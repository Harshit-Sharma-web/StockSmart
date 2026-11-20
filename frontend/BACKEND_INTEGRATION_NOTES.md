# Backend integration notes

## Local connection

The frontend was built against the existing Django router, serializers, views, authorization, services, tests and generated OpenAPI file. Vite proxies relative `/api/v1/` requests to `VITE_API_BASE_URL` in development, including a configured base path. Set `VITE_API_BASE_URL` to the absolute API prefix for a production cross-origin build. In that deployment, set Django's `CORS_ALLOWED_ORIGINS` to the exact frontend origin and configure `DJANGO_ALLOWED_HOSTS` for the API host. Configure TLS and the backend's redirect settings consistently. These are deployment settings and were not applied by the frontend task.

## Authorization and sessions

The account response includes the application role but omits Django's superuser flag. When a profile reports customer, a read-only users-list request detects admin permission for a default Django superuser. A 403 confirms customer access. An API or network error is shown as a session issue. The Django API remains the authority for every request.

Catalog updates require per-model permissions for store managers. The frontend uses DRF OPTIONS metadata to discover add and change actions. The API has no equivalent metadata action for delete, so catalog deactivation and deletion are exposed to administrators. Account changes follow the API's protection of the current account and its superusers.

Tokens live in memory and tab-scoped `sessionStorage` to support reload. The current Django API returns JWTs in JSON. Moving JWTs to HttpOnly cookies would require a backend contract change. Avoid untrusted scripts on the frontend origin. Rotating refresh requests are shared while pending, and rejected refresh credentials clear the client session. Logout asks Django to blacklist the refresh token and clears the local session.

## Supported contracts and gaps

- Checkout requires a store and product quantities. The displayed confirmed total comes from Django. There is no payment or carrier API.
- Purchase orders require supplier offers. Inventory increases through goods receipts. Shipments and returns follow the backend status transitions and eligible item quantities.
- Product assets are HTTP(S) URLs. There is no upload API. The currency code is absent from API responses, so prices are displayed as numeric amounts without an assumed currency.
- Scans accept manual or scanner keyboard input, including simulated RFID. Hardware protocols and camera scanning were outside the implemented UI. A scan needs a separate authorized movement to affect inventory.
- Alerts are read from low-stock and overdue-purchase endpoints. There is no server-side read/unread tracking or push delivery.
- General server-side search and ordering are available only on resources that expose those filters. Other lists use their verified filters and pagination.
- Inventory distribution covers the first page of active authorized locations, or a selected location when it appears on that page. Analytics use dated sales, balances and ledger records returned by Django. The recommendation report displays insufficient-data statuses provided by the server.
- The original workspace did not have Django listening on port 8000 or usable authorized QA credentials. A temporary process loaded the existing Django WSGI application for a read-only schema smoke check. Authenticated live workflows require a separately configured Django service and test accounts.
