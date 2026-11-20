from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.analytics.models import ReorderRule
from apps.inventory.models import Balance, Movement
from apps.inventory.services import Conflict, manual_movement
from apps.locations.models import Location, LocationAssignment
from apps.orders.services import place_order
from apps.products.models import Category, Product
from apps.purchasing.models import Supplier, SupplierProduct
from .models import User


PREFIX = "/api/v1/"


def setup_stock():
    store = Location.objects.create(code="STORE", name="Store", kind="store")
    warehouse = Location.objects.create(code="WARE", name="Warehouse", kind="warehouse")
    category = Category.objects.create(name="Home")
    product = Product.objects.create(
        category=category, name="Kettle", sku="K01", barcode="001234",
        purchase_price=Decimal("8.00"), selling_price=Decimal("12.00"),
    )
    return store, warehouse, product


@override_settings(SECURE_SSL_REDIRECT=False)
class StockSmartAPI(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.store, cls.warehouse, cls.product = setup_stock()
        cls.customer = User.objects.create_user("customer")
        cls.other = User.objects.create_user("other")
        cls.manager = User.objects.create_user("manager", role=User.Role.MANAGER)
        cls.admin = User.objects.create_user("operator", role=User.Role.ADMIN)
        LocationAssignment.objects.create(user=cls.manager, location=cls.store)
        cls.supplier = Supplier.objects.create(name="Supply Co.")
        cls.offer = SupplierProduct.objects.create(
            supplier=cls.supplier, product=cls.product, unit_cost=Decimal("7.00"), lead_time_days=3,
        )

    def post(self, path, data, expected=201):
        response = self.client.post(PREFIX + path, data, format="json")
        self.assertEqual(response.status_code, expected, response.content)
        return response.json() if response.content else None

    def get(self, path, expected=200):
        response = self.client.get(PREFIX + path)
        self.assertEqual(response.status_code, expected, response.content)
        return response.json()

    def auth(self, user):
        self.client.force_authenticate(user)

    def opening(self, quantity=10):
        self.auth(self.manager)
        return self.post("stock-movements/", {
            "location": self.store.pk, "product": self.product.pk, "kind": "opening", "quantity": quantity,
        })

    def assert_balance(self, on_hand, reserved, location=None):
        balance = Balance.objects.get(location=location or self.store, product=self.product)
        self.assertEqual((balance.on_hand, balance.reserved, balance.available), (on_hand, reserved, on_hand - reserved))

    def test_registration_jwt_rotation_and_logout(self):
        password = "W9r#Z3mD8!sK5"
        data = self.post("auth/register/", {"username": "newshopper", "password": password, "role": "admin"})
        self.assertEqual(data["role"], "customer")
        self.assertNotIn("password", data)
        self.assertTrue(User.objects.get(username="newshopper").check_password(password))
        self.post("auth/register/", {"username": "bad", "password": "12345678"}, 400)
        self.get("auth/profile/", 401)
        tokens = self.post("auth/login/", {"username": "newshopper", "password": password}, 200)
        rotated = self.post("auth/refresh/", {"refresh": tokens["refresh"]}, 200)
        self.post("auth/refresh/", {"refresh": tokens["refresh"]}, 401)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + rotated["access"])
        self.assertEqual(self.get("auth/profile/")["username"], "newshopper")
        self.get("users/", 403)
        self.post("auth/logout/", {"refresh": rotated["refresh"]}, 204)
        self.post("auth/refresh/", {"refresh": rotated["refresh"]}, 401)

    def test_password_change_and_account_deactivation(self):
        password = "T7!b4@Zzmw9"
        account = User.objects.create_user("password-case", password=password)
        tokens = self.post("auth/login/", {"username": account.username, "password": password}, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + tokens["access"])
        new_password = "Bq3%UvL5x!99"
        self.post("auth/change-password/", {"current_password": password, "new_password": new_password}, 204)
        self.get("auth/profile/", 401)
        self.post("auth/refresh/", {"refresh": tokens["refresh"]}, 401)
        changed = self.post("auth/login/", {"username": account.username, "password": new_password}, 200)
        self.auth(self.admin)
        response = self.client.patch(PREFIX + f"users/{account.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + changed["access"])
        self.get("auth/profile/", 401)
        self.post("auth/refresh/", {"refresh": changed["refresh"]}, 401)

    def test_catalog_permissions_search_and_deactivation(self):
        payload = {
            "category": self.product.category_id, "sku": "CUP", "name": "Cup", "barcode": "001235",
            "purchase_price": "1.50", "selling_price": "3.00",
        }
        self.auth(self.customer)
        self.post("products/", payload, 403)
        self.auth(self.manager)
        self.post("products/", payload, 403)
        self.auth(self.admin)
        product = self.post("products/", payload)
        self.post("products/", {**payload, "sku": "NEW"}, 400)
        self.post("product-images/", {"product": product["id"], "url": "https://example.org/cup.png"})
        url = PREFIX + f'products/{product["id"]}/'
        response = self.client.patch(url, {"selling_price": "4.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.auth(self.customer)
        listing = self.get("products/?search=Cup&min_price=4")["results"]
        self.assertEqual(len(listing), 1)
        self.assertNotIn("purchase_price", listing[0])
        self.assertEqual(len(listing[0]["images"]), 1)
        self.auth(self.admin)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.auth(self.customer)
        self.get(f'products/{product["id"]}/', 404)
        self.assertTrue(Product.objects.filter(pk=product["id"], active=False).exists())

    def test_inventory_movement_validation_and_location_scope(self):
        self.opening(4)
        payload = {"location": self.store.pk, "product": self.product.pk, "kind": "damage", "quantity": -5, "note": "Broken"}
        self.post("stock-movements/", payload, 409)
        self.post("stock-movements/", {**payload, "quantity": -1})
        self.post("stock-movements/", {**payload, "location": self.warehouse.pk}, 404)
        self.post("stock-movements/", {**payload, "kind": "opening", "quantity": 3}, 409)
        self.assert_balance(3, 0)
        self.assertEqual(Movement.objects.count(), 2)
        self.assertEqual(self.get("inventory/low-stock/")["count"], 1)
        self.assertEqual(self.get("inventory/totals/")["available"], 3)
        self.get(f"reports/inventory/?location={self.warehouse.pk}", 404)

    def test_catalog_availability_filter_respects_locations(self):
        self.opening(4)
        self.auth(self.customer)
        self.assertEqual(self.get(f"products/?available=true&location={self.store.pk}")["count"], 1)
        self.get(f"products/?available=true&location={self.warehouse.pk}", 404)
        self.auth(self.manager)
        self.get(f"products/?available=false&location={self.warehouse.pk}", 404)

    def test_transfer_atomicity_retry_and_isolation(self):
        self.opening(5)
        payload = {"source": self.store.pk, "destination": self.warehouse.pk, "items": [{"product": self.product.pk, "quantity": 3}]}
        self.post("stock-transfers/", payload, 404)
        self.auth(self.admin)
        failed = self.post("stock-transfers/", {**payload, "items": [{"product": self.product.pk, "quantity": 6}]})
        self.post(f'stock-transfers/{failed["id"]}/complete/', {}, 409)
        transfer = self.post("stock-transfers/", payload)
        self.assert_balance(5, 0)
        endpoint = f'stock-transfers/{transfer["id"]}/complete/'
        for _ in range(2):
            self.assertEqual(self.post(endpoint, {}, 200)["status"], "completed")
        self.assert_balance(2, 0)
        self.assert_balance(3, 0, self.warehouse)
        self.assertEqual(Movement.objects.count(), 3)
        self.auth(self.manager)
        self.get(f'stock-transfers/{transfer["id"]}/', 404)

    def test_order_reservation_cancellation_privacy_and_retry(self):
        self.opening(6)
        self.auth(self.customer)
        payload = {"location": self.store.pk, "client_key": str(uuid4()), "items": [{"product": self.product.pk, "quantity": 4}]}
        order = self.post("orders/", payload)
        self.assertEqual(order["total"], "48.00")
        self.assertEqual(self.post("orders/", payload, 200)["id"], order["id"])
        self.assert_balance(6, 4)
        self.post("orders/", {**payload, "client_key": str(uuid4())}, 409)
        self.auth(self.other)
        self.get(f'orders/{order["id"]}/', 404)
        self.auth(self.customer)
        endpoint = f'orders/{order["id"]}/cancel/'
        self.post(endpoint, {}, 200)
        self.post(endpoint, {}, 200)
        self.assert_balance(6, 0)
        self.assertEqual(Movement.objects.count(), 3)

    def ship_order(self):
        self.opening(10)
        self.auth(self.customer)
        order = self.post("orders/", {"location": self.store.pk, "items": [{"product": self.product.pk, "quantity": 5}]})
        endpoint = f'orders/{order["id"]}/'
        self.post(endpoint + "status/", {"status": "confirmed"}, 403)
        self.auth(self.manager)
        self.post(endpoint + "status/", {"status": "packed"}, 409)
        for status in ("confirmed", "picking", "packed"):
            self.post(endpoint + "status/", {"status": status}, 200)
        payload = {"client_key": str(uuid4()), "items": [{"product": self.product.pk, "quantity": 2}]}
        shipment = self.post(endpoint + "ship/", payload, 200)
        self.assertEqual(shipment["status"], "partial")
        self.post(endpoint + "ship/", payload, 200)
        self.assert_balance(8, 3)
        self.post(endpoint + "cancel/", {}, 409)
        shipment = self.post(endpoint + "ship/", {"client_key": str(uuid4()), "tracking_number": "TEST1"}, 200)
        self.assertEqual(len(shipment["shipments"]), 2)
        self.assert_balance(5, 0)
        self.post(endpoint + "status/", {"status": "delivered"}, 200)

    def test_order_lifecycle_partial_shipment_and_analytics(self):
        self.ship_order()
        data = self.get("reports/dashboard/")
        self.assertEqual(Decimal(data["sales_revenue"]), Decimal("60.00"))
        self.assertEqual(data["completed_orders"], 1)
        self.assertEqual(data["total_inventory_quantity"], 5)
        self.assertEqual(Decimal(data["inventory_turnover"]), Decimal("2.00"))
        self.assertEqual(self.get("reports/sales/?group=week")["results"][0]["units"], 5)
        self.assertEqual(self.get("reports/inventory/")["results"][0]["available"], 5)
        self.assertEqual(self.get("reports/products/")["results"][0]["units"], 5)
        response = self.client.get(PREFIX + "reports/sales/?export=csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"shipments,units,revenue", b"".join(response.streaming_content))

    def test_received_return_is_scoped_validated_and_idempotent(self):
        self.ship_order()
        order = self.get("orders/")["results"][0]
        endpoint = f'orders/{order["id"]}/receive-return/'
        payload = {
            "client_key": str(uuid4()), "reason": "Inspected and sellable",
            "items": [{"product": self.product.pk, "quantity": 2}],
        }
        self.auth(self.customer)
        self.post(endpoint, payload, 403)
        self.auth(self.manager)
        self.post(endpoint, {**payload, "items": [{"product": self.product.pk, "quantity": 6}]}, 409)
        returned = self.post(endpoint, payload, 200)
        self.assertEqual(returned["status"], "delivered")
        self.assertEqual(returned["items"][0]["returned"], 2)
        retried = self.post(endpoint, payload, 200)
        self.assertEqual(len(retried["returns"]), 1)
        self.assert_balance(7, 0)
        self.assertEqual(Movement.objects.filter(kind="return").count(), 1)

    def test_purchase_edit_partial_receipt_and_delivery_performance(self):
        self.auth(self.manager)
        data = {
            "location": self.store.pk, "supplier": self.supplier.pk, "expected_date": str(timezone.localdate()),
            "items": [{"product": self.product.pk, "quantity": 7}],
        }
        order = self.post("purchase-orders/", data)
        self.assertFalse(Balance.objects.exists())
        endpoint = f'purchase-orders/{order["id"]}/'
        response = self.client.patch(PREFIX + endpoint, {"items": [{"product": self.product.pk, "quantity": 6}]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        payload = {"client_key": str(uuid4()), "items": [{"product": self.product.pk, "quantity": 3}]}
        self.post(endpoint + "receive/", payload, 409)
        for status in ("approved", "ordered"):
            self.post(endpoint + "status/", {"status": status}, 200)
        self.assertEqual(self.post(endpoint + "receive/", payload, 200)["status"], "partial")
        self.post(endpoint + "receive/", payload, 200)
        self.assert_balance(3, 0)
        self.post(endpoint + "receive/", {
            "client_key": str(uuid4()), "items": [{"product": self.product.pk, "quantity": 4}],
        }, 409)
        final = self.post(endpoint + "receive/", {**payload, "client_key": str(uuid4())}, 200)
        self.assertEqual(final["status"], "received")
        self.assertEqual(len(final["receipts"]), 2)
        self.assert_balance(6, 0)
        self.assertEqual(self.get("reports/suppliers/")["results"][0]["on_time"], 1)

    def test_scan_validation_lookup_and_deduplication(self):
        self.auth(self.admin)
        self.post("rfid-tags/", {"product": self.product.pk, "identifier": "other"}, 400)
        self.post("rfid-tags/", {"product": self.product.pk, "identifier": "0123abcd"})
        self.post("rfid-tags/", {"product": self.product.pk, "identifier": "0123ABCD"}, 400)
        self.auth(self.manager)
        self.assertEqual(self.get("barcodes/001234/")["sku"], "K01")
        data = {"location": self.store.pk, "kind": "rfid", "simulated": True, "client_key": str(uuid4()), "identifier": "0123abcd"}
        scan = self.post("scans/", data)
        self.assertEqual(self.post("scans/", data, 200)["id"], scan["id"])
        self.post("scans/", {**data, "identifier": "0123ABCE"}, 409)
        self.assertFalse(Balance.objects.exists())
        receipt = {
            "location": self.store.pk, "product": self.product.pk, "kind": "receipt", "quantity": 1, "scan": scan["id"],
        }
        self.post("stock-movements/", receipt)
        self.post("stock-movements/", receipt, 409)
        self.assert_balance(1, 0)

    def test_reorder_point_uses_observed_demand(self):
        self.ship_order()
        rule = ReorderRule.objects.create(location=self.store, offer=self.offer, demand_window_days=5, safety_stock=3, target_stock=12)
        self.assertEqual(self.get("reports/reorder/")["results"][0]["status"], "insufficient_data")
        now = timezone.now()
        Movement.objects.filter(kind="opening").update(created_at=now - timedelta(days=7))
        from apps.orders.models import Shipment

        Shipment.objects.update(shipped_at=now - timedelta(days=2))
        result = self.get("reports/reorder/")["results"][0]
        self.assertEqual(result["rule"], rule.pk)
        self.assertEqual(result["reorder_point"], 6)
        self.assertEqual(result["suggested_reorder_quantity"], 7)
        self.assertEqual(Decimal(result["average_daily_sales"]), Decimal("1.00"))


class StockConcurrency(TransactionTestCase):
    def test_two_buyers_cannot_reserve_the_same_units(self):
        if connection.vendor != "mysql":
            self.skipTest("Row locking is verified on MySQL.")
        store, _, product = setup_stock()
        buyers = [User.objects.create_user(name) for name in ("buyer-one", "buyer-two")]
        manual_movement(actor=buyers[0], location_id=store.pk, product_id=product.pk, kind=Movement.Kind.OPENING, quantity=5)
        barrier = Barrier(2)

        def attempt(buyer):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                place_order(customer=buyer, location_id=store.pk, items=[{"product": product.pk, "quantity": 4}])
                return True
            except Conflict:
                return False
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, buyers))
        self.assertCountEqual(results, [True, False])
        balance = Balance.objects.get(location=store, product=product)
        self.assertEqual((balance.on_hand, balance.reserved), (5, 4))
        self.assertEqual(balance.movements.count(), 2)
