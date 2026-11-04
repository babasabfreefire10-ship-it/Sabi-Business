# SABI BUSINESS V2 PREMIUM MODULES

Files:
- `schema_v2.sql`: run once against the existing D1 database after V1 schema.
- `worker_v2.js`: reference V2 Worker API implementation.
- `dashboard-v2.html`: separate dashboard preview that consumes V2 API endpoints.
- `menu.html`: public QR menu page.

IMPORTANT DEPLOYMENT NOTE:
This V2 Worker file is a separate replacement/starting point for the V2 endpoints, but V1 login/register/admin routes must be retained. Merge the `/api/v2/*` and `/api/public/menu/*` branches into the V1 Worker `routeApi` function, before its final 404, and keep the V1 session/password functions. Do NOT deploy worker_v2.js alone as it does not implement login/register itself.

Deployment:
1. Backup your existing project and D1 database.
2. Run all of `schema_v2.sql` in the same D1 database used by V1.
3. Merge the V2 API routes into the existing V1 `worker.js` as described above.
4. Copy `dashboard-v2.html` to `public/dashboard-v2.html`.
5. Copy `menu.html` to `public/menu.html`.
6. Deploy again.

API endpoints:
GET /api/v2/overview
GET/POST /api/v2/products
DELETE /api/v2/products/:id
GET/POST /api/v2/tables
GET /api/v2/orders
PATCH /api/v2/orders/:id/status
GET /api/v2/reservations
GET /api/v2/customers
GET /api/v2/expenses
GET /api/public/menu/:qrSlug

Security:
- V2 API uses the authenticated session and derives business_id from the logged-in account.
- Public QR menu only exposes available product names/descriptions/prices and table/business public names.
- Never put secret API keys in HTML, JavaScript sent to browsers, or GitHub.
- This package does not yet implement payment gateways, email/SMS notifications, order submission from public menu, full reservations/CRM/expense create flows, image uploads, subscription billing, or production rate limiting.
- Prices are stored as integer cents; UI sample shows ALL with 2 decimals. Adapt currency formatting if needed.
