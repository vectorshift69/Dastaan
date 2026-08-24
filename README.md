# Dastaan — Salon Management & E-Commerce Platform

A production salon platform for **DASTAAN LIFE BARBERS L.L.C**, a two-branch
gents' salon in Dubai: online booking, a front-desk console, POS with combined
service + product checkout, FTA-compliant VAT invoices, an Apple Wallet loyalty
programme, branch inventory, coupons, a delivered online shop with its own
warehouse, and owner reporting.

Built to replace a third-party SaaS (Fresha) with a system the salon owns.

![screens](docs/cover.png)

## Architecture

Two deployable services, one contract — the web app holds no business logic:

```
browser ── dastaan-web (Next.js 16, UI only)
              │  /api/* same-origin proxy
              ▼
          dastaan-api (Fastify + TypeScript)  ──  PostgreSQL (Supabase / PGlite)
              │
              └── dastaan-payments (separate service, PCI scope isolated)
```

Payments live behind a master go/no-go flag and in their own service, so Stripe
keys never sit inside the main API. That service is built; the main API's
boundary routes are not yet pointed at it.

| Service | Stack | Purpose |
|---|---|---|
| `dastaan-web` | Next.js 16 · TypeScript · Tailwind 4 · React-Three-Fiber | Public site, booking, store, loyalty card, staff console |
| `dastaan-api` | Fastify 5 · TypeScript · zod · JWT | All data, auth, business rules, RBAC |
| `dastaan-payments` | Fastify · Stripe | Payment Intents, refunds, idempotent webhooks |

## Features

**Clients** — 3D landing page with scroll choreography, 4-step booking wizard
with real availability, sign-in or Google, booking for yourself or someone
else, an online shop that delivers anywhere in the UAE, order history, a
digital loyalty card with QR + Apple Wallet pass, a no-login review link after
each visit, and self-service password reset by email.

**Front desk** — barber-column day calendar with a live now-line in salon time,
day and month navigation across the whole history, status pipeline and
paid/unpaid indicators, cancel-with-reason, combined product + service checkout
with editable price/discount/coupons/tips, automatic VAT invoices with PDF
download, loyalty QR scanning from the client's phone, client records, and
branch inventory with shipment receiving.

**Owner** — cross-branch sales reporting, revenue charts, top services, product
CRUD and stock adjustments, discount-code management, online order fulfilment,
a **Team** tab for every account and credential, and an audit trail.

**Online shop manager** — a separate system at `/shop` with its own id-and-password
sign-in, managing one national warehouse: receiving, stock counts, corrections,
customer returns, reorder levels and a movement ledger.

### Two kinds of stock, deliberately apart

Branch stock and the online shop's stock are different tables, different
screens and different people:

| | Branch stock | Online shop |
|---|---|---|
| What | The retail shelf and back bar, per branch | One warehouse for the whole UAE |
| Managed in | Team console → Inventory | `/shop`, by the shop manager |
| Sold by | The desk, at checkout | The website, delivered |
| Reservations | None — a desk sale is instant | Held from order until shipped |

A barber using the last bottle of oil at Marina Walk cannot make the website
sell out, and a busy week online cannot leave the chair short. Every online
order is **delivered**; there is no collect-from-branch.

### Three kinds of account

| | Signs in with | Set by |
|---|---|---|
| Staff (owner, reception, barbers) | 4-digit keypad code | Owner types it, hands it over in person |
| Online shop manager | User ID + password | Owner creates once, then it is theirs |
| Clients | User ID + password, or Google | Themselves — staff never set a client's password |

Nothing in the console can read an existing credential back. Codes are stored
as an HMAC and passwords as a hash, so the only available actions are replace
and switch off. Deactivating never deletes: invoices and bookings point at
those rows.

### VAT invoicing

Every invoice is a valid UAE tax invoice: it carries the words *Tax Invoice*,
the supplier's legal name and **TRN 104235451200003**, a sequential number, the
date, what was supplied, and the tax rate, tax amount and total in AED. The TRN
is printed in the header and repeated in the footer, so a cropped receipt still
carries it. Business details and the VAT rate come from config
(`BUSINESS_TRN`, `BUSINESS_LEGAL_NAME`, `VAT_RATE`, …) so a correction never
needs a code change.

## Security

- Staff sign in with a 4-digit code only (fast at the desk). Codes are stored
  as HMAC-SHA256 with a server-side pepper, are globally unique, and are
  protected by rate limiting plus escalating lockout.
- Clients and the shop manager use ID + password (bcrypt, cost 12) with
  timing-equalised lookups, so an unknown ID takes as long as a wrong password.
- Password resets are emailed links: only the SHA-256 of the token is stored,
  each works once, they expire in an hour, and asking for one gives the same
  answer whether or not the account exists — otherwise the form becomes a way
  to find out who is a client here.
- Sessions are signed JWTs in httpOnly SameSite cookies; CSRF is blocked by an
  origin allow-list on every mutation.
- Every query is a bound prepared statement — no string-built SQL.
- Role and branch scope are re-checked server-side on every route; the UI
  hiding a control is never the only guard. Routes name the roles they admit
  rather than denying a few, so a role added later is refused by default —
  a deny-list is only correct until somebody adds a role.
- Credential resets, booking edits, checkouts, stock and sales changes are all
  written to an audit log.

## Run locally

```bash
# 1. API
cd dastaan-api
cp .env.example .env          # fill JWT_SECRET and CODE_PEPPER (32+ random chars)
npm install && npm run seed && npm run dev      # :4000

# 2. Web
cd ../dastaan-web
npm install && npm run dev                       # :3000
```

Or `docker compose up --build` from this folder.

**Demo logins**

| Where | Credential |
|---|---|
| `/team` — staff console | `9999` owner · `1111` reception (Marina Walk) · `1212` reception (City Centre) · `2222`–`7777`, `6161`–`6363` barbers. The code alone signs you in. |
| `/login` — clients | `demo` / `demo1234` (every demo client shares that password) |
| `/shop` — online shop | `shop` / `shop1234` — **a demo password, change it on a real deployment** |

Coupons: `WELCOME10`, `GROOM25`, and `SUMMER15` (expired, to show that state).

`npm run seed` builds a salon that has already been trading: six weeks of
completed visits with invoices, ~150 clients with honest visit counts, loyalty
balances carried over from Fresha, ratings on every barber, branch stock that
has moved (two lines sit below their reorder point), a stocked online warehouse
with one line low, store orders in every state, and a fortnight of archived
timeline days. It is deterministic for a given day, so a demo can be rehearsed.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for hosting.

## Status

Built and tested: booking, console, POS, VAT invoicing, loyalty, branch
inventory, the online shop and its warehouse, coupons, reports, reviews,
clients, user administration and password resets.

The `dastaan-payments` service is built and verified in isolation — amounts
always read from the database, idempotent webhooks, signature checks — but the
main API's `/payments/*` boundary is not yet wired to it, and the booking
wizard has no pay-now step. Card payments therefore stay behind
`PAYMENTS_ENABLED=0`.

GPS attendance is a day-2 requirement and is not started.

See [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for what changed and when.
