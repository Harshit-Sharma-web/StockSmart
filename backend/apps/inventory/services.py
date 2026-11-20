from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.locations.models import Location
from apps.products.models import Product
from .models import Balance, Movement, Transfer, TransferItem


class Conflict(APIException):
    status_code = 409
    default_detail = "The operation conflicts with the current state."
    default_code = "conflict"


def lock_locations(*ids, require_active=True):
    expected = set(ids)
    locations = list(Location.objects.select_for_update().filter(pk__in=expected).order_by("pk"))
    if len(locations) != len(expected) or (require_active and any(not location.active for location in locations)):
        raise Conflict("A location is unavailable.")
    return {location.pk: location for location in locations}


def change_stock(*, location_id, product, actor, kind, on_hand=0, reserved=0, reference="", note="", unit_cost=None):
    """Apply one ledger entry inside an atomic transaction holding the location lock."""
    balance, _ = Balance.objects.select_for_update().get_or_create(location_id=location_id, product=product)
    if kind == Movement.Kind.OPENING and balance.movements.exists():
        raise Conflict("Opening stock has already been recorded for this balance.")
    new_on_hand = balance.on_hand + on_hand
    new_reserved = balance.reserved + reserved
    if not 0 <= new_reserved <= new_on_hand <= 2**63 - 1:
        raise Conflict(f"Insufficient stock or invalid balance for SKU {product.sku}.")
    balance.on_hand = new_on_hand
    balance.reserved = new_reserved
    balance.save(update_fields=["on_hand", "reserved"])
    return Movement.objects.create(
        balance=balance, kind=kind, on_hand_delta=on_hand, reserved_delta=reserved,
        on_hand_after=new_on_hand, reserved_after=new_reserved, actor=actor, reference=reference, note=note,
        unit_cost=product.purchase_price if unit_cost is None else unit_cost,
    )


@transaction.atomic
def manual_movement(*, actor, location_id, product_id, kind, quantity, note="", scan=None):
    lock_locations(location_id)
    product = Product.objects.filter(pk=product_id, active=True).first()
    if product is None:
        raise ValidationError({"product": "Select an active product."})
    if scan is not None:
        from apps.scanning.models import ScanEvent

        scan = ScanEvent.objects.select_for_update().get(pk=scan.pk)
        if scan.location_id != location_id or scan.product_id != product_id:
            raise ValidationError({"scan": "The scan must match the location and product."})
        if Movement.objects.filter(reference=f"scan:{scan.pk}").exists():
            raise Conflict("This scan has already been applied to inventory.")
    return change_stock(
        location_id=location_id, product=product, actor=actor, kind=kind,
        on_hand=quantity, note=note, reference=f"scan:{scan.pk}" if scan else "",
    )


@transaction.atomic
def create_transfer(*, source, destination, items, actor):
    lock_locations(source.pk, destination.pk)
    transfer = Transfer.objects.create(source=source, destination=destination, created_by=actor)
    TransferItem.objects.bulk_create([TransferItem(transfer=transfer, **item) for item in items])
    return transfer


@transaction.atomic
def update_transfer(transfer_id, action, actor):
    transfer = Transfer.objects.select_for_update().get(pk=transfer_id)
    if transfer.status == action:
        return transfer
    if transfer.status != Transfer.Status.PENDING:
        raise Conflict("Only pending transfers can change status.")
    if action == Transfer.Status.COMPLETED:
        lock_locations(transfer.source_id, transfer.destination_id)
        for item in transfer.items.select_related("product").order_by("product_id"):
            fields = {"product": item.product, "actor": actor, "reference": f"transfer:{transfer.pk}"}
            change_stock(location_id=transfer.source_id, kind=Movement.Kind.TRANSFER_OUT, on_hand=-item.quantity, **fields)
            change_stock(location_id=transfer.destination_id, kind=Movement.Kind.TRANSFER_IN, on_hand=item.quantity, **fields)
        transfer.completed_at = timezone.now()
    transfer.status = action
    transfer.save(update_fields=["status", "completed_at"])
    return transfer
