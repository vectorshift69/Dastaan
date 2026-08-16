# Dastaan — Salon Management & E-Commerce Platform

Two services: this web UI (Next.js) + `dastaan-api` (Fastify). Mobile-responsive.

## Run (dev)

```bash
# terminal 1 — API
cd ../dastaan-api && cp .env.example .env  # fill JWT_SECRET + CODE_PEPPER
npm install && npm run seed && npm run dev  # :4000

# terminal 2 — web
cd dastaan-web
npm install && npm run dev                  # :3000 (proxies /api → :4000)
```

Or `docker compose up --build` from the parent folder.

## Demo credentials

Staff (4-digit code IS the login): `1111` reception · `2222` barber · `9999` owner.
Client: `demo / demo1234`.

## Screens

| Route | What it is |
|---|---|
| `/` | Landing — interactive 3D grooming tools (scissors snip on click), scroll-choreographed like presentation slides |
| `/login` | Client sign-in — user ID + password (real API auth) |
| `/team` | Hidden staff keypad — 4-digit code only, server-verified with rate limits + lockout |
| `/book` | Booking wizard — persists to the API when signed in |
| `/store` | Storefront — live product catalog, category filter, add to cart, in-card quantity stepper |
| ↳ Cart drawer | Change quantity, remove a line, clear cart, apply a discount code, place the order |
| `/orders` | Client order history — items, coupon, VAT, status (placed → paid → ready) |
| `/card` | Client loyalty card — tier, points, QR for POS scanning, Add to Apple Wallet |
| `/console` | Staff workspace — the sidebar adapts to your role (server enforces it too): |
| ↳ Calendar | Live bookings, status pipeline, cancel-with-reason, loyalty chip, checkout with coupon + invoice PDF (all staff) |
| ↳ Inventory | Branch stock, low-stock flags, receive shipments, movement log; product CRUD + adjustments for the owner |
| ↳ Reports | Owner only — revenue/tips/VAT KPIs, revenue-by-day chart, payment & branch splits, top services |
| ↳ Coupons | Owner only — create/deactivate discount codes, usage tracking |
| ↳ Orders | Owner only — online orders, placed → paid → fulfilled, store revenue |

## Stack

Next.js 16 · TypeScript · Tailwind 4 · React-Three-Fiber. UI only — every
data decision and permission check lives in dastaan-api (see its README for
the full security model).
