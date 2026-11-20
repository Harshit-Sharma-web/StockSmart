from django.db.models import F, Sum
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common import OperatorOnly, PositiveQuantity, locations_for, scoped_location, unique_items
from apps.products.models import Product
from .models import Balance, Movement, Transfer, TransferItem
from .services import create_transfer, manual_movement, update_transfer


class BalanceSerializer(serializers.ModelSerializer):
    available = serializers.IntegerField(read_only=True)

    class Meta:
        model = Balance
        fields = ("id", "location", "product", "on_hand", "reserved", "available", "low_stock_threshold")
        read_only_fields = fields


class MovementSerializer(serializers.ModelSerializer):
    location = serializers.IntegerField(source="balance.location_id", read_only=True)
    product = serializers.IntegerField(source="balance.product_id", read_only=True)

    class Meta:
        model = Movement
        fields = (
            "id", "location", "product", "kind", "on_hand_delta", "reserved_delta",
            "on_hand_after", "reserved_after", "unit_cost", "actor", "reference", "note", "created_at",
        )
        read_only_fields = fields


class ThresholdInput(serializers.Serializer):
    low_stock_threshold = serializers.IntegerField(min_value=0, max_value=1_000_000)


class TotalsSerializer(serializers.Serializer):
    on_hand = serializers.IntegerField()
    reserved = serializers.IntegerField()
    available = serializers.IntegerField()


class Balances(viewsets.ReadOnlyModelViewSet):
    queryset = Balance.objects.all()
    serializer_class = BalanceSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("location", "product")
    ordering_fields = ("on_hand", "reserved", "id")

    def get_queryset(self):
        return self.queryset.filter(location__in=locations_for(self.request.user))

    @extend_schema(responses=TotalsSerializer)
    @action(detail=False)
    def totals(self, request):
        totals = self.filter_queryset(self.get_queryset()).aggregate(
            on_hand=Sum("on_hand", default=0), reserved=Sum("reserved", default=0),
        )
        totals["available"] = totals["on_hand"] - totals["reserved"]
        return Response(totals)

    @action(detail=False, url_path="low-stock")
    def low_stock(self, request):
        balances = self.filter_queryset(self.get_queryset()).filter(
            product__active=True, on_hand__lte=F("reserved") + F("low_stock_threshold"),
        )
        return self.get_paginated_response(self.get_serializer(self.paginate_queryset(balances), many=True).data)


    @extend_schema(request=ThresholdInput, responses=BalanceSerializer)
    @action(detail=True, methods=["patch"], url_path="threshold")
    def threshold(self, request, pk=None):
        balance = self.get_object()
        serializer = ThresholdInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        balance.low_stock_threshold = serializer.validated_data["low_stock_threshold"]
        balance.save(update_fields=["low_stock_threshold"])
        return Response(self.get_serializer(balance).data)


class MovementInput(serializers.Serializer):
    location = serializers.IntegerField(min_value=1)
    product = serializers.IntegerField(min_value=1)
    kind = serializers.ChoiceField(choices=[
        Movement.Kind.OPENING, Movement.Kind.RECEIPT, Movement.Kind.ADJUSTMENT,
        Movement.Kind.DAMAGE, Movement.Kind.LOSS,
    ])
    quantity = serializers.IntegerField(min_value=-1_000_000, max_value=1_000_000)
    note = serializers.CharField(required=False, max_length=250, allow_blank=True, default="")
    scan = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        kind, quantity = attrs["kind"], attrs["quantity"]
        if not quantity:
            raise serializers.ValidationError({"quantity": "Quantity must be nonzero."})
        if kind in (Movement.Kind.OPENING, Movement.Kind.RECEIPT) and quantity < 0:
            raise serializers.ValidationError({"quantity": "Use a positive quantity."})
        if kind in (Movement.Kind.DAMAGE, Movement.Kind.LOSS) and quantity > 0:
            raise serializers.ValidationError({"quantity": "Use a negative quantity."})
        if kind in (Movement.Kind.ADJUSTMENT, Movement.Kind.DAMAGE, Movement.Kind.LOSS) and not attrs["note"]:
            raise serializers.ValidationError({"note": "Provide a reason."})
        return attrs


class Movements(viewsets.ReadOnlyModelViewSet):
    queryset = Movement.objects.select_related("balance")
    serializer_class = MovementSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("balance__location", "balance__product", "kind")
    ordering_fields = ("created_at", "id")

    def get_queryset(self):
        return self.queryset.filter(balance__location__in=locations_for(self.request.user))

    @extend_schema(request=MovementInput, responses={201: MovementSerializer})
    def create(self, request):
        from django.shortcuts import get_object_or_404
        from apps.scanning.models import ScanEvent

        serializer = MovementInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = dict(serializer.validated_data)
        location = scoped_location(request.user, fields.pop("location"))
        product_id = fields.pop("product")
        scan_id = fields.pop("scan", None)
        scan = get_object_or_404(ScanEvent, pk=scan_id, location=location) if scan_id else None
        movement = manual_movement(
            actor=request.user, location_id=location.pk, product_id=product_id, scan=scan, **fields,
        )
        return Response(self.get_serializer(movement).data, status=201)


class TransferItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransferItem
        fields = ("product", "quantity")


class TransferSerializer(serializers.ModelSerializer):
    items = TransferItemSerializer(many=True, read_only=True)

    class Meta:
        model = Transfer
        fields = ("id", "source", "destination", "status", "items", "created_by", "created_at", "completed_at")
        read_only_fields = fields


class TransferLineInput(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.filter(active=True))
    quantity = PositiveQuantity()


class TransferInput(serializers.Serializer):
    source = serializers.IntegerField(min_value=1)
    destination = serializers.IntegerField(min_value=1)
    items = TransferLineInput(many=True, allow_empty=False, max_length=100)

    def validate_items(self, items):
        return unique_items(items, "product")

    def validate(self, attrs):
        if attrs["source"] == attrs["destination"]:
            raise serializers.ValidationError({"destination": "Select a different location."})
        return attrs


class Transfers(viewsets.ReadOnlyModelViewSet):
    queryset = Transfer.objects.prefetch_related("items")
    serializer_class = TransferSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("source", "destination", "status")

    def get_queryset(self):
        locations = locations_for(self.request.user)
        return self.queryset.filter(source__in=locations, destination__in=locations)

    @extend_schema(request=TransferInput, responses={201: TransferSerializer})
    def create(self, request):
        serializer = TransferInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        transfer = create_transfer(
            source=scoped_location(request.user, data["source"]),
            destination=scoped_location(request.user, data["destination"]),
            items=data["items"], actor=request.user,
        )
        return Response(self.get_serializer(transfer).data, status=201)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return Response(self.get_serializer(update_transfer(self.get_object().pk, Transfer.Status.COMPLETED, request.user)).data)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return Response(self.get_serializer(update_transfer(self.get_object().pk, Transfer.Status.CANCELLED, request.user)).data)
