from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework import serializers

from .models import User


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "role")
        read_only_fields = ("id", "username", "role")


class RegisterSerializer(ProfileSerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    class Meta(ProfileSerializer.Meta):
        fields = ProfileSerializer.Meta.fields + ("password",)
        read_only_fields = ("id", "role")

    def validate(self, attrs):
        try:
            validate_password(attrs["password"], User(**{k: v for k, v in attrs.items() if k != "password"}))
        except ValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserAdminSerializer(ProfileSerializer):
    class Meta(ProfileSerializer.Meta):
        fields = ProfileSerializer.Meta.fields + ("is_active",)
        read_only_fields = ("id", "username")


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "Incorrect password."})
        try:
            validate_password(attrs["new_password"], user)
        except ValidationError as exc:
            raise serializers.ValidationError({"new_password": exc.messages}) from exc
        return attrs


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()
