from django.db.models import Exists, F, OuterRef
from django.shortcuts import get_object_or_404
from django_filters import rest_framework as filters
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from apps.common import CatalogPermission, is_operator, locations_for
from apps.inventory.models import Balance
from apps.locations.models import Location
from .models import Category, Product, ProductImage


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "description")


class ProductImageSerializer(serializers.ModelSerializer):
    url = serializers.URLField(max_length=500)

    class Meta:
        model = ProductImage
        fields = ("id", "url", "alt_text")

    def validate_url(self, url):
        if not url.lower().startswith(("https://", "http://")):
            raise serializers.ValidationError("Use an HTTP or HTTPS image URL.")
        return url


# Custom field to accept either a PK or a category name (string)
class CategoryRelatedField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        # Allow integer PK as usual
        if isinstance(data, int):
            return super().to_internal_value(data)
        # Allow string name – get or create the Category
        if isinstance(data, str):
            # Trim whitespace
            name = data.strip()
            if not name:
                raise serializers.ValidationError('Category name cannot be empty')
            # Try to fetch existing category by name (case‑insensitive)
            try:
                return Category.objects.get(name__iexact=name)
            except Category.DoesNotExist:
                # Create a new Category with the given name
                return Category.objects.create(name=name)
        # Anything else is invalid
        raise serializers.ValidationError('Category must be an integer ID or a string name')
class ProductSerializer(serializers.ModelSerializer):
    category = CategoryRelatedField(queryset=Category.objects.all())
    images = ProductImageSerializer(many=True, read_only=True)

    class Meta:
        model = Product
        fields = (
            "id", "category", "sku", "name", "description", "barcode", "purchase_price",
            "selling_price", "active", "images", "created_at", "updated_at",
        )
        extra_kwargs = {"barcode": {"allow_blank": False, "allow_null": True}}

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None and not is_operator(request.user):
            fields.pop("purchase_price")
        return fields


class ProductFilter(filters.FilterSet):
    min_price = filters.NumberFilter(field_name="selling_price", lookup_expr="gte")
    max_price = filters.NumberFilter(field_name="selling_price", lookup_expr="lte")
    available = filters.BooleanFilter(method="filter_available")
    location = filters.NumberFilter(method="filter_location", min_value=1, max_value=2**63 - 1)

    def filter_location(self, queryset, name, value):
        if self.form.cleaned_data.get("available") is None:
            raise ValidationError({"location": "Use this filter with available=true or available=false."})
        return queryset

    def filter_available(self, queryset, name, value):
        locations = (
            locations_for(self.request.user, active=True) if is_operator(self.request.user)
            else Location.objects.filter(active=True, kind=Location.Kind.STORE)
        )
        location_id = self.form.cleaned_data.get("location")
        if location_id is not None:
            if location_id != location_id.to_integral_value():
                raise ValidationError({"location": "Use a whole-number location ID."})
            location = get_object_or_404(locations, pk=int(location_id))
            locations = locations.filter(pk=location.pk)
        stock = Balance.objects.filter(product=OuterRef("pk"), location__in=locations, on_hand__gt=F("reserved"))
        return queryset.filter(Exists(stock) if value else ~Exists(stock))

    class Meta:
        model = Product
        fields = ("category", "active")


class Products(viewsets.ModelViewSet):
    queryset = Product.objects.prefetch_related("images")
    serializer_class = ProductSerializer
    permission_classes = (IsAuthenticated, CatalogPermission)
    filterset_class = ProductFilter
    search_fields = ("sku", "name", "description", "barcode")
    ordering_fields = ("name", "selling_price", "created_at")

    def get_queryset(self):
        if is_operator(self.request.user):
            return self.queryset
        return self.queryset.filter(active=True)

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class Categories(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = (IsAuthenticated, CatalogPermission)
    search_fields = ("name",)

    def perform_destroy(self, instance):
        from django.db.models import ProtectedError

        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError("A category with products cannot be deleted.") from exc


class ImageWriteSerializer(ProductImageSerializer):
    class Meta(ProductImageSerializer.Meta):
        fields = ProductImageSerializer.Meta.fields + ("product",)


class Images(viewsets.ModelViewSet):
    queryset = ProductImage.objects.all()
    serializer_class = ImageWriteSerializer
    permission_classes = (IsAuthenticated, CatalogPermission)
    filterset_fields = ("product",)

    def get_queryset(self):
        if is_operator(self.request.user):
            return self.queryset
        return self.queryset.filter(product__active=True)
