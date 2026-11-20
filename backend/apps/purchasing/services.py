from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.inventory.models import Movement
from apps.inventory.services import Conflict, change_stock, lock_locations
from .models import PurchaseItem, PurchaseOrder, Receipt, ReceiptItem, Supplier, SupplierProduct


def set_lines(order, items):
    quantities = {item["product"]: item["quantity"] for item in items}
    offers = SupplierProduct.objects.filter(
        supplier_id=order.supplier_id, product_id__in=quantities, product__active=True,
    )
    costs = dict(offers.values_list("product_id", "unit_cost"))
    if costs.keys() != quantities.keys():
        raise ValidationError({"items": "All products must be active and offered by the selected supplier."})
    order.items.all().delete()
    PurchaseItem.objects.bulk_create([
        PurchaseItem(order=order, product_id=pk, quantity=quantity, unit_cost=costs[pk])
        for pk, quantity in quantities.items()
    ])


@transaction.atomic
def create_purchase(*, actor, location_id, supplier, expected_date, items):
    lock_locations(location_id)
    if not supplier.active:
        raise Conflict("The supplier is inactive.")
    order = PurchaseOrder.objects.create(
        created_by=actor, location_id=location_id, supplier=supplier, expected_date=expected_date,
    )
    set_lines(order, items)
    return order


@transaction.atomic
def edit_purchase(order_id, *, supplier=None, items=None, expected_date=None):
    order = PurchaseOrder.objects.select_for_update().get(pk=order_id)
    if order.status != PurchaseOrder.Status.DRAFT:
        raise Conflict("Only draft purchase orders can be edited.")
    if supplier is not None:
        if not supplier.active:
            raise Conflict("The supplier is inactive.")
        if supplier.pk != order.supplier_id and items is None:
            raise ValidationError({"items": "Specify the items when changing suppliers."})
        order.supplier = supplier
    if expected_date is not None:
        order.expected_date = expected_date
    if items is not None:
        set_lines(order, items)
    order.save(update_fields=["supplier", "expected_date"])
    return order


PURCHASE_TRANSITIONS = {
    PurchaseOrder.Status.APPROVED: ({PurchaseOrder.Status.DRAFT}, "approved_at"),
    PurchaseOrder.Status.ORDERED: ({PurchaseOrder.Status.APPROVED}, "ordered_at"),
    PurchaseOrder.Status.CANCELLED: (
        {PurchaseOrder.Status.DRAFT, PurchaseOrder.Status.APPROVED, PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.PARTIAL},
        "cancelled_at",
    ),
}


@transaction.atomic
def transition_purchase(order_id, target, actor):
    order = PurchaseOrder.objects.select_for_update().get(pk=order_id)
    if order.status == target:
        return order
    allowed, timestamp = PURCHASE_TRANSITIONS[target]
    if order.status not in allowed:
        raise Conflict("This purchase order cannot change to the requested status.")
    update_fields = ["status", timestamp]
    if target == PurchaseOrder.Status.APPROVED:
        if not Supplier.objects.filter(pk=order.supplier_id, active=True).exists():
            raise Conflict("The supplier is inactive.")
        order.approved_by = actor
        update_fields.append("approved_by")
    order.status = target
    setattr(order, timestamp, timezone.now())
    order.save(update_fields=update_fields)
    return order


@transaction.atomic
def receive(*, order_id, actor, client_key, items):
    order = PurchaseOrder.objects.select_for_update().get(pk=order_id)
    quantities = {item["product"]: item["quantity"] for item in items}
    previous = order.receipts.filter(client_key=client_key).first()
    if previous:
        if dict(previous.items.values_list("purchase_item__product_id", "quantity")) != quantities:
            raise Conflict("This receipt key was already used for a different request.")
        return order
    if order.status not in {PurchaseOrder.Status.ORDERED, PurchaseOrder.Status.PARTIAL}:
        raise Conflict("This purchase order is not open for receiving.")
    lock_locations(order.location_id)
    lines = {line.product_id: line for line in order.items.select_related("product").order_by("product_id")}
    remaining = {pk: line.quantity - line.received for pk, line in lines.items() if line.received < line.quantity}
    if not quantities or any(quantity > remaining.get(pk, 0) for pk, quantity in quantities.items()):
        raise Conflict("Receipt exceeds the outstanding purchase quantities.")
    receipt = Receipt.objects.create(order=order, actor=actor, client_key=client_key)
    for pk, quantity in sorted(quantities.items()):
        line = lines[pk]
        change_stock(
            location_id=order.location_id, product=line.product, actor=actor, kind=Movement.Kind.RECEIPT,
            on_hand=quantity, reference=f"receipt:{receipt.pk}", unit_cost=line.unit_cost,
        )
        ReceiptItem.objects.create(receipt=receipt, purchase_item=line, quantity=quantity)
        line.received += quantity
        line.save(update_fields=["received"])
    order.status = PurchaseOrder.Status.RECEIVED if quantities == remaining else PurchaseOrder.Status.PARTIAL
    if order.status == PurchaseOrder.Status.RECEIVED:
        order.received_at = receipt.created_at
    order.save(update_fields=["status", "received_at"])
    return order
