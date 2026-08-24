# dastaan-api — backend service

All business logic, auth, and data for the Dastaan platform. The web app
(`dastaan-web`) is UI-only and talks to this service through a same-origin
proxy (`/api/*`).

## Run

```bash
cp .env.example .env    # then fill JWT_SECRET and CODE_PEPPER (32+ random chars each)
npm install
npm run seed            # demo branches, services, staff, six weeks of history
npm run seed:reset      # clear and rebuild it — safe to re-run any time
npm run dev             # http://localhost:4000

# production (this is what the host runs)
npm run build           # tsc → dist/
npm start               # node dist/index.js
npm run seed:built      # seed from the compiled output (no tsx needed)
npm run seed:built:reset
```

Demo credentials (seed): staff codes `9999` Imtiaz Dastaan (Super Admin) ·
`1111` Aisha Rahman (Admin, Marina Walk) · `1212` Noor Siddiqui (Admin, City
Centre) · barbers `2222`–`7777` and `6161`–`6363` · clients `demo / demo1234`
(all nine seeded clients share that password).

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
- **Online shop login (`/auth/shop/login`).** A separate door from the staff
  keypad. Whoever runs the shop is not on the salon floor: no branch, no chair,
  and no code that also opens the till. Same bcrypt, same lockout, and the same
  deliberately vague "wrong user ID or password" either way.
- **Password resets.** Only the SHA-256 of the token is stored, so a leak of
  `password_resets` is useless. Single use — the token is spent *before* the
  password changes, so two racing requests cannot both win — and expires in an
  hour (`RESET_TTL_MINUTES`). Requesting a new link spends the outstanding ones.
- **No account enumeration.** `POST /auth/forgot` answers identically for a real
  address, an address nobody has, and a malformed one. Anything else turns the
  form into a way of finding out who has an account at a men's salon.
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
  password resets requested and completed, account deactivation, stock
  movements, status changes, payment flags — queryable at `GET /audit`
  (super admin).
- **Business rules enforced server-side.** Cancellation requires a reason;
  double-booking rejected with a conflict check; status values whitelisted.

## Notifications (PRD 5.4)

Outbox pattern: triggers write rows to a `notifications` table; a scheduler
loop (15s) delivers due rows with retries and exponential backoff.

The same queue carries **email** as well as SMS — a reset link cannot go by SMS,
since it is long and the address is the thing being proved. A row names its
`channel` and its destination; retries and backoff are identical either way,
which is the point of keeping them in one table. `EMAIL_PROVIDER=resend` with
`RESEND_API_KEY` and `EMAIL_FROM` sends for real; unset, the dev provider prints
the message and the whole flow is testable with nothing configured.

Messages
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

## Branch inventory (PRD 10)

The retail shelf and back bar at each location. **The online shop's stock is
not here** — that is a separate warehouse in its own table, see below.

