# StockSmart backend

P04 StockSmart manages retail catalog data, store and warehouse inventory, sales fulfillment, supplier purchasing, scanner input, and operational reporting. The API uses Python 3.12+, Django 5.2, Django REST Framework, Simple JWT, and MySQL 8.0.16+ with InnoDB. The frontend can consume the versioned API from any allowlisted origin.

## Project layout

| Path | Contents |
|---|---|
| config/ | Settings, API router, ASGI and WSGI entry points |
| apps/accounts/ | Users and roles, JWT workflows, integration tests, demo command |
| apps/locations/ and apps/products/ | Store and warehouse assignments, product catalog and images |
| apps/inventory/ and apps/orders/ | Stock ledger, transfers, orders and shipments |
| apps/purchasing/ and apps/scanning/ | Suppliers, purchases and receipts, barcode and RFID scans |
| apps/analytics/ | Reports, CSV exports and configurable reorder rules |
| docs/ | Data model and transaction flow diagrams |

## Local setup

From the repository root in PowerShell, with Python 3.12 available:

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

On macOS or Linux, use `python3.12 -m venv .venv` and substitute `.venv/bin/python` in the commands. Building mysqlclient from source may require MySQL client development libraries and a C compiler.

Create an empty database on your MySQL server using a MySQL administrator account:

```sql
CREATE DATABASE stocksmart CHARACTER SET utf8mb4;
```

Create a dedicated application MySQL user through your preferred administration tool. Give it access to that schema. The migration command also needs schema modification privileges. For testing, use a separate development MySQL server or grant a separate test user schema privileges on a dedicated `test_stocksmart` database. MySQL date and time-zone tables are needed if you change the Django reporting time zone from UTC.

Use `.env.example` as a template while preserving any existing local credentials. The scaffold's old `DB_*` names are ignored. Supply the following values in `.env` or exported environment variables, which take precedence:

| Variable | Local value or purpose |
|---|---|
| DJANGO_SECRET_KEY | Generate a long random key with the command below |
| DJANGO_DEBUG | `True` in local development |
| DJANGO_ALLOWED_HOSTS | Comma-separated hosts, such as `localhost,127.0.0.1` |
| MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD | Actual MySQL schema and credentials |
| MYSQL_HOST, MYSQL_PORT | MySQL address and port, typically `127.0.0.1` and `3306` |
| CORS_ALLOWED_ORIGINS | Comma-separated exact origins, including scheme and development port |
| DJANGO_SECURE_SSL_REDIRECT | Set `False` for local HTTP and `True` for HTTPS deployment |
| DJANGO_HSTS_SECONDS | Set a deployment-appropriate duration after configuring HTTPS |

Generate a local key:

