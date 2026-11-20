from rest_framework import serializers, viewsets
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS

from apps.accounts.models import User
from apps.common import AdminOnly, is_operator, locations_for
from .models import Location, LocationAssignment


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ("id", "code", "name", "kind", "address", "active")


class AssignmentSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.MANAGER, is_active=True))

    class Meta:
        model = LocationAssignment
        fields = ("id", "user", "location")


class Locations(viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    filterset_fields = ("kind", "active")
    search_fields = ("name", "code")

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method in SAFE_METHODS else [AdminOnly()]

    def get_queryset(self):
        if is_operator(self.request.user):
            return locations_for(self.request.user)
        return self.queryset.filter(active=True, kind=Location.Kind.STORE)

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active"])


class Assignments(viewsets.ModelViewSet):
    queryset = LocationAssignment.objects.all()
    serializer_class = AssignmentSerializer
    permission_classes = (AdminOnly,)
    filterset_fields = ("user", "location")
