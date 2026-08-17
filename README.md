# Dastaan — Salon Management & E-Commerce Platform

A production salon platform for a two-branch unisex salon in Dubai: online
booking, a front-desk console, POS with combined service + product checkout,
auto-generated VAT invoices, an Apple Wallet loyalty programme, inventory,
coupons, an online store, and owner reporting.

Built to replace a third-party SaaS (Fresha) with a system the salon owns.

![screens](docs/cover.png)

## Architecture

Two deployable services, one contract — the web app holds no business logic:

```
browser ── dastaan-web (Next.js 16, UI only)
              │  /api/* same-origin proxy
              ▼
          dastaan-api (Fastify + TypeScript)  ──  PostgreSQL / SQLite
              │
              └── dastaan-payments (separate service, PCI scope isolated)
```

Payments live behind a master go/no-go flag and, when built, in their own
service so Stripe keys never sit inside the main API.

| Service | Stack | Purpose |
|---|---|---|
| `dastaan-web` | Next.js 16 · TypeScript · Tailwind 4 · React-Three-Fiber | Public site, booking, store, loyalty card, staff console |
| `dastaan-api` | Fastify 5 · TypeScript · zod · JWT | All data, auth, business rules, RBAC |
| `dastaan-payments` | *(planned)* Stripe | Payment Intents + Terminal |

## Features

**Clients** — 3D landing page with scroll choreography, 4-step booking wizard,
online store with cart, order history, digital loyalty card with QR + Apple
Wallet pass, and a no-login review link after each visit.

**Front desk** — barber-column day calendar with status pipeline and
paid/unpaid indicators, cancel-with-reason, combined product + service
checkout with editable price/discount/coupons/tips, automatic VAT invoices
with PDF download, loyalty QR scanning from the client's phone screen, client
records, and branch inventory with shipment receiving.

**Owner** — cross-branch sales reporting, revenue charts, top services,
product CRUD and stock adjustments, discount-code management, online order
fulfilment, and an audit trail.

## Security

- Staff sign in with a 4-digit code only (fast at the desk). Codes are stored
  as HMAC-SHA256 with a server-side pepper, are globally unique, and are
  protected by rate limiting plus escalating lockout.
- Clients use ID + password (bcrypt, cost 12) with timing-equalised lookups.
- Sessions are signed JWTs in httpOnly SameSite cookies; CSRF is blocked by an
  origin allow-list on every mutation.
- Every query is a bound prepared statement — no string-built SQL.
- Role and branch scope are re-checked server-side on every route; the UI
  hiding a control is never the only guard.
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

**Demo logins** — staff codes `9999` owner · `1111` reception (Marina Walk) ·
`1212` reception (City Centre) · `2222`–`7777` and `6161`–`6363` barbers. The
code alone signs you in. Clients sign in with `demo` / `demo1234`.
Coupons: `WELCOME10`, `GROOM25`, and `SUMMER15` (expired, to show that state).

`npm run seed` builds a salon that has already been trading: six weeks of
completed visits with invoices, ~150 clients with honest visit counts, loyalty
balances carried over from Fresha, ratings on every barber, stock that has
moved (two lines sit below their reorder point), store orders in every state,
and a fortnight of archived timeline days. It is deterministic, so a demo can
be rehearsed.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for hosting.

## Status

Booking, console, POS, invoicing, loyalty, inventory, coupons, store, reports,
reviews and clients are built and tested. Card payments are behind
`PAYMENTS_ENABLED` and await the payments service.
