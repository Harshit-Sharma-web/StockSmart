from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.analytics.models import ReorderRule
from apps.inventory.models import Movement
from apps.inventory.services import manual_movement
from apps.locations.models import Location, LocationAssignment
from apps.orders.models import Order
from apps.orders.services import place_order, ship, transition
from apps.products.models import Category, Product
from apps.purchasing.models import PurchaseOrder, Supplier, SupplierProduct
from apps.purchasing.services import create_purchase, receive, transition_purchase


class Command(BaseCommand):
    help = "Create sample StockSmart records in a development database."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("This command requires DJANGO_DEBUG=True in a development database.")
        if Location.objects.filter(code__in=["DEMO-STORE", "DEMO-WAREHOUSE"]).exists():
            raise CommandError("Demo location codes already exist. Existing records were preserved.")
        if User.objects.filter(username__in=["stocksmart-demo-manager", "stocksmart-demo-customer"]).exists():
            raise CommandError("Demo usernames already exist. Existing records were preserved.")

        manager = User.objects.create_user("stocksmart-demo-manager", role=User.Role.MANAGER)
        customer = User.objects.create_user("stocksmart-demo-customer")
        store = Location.objects.create(code="DEMO-STORE", name="Demo Store", kind=Location.Kind.STORE)
        warehouse = Location.objects.create(code="DEMO-WAREHOUSE", name="Demo Warehouse", kind=Location.Kind.WAREHOUSE)
        LocationAssignment.objects.bulk_create([
            LocationAssignment(user=manager, location=store), LocationAssignment(user=manager, location=warehouse),
        ])
        category = Category.objects.create(name="Demo Home Goods")
        first = Product.objects.create(
            category=category, sku="DEMO-KETTLE", name="Demo Kettle",
            purchase_price=Decimal("20.00"), selling_price=Decimal("32.00"),
        )
        second = Product.objects.create(
            category=category, sku="DEMO-MUG", name="Demo Mug",
            purchase_price=Decimal("3.00"), selling_price=Decimal("7.00"),
        )
        supplier = Supplier.objects.create(name="Demo Supply Company")
        for product in (first, second):
            offer = SupplierProduct.objects.create(
                supplier=supplier, product=product, unit_cost=product.purchase_price, lead_time_days=4,
            )
            ReorderRule.objects.create(location=store, offer=offer, safety_stock=4, target_stock=30)
            for location in (store, warehouse):
                manual_movement(
                    actor=manager, location_id=location.pk, product_id=product.pk,
                    kind=Movement.Kind.OPENING, quantity=20, note="Demo opening stock",
                )

        items = [{"product": first.pk, "quantity": 3}, {"product": second.pk, "quantity": 2}]
        order, _ = place_order(customer=customer, location_id=store.pk, items=items)
        for status in (Order.Status.CONFIRMED, Order.Status.PICKING, Order.Status.PACKED):
            transition(order.pk, status, manager)
        ship(order_id=order.pk, actor=manager, client_key=uuid4(), tracking_number="DEMO-SHIP")
        transition(order.pk, Order.Status.DELIVERED, manager)

        purchase = create_purchase(
            actor=manager, location_id=warehouse.pk, supplier=supplier,
            expected_date=timezone.localdate() + timedelta(days=2), items=items,
        )
        for status in (PurchaseOrder.Status.APPROVED, PurchaseOrder.Status.ORDERED):
            transition_purchase(purchase.pk, status, manager)
        receive(order_id=purchase.pk, actor=manager, client_key=uuid4(), items=items[:1])
        self.stdout.write(self.style.SUCCESS("Demo records created. Demo usernames have unusable passwords."))
