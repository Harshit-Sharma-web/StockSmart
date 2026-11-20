from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Supplier(models.Model):
    name = models.CharField(max_length=150, unique=True)
    contact_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]


class SupplierProduct(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT)
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    lead_time_days = models.PositiveIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["supplier", "product"], name="unique_supplier_product"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="nonnegative_supplier_cost"),
        ]


class PurchaseOrder(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        ORDERED = "ordered", "Ordered"
        PARTIAL = "partial", "Partially received"
        RECEIVED = "received", "Received"
        CANCELLED = "cancelled", "Cancelled"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT)
    location = models.ForeignKey("locations.Location", on_delete=models.PROTECT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    expected_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    approved_at = models.DateTimeField(null=True)
    ordered_at = models.DateTimeField(null=True)
    received_at = models.DateTimeField(null=True)
    cancelled_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-id"]


class PurchaseItem(models.Model):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="items")
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    received = models.PositiveIntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "product"], name="unique_purchase_product"),
            models.CheckConstraint(condition=Q(quantity__gt=0, received__lte=F("quantity"), unit_cost__gte=0), name="valid_purchase_item"),
        ]


class Receipt(models.Model):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="receipts")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    client_key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "client_key"], name="unique_purchase_receipt_key"),
        ]


class ReceiptItem(models.Model):
    receipt = models.ForeignKey(Receipt, on_delete=models.PROTECT, related_name="items")
    purchase_item = models.ForeignKey(PurchaseItem, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["receipt", "purchase_item"], name="unique_receipt_purchase_item"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="positive_receipt_quantity"),
        ]
