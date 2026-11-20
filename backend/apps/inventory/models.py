from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Balance(models.Model):
    location = models.ForeignKey("locations.Location", on_delete=models.PROTECT)
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    on_hand = models.PositiveBigIntegerField(default=0)
    reserved = models.PositiveBigIntegerField(default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)

    @property
    def available(self):
        return self.on_hand - self.reserved

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["location", "product"], name="unique_stock_balance"),
            models.CheckConstraint(condition=Q(reserved__lte=F("on_hand")), name="reserved_within_on_hand"),
        ]


class Movement(models.Model):
    class Kind(models.TextChoices):
        OPENING = "opening", "Opening"
        RECEIPT = "receipt", "Receipt"
        ADJUSTMENT = "adjustment", "Adjustment"
        DAMAGE = "damage", "Damage"
        LOSS = "loss", "Loss"
        TRANSFER_OUT = "transfer_out", "Transfer out"
        TRANSFER_IN = "transfer_in", "Transfer in"
        RESERVE = "reserve", "Reserve"
        RELEASE = "release", "Release"
        SHIP = "ship", "Ship"
        RETURN = "return", "Verified return"

    balance = models.ForeignKey(Balance, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    on_hand_delta = models.BigIntegerField()
    reserved_delta = models.BigIntegerField(default=0)
    on_hand_after = models.PositiveBigIntegerField()
    reserved_after = models.PositiveBigIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reference = models.CharField(max_length=100, blank=True)
    note = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["balance", "created_at", "id"], name="movement_balance_time")]


class Transfer(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    source = models.ForeignKey("locations.Location", on_delete=models.PROTECT, related_name="outgoing")
    destination = models.ForeignKey("locations.Location", on_delete=models.PROTECT, related_name="incoming")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-id"]
        constraints = [
            models.CheckConstraint(condition=~Q(source=F("destination")), name="different_transfer_locations"),
        ]


class TransferItem(models.Model):
    transfer = models.ForeignKey(Transfer, on_delete=models.PROTECT, related_name="items")
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["transfer", "product"], name="unique_transfer_product"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="positive_transfer_quantity"),
        ]
