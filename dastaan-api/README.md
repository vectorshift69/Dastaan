# dastaan-api — backend service

All business logic, auth, and data for the Dastaan platform. The web app
(`dastaan-web`) is UI-only and talks to this service through a same-origin
proxy (`/api/*`).

## Run

```bash
cp .env.example .env    # then fill JWT_SECRET and CODE_PEPPER (32+ random chars each)
npm install
npm run seed            # demo branches, services, staff, bookings
npm run dev             # http://localhost:4000
```

Demo credentials (seed): staff codes `1111` reception (Admin, Marina Walk) ·
`2222` Aqib (Barber) · `9999` Owner (Super Admin) · barbers `3333–7777`,
`6161–6363` · client `demo / demo1234`.

## Architecture

Two services, one contract:

```
browser ── dastaan-web (Next.js, UI only, :3000)
              │  /api/* rewrite (server-side proxy, same origin)
              ▼
          dastaan-api (Fastify, :4000) ── SQLite (dev) / Postgres (prod)
```

Modules inside the API (`src/routes/`): `auth`, `bookings`, `catalog`/staff,
plus `src/notify/` (notification outbox + scheduler).
Each is an isolated Fastify plugin with its own validation — they can be
split into separate deployables (booking service, notification service,
store service) later without changing the web app, which only knows `/api/*`.
Full microservices are deliberately deferred: at current scale they'd add
network hops, distributed-transaction pain, and ops cost with no benefit.

## Security model

- **Staff login (4-digit code only).** Codes are never stored in plain text —
  HMAC-SHA256 with a server-side pepper (`CODE_PEPPER`, env only, never in
  the DB). A stolen database cannot be brute-forced without the pepper.
  Codes are globally unique (enforced on create/change) so the code alone
  identifies the account. Online guessing is contained by rate limits
  (10/min/IP) plus escalating lockout (5 misses → 60s, doubling to 15 min),
  persisted in the DB so restarts don't reset it.
- **Client login (user ID + password).** bcrypt cost 12; unknown-user
  timing is equalized with a dummy compare; same lockout scheme per IP+ID.
- **Sessions.** Signed JWT in an `httpOnly` `SameSite=Lax` cookie
  (`Secure` in production), 8h expiry, issuer-pinned. Nothing readable by JS.
- **CSRF.** SameSite cookie + Origin allow-list (`WEB_ORIGINS`) on every
  state-changing request.
- **SQL injection.** Impossible by construction: every query is a prepared
  statement with bound parameters; no string-built SQL anywhere.
- **Input validation.** zod schemas on every route; unknown fields dropped;
  body size capped at 64 KB.
- **RBAC on the server.** Every route re-checks role and branch scope
  (admin → own branch only; barber → read-only, own bookings only;
  client → own records only). The UI hiding a button is never the guard.
- **Information hygiene.** Generic error messages (no stack traces, no
  "user exists" oracles beyond registration), code hashes never selected,
  helmet security headers, cross-origin XHR denied.
- **Audit trail.** Logins (success + failure), staff creation, code resets,
  status changes, payment flags — queryable at `GET /audit` (super admin).
- **Business rules enforced server-side.** Cancellation requires a reason;
  double-booking rejected with a conflict check; status values whitelisted.

## Notifications (PRD 5.4)

Outbox pattern: triggers write rows to a `notifications` table; a scheduler
loop (15s) delivers due rows with retries and exponential backoff. Messages
are never lost to a crash and API responses never block on an SMS gateway.

| Trigger | Message |
|---|---|
| Booking created | Instant confirmation text |
| Booking created (future) | Reminder, exactly 2 hours before the slot |
| Booking cancelled | Cancellation notice + pending reminder auto-voided |
| Service paid (checkout) | Feedback request — in-app review link + Google review link (sent once) |

Providers are pluggable via `SMS_PROVIDER`: `console` (dev, logs the send)
or `twilio` (real SMS — set `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM`). A
WhatsApp Business provider (often preferred in the UAE) drops into the same
interface in `src/notify/provider.ts`. Review links come from `REVIEW_URL`
and `GOOGLE_REVIEW_URL`. Staff can inspect the outbox at
`GET /notifications` (admin: own branch; super admin: all).

## Auto-invoicing (PRD 9 & 11)

`POST /bookings/:id/checkout` is the single atomic checkout action: it takes
the POS panel's editable price, discount, tip, and payment method, creates a
tax invoice (sequential `INV-<year>-#####`, UAE VAT 5% computed from
VAT-inclusive prices, tip outside VAT), marks the booking paid, texts the
client the invoice, and queues the feedback request — no manual step for
front-desk staff. Duplicate checkout is rejected (one invoice per booking);
cancelled/no-show bookings can't be checked out. Browse with
`GET /invoices` (admin: own branch; super: all, `?branchId=` filter) and
`GET /bookings/:id/invoice` (clients: own bookings only). Every invoice is
downloadable as a branded A5 PDF at `GET /bookings/:id/invoice/pdf` (same
authorization) — the console's "Sale completed" screen has the download
button.

