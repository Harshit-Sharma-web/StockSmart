from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.common import PositiveQuantity, is_operator, locations_for, unique_items
from .models import Order, OrderItem, Shipment, ShipmentItem, StockReturn, StockReturnItem
from .services import place_order, receive_return, ship, transition


class LineInput(serializers.Serializer):
    product = serializers.IntegerField(min_value=1)
    quantity = PositiveQuantity()


class CreateOrder(serializers.Serializer):
    location = serializers.IntegerField(min_value=1, source="location_id")
    client_key = serializers.UUIDField(required=False)
    items = LineInput(many=True, allow_empty=False, max_length=100)

    def validate_items(self, items):
        return unique_items(items, "product")


class ShipmentInput(serializers.Serializer):
    client_key = serializers.UUIDField()
    tracking_number = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    items = LineInput(many=True, allow_empty=False, max_length=100, required=False)

    def validate_items(self, items):
        return unique_items(items, "product")


class ReturnInput(serializers.Serializer):
    client_key = serializers.UUIDField()
    reason = serializers.CharField(max_length=250)
    items = LineInput(many=True, allow_empty=False, max_length=100)

    def validate_items(self, items):
        return unique_items(items, "product")


class StatusInput(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        Order.Status.CONFIRMED, Order.Status.PICKING, Order.Status.PACKED, Order.Status.DELIVERED,
    ])


class OrderLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ("product", "quantity", "shipped", "returned", "unit_price")


class ShipmentLineSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="order_item.product_id")

    class Meta:
        model = ShipmentItem
        fields = ("product", "quantity")


class ShipmentSerializer(serializers.ModelSerializer):
    items = ShipmentLineSerializer(many=True)

    class Meta:
        model = Shipment
        fields = ("id", "tracking_number", "shipped_at", "items")


class ReturnLineSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="order_item.product_id")

    class Meta:
        model = StockReturnItem
        fields = ("product", "quantity")


class ReturnSerializer(serializers.ModelSerializer):
    items = ReturnLineSerializer(many=True)

    class Meta:
        model = StockReturn
        fields = ("id", "reason", "created_at", "items")


class OrderSerializer(serializers.ModelSerializer):
    items = OrderLineSerializer(many=True)
    shipments = ShipmentSerializer(many=True)
    returns = ReturnSerializer(many=True)

    class Meta:
        model = Order
        fields = (
            "id", "customer", "location", "status", "total", "items", "shipments", "returns", "created_at",
            "confirmed_at", "picking_at", "packed_at", "shipped_at", "delivered_at", "cancelled_at",
        )


class Orders(viewsets.ReadOnlyModelViewSet):
    queryset = Order.objects.prefetch_related("items", "shipments__items__order_item", "returns__items__order_item")
    serializer_class = OrderSerializer
    filterset_fields = ("location", "status")
    ordering_fields = ("created_at", "total", "id")

    def get_queryset(self):
        user = self.request.user
        if is_operator(user):
            return self.queryset.filter(location__in=locations_for(user))
        return self.queryset.filter(customer=user)

    @extend_schema(request=CreateOrder, responses={201: OrderSerializer, 200: OrderSerializer})
    def create(self, request):
        if is_operator(request.user):
            raise PermissionDenied("Use a customer account to place orders.")
        serializer = CreateOrder(data=request.data)
        serializer.is_valid(raise_exception=True)
        order, created = place_order(customer=request.user, **serializer.validated_data)
        return Response(self.get_serializer(order).data, status=201 if created else 200)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = transition(
            self.get_object().pk, Order.Status.CANCELLED, request.user,
            customer_action=not is_operator(request.user),
        )
        return Response(self.get_serializer(order).data)

    @extend_schema(request=StatusInput, filters=False)
    @action(detail=True, methods=["post"], url_path="status")
    def change_status(self, request, pk=None):
        if not is_operator(request.user):
            raise PermissionDenied()
        serializer = StatusInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = transition(self.get_object().pk, serializer.validated_data["status"], request.user)
        return Response(self.get_serializer(order).data)

    @extend_schema(request=ShipmentInput)
    @action(detail=True, methods=["post"])
    def ship(self, request, pk=None):
        if not is_operator(request.user):
            raise PermissionDenied()
        serializer = ShipmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = ship(order_id=self.get_object().pk, actor=request.user, **serializer.validated_data)
        return Response(self.get_serializer(order).data)


    @extend_schema(request=ReturnInput)
    @action(detail=True, methods=["post"], url_path="receive-return")
    def receive_return(self, request, pk=None):
        if not is_operator(request.user):
            raise PermissionDenied()
        serializer = ReturnInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = receive_return(order_id=self.get_object().pk, actor=request.user, **serializer.validated_data)
        return Response(self.get_serializer(order).data)
