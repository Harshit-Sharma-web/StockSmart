from django.core.validators import MinValueValidator
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.common import AdminOnly, OperatorOnly, locations_for, scoped_location, unique_items
from apps.orders.api import LineInput
from .models import PurchaseItem, PurchaseOrder, Receipt, ReceiptItem, Supplier, SupplierProduct
from .services import create_purchase, edit_purchase, receive, transition_purchase


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ("id", "name", "contact_name", "email", "phone", "address", "active")


class SupplierOfferSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierProduct
        fields = ("id", "supplier", "product", "unit_cost", "lead_time_days")
        extra_kwargs = {"unit_cost": {"validators": [MinValueValidator(0)]}}


class Suppliers(viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    filterset_fields = ("active",)
    search_fields = ("name", "contact_name")

    def get_permissions(self):
        return [OperatorOnly()] if self.action in {"list", "retrieve"} else [AdminOnly()]

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active"])


class SupplierOffers(viewsets.ModelViewSet):
    queryset = SupplierProduct.objects.all()
    serializer_class = SupplierOfferSerializer
    filterset_fields = ("supplier", "product")

    def get_permissions(self):
        return [OperatorOnly()] if self.action in {"list", "retrieve"} else [AdminOnly()]


    def perform_destroy(self, instance):
        from django.db.models import ProtectedError

        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError("Remove dependent reorder rules before deleting this supplier offer.") from exc


class PurchaseLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseItem
        fields = ("product", "quantity", "received", "unit_cost")


class ReceiptLineSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="purchase_item.product_id")

    class Meta:
        model = ReceiptItem
        fields = ("product", "quantity")


class ReceiptSerializer(serializers.ModelSerializer):
    items = ReceiptLineSerializer(many=True)

    class Meta:
        model = Receipt
        fields = ("id", "actor", "created_at", "items")


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseLineSerializer(many=True)
    receipts = ReceiptSerializer(many=True)

    class Meta:
        model = PurchaseOrder
        fields = (
            "id", "supplier", "location", "status", "expected_date", "created_by", "approved_by",
            "created_at", "approved_at", "ordered_at", "received_at", "cancelled_at", "items", "receipts",
        )


class PurchaseEditInput(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.filter(active=True), required=False)
    expected_date = serializers.DateField(required=False)
    items = LineInput(many=True, allow_empty=False, max_length=100, required=False)

    def validate_items(self, items):
        return unique_items(items, "product")


class PurchaseInput(PurchaseEditInput):
    location = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        missing = {"supplier", "expected_date", "items"} - attrs.keys()
        if missing:
            raise serializers.ValidationError({key: "This field is required." for key in missing})
        return attrs


class PurchaseStatusInput(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        PurchaseOrder.Status.APPROVED, PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.CANCELLED,
    ])


class ReceiveInput(serializers.Serializer):
    client_key = serializers.UUIDField()
    items = LineInput(many=True, allow_empty=False, max_length=100)

    def validate_items(self, items):
        return unique_items(items, "product")


class Purchases(viewsets.ReadOnlyModelViewSet):
    queryset = PurchaseOrder.objects.prefetch_related("items", "receipts__items__purchase_item")
    serializer_class = PurchaseSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("location", "supplier", "status")
    ordering_fields = ("expected_date", "created_at")

    def get_queryset(self):
        return self.queryset.filter(location__in=locations_for(self.request.user))

    @extend_schema(request=PurchaseInput, responses={201: PurchaseSerializer})
    def create(self, request):
        serializer = PurchaseInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        location = scoped_location(request.user, data.pop("location"))
        order = create_purchase(actor=request.user, location_id=location.pk, **data)
        return Response(self.get_serializer(order).data, status=201)

    @extend_schema(request=PurchaseEditInput)
    def partial_update(self, request, pk=None):
        order = self.get_object()
        serializer = PurchaseEditInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(self.get_serializer(edit_purchase(order.pk, **serializer.validated_data)).data)

    @extend_schema(request=PurchaseStatusInput)
    @action(detail=True, methods=["post"], url_path="status")
    def change_status(self, request, pk=None):
        serializer = PurchaseStatusInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = transition_purchase(self.get_object().pk, serializer.validated_data["status"], request.user)
        return Response(self.get_serializer(order).data)

    @extend_schema(request=ReceiveInput)
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        serializer = ReceiveInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = receive(order_id=self.get_object().pk, actor=request.user, **serializer.validated_data)
        return Response(self.get_serializer(order).data)

    @action(detail=False, url_path="delivery-alerts")
    def delivery_alerts(self, request):
        from django.utils import timezone

        orders = self.filter_queryset(self.get_queryset()).filter(
            expected_date__lt=timezone.localdate(),
            status__in=[PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.PARTIAL],
        )
        return self.get_paginated_response(self.get_serializer(self.paginate_queryset(orders), many=True).data)
