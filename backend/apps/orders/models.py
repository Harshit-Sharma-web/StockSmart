from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        PICKING = "picking", "Picking"
        PACKED = "packed", "Packed"
        PARTIAL = "partial", "Partially shipped"
        SHIPPED = "shipped", "Shipped"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    location = models.ForeignKey("locations.Location", on_delete=models.PROTECT)
    client_key = models.UUIDField(null=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    total = models.DecimalField(max_digits=22, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    confirmed_at = models.DateTimeField(null=True)
    picking_at = models.DateTimeField(null=True)
    packed_at = models.DateTimeField(null=True)
    shipped_at = models.DateTimeField(null=True)
    delivered_at = models.DateTimeField(null=True)
    cancelled_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["customer", "client_key"], name="unique_customer_order_key"),
        ]


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="items")
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    shipped = models.PositiveIntegerField(default=0)
    returned = models.PositiveIntegerField(default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "product"], name="unique_order_product"),
            models.CheckConstraint(
                condition=Q(quantity__gt=0, shipped__lte=F("quantity"), returned__lte=F("shipped")),
                name="valid_order_quantities",
            ),
        ]


class Shipment(models.Model):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="shipments")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    client_key = models.UUIDField()
    tracking_number = models.CharField(max_length=120, blank=True)
    shipped_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "client_key"], name="unique_shipment_key"),
        ]


class ShipmentItem(models.Model):
    shipment = models.ForeignKey(Shipment, on_delete=models.PROTECT, related_name="items")
    order_item = models.ForeignKey(OrderItem, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["shipment", "order_item"], name="unique_shipment_order_item"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="positive_shipment_quantity"),
        ]


class StockReturn(models.Model):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="returns")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    client_key = models.UUIDField()
    reason = models.CharField(max_length=250)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "client_key"], name="unique_stock_return_key"),
        ]


class StockReturnItem(models.Model):
    stock_return = models.ForeignKey(StockReturn, on_delete=models.PROTECT, related_name="items")
    order_item = models.ForeignKey(OrderItem, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["stock_return", "order_item"], name="unique_return_order_item"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="positive_return_quantity"),
        ]
