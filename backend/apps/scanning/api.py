from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import generics, serializers, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common import AdminOnly, OperatorOnly, is_operator, locations_for, scoped_location
from apps.inventory.services import Conflict, lock_locations
from apps.products.api import ProductSerializer
from apps.products.models import Product
from .models import RFIDTag, ScanEvent


def normalize_epc(value):
    value = value.upper()
    if len(value) % 2 or not 8 <= len(value) <= 64 or any(char not in "0123456789ABCDEF" for char in value):
        raise serializers.ValidationError("Use 8 to 64 hexadecimal characters in whole bytes.")
    return value


class RFIDSerializer(serializers.ModelSerializer):
    identifier = serializers.CharField(max_length=64)
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.filter(active=True))

    class Meta:
        model = RFIDTag
        fields = ("id", "identifier", "product", "active", "created_at")

    def validate_identifier(self, value):
        value = normalize_epc(value)
        if RFIDTag.objects.filter(identifier=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This tag already exists.")
        return value

    def validate(self, attrs):
        if self.instance and any(
            key in attrs and attrs[key] != getattr(self.instance, key) for key in ("identifier", "product")
        ):
            raise serializers.ValidationError("Deactivate this tag and register a new identifier.")
        return attrs

    def create(self, validated_data):
        from django.db import IntegrityError

        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError as exc:
            if RFIDTag.objects.filter(identifier=validated_data["identifier"]).exists():
                raise Conflict("This tag already exists.") from exc
            raise


class RFIDTags(viewsets.ModelViewSet):
    queryset = RFIDTag.objects.all()
    serializer_class = RFIDSerializer
    permission_classes = (AdminOnly,)
    filterset_fields = ("product", "active")
    search_fields = ("identifier",)

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active"])


class ScanSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScanEvent
        fields = ("id", "location", "product", "tag", "kind", "identifier", "client_key", "simulated", "actor", "created_at")
        read_only_fields = fields


class ScanInput(serializers.Serializer):
    location = serializers.IntegerField(min_value=1)
    kind = serializers.ChoiceField(choices=ScanEvent.Kind.choices)
    identifier = serializers.CharField(max_length=80)
    client_key = serializers.UUIDField()
    simulated = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs["kind"] == ScanEvent.Kind.RFID:
            attrs["identifier"] = normalize_epc(attrs["identifier"])
        if attrs["kind"] == ScanEvent.Kind.BARCODE and attrs["simulated"]:
            raise serializers.ValidationError({"simulated": "Only RFID scans support simulation."})
        return attrs


class BarcodeLookup(generics.RetrieveAPIView):
    serializer_class = ProductSerializer
    permission_classes = (IsAuthenticated,)
    lookup_field = "barcode"

    def get_queryset(self):
        products = Product.objects.prefetch_related("images")
        if not is_operator(self.request.user):
            return products.filter(active=True)
        return products


class Scans(viewsets.ReadOnlyModelViewSet):
    queryset = ScanEvent.objects.all()
    serializer_class = ScanSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("location", "product", "kind", "simulated")
    ordering_fields = ("created_at", "id")

    def get_queryset(self):
        return self.queryset.filter(location__in=locations_for(self.request.user))

    @extend_schema(request=ScanInput, responses={201: ScanSerializer, 200: ScanSerializer})
    @transaction.atomic
    def create(self, request):
        serializer = ScanInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        location = scoped_location(request.user, data.pop("location"))
        lock_locations(location.pk)
        previous = ScanEvent.objects.filter(location=location, client_key=data["client_key"]).first()
        if previous:
            if any(getattr(previous, key) != data[key] for key in ("kind", "identifier", "simulated")):
                raise Conflict("This scan key was already used for a different request.")
            return Response(self.get_serializer(previous).data)
        tag = None
        if data["kind"] == ScanEvent.Kind.RFID:
            tag = get_object_or_404(RFIDTag.objects.select_related("product"), identifier=data["identifier"], active=True, product__active=True)
            product = tag.product
        else:
            product = get_object_or_404(Product, barcode=data["identifier"], active=True)
        scan = ScanEvent.objects.create(location=location, actor=request.user, product=product, tag=tag, **data)
        return Response(self.get_serializer(scan).data, status=201)