```powershell
.venv\Scripts\python.exe -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Set the result as `DJANGO_SECRET_KEY` and supply the MySQL settings above. Then start Django:

```powershell
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py createsuperuser
.venv\Scripts\python.exe manage.py runserver
```

Use `/api/v1/docs/` for Swagger and `/api/v1/schema/` for OpenAPI. Deploy with a production WSGI or ASGI server, HTTPS and `DJANGO_DEBUG=False`. Serve `collectstatic` output through the deployment's static file service. Django checks for environment and deployment settings can be run with `manage.py check --deploy`.

## Authentication and authorization

Register a customer with username, password and optional profile fields. Log in for an access/refresh pair. Send the access token as `Authorization: Bearer <access>`. Refresh rotates the refresh token. Logout blacklists the submitted refresh token. Access tokens expire after 10 minutes and refresh tokens after one day. Changing a password revokes existing tokens. Run `manage.py flushexpiredtokens` regularly to clear expired token records.

| Role | Access |
|---|---|
| Admin | All locations and reports, account role and activation updates, configuration, catalog, supplier and RFID maintenance |
| Store Manager | Inventory, orders, transfers, purchasing and reports at assigned locations. Transfers require access to both endpoints. Shared catalog writes require the corresponding Django model permission and an active assignment. |
| Customer | Active catalog and store directory, order creation, own order history and eligible cancellation. Purchase costs and operator APIs are restricted. |

Create an initial admin with `createsuperuser`. Register another user, change its role through the users API, then create its location assignments. Superusers can grant Django catalog model permissions through Django Admin. Managers have no access to unassigned locations. Out-of-scope records return 404.

## API endpoints

All rows below use the prefix `/api/v1/`. Collection routes use trailing slashes. Lists generally return `count`, `next`, `previous` and `results`, with 25 records per page. Filter and ordering fields are listed in Swagger. Invalid fields return 400 and stock or workflow conflicts return 409.

| Routes | Methods and purpose |
|---|---|
| auth/register/, auth/login/, auth/refresh/, auth/logout/, auth/change-password/ | POST |
| auth/profile/ | GET, PUT, PATCH |
| users/, users/{id}/ | GET, administrator PUT/PATCH on detail |
| locations/, location-assignments/ | CRUD. Use `kind=store` or `kind=warehouse` for location filtering. |
| products/, categories/, product-images/ | CRUD. Products support `search`, `category`, `min_price`, `max_price`, `available`, `location` and `ordering`. Use `location` with `available` to scope stock availability. |
| barcodes/{barcode}/ | GET product lookup |
| inventory/, inventory/{id}/, inventory/totals/, inventory/low-stock/ | GET balances, totals and alerts |
| inventory/{id}/threshold/ | PATCH `low_stock_threshold` |
| stock-movements/ | GET history, POST a validated manual movement |
| stock-transfers/ | GET history, POST a pending transfer |
| stock-transfers/{id}/complete/, stock-transfers/{id}/cancel/ | POST |
| orders/ | GET scoped orders, POST customer checkout |
| orders/{id}/ | GET details with line items and shipments |
| orders/{id}/status/, orders/{id}/ship/, orders/{id}/cancel/, orders/{id}/receive-return/ | POST fulfillment, cancellation or inspected returns |
| suppliers/, supplier-products/ | GET for operators, admin CRUD |
| purchase-orders/, purchase-orders/{id}/ | GET lists/details, POST creation, PATCH draft detail |
| purchase-orders/{id}/status/, purchase-orders/{id}/receive/ | POST status transition or receipt |
| purchase-orders/delivery-alerts/ | GET open orders past expected delivery |
| rfid-tags/, scans/ | RFID tag admin CRUD, operator scan GET/POST |
| reorder-rules/ | Scoped CRUD |
| reports/{report}/ | GET dashboard, sales, inventory, movements, products, low-stock, purchase-orders, suppliers or reorder |
| schema/, docs/ | OpenAPI and Swagger |

### Inventory and fulfillment

Available stock is on-hand minus reserved. Post opening stock once per product and location, then use receipts, adjustments, damage or loss with signed quantities. Adjustments, damage and loss require a reason. A movement records prior changes through deltas and captures the resulting balances with actor and reference. Product and location deletion through the API deactivates the record while retaining transaction history.

Transfers start pending. Completion writes both stock movements in one transaction and checks source availability. Cancelling a pending transfer leaves both balances as they were. Completing an already completed transfer returns the same transfer.

For checkout, send `location` and `items: [{product, quantity}]`. An optional UUID `client_key` makes checkout retry-safe. Prices come from the catalog and are recorded on the order. Checkout reserves stock immediately. The normal workflow is pending → confirmed → picking → packed → shipped → delivered. Shipping uses a required UUID `client_key` and can include some or all of the remaining items and an optional tracking number. Leaving out items ships the remaining quantities. Customers may cancel pending or confirmed orders. Managers can cancel through packed. Cancellation releases reservations. After any shipment, cancellation is blocked. Operators can receive inspected, sellable returns separately using a UUID `client_key`, an item list, and a reason. Returns cannot exceed quantities shipped minus previous returns.

### Purchasing and scanning

Add supplier-product offers before drafting purchase orders. Purchase orders use `supplier`, `location`, `expected_date` and `items`. Approved orders must be marked ordered before receiving. Send a receipt UUID `client_key` and the received line quantities. Only receiving adds inventory. Each receipt is audited, partial receipt is supported and over-receipt is rejected. Cancelling a partially received order closes the remainder and keeps receipts intact.

Register RFID via a hexadecimal EPC of 8–64 characters in whole bytes. An operator can post a scan with `location`, `kind`, `identifier`, `client_key` and optional `simulated` (RFID only). Barcode strings preserve leading zeroes. A matching scan can be attached once to a manual stock movement. Scan recording alone changes no stock. A scanner or client that can submit JSON can use the same API.

### Reports and optimization

Pass `location` for a single authorized location, `start` and `end` as inclusive UTC dates, and `group=day|week|month` for sales. The default range is the 30 days ending today. Inventory and low-stock quantities show current balances. Orders are grouped by creation date. Sales report gross shipments and captured sale prices. Tax, shipping charges and refunds are excluded. Supplier reports use purchase creation dates and include completed, on-time, cancelled and currently overdue counts. Add `export=csv` for tabular reports.

Inventory value uses current catalog purchase prices. Turnover is shipped cost divided by the average of opening and ending inventory values, with the result omitted when the denominator is zero. Cost at shipping is the then-current catalog purchase price. This is an operational estimate. Low-stock and stockout counts represent products with at least one matching location balance. Products with no movement history have no balance at that location. Shipment totals represent observed sales and can understate demand during stockouts.

For a configured location and supplier offer, the reorder-point formula is average daily shipped quantity over the last complete configured days × lead time + safety stock, rounded up. Lead time comes from the supplier offer or a rule override. Suggested order quantity uses available stock plus unreceived quantities on open, ordered purchases and replenishes to the configured target or one unit above the reorder point, whichever is higher. Rules with insufficient observation history return `insufficient_data`. Forecasts are a moving average and do not model seasonality or lost demand. Recommendations from alternative suppliers for the same SKU should be compared before placing an order.

## Tests and demo data

Use a dedicated MySQL environment, then run:

```powershell
.venv\Scripts\python.exe manage.py check --database default
.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.venv\Scripts\python.exe manage.py test --keepdb
.venv\Scripts\python.exe manage.py spectacular --validate --fail-on-warn
```

Run `manage.py seed_stocksmart` explicitly with `DJANGO_DEBUG=True` to create labeled examples. The command creates a store, warehouse, catalog, supplier, stock movements, fulfilled sale and partially received purchase. Demo accounts have unusable passwords. Set a dev-only password interactively with `manage.py changepassword stocksmart-demo-customer` if you want to log in as that user.

## Known limits

Committed stock is visible on the next API read. Delivery alerts are available through an in-app list. That list has no email or push delivery. Images are cataloged by HTTP(S) URL. Hardware reader protocols, payment gateways, refund processing and carrier APIs are outside this implementation. Swagger assets load from a CDN. The inventory ledger and fulfillment history are written by domain services. Direct database edits bypass those controls.

See [architecture and diagrams](docs/architecture.md) and the [generated OpenAPI schema](docs/openapi.yaml).
