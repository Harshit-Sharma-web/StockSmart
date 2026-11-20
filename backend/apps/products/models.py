from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


class Category(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]


class Product(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    sku = models.CharField(max_length=48, unique=True)
    name = models.CharField(max_length=150, db_index=True)
    description = models.TextField(blank=True)
    barcode = models.CharField(max_length=80, unique=True, null=True, blank=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=Q(purchase_price__gte=0, selling_price__gte=0), name="product_prices_nonnegative"),
        ]


class ProductImage(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    url = models.URLField(max_length=500)
    alt_text = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["id"]
