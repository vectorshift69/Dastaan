# Uncommitted changes — review before pushing

Everything below is on disk and **not yet committed**. Grouped into seven commits
in dependency order: each one builds and typechecks on its own, so you can stop
part-way if you want to.

Totals: **22 files changed** (+707 / −88), **8 new files**, **1 new service**.

Both projects typecheck clean (`npx tsc --noEmit` in `dastaan-api` and
`dastaan-web`). The Next.js production build has **not** been run — my sandbox
can't fetch the SWC binary, so please run `npm run build` in `dastaan-web`
before pushing.

---

## Commit 1 — payments service

**New:** `dastaan-payments/` (10 files: `src/config.ts`, `src/db.ts`,
`src/index.ts`, `src/load-env.ts`, `package.json`, `render.yaml`,
`.env.example`, `.gitignore`, two tsconfigs)

A separate deployable that is the only process holding Stripe credentials. The
main API talks to it over a shared service token; the browser never talks to it
at all.

Two rules run through it:

- **The amount is decided from the database, never from the request.** Otherwise
  anyone could pay AED 1 for a AED 300 bill.
- **Webhooks are recorded before they are acted on.** Stripe delivers at least
  once and retries for days, so "did we already handle this?" has to be answered
  from storage, not memory.

Routes: `POST /intent`, `GET /choices`, `POST /refund`, `POST /webhook`.
Booking payment is all-now or all-after — no deposits, no part-payments.

Verified: amount always from the DB; 401 on a bad service token; webhook 400
without or with a forged signature; a replayed event returns `duplicate: true`;
booking → `prepaid`, invoice → `settled`, order → `paid`.

```
feat(payments): standalone Stripe service with idempotent webhooks

The only process that holds Stripe credentials, so PCI scope stays off the
main API. Amounts are always read from the database rather than the request,
and every webhook is recorded before it is acted on, because Stripe delivers
at least once and retries for days.

Booking payment is pay-in-full-now or pay-after-the-visit. No deposits: a
half-paid appointment is a reconciliation problem for the salon and a
confusing screen for the client.

Not wired to the main API yet — PAYMENT_SERVICE_URL still points at nothing.
```

---

## Commit 2 — online shop is its own operation

**New:** `dastaan-api/src/routes/online-inventory.ts` (245 lines)
**Changed:** `db.ts`, `index.ts`, `routes/store.ts`, `routes/inventory.ts`,
`routes/bookings.ts`, `security.ts`, `seed.ts`

The website no longer sells off the branch shelves. New `online_stock` table
with **no branch column** — one warehouse for the whole UAE, because everything
is delivered from it. Branch stock (`stock_levels`) goes back to what it was and
stays in the team console.

- Every online order is **delivered**; collect-from-branch is gone from the
  schema, the routes and the UI. An address is required.
- Stock is **reserved** when an order is placed, released on cancel, consumed on
  ship — so the shop can't oversell.
- New `shop_manager` role: no branch, no chair, no keypad code.

Verified live:

```
Straight Razor Kit          warehouse        Marina Walk shelf
  start                     14 (1 held)              6
  2 ordered online          14 (3 held)              6   ← shelf untouched
  order shipped             12 (1 held)              6
  1 sold at the desk        12 (1 held)              5   ← warehouse untouched
```

Plus: desk sale refused when the shelf is short even though the warehouse is
full; stock held by an order can't be written off; the last item can't be sold
twice.

> **Note on the migration.** An earlier design split branch stock into two
> channels. That's reverted, and the migration folds any leftover rows back into
> the branch row. Harmless on a database that never saw it — which includes
> Supabase, since none of this was ever pushed.

```
feat(shop): online store becomes its own operation

The website sells from one national warehouse and delivers everything. There
is no collect-from-branch: the branches keep their stock for the chair and
the walk-in shelf, and a barber using the last bottle of oil cannot make the
website sell out.

online_stock is deliberately a separate table rather than a column on
stock_levels — different stock, different people, different login. Orders
reserve stock the moment they are placed rather than when someone marks them
shipped, which is what stopped the shop overselling.

Adds the shop_manager role: no branch, no chair, no keypad code.
```

---

## Commit 3 — the shop's back office

