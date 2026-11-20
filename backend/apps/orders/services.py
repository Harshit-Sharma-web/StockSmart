from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.inventory.models import Movement
from apps.inventory.services import Conflict, change_stock, lock_locations
from apps.locations.models import Location
from apps.products.models import Product
from .models import Order, OrderItem, Shipment, ShipmentItem, StockReturn, StockReturnItem


@transaction.atomic
def place_order(*, customer, location_id, items, client_key=None):
    User.objects.select_for_update().get(pk=customer.pk)
    requested = {item["product"]: item["quantity"] for item in items}
    if client_key:
        previous = Order.objects.filter(customer=customer, client_key=client_key).first()
        if previous:
            previous_items = dict(previous.items.values_list("product_id", "quantity"))
            if previous.location_id != location_id or previous_items != requested:
                raise Conflict("This order key was already used for a different request.")
            return previous, False
    location = lock_locations(location_id)[location_id]
    if location.kind != Location.Kind.STORE:
        raise Conflict("Orders must be placed at an active store.")
    products = Product.objects.filter(pk__in=requested, active=True).in_bulk()
    if products.keys() != requested.keys():
        raise Conflict("One or more products are unavailable.")
    order = Order.objects.create(
        customer=customer, location=location, client_key=client_key,
        total=sum(products[pk].selling_price * quantity for pk, quantity in requested.items()),
    )
    for pk, quantity in sorted(requested.items()):
        product = products[pk]
        OrderItem.objects.create(order=order, product=product, quantity=quantity, unit_price=product.selling_price)
        change_stock(
            location_id=location_id, product=product, actor=customer, kind=Movement.Kind.RESERVE,
            reserved=quantity, reference=f"order:{order.pk}",
        )
    return order, True


TRANSITIONS = {
    Order.Status.CONFIRMED: ({Order.Status.PENDING}, "confirmed_at"),
    Order.Status.PICKING: ({Order.Status.CONFIRMED}, "picking_at"),
    Order.Status.PACKED: ({Order.Status.PICKING}, "packed_at"),
    Order.Status.DELIVERED: ({Order.Status.SHIPPED}, "delivered_at"),
    Order.Status.CANCELLED: (
        {Order.Status.PENDING, Order.Status.CONFIRMED, Order.Status.PICKING, Order.Status.PACKED}, "cancelled_at",
    ),
}


@transaction.atomic
def transition(order_id, target, actor, *, customer_action=False):
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.status == target:
        return order
    allowed, timestamp = TRANSITIONS[target]
    if customer_action:
        allowed = allowed & {Order.Status.PENDING, Order.Status.CONFIRMED}
    if order.status not in allowed:
        raise Conflict("This order cannot change to the requested status.")
    if target == Order.Status.CANCELLED:
        lock_locations(order.location_id, require_active=False)
        for item in order.items.select_related("product").order_by("product_id"):
            change_stock(
                location_id=order.location_id, product=item.product, actor=actor, kind=Movement.Kind.RELEASE,
                reserved=-item.quantity, reference=f"order:{order.pk}",
            )
    order.status = target
    setattr(order, timestamp, timezone.now())
    order.save(update_fields=["status", timestamp])
    return order


@transaction.atomic
def ship(*, order_id, actor, client_key, items=None, tracking_number=""):
    order = Order.objects.select_for_update().get(pk=order_id)
    requested = {item["product"]: item["quantity"] for item in items} if items is not None else None
    previous = order.shipments.filter(client_key=client_key).first()
    if previous:
        previous_items = dict(previous.items.values_list("order_item__product_id", "quantity"))
        if previous.tracking_number != tracking_number or (requested is not None and requested != previous_items):
            raise Conflict("This shipment key was already used for a different request.")
        return order
    if order.status not in {Order.Status.PACKED, Order.Status.PARTIAL}:
        raise Conflict("Only packed or partially shipped orders may ship.")
    lock_locations(order.location_id, require_active=False)
    lines = {line.product_id: line for line in order.items.select_related("product").order_by("product_id")}
    remaining = {pk: line.quantity - line.shipped for pk, line in lines.items() if line.quantity > line.shipped}
    if requested is None:
        requested = remaining
    if not requested or any(quantity > remaining.get(pk, 0) for pk, quantity in requested.items()):
        raise Conflict("Shipment exceeds the remaining order quantities.")
    shipment = Shipment.objects.create(order=order, actor=actor, client_key=client_key, tracking_number=tracking_number)
    for pk, quantity in sorted(requested.items()):
        line = lines[pk]
        movement = change_stock(
            location_id=order.location_id, product=line.product, actor=actor, kind=Movement.Kind.SHIP,
            on_hand=-quantity, reserved=-quantity, reference=f"shipment:{shipment.pk}",
        )
        ShipmentItem.objects.create(shipment=shipment, order_item=line, quantity=quantity, unit_cost=movement.unit_cost)
        line.shipped += quantity
        line.save(update_fields=["shipped"])
    order.status = Order.Status.SHIPPED if requested == remaining else Order.Status.PARTIAL
    if order.status == Order.Status.SHIPPED:
        order.shipped_at = shipment.shipped_at
    order.save(update_fields=["status", "shipped_at"])
    return order


@transaction.atomic
def receive_return(*, order_id, actor, client_key, items, reason):
    order = Order.objects.select_for_update().get(pk=order_id)
    requested = {item["product"]: item["quantity"] for item in items}
    previous = order.returns.filter(client_key=client_key).first()
    if previous:
        previous_items = dict(previous.items.values_list("order_item__product_id", "quantity"))
        if previous.reason != reason or previous_items != requested:
            raise Conflict("This return key was already used for a different request.")
        return order
    if order.status not in {Order.Status.PARTIAL, Order.Status.SHIPPED, Order.Status.DELIVERED}:
        raise Conflict("Only shipped items may be returned.")
    lock_locations(order.location_id)
    lines = {line.product_id: line for line in order.items.select_related("product")}
    returnable = {pk: line.shipped - line.returned for pk, line in lines.items()}
    if not requested or any(quantity > returnable.get(pk, 0) for pk, quantity in requested.items()):
        raise Conflict("Return exceeds the quantities shipped and eligible for return.")
    stock_return = StockReturn.objects.create(order=order, actor=actor, client_key=client_key, reason=reason)
    for pk, quantity in sorted(requested.items()):
        line = lines[pk]
        change_stock(
            location_id=order.location_id, product=line.product, actor=actor, kind=Movement.Kind.RETURN,
            on_hand=quantity, reference=f"return:{stock_return.pk}", note=reason,
        )
        StockReturnItem.objects.create(stock_return=stock_return, order_item=line, quantity=quantity)
        line.returned += quantity
        line.save(update_fields=["returned"])
    return order
