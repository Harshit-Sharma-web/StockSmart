# StockSmart frontend

React SPA for the existing StockSmart Django API. Operators use a retail inventory workspace. Customers use a separate catalog, cart and order workspace.

## Run locally

Requirements are Node 22.13+ and npm. The existing Django service must listen on port 8000 or on the configured API URL.

From the repository root in PowerShell:

```powershell
cd frontend
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

Open http://localhost:5173. Edit the frontend-only `.env` if the Django origin differs. The Vite development proxy forwards `/api/v1/` to the configured Django service.

To start an already-configured Django environment, use a separate terminal from the repository root:

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

See the existing backend README for MySQL, Django secret, allowed hosts and local HTTP configuration. Starting the frontend does not run backend migrations or seed data.

## Pages

| Area | Pages |
|---|---|
| Access | Sign in, customer registration, account details, password change, access restricted and page not found |
| Management | Dashboard, alert center, products and categories, inventory and low-stock thresholds, stores and warehouses, movements and transfers, orders and fulfillment, suppliers and offers, purchase orders and receipts |
| Tracking and insights | Barcode lookup, scan capture and history, RFID tag management, analytics, reports and CSV exports, reorder rules and recommendations |
| Administration | User status and roles, location assignments |
| Customer | Storefront, catalog, product details, cart, checkout, order history, order details, customer profile |

Management mutations and customer checkout call Django directly through Axios. Backend stock quantities and order totals are authoritative. Pagination and supported filters run on the API. TanStack Query refreshes API state after mutations. Retry-safe writes send the backend's client key.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

Vitest uses a test-only Axios adapter to verify request shapes, routes, account state and UI behavior. The production build emits `dist/`. Configure your static host to fall back to `index.html` for client routes. In production, set `VITE_API_BASE_URL` when building. Serve the frontend and API over HTTPS. A different API origin needs the frontend origin in Django's CORS allowlist. See [backend integration notes](BACKEND_INTEGRATION_NOTES.md).

## Source layout

- `src/api/` contains API types, request services and JWT handling.
- `src/components/` contains layouts, tables, filters, dialogs and forms.
- `src/features/` contains accounts, management workflows, storefront, charts and reports.
- `src/App.tsx` contains role-protected routes. `src/App.test.tsx` contains UI and request-contract tests.
- `public/` contains the favicon.