**New:** `dastaan-web/src/app/shop/page.tsx` (416 lines)
**Changed:** `console/page.tsx`, `console/InventoryView.tsx`,
`console/OrdersView.tsx`

A separate system at `/shop` with its own id-and-password sign-in, off the team
console entirely. Warehouse stock, receiving, counts, corrections, customer
returns and a movement ledger. The owner can look in; reception and clients get
403.

```
feat(shop): back office at /shop with its own sign-in

Whoever runs the online shop is not on the salon floor, so they get their own
door rather than a keypad code that also opens the till. The console's
inventory screen is now labelled branch stock and no longer pretends to cover
the website.
```

---

## Commit 4 — storefront respects stock

**Changed:** `dastaan-web/src/app/store/page.tsx`,
`components/store/CartDrawer.tsx`, `app/orders/page.tsx`

`/store/products` had been returning `available` and the grid ignored it, so a
sold-out product still showed "Add to cart" and the client only found out at
checkout with a 409. **My omission — I wired the API and left the grid alone.**

Now: sold-out cards dim with a badge and no button, "3 left" when scarce, and
the quantity stepper stops at what can ship. The cart asks for a delivery
address and won't submit without one.

```
fix(store): the shelf now reflects what can actually ship

The storefront was ignoring the availability the API already returned, so a
client could fill a cart with something sold out and only find out at
checkout. Sold-out lines are now unbuyable, scarce ones say so, and the
quantity stepper stops at what the warehouse holds.

The cart collects a delivery address, since every order is delivered.
```

---

## Commit 5 — password resets

**New:** `dastaan-api/src/password-reset.ts` (116 lines),
`dastaan-web/src/app/forgot/page.tsx`, `dastaan-web/src/app/reset/page.tsx`
**Changed:** `routes/auth.ts`, `notify/provider.ts`, `notify/service.ts`,
`db.ts`, `app/login/page.tsx`

The "Forgot password?" link on the sign-in page pointed at `#` — **another dead
link, same class of bug as the Google button was.** It now works.

- Only the **SHA-256 of the token** is stored, so a leak of the table is useless.
- **Single use** and expires in an hour; asking for a new link kills the old ones.
- The confirmation is **identical whether or not the account exists** — otherwise
  the form becomes a way to find out who has an account at a men's salon.
- Email rides the existing outbox with the same retries as SMS. The dev provider
  prints the link; real sending needs `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`
  and `EMAIL_FROM`.

Verified: expired link rejected, reused link rejected, new password works, old
password dead, and the three forgot-password answers byte-identical.

```
feat(auth): password reset by emailed link

The forgot-password link on the sign-in page pointed at "#" and had never
been built. Tokens are stored only as a hash, work once, and expire in an
hour.

Asking for a reset answers the same whether or not the account exists — any
difference turns the form into a way of finding out who is a client here.

Email reuses the notification outbox, so nothing user-facing blocks on a mail
API and a crash cannot lose the message.
```

---

## Commit 6 — Team tab

**New:** `dastaan-web/src/components/console/TeamView.tsx` (543 lines),
`dastaan-api/src/routes/users.ts` (255 lines)
**Changed:** `console/page.tsx`, `routes/auth.ts`, `index.ts`

There was **no screen for managing users at all** — three API endpoints existed
but nothing called them, so staff codes only existed because the seed wrote them.

Three kinds of account, three ways of handing over a credential:

| | credential | who sets it |
|---|---|---|
| Staff | 4-digit keypad code | owner types it, tells them in person |
| Shop manager | id + password | owner creates once, then it's theirs |
| Clients | password | never staff — a reset link goes to their inbox |

Nothing can read an existing credential back; codes are an HMAC and passwords a
hash, so the only actions are replace and switch off. Deactivating never
deletes — invoices and bookings point at these rows.

Verified: new code works and kills the old one; duplicate codes refused;
reception gets 403 on everything except adding a barber to their own branch; a
manager changes their own password and the owner can't read it; a client
poking the shop endpoint gets "Not allowed".

```
feat(console): Team tab for staff codes, shop logins and client resets

There was no way to manage users at all — the endpoints existed but nothing
called them, so codes only existed because the seed wrote them.

Codes are typed by the owner and passed on in person: a barber has no email
account here and is standing in the same room. Shop managers get one password
from the owner and own it after that. Client passwords are never set by
staff — a reset link goes to the client's own inbox.

Nothing on the screen can read a credential back, only replace it.
```

