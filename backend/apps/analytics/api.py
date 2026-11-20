import csv
from datetime import timedelta
from decimal import Decimal

from django.db.models import F
from django.http import StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.generics import GenericAPIView
from rest_framework.response import Response

from apps.common import OperatorOnly, locations_for, scoped_location
from apps.inventory.models import Movement
from apps.purchasing.models import PurchaseOrder
from . import reports
from .models import ReorderRule


class RuleSerializer(serializers.ModelSerializer):
    demand_window_days = serializers.IntegerField(min_value=1, max_value=365, default=30)

    class Meta:
        model = ReorderRule
        fields = ("id", "location", "offer", "safety_stock", "demand_window_days", "target_stock", "lead_time_override_days")

    def validate_location(self, location):
        return scoped_location(self.context["request"].user, location.pk)


class Rules(viewsets.ModelViewSet):
    queryset = ReorderRule.objects.all()
    serializer_class = RuleSerializer
    permission_classes = (OperatorOnly,)
    filterset_fields = ("location", "offer")

    def get_queryset(self):
        return self.queryset.filter(location__in=locations_for(self.request.user))


class ReportInput(serializers.Serializer):
    location = serializers.IntegerField(min_value=1, required=False)
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
    group = serializers.ChoiceField(choices=["day", "week", "month"], default="day")
    export = serializers.ChoiceField(choices=["csv"], required=False)

    def validate(self, attrs):
        end = attrs.get("end", timezone.localdate())
        start = attrs.get("start")
        if start is None:
            start = end - timedelta(days=min(end.toordinal() - 1, 29))
        if start > end or (end - start).days > 365:
            raise serializers.ValidationError("Use an ordered date range of at most 366 days.")
        return {**attrs, "start": start, "end": end}


class CsvOutput:
    def write(self, value):
        return value


def csv_value(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def json_values(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: json_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_values(item) for item in value]
    return value


REPORT_NAMES = [
    "dashboard", "sales", "inventory", "movements", "products", "low-stock", "purchase-orders", "suppliers", "reorder",
]


class Report(GenericAPIView):
    serializer_class = ReportInput
    permission_classes = (OperatorOnly,)
    filter_backends = ()

    @extend_schema(parameters=[
        ReportInput, OpenApiParameter("report", str, OpenApiParameter.PATH, enum=REPORT_NAMES),
    ], responses={
        200: OpenApiResponse(response={"type": "object", "additionalProperties": True}, description="Report or CSV export."),
    })
    def get(self, request, report):
        serializer = self.get_serializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        params = serializer.validated_data
        locations = locations_for(request.user)
        if "location" in params:
            from django.shortcuts import get_object_or_404

            location = get_object_or_404(locations, pk=params["location"])
            locations = locations.filter(pk=location.pk)
        start, end = params["start"], params["end"]
        if report == "dashboard":
            if "export" in params:
                raise serializers.ValidationError({"export": "The dashboard is available as JSON."})
            return Response(json_values(reports.dashboard(locations, start, end)))
        rows, columns = self.fetch(report, locations, start, end, params["group"])
        if params.get("export") == "csv":
            writer = csv.writer(CsvOutput())

            def stream():
                yield writer.writerow(columns)
                entries = rows.iterator(chunk_size=1000) if hasattr(rows, "iterator") else rows
                for row in entries:
                    yield writer.writerow(csv_value(row.get(key)) for key in columns)

            return StreamingHttpResponse(
                stream(), content_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{report}.csv"'},
            )
        return self.get_paginated_response(json_values(list(self.paginate_queryset(rows))))

    def fetch(self, report, locations, start, end, group):
        if report == "sales":
            return reports.sales(locations, start, end, group), ("period", "shipments", "units", "revenue")
        if report in {"inventory", "low-stock"}:
            rows = reports.inventory(locations)
            if report == "low-stock":
                rows = rows.filter(product__active=True, available__lte=F("low_stock_threshold"))
            columns = ("location_id", "product_id", "on_hand", "reserved", "available", "inventory_value", "low_stock_threshold")
            return rows.values(*columns), columns
        if report == "movements":
            columns = (
                "id", "balance__location_id", "balance__product_id", "kind", "on_hand_delta", "reserved_delta",
                "on_hand_after", "reserved_after", "reference", "note", "created_at",
            )
            rows = Movement.objects.filter(balance__location__in=locations, created_at__date__range=(start, end))
            return rows.values(*columns), columns
        if report == "products":
            return reports.product_performance(locations, start, end), ("id", "sku", "name", "stock", "units", "revenue")
        if report == "purchase-orders":
            columns = ("id", "supplier_id", "location_id", "expected_date", "status", "created_at", "received_at")
            rows = PurchaseOrder.objects.filter(location__in=locations, created_at__date__range=(start, end))
            return rows.values(*columns), columns
        if report == "suppliers":
            columns = ("supplier_id", "supplier__name", "orders", "completed", "cancelled", "on_time", "currently_overdue")
            return reports.supplier_performance(locations, start, end), columns
        columns = (
            "rule", "location", "product", "supplier", "status", "demand_window_days", "lead_time_days", "units_sold",
            "average_daily_sales", "safety_stock", "reorder_point", "available", "inbound",
            "suggested_reorder_quantity", "slow_moving",
        )
        return reports.optimize(locations), columns
