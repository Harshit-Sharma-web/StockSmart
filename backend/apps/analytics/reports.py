from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from math import ceil

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Min, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, TruncDay, TruncMonth, TruncWeek
from django.utils import timezone

from apps.inventory.models import Balance, Movement
from apps.orders.models import Order, ShipmentItem
from apps.products.models import Product
from apps.purchasing.models import PurchaseItem, PurchaseOrder
from .models import ReorderRule


def inventory(locations):
    return Balance.objects.filter(location__in=locations).annotate(
        available=F("on_hand") - F("reserved"),
        inventory_value=cost_expression(F("on_hand") * F("product__purchase_price")),
    )


def cost_expression(expression):
    return ExpressionWrapper(expression, output_field=DecimalField(max_digits=32, decimal_places=2))


def sales_lines(locations, start, end):
    return ShipmentItem.objects.filter(
        shipment__order__location__in=locations, shipment__shipped_at__date__range=(start, end),
    )


def sales(locations, start, end, group):
    truncate = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}[group]
    return sales_lines(locations, start, end).order_by().annotate(
        period=truncate("shipment__shipped_at"),
    ).values("period").annotate(
        shipments=Count("shipment_id", distinct=True),
        units=Sum("quantity"),
        revenue=Sum(cost_expression(F("quantity") * F("order_item__unit_price"))),
    ).order_by("period")


def product_performance(locations, start, end):
    totals = sales_lines(locations, start, end).order_by().values("order_item__product_id").annotate(
        units=Sum("quantity"),
        revenue=Sum(cost_expression(F("quantity") * F("order_item__unit_price"))),
    )
    stock = inventory(locations).order_by().values("product_id").annotate(stock=Sum("on_hand"))
    return Product.objects.filter(
        Q(pk__in=stock.values("product_id")) | Q(pk__in=totals.values("order_item__product_id")),
    ).annotate(
        units=Coalesce(Subquery(totals.filter(order_item__product_id=OuterRef("pk")).values("units")), Value(0)),
        revenue=Coalesce(
            Subquery(totals.filter(order_item__product_id=OuterRef("pk")).values("revenue")), Decimal("0.00"),
        ),
        stock=Coalesce(Subquery(stock.filter(product_id=OuterRef("pk")).values("stock")), Value(0)),
    ).order_by("-units", "id").values("id", "sku", "name", "stock", "units", "revenue")


def supplier_performance(locations, start, end):
    return PurchaseOrder.objects.filter(
        location__in=locations, created_at__date__range=(start, end),
    ).order_by().values("supplier_id", "supplier__name").annotate(
        orders=Count("id"),
        completed=Count("id", filter=Q(status=PurchaseOrder.Status.RECEIVED)),
        cancelled=Count("id", filter=Q(status=PurchaseOrder.Status.CANCELLED)),
        on_time=Count("id", filter=Q(received_at__date__lte=F("expected_date"))),
        currently_overdue=Count("id", filter=Q(
            status__in=[PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.PARTIAL],
            expected_date__lt=timezone.localdate(),
        )),
    ).order_by("supplier__name")