---

## Commit 7 — TRN on every invoice

**Changed:** `dastaan-api/src/config.ts`, `invoice-pdf.ts`, `invoices.ts`,
`routes/store.ts`, `dastaan-web/src/lib/config.ts`,
`components/console/AppointmentPanel.tsx`, `app/orders/page.tsx`

From the VAT certificate:

- **DASTAAN LIFE BARBERS L.L.C**
- **TRN 104235451200003**
- Registered 01/06/2024, standard 5% rate

The invoice said "TAX INVOICE" but carried **no TRN and no legal entity name**,
which means it was not a valid UAE tax invoice — the client couldn't reclaim
input VAT from it.

Now printed twice: in the header block and again in the footer, so a folded or
cropped receipt still shows it. The VAT rate comes from one place rather than
being hardcoded in three, and the business block ships with every invoice
response so no screen has to remember it.

Actual output:

```
D A S T A A N
DASTAAN LIFE BARBERS L.L.C
Dastaan — Marina Walk
Marina Walk, Tower 4, Ground Floor · Dubai Marina
+971 4 000 0001
TRN 104235451200003
TAX INVOICE
Invoice no.  INV-2026-00449
Date         24 Aug 2026, 9:55 AM
Billed to    Yousuf Kareem
Payment      Card
  Skin Fade & Beard      268.00
  Argan Repair Serum     120.00
  Subtotal (excl. VAT)   369.52
  VAT 5% (AED)            18.48
  Tip                     20.00
  TOTAL PAID     AED     408.00
DASTAAN LIFE BARBERS L.L.C · TRN 104235451200003 · Zabeel 2, Dubai, UAE
Prices are inclusive of 5% UAE VAT. All amounts in AED.
```

Everything is env-overridable (`BUSINESS_TRN`, `BUSINESS_LEGAL_NAME`,
`BUSINESS_ADDRESS`, `BUSINESS_PHONE`, `VAT_RATE`) so a correction never needs a
code change.

```
feat(invoices): print the TRN and legal entity, as UAE law requires

The invoice called itself a TAX INVOICE but carried neither the supplier's
Tax Registration Number nor the registered legal name, which means it was not
a valid one — a client could not have reclaimed input VAT from it.

TRN 104235451200003, DASTAAN LIFE BARBERS L.L.C, from the VAT certificate.
Printed in the header and repeated in the footer so a cropped receipt still
carries it, and sent with every invoice response so the console and the
client's own order history show it too.

The VAT rate now comes from config rather than being hardcoded in three
files.
```

---

## Before you push

**Safe to commit.** No `.env` is tracked; `dastaan-api/.env` exists on disk and
is ignored. The only `sk_test_…` strings in the repo are placeholders in
`.env.example` and a comment in `render.yaml`.

**Run first:** `cd dastaan-web && npm run build` — I could not run it here.

**Re-seed after pulling.** The seed changed in three ways that matter:

1. Demo clients now have emails (`<userid>@dastaan.test`, a reserved domain that
   can't reach a real inbox). Without this a password reset can't be demoed at
   all — they had no email on file.
2. The online warehouse is seeded separately from branch stock.
3. A shop manager account exists: **`shop` / `shop1234`**.

**Render environment variables to add** when you're ready:

| Variable | For |
|---|---|
| `APP_URL` | the base for reset links — currently defaults to localhost |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | real reset emails |
| `PAYMENT_SERVICE_URL`, `PAYMENT_SERVICE_TOKEN` | when payments go live |
| `BUSINESS_TRN` etc. | only if the certificate details ever change |

**Still to rotate before go-live** (all have appeared in chat): the Google client
secret, the Supabase database password, and `CODE_PEPPER` — changing that last
one invalidates every staff code, so re-seed after.

**`shop1234` is a demo password** and should be changed on first sign-in.

## Not done yet

- The booking wizard's pay-now / pay-after step, and the API boundary
  (`routes/payments.ts`) is still pointing at nothing.
- Console checkout doesn't show "paid online" or leave a bill open.
- No "outstanding bills" view in the client's account.
- GPS attendance — parked as day 2, as agreed.
