from django.conf import settings
from django.db import models


class RFIDTag(models.Model):
    identifier = models.CharField(max_length=64, unique=True)
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class ScanEvent(models.Model):
    class Kind(models.TextChoices):
        BARCODE = "barcode", "Barcode"
        RFID = "rfid", "RFID"

    location = models.ForeignKey("locations.Location", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    tag = models.ForeignKey(RFIDTag, null=True, on_delete=models.PROTECT)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    identifier = models.CharField(max_length=80)
    client_key = models.UUIDField()
    simulated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["location", "client_key"], name="unique_location_scan_key"),
        ]
