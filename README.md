# SABI BUSINESS V1

Version 1 includes:
- Business registration and login
- Admin bootstrap endpoint
- Business profile
- Admin dashboard with registered business list
- Four UI languages (sq/en/it/de)
- Cloudflare D1 database
- Secure HttpOnly session cookie and PBKDF2 password hashing

## Important
This is a starter V1. It does not yet include QR menus, ordering, subscriptions, payment processing, password reset, email verification, or production abuse controls. Do not collect card data.

## Deploy outline
1. Create a Cloudflare D1 database named `sabi-business-db`.
2. In the D1 console, run the full contents of `schema.sql`.
3. Copy the D1 database ID into `wrangler.toml`.
4. Put `worker.js` in `src/worker.js` (create the `src` folder).
5. Deploy the Worker with the static assets directory `public`.
6. Add Worker secret `ADMIN_SETUP_KEY` with a long random value.
7. After deploy, create your admin once by POSTing JSON to `/api/setup-admin` with header `x-setup-key: YOUR_SETUP_KEY`:
   `{"email":"YOUR_EMAIL","password":"A_LONG_UNIQUE_PASSWORD"}`
8. Sign in through the website.

If using Wrangler:
- `npx wrangler d1 create sabi-business-db`
- Run schema: `npx wrangler d1 execute sabi-business-db --remote --file=./schema.sql`
- `npx wrangler secret put ADMIN_SETUP_KEY`
- `npx wrangler deploy`

The D1 database ID returned by `d1 create` must be inserted into wrangler.toml before deploy.

## Admin setup request example
Use a REST client or browser API tool to send:
POST https://YOUR-WORKER-DOMAIN/api/setup-admin
Headers:
  content-type: application/json
  x-setup-key: YOUR_SETUP_KEY
Body:
  {"email":"you@example.com","password":"AtLeast12Characters!"}

Keep the setup key and admin password private. The setup endpoint automatically refuses to create a second admin.