def optimize(locations, today=None):
    today = today or timezone.localdate()
    rules = list(ReorderRule.objects.filter(
        location__in=locations, location__active=True, offer__supplier__active=True, offer__product__active=True,
    ).select_related("offer"))
    if not rules:
        return []
    location_ids = {rule.location_id for rule in rules}
    product_ids = {rule.offer.product_id for rule in rules}
    stock = {
        (row.location_id, row.product_id): row.available
        for row in Balance.objects.filter(location_id__in=location_ids, product_id__in=product_ids)
    }
    pending = {
        (row["order__location_id"], row["product_id"]): row["outstanding"]
        for row in PurchaseItem.objects.filter(
            order__location_id__in=location_ids, product_id__in=product_ids,
            order__status__in=[PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.PARTIAL],
        ).order_by().values("order__location_id", "product_id").annotate(
            outstanding=Sum(F("quantity") - F("received")),
        )
    }
    first_seen = {
        (row["balance__location_id"], row["balance__product_id"]): row["first"]
        for row in Movement.objects.filter(
            balance__location_id__in=location_ids, balance__product_id__in=product_ids,
        ).order_by().values("balance__location_id", "balance__product_id").annotate(first=Min("created_at"))
    }
    shipments = defaultdict(list)
    max_window = max(rule.demand_window_days for rule in rules)
    for row in sales_lines(location_ids, today - timedelta(days=max_window), today - timedelta(days=1)).filter(
        order_item__product_id__in=product_ids,
    ).order_by().annotate(day=TruncDay("shipment__shipped_at")).values(
        "shipment__order__location_id", "order_item__product_id", "day",
    ).annotate(units=Sum("quantity")):
        shipments[row["shipment__order__location_id"], row["order_item__product_id"]].append(
            (row["day"].date(), row["units"]),
        )
    recommendations = []
    for rule in rules:
        key = rule.location_id, rule.offer.product_id
        start = today - timedelta(days=rule.demand_window_days)
        units = sum(quantity for day, quantity in shipments[key] if day >= start)
        known = key in first_seen and first_seen[key].date() < start
        average = Decimal(units) / rule.demand_window_days if known else None
        lead = rule.lead_time_override_days
        if lead is None:
            lead = rule.offer.lead_time_days
        available = stock.get(key, 0)
        inbound = pending.get(key, 0)
        point = ceil(average * lead + rule.safety_stock) if known else None
        recommendation = None
        if known:
            recommendation = (
                max(1, max(rule.target_stock, point + 1) - available - inbound)
                if available + inbound <= point else 0
            )
        recommendations.append({
            "rule": rule.pk, "location": key[0], "product": key[1],
            "supplier": rule.offer.supplier_id, "status": "ready" if known else "insufficient_data",
            "demand_window_days": rule.demand_window_days, "lead_time_days": lead, "units_sold": units,
            "average_daily_sales": round(average, 4) if known else None, "safety_stock": rule.safety_stock,
            "reorder_point": point, "available": available, "inbound": inbound,
            "suggested_reorder_quantity": recommendation,
            "slow_moving": units == 0 and available > 0 if known else None,
        })
    return recommendations


def dashboard(locations, start, end):
    balances = inventory(locations)
    active = balances.filter(product__active=True)
    orders = Order.objects.filter(location__in=locations, created_at__date__range=(start, end))
    products = product_performance(locations, start, end)
    lines = sales_lines(locations, start, end)
    totals = lines.aggregate(
        revenue=Sum(cost_expression(F("quantity") * F("order_item__unit_price")), default=Decimal("0.00")),
        cost=Sum(cost_expression(F("quantity") * F("unit_cost")), default=Decimal("0.00")),
    )
    history = Movement.objects.filter(balance_id=OuterRef("pk")).order_by("-created_at", "-pk")
    opening = Subquery(history.filter(created_at__date__lt=start).values("on_hand_after")[:1])
    closing = Subquery(history.filter(created_at__date__lte=end).values("on_hand_after")[:1])
    average_value = balances.aggregate(value=Sum(cost_expression(
        (Coalesce(opening, Value(0)) + Coalesce(closing, Value(0))) * F("product__purchase_price"),
    )))["value"]
    average_value = average_value / 2 if average_value else None
    trend = Movement.objects.filter(
        balance__location__in=locations, created_at__date__range=(start, end),
    ).order_by().annotate(period=TruncDay("created_at")).values("period", "kind").annotate(
        events=Count("id"), net_units=Sum("on_hand_delta"),
    ).order_by("period", "kind")
    return {
        "total_products": active.order_by().values("product_id").distinct().count(),
        "active_stores": locations.filter(active=True, kind="store").count(),
        "active_warehouses": locations.filter(active=True, kind="warehouse").count(),
        **balances.aggregate(
            total_inventory_quantity=Sum("on_hand", default=0),
            total_inventory_value=Sum("inventory_value", default=Decimal("0.00")),
        ),
        "low_stock_products": active.filter(available__lte=F("low_stock_threshold")).order_by().values("product_id").distinct().count(),
        "out_of_stock_products": active.filter(available=0).order_by().values("product_id").distinct().count(),
        "total_orders": orders.count(),
        "pending_orders": orders.exclude(status__in=[Order.Status.DELIVERED, Order.Status.CANCELLED]).count(),
        "completed_orders": orders.filter(status=Order.Status.DELIVERED).count(),
        "sales_revenue": totals["revenue"],
        "top_selling": list(products.filter(units__gt=0)[:10]),
        "slow_moving": list(products.filter(units=0, stock__gt=0)[:10]),
        "inventory_turnover": round(totals["cost"] / average_value, 4) if average_value else None,
        "supplier_performance": list(supplier_performance(locations, start, end)[:25]),
        "movement_trends": list(trend),
    }
