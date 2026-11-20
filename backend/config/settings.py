import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", interpolate=False)


def flag(key, default=False):
    return os.getenv(key, str(default)).lower() in {"1", "true", "yes"}


def values(key, default=""):
    return [value.strip() for value in os.getenv(key, default).split(",") if value.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY before starting StockSmart.")

DEBUG = flag("DJANGO_DEBUG")
ALLOWED_HOSTS = values("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
CORS_ALLOWED_ORIGINS = values("CORS_ALLOWED_ORIGINS")
SECURE_SSL_REDIRECT = flag("DJANGO_SECURE_SSL_REDIRECT", not DEBUG)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "0"))
SECURE_REFERRER_POLICY = "same-origin"

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "rest_framework", "rest_framework_simplejwt.token_blacklist", "corsheaders",
    "django_filters", "drf_spectacular",
    "apps.accounts", "apps.locations", "apps.products", "apps.inventory",
    "apps.orders", "apps.purchasing", "apps.scanning", "apps.analytics",
]
AUTH_USER_MODEL = "accounts.User"
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"

_db_options = {
    "charset": "utf8mb4",
    "init_command": "SET sql_mode='STRICT_TRANS_TABLES', default_storage_engine=INNODB",
}

# Enable SSL only when configured
if flag("MYSQL_USE_SSL"):
    _db_options["ssl"] = {
        "ca": os.getenv(
            "MYSQL_SSL_CA",
            "/etc/ssl/certs/ca-certificates.crt"
        )
    }


DATABASES = {"default": {
    "ENGINE": "django.db.backends.mysql",
    "NAME": os.getenv("MYSQL_DATABASE", ""),
    "USER": os.getenv("MYSQL_USER", ""),
    "PASSWORD": os.getenv("MYSQL_PASSWORD", ""),
    "HOST": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "PORT": os.getenv("MYSQL_PORT", "3306"),
    "OPTIONS": _db_options,
    # "OPTIONS": {
    #     "charset": "utf8mb4",
    #     "init_command": "SET sql_mode='STRICT_TRANS_TABLES', default_storage_engine=INNODB",
    # },
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}"}
    for name in (
        "UserAttributeSimilarityValidator", "MinimumLengthValidator",
        "CommonPasswordValidator", "NumericPasswordValidator",
    )
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter", "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "DEFAULT_THROTTLE_RATES": {"auth": "20/minute"},
    "PAGE_SIZE": 25,
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=10),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "CHECK_REVOKE_TOKEN": True,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "StockSmart API",
    "VERSION": "1.0.0",
    "ENUM_NAME_OVERRIDES": {
        "LocationKind": "apps.locations.models.Location.Kind",
        "ScanKind": "apps.scanning.models.ScanEvent.Kind",
        "MovementKind": "apps.inventory.models.Movement.Kind",
    },
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Use TiDB-compatible SimpleJWT migrations only when enabled
if flag("USE_TIDB_TOKEN_MIGRATIONS"):
    MIGRATION_MODULES = {
        "token_blacklist": "config.tidb_token_migrations",
    }