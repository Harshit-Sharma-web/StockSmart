from django.db import transaction
from rest_framework import generics, mixins, serializers, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.common import AdminOnly
from .models import User
from .serializers import (
    ChangePasswordSerializer, LogoutSerializer, ProfileSerializer, RegisterSerializer, UserAdminSerializer,
)


class AuthThrottle:
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"


class Register(AuthThrottle, generics.CreateAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RegisterSerializer


class Login(AuthThrottle, TokenObtainPairView):
    pass


class Refresh(AuthThrottle, TokenRefreshView):
    pass


class Profile(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer

    def get_object(self):
        return self.request.user


class Logout(generics.GenericAPIView):
    serializer_class = LogoutSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            token = RefreshToken(serializer.validated_data["refresh"])
            if str(token.get("user_id")) != str(request.user.pk):
                raise serializers.ValidationError({"refresh": "Invalid refresh token."})
            token.blacklist()
        except TokenError as exc:
            raise serializers.ValidationError({"refresh": "Invalid or expired refresh token."}) from exc
        return Response(status=204)


class ChangePassword(AuthThrottle, generics.GenericAPIView):
    serializer_class = ChangePasswordSerializer

    @transaction.atomic
    def post(self, request):
        request.user = User.objects.select_for_update().get(pk=request.user.pk)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        for token in OutstandingToken.objects.filter(user=request.user):
            BlacklistedToken.objects.get_or_create(token=token)
        return Response(status=204)


class Users(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = User.objects.order_by("id")
    serializer_class = UserAdminSerializer
    permission_classes = (AdminOnly,)
    search_fields = ("username", "email")
    filterset_fields = ("role", "is_active")

    def perform_update(self, serializer):
        user = serializer.instance
        if user.pk == self.request.user.pk or user.is_superuser:
            raise serializers.ValidationError("This account cannot be changed through this endpoint.")
        serializer.save()
