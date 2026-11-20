from django.db import models


class ReorderRule(models.Model):
    location = models.ForeignKey("locations.Location", on_delete=models.PROTECT)
    offer = models.ForeignKey("purchasing.SupplierProduct", on_delete=models.PROTECT)
    safety_stock = models.PositiveIntegerField(default=0)
    demand_window_days = models.PositiveSmallIntegerField(default=30)
    target_stock = models.PositiveIntegerField(default=0)
    lead_time_override_days = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["location", "offer"], name="unique_location_reorder_offer"),
            models.CheckConstraint(
                condition=models.Q(demand_window_days__gte=1, demand_window_days__lte=365), name="valid_demand_window",
            ),
        ]
