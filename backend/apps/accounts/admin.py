from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class StockSmartUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("StockSmart", {"fields": ("role",)}),)