Products come in two kinds: `retail` (sellable at POS and online) and
`supply` (in-salon use). Product CRUD is Super-Admin-only (delete = retire,
history survives). Stock is per branch with low-stock thresholds; Admins
see their own branch and can **receive shipments** (positive additions
only, per open item #3's recommendation); free-form adjustments are
Super-Admin-only. Every change is an immutable `stock_movements` row with
actor and reason (`received`, `adjustment`, `pos_sale`, `online_sale`).

## The online shop's warehouse

`online_stock` has **no branch column**: one pool for the whole UAE, because
everything sold on the site is delivered from it. Asking which branch a jar
belongs to has no answer and does not need one.

Kept as a separate table rather than a column on `stock_levels` because it is
different stock, different people and a different login. A barber using the
last bottle of oil at Marina Walk cannot make the website sell out, and a busy
week online cannot leave the chair short.

**Reservations.** An order holds stock the moment it is placed, not days later
when someone marks it shipped — otherwise the shop sells what it does not have
and finds out when it tries to pack the box.

```
available = qty - reserved

reserve → order placed
release → order cancelled, back on sale
consume → order shipped, a real movement out
```

The check that makes this safe is one statement — `UPDATE ... WHERE qty -
reserved >= n` — so two clients ordering the last item at the same moment
cannot both succeed. Stock already promised to an order cannot be written off
either; cancel the order first.

Routes live under `/online/inventory` and are open to the `shop_manager` role
and the owner only. Reception and barbers get 403: how much of the company's
stock the website may sell is not a branch's call.

## User administration

Three kinds of account, three ways of handing over a credential, because they
are not the same problem:

| Account | Credential | Who sets it |
|---|---|---|
| Staff | 4-digit keypad code | Owner types it and passes it on in person — a barber has no email account here and is standing in the same room |
| Shop manager | id + password | Owner creates once; after that it is theirs (`/auth/shop/change-password`) |
| Client | password | Never staff. `POST /users/clients/:id/send-reset` emails a link to the client's own inbox |

Nothing can read an existing credential back — codes are an HMAC, passwords a
hash — so the only actions are replace and switch off. Codes are globally
unique, so a reused code is refused. Reception can add barbers to their own
branch and nothing else.

Deactivating never deletes: invoices, bookings and stock movements all
reference these rows and the history has to stay readable. You cannot switch
off your own account, and the last active owner is protected as well.

## VAT and tax invoices

A UAE tax invoice is only valid if it carries the supplier's legal name and
Tax Registration Number. Without them the client cannot reclaim input VAT and
the salon is not compliant, so this is not decoration.

```
BUSINESS_LEGAL_NAME=DASTAAN LIFE BARBERS L.L.C
BUSINESS_TRN=104235451200003
BUSINESS_ADDRESS=Zabeel 2, Dubai, UAE
VAT_RATE=0.05
```

Defaults come from the VAT registration certificate and every value is
env-overridable, so a correction never needs a code change. The TRN is printed
in the invoice header and repeated in the footer — a folded or cropped receipt
still carries it — and the business block ships with every invoice response, so
the console and the client's own order history show it without having to
remember. The VAT rate is read from config in one place rather than hardcoded
per file.

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
invoice or order. Seeded demo codes: `WELCOME10` (10% off, min AED 50),
`GROOM25` (AED 25 off services, min AED 150) and `SUMMER15` (expired and
deactivated, so the disabled state has something to show).

## Online store (PRD 12)

`GET /store/products` is the public storefront (retail items only), showing
one availability figure per product taken from the warehouse — never the branch
shelves, which belong to the chair.

**Everything is delivered.** There is no collect-from-branch: an address is
required and validated, and the storefront asks for no branch at all. Clients
place orders (`POST /store/orders`) priced entirely from the server-side
catalog, with coupon support and a VAT breakdown; they see only their own
orders. Goods are always paid in full — an appointment is a promise of time and
can be settled afterwards, a jar of pomade walking out of the door cannot.

**All** order visibility and lifecycle control is Super-Admin-only — Admins and
Barbers get 403 on store sales data, exactly per PRD 12.1. Status flow
`placed → paid → fulfilled` (or `cancelled`) is enforced. Placing an order
reserves warehouse stock inside the same transaction as the insert (both or
neither); shipping converts the hold into a real movement out; cancelling
releases it.

## POS product sales (PRD 11)

`POST /bookings/:id/checkout` accepts a `products[]` array so the front desk
can sell retail items in the same transaction as the service. Lines are
priced from the catalog server-side, stock is checked first (the sale is
rejected before any invoice exists if a line is short), products appear as
their own invoice lines (`2× Argan Repair Serum`), and stock is drawn down
as logged `pos_sale` movements. Coupons apply to the combined total.

The desk sells off **this branch's shelf**. The online warehouse is a different
table and cannot be reached from here, so a full warehouse will not rescue a
short shelf — the sale is refused, which is correct.

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

With the flag **off**: store orders are "pay on delivery", the POS
records whatever method the desk actually used, `GET /config` reports
`payments.enabled=false` so the web app never offers to charge, and every
`/payments/*` route answers `503` with a plain explanation. With it **on**:
store orders return `payment.required=true`, the console shows a "Card
reader" option, and `/payments/*` proxy to the payment service.

**The money-moving code lives in its own service** (`dastaan-payments`, built
and verified in isolation, though this API's boundary routes are not yet
pointed at it) so Stripe secret keys and PCI scope never sit inside this
API. These routes are only the boundary — flag check, authorization, branch
scoping, audit — then a server-to-server call. Stripe supports the UAE
(Visa/Mastercard, AED settlement) and Terminal readers (Reader M2 / BBPOS
Chipper 2X BT) for in-branch charges.

## Database

PostgreSQL everywhere. `DATABASE_URL` set → node-postgres against Supabase
(or any Postgres). Unset → **PGlite**, a real Postgres compiled to WASM,
running in-process and persisted to `./data/pg`. Local development needs no
Docker and no install, and the SQL that runs locally is the SQL that runs in
production.

Call sites keep writing `?` placeholders; `src/db.ts` rewrites them to
`$1..$n`. Every query is still a bound prepared statement.

## Production checklist

1. Point `DATABASE_URL` at Supabase (pooled connection, port 6543, for
   serverless hosts; direct 5432 for an always-on server).
2. Put both services behind one domain (e.g. Vercel + Render, or one
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
| GET | /auth/google/start · /auth/google/callback | public — clients only |
| POST | /auth/shop/login | public (rate-limited) — online shop manager |
| POST | /auth/shop/change-password | shop manager — own password |
| POST | /auth/forgot | public — emails a reset link, answers the same either way |
| GET | /auth/reset/check · POST /auth/reset | public (token) |
| GET | /auth/me · POST /auth/logout | any session |
| GET | /branches · /services · /stylists | public |
| GET | /bookings?date=&branchId= | role-scoped |
| POST | /bookings | client or admin/super |
| PATCH | /bookings/:id/status | admin/super (cancel ⇒ reason required) |
| PATCH | /bookings/:id/paid | admin/super |
| GET/POST | /staff | admin (own-branch barbers) / super |
| POST | /staff/:id/reset-code | super only |
| GET | /users | super only — everyone with a way in |
| POST | /users/staff | admin (own-branch barbers) / super |
| POST | /users/:id/code | super only — set a staff keypad code |
| POST | /users/shop-manager | super only — create a shop login |
| POST | /users/:id/shop-password | super only — break-glass reset |
| GET | /users/clients?q= | super only — registered clients, for resets |
| POST | /users/clients/:id/send-reset | super only — emails the client |
| PATCH | /users/:id/active | super only — never deletes |
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
| GET | /online/inventory | shop manager / super — the national warehouse |
| POST | /online/inventory/receive | shop manager / super |
| POST | /online/inventory/adjust | shop manager / super — counts, breakage, returns |
| POST | /online/inventory/reorder-level | shop manager / super |
| GET | /online/inventory/movements | shop manager / super |
| CRUD | /coupons (+/:id/redemptions) | super only |
| POST | /coupons/validate | staff (not barber) + clients |
| GET | /store/products | public — one national availability figure |
| POST | /store/orders · GET (own) | client |
| GET all · PATCH /store/orders/:id/status | super only (PRD 12.1) |
| GET | /reports/sales | super only |
| GET | /reports/barber/me | barber, self only |
| GET /reports/timeline · POST /reports/snapshot | admin own branch / super |
| GET | /audit | super only |