## Loyalty & Apple Wallet (PRD 6)

Registered clients earn 1 point per AED of the service total, automatically
at checkout. Tiers by lifetime points: Member → Silver (2,000) → Gold
(5,000). Each account has a random QR token; the client's card page
(`/card` in the web app) renders it on a bright panel so the front desk can
scan it **from the phone screen with the POS webcam** (console → "Scan
card", BarcodeDetector with manual-entry fallback). Endpoints:
`GET /loyalty/me`, `GET /loyalty/me/qr.svg`, `POST /loyalty/scan` (staff,
audited), `GET /loyalty/me/wallet.pkpass`. The Wallet pass is fully coded
and activates once you add Apple Developer credentials to `.env`
(`APPLE_PASS_CERT`, `APPLE_PASS_KEY`, `APPLE_WWDR_CERT`,
`APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`); until then the endpoint explains
what's missing. Checkout responses include `pointsEarned`, and bookings for
registered clients carry a `loyalty` chip into the console.

## Inventory (PRD 10)

Products come in two kinds: `retail` (sellable at POS and online) and
`supply` (in-salon use). Product CRUD is Super-Admin-only (delete = retire,
history survives). Stock is per branch with low-stock thresholds; Admins
see their own branch and can **receive shipments** (positive additions
only, per open item #3's recommendation); free-form adjustments are
Super-Admin-only. Every change is an immutable `stock_movements` row with
actor and reason (`received`, `adjustment`, `pos_sale`, `online_sale`).

## Reports & timeline history (PRD 2.2, 7, 13)

`GET /reports/sales` (Super Admin ONLY): revenue/tips/VAT/discount totals,
by day, by payment method, by branch, top services — filterable
`?from&to&branchId`. `GET /reports/barber/me` (barber, self only): booking
volume, completed, no-shows, minutes, own-chair service revenue — nothing
salon-wide. Timeline history: every night (and via
`POST /reports/snapshot`) the day's full calendar state is archived to
`day_snapshots`, queryable at `GET /reports/timeline?date=&branchId=`
(admin: own branch; super: all) — the past is never overwritten.

## Coupons (PRD 8)

Creation/management is Super-Admin-only (open item #2 recommendation):
percent or fixed, scoped to `services`/`products`/`both`, with minimum
spend, usage caps, and validity windows. Staff and clients validate codes
via `POST /coupons/validate`; the POS checkout accepts `couponCode` (the
console has an Apply field) and the store checkout does too — amounts are
always computed server-side and every redemption is logged against its
invoice or order. Seeded demo code: `WELCOME10` (10% off, min AED 50).

## Online store (PRD 12)

`GET /store/products` is the public storefront (retail items only).
Clients place orders (`POST /store/orders`) priced entirely from the
server-side catalog, with coupon support and 5% VAT breakdown; they see
only their own orders. **All** order visibility and lifecycle control is
Super-Admin-only — Admins and Barbers get 403 on store sales data, exactly
per PRD 12.1. Status flow `placed → paid → fulfilled` (or `cancelled`) is
enforced; fulfilment automatically draws stock from the fulfilment branch
(`STORE_FULFIL_BRANCH`, default `b1`) as logged `online_sale` movements.
Payment capture awaits the gateway decision (open item #5) — the
`paid` transition is where the gateway webhook will land.

## POS product sales (PRD 11)

`POST /bookings/:id/checkout` accepts a `products[]` array so the front desk
can sell retail items in the same transaction as the service. Lines are
priced from the catalog server-side, stock is checked first (the sale is
rejected before any invoice exists if a line is short), products appear as
their own invoice lines (`2× Argan Repair Serum`), and stock is drawn down
as logged `pos_sale` movements. Coupons apply to the combined total.

## Reviews & ratings (PRD 5.4, 7)

Checkout creates an unsubmitted review with a single-use token; the feedback
SMS links to `/review/<token>` so clients can rate **without logging in**.
`GET /reviews/:token` opens the form, `POST /reviews` submits (1–5 stars +
optional comment, single-use, rate-limited). 4–5 star ratings are then
nudged toward the Google review link. Stylist averages surface at
`GET /stylists/:id/reviews`, feed each barber's own analytics
(`/reports/barber/me` → `rating`), and staff can browse submitted reviews
via `GET /reviews` (admin: own branch; super: all).

## Clients (PRD 2.2, 7)

`GET /clients?search=` lists everyone who has booked — registered accounts
and walk-ins — aggregated with visit counts, last visit, and loyalty.
`GET /clients/:id` returns the profile plus booking history;
`PATCH /clients/:id` edits details; `POST /clients` records a walk-in.
Admins are scoped to their own branch, Super Admin sees all branches, and
**barbers are refused entirely** — they cannot view or edit client details.

## Payments — go/no-go switch (whole application)

Payments are behind a single master flag so the platform can launch and run
completely without card processing, then have it turned on later.

```bash
PAYMENTS_ENABLED=0        # nothing charges a card anywhere (default)
PAYMENTS_ENABLED=1
PAYMENT_MODES=online,terminal   # which capture paths are live
PAYMENT_SERVICE_URL=...         # the separate payment service
PAYMENT_SERVICE_TOKEN=...       # service-to-service auth
```

With the flag **off**: store orders are "pay when you collect", the POS
records whatever method the desk actually used, `GET /config` reports
`payments.enabled=false` so the web app never offers to charge, and every
`/payments/*` route answers `503` with a plain explanation. With it **on**:
store orders return `payment.required=true`, the console shows a "Card
reader" option, and `/payments/*` proxy to the payment service.

**The money-moving code lives in its own service** (`dastaan-payments`,
not built yet) so Stripe secret keys and PCI scope never sit inside this
API. These routes are only the boundary — flag check, authorization, branch
scoping, audit — then a server-to-server call. Stripe supports the UAE
(Visa/Mastercard, AED settlement) and Terminal readers (Reader M2 / BBPOS
Chipper 2X BT) for in-branch charges.

## Production checklist

1. Swap SQLite → Postgres: reimplement `src/db.ts` with `pg` (same function
   signatures; all SQL is standard). SQLite is fine for a single branch,
   Postgres is right once both branches write concurrently.
2. Put both services behind one domain (e.g. Vercel + Fly/Railway, or one
   VPS with Caddy): web on `/`, API on `/api`. Set `NODE_ENV=production`,
   `TRUST_PROXY=1`, real `WEB_ORIGINS`.
3. Rotate `JWT_SECRET`/`CODE_PEPPER` into a secret manager, not files.
4. Move rate-limit/lockout state to Redis if you run more than one API
   instance.
5. Super Admin: consider upgrading to ID + password + code (PRD open item
   #4) — the route structure already allows adding a second factor.
6. Add TLS everywhere (automatic on the platforms above).

## API surface

| Method | Path | Who |
|---|---|---|
| POST | /auth/team | public (rate-limited) — 4-digit code login |
| POST | /auth/team/change-code | staff — change own code |
| POST | /auth/client/register | public — user ID + password |
| POST | /auth/client/login | public (rate-limited) |
| GET | /auth/me · POST /auth/logout | any session |
| GET | /branches · /services · /stylists | public |
| GET | /bookings?date=&branchId= | role-scoped |
| POST | /bookings | client or admin/super |
| PATCH | /bookings/:id/status | admin/super (cancel ⇒ reason required) |
| PATCH | /bookings/:id/paid | admin/super |
| GET/POST | /staff | admin (own-branch barbers) / super |
| POST | /staff/:id/reset-code | super only |
| POST | /bookings/:id/checkout | admin/super — pay + auto-invoice + SMS |
| GET | /invoices · /bookings/:id/invoice | staff branch-scoped; clients own only |
| GET | /loyalty/me · /loyalty/me/qr.svg · /loyalty/me/wallet.pkpass | client |
| POST | /loyalty/scan | admin/super (audited) |
| GET/POST | /reviews/:token · /reviews | public (token) — submit rating |
| GET | /stylists/:id/reviews | public |
| GET | /reviews | admin own branch / super |
| GET/POST/PATCH | /clients (+/:id) | admin own branch / super · barbers denied |
| GET | /notifications?bookingId= | admin (own branch) / super |
| GET/POST/PATCH/DELETE | /products | GET staff · writes super only |
| GET | /inventory · /inventory/movements | admin own branch / super all |
| POST | /inventory/receive | admin (own branch, +only) / super |
| POST | /inventory/adjust | super only |
| CRUD | /coupons (+/:id/redemptions) | super only |
| POST | /coupons/validate | staff (not barber) + clients |
| GET | /store/products | public |
| POST | /store/orders · GET (own) | client |
| GET all · PATCH /store/orders/:id/status | super only (PRD 12.1) |
| GET | /reports/sales | super only |
| GET | /reports/barber/me | barber, self only |
| GET /reports/timeline · POST /reports/snapshot | admin own branch / super |
| GET | /audit | super only |
