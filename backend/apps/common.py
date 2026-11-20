from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers

from apps.accounts.models import User


def is_admin(user):
    return user.is_authenticated and (user.is_superuser or user.role == User.Role.ADMIN)


def is_operator(user):
    return is_admin(user) or (user.is_authenticated and user.role == User.Role.MANAGER)


def locations_for(user, *, active=False):
    from apps.locations.models import Location

    locations = Location.objects.all()
    if active:
        locations = locations.filter(active=True)
    if is_admin(user):
        return locations
    if is_operator(user):
        return locations.filter(assignments__user=user)
    return locations.none()


def scoped_location(user, location_id):
    return get_object_or_404(locations_for(user, active=True), pk=location_id)


class AdminOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return is_admin(request.user)


class OperatorOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return is_operator(request.user)


class CatalogPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS or is_admin(request.user):
            return True
        if not is_operator(request.user) or not locations_for(request.user, active=True).exists():
            return False
        model = view.queryset.model._meta
        operation = {"POST": "add", "PUT": "change", "PATCH": "change", "DELETE": "delete"}.get(request.method)
        return bool(operation and request.user.has_perm(f"{model.app_label}.{operation}_{model.model_name}"))


class PositiveQuantity(serializers.IntegerField):
    def __init__(self, **kwargs):
        super().__init__(min_value=1, max_value=1_000_000, **kwargs)


def unique_items(items, key):
    ids = [item[key] for item in items]
    if len(ids) != len(set(ids)):
        raise serializers.ValidationError("Each item must appear only once.")
    return items
