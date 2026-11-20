from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts import views as accounts
from apps.analytics import api as analytics
from apps.inventory import api as inventory
from apps.locations import api as locations
from apps.orders import api as orders
from apps.products import api as catalog
from apps.purchasing import api as purchasing
from apps.scanning import api as scanning

router = DefaultRouter()
router.register("users", accounts.Users)
router.register("locations", locations.Locations)
router.register("location-assignments", locations.Assignments)
router.register("categories", catalog.Categories)
router.register("products", catalog.Products)
router.register("product-images", catalog.Images)
router.register("inventory", inventory.Balances)
router.register("stock-movements", inventory.Movements)
router.register("stock-transfers", inventory.Transfers)
router.register("orders", orders.Orders)
router.register("suppliers", purchasing.Suppliers)
router.register("supplier-products", purchasing.SupplierOffers)
router.register("purchase-orders", purchasing.Purchases)
router.register("rfid-tags", scanning.RFIDTags)
router.register("scans", scanning.Scans)
router.register("reorder-rules", analytics.Rules)

report_pattern = "|".join(analytics.REPORT_NAMES)
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/register/", accounts.Register.as_view(), name="register"),
    path("api/v1/auth/login/", accounts.Login.as_view(), name="login"),
    path("api/v1/auth/refresh/", accounts.Refresh.as_view(), name="refresh"),
    path("api/v1/auth/logout/", accounts.Logout.as_view(), name="logout"),
    path("api/v1/auth/profile/", accounts.Profile.as_view(), name="profile"),
    path("api/v1/auth/change-password/", accounts.ChangePassword.as_view(), name="change-password"),
    path("api/v1/barcodes/<str:barcode>/", scanning.BarcodeLookup.as_view(), name="barcode"),
    re_path(rf"^api/v1/reports/(?P<report>{report_pattern})/$", analytics.Report.as_view(), name="report"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"),
    path("api/v1/", include(router.urls)),
]
