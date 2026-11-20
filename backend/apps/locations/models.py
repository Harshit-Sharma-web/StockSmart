from django.conf import settings
from django.db import models


class Location(models.Model):
    class Kind(models.TextChoices):
        STORE = "store", "Store"
        WAREHOUSE = "warehouse", "Warehouse"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=150)
    kind = models.CharField(max_length=12, choices=Kind.choices)
    address = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["code"]


class LocationAssignment(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="assignments")

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "location"], name="unique_user_location"),
        ]
