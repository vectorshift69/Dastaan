# Changelog

Newest first. Each entry says what changed, why, and what was actually proven
rather than merely written.

---

## 2026-08-24 — security fix: the shop manager could read the appointment book

Found by clicking through the live site, which is exactly why it was worth
doing. Signed in as the newly created shop manager, `/console` rendered the
salon's calendar — and `GET /bookings` returned the whole day: client names,
phone numbers, loyalty tiers and balances.

**Cause.** Five routes were written as `requireAuth` followed by a chain that
denied specific roles:

```ts
const s = await requireAuth(req, reply);
if (s.role === "client")  { ...own records... }
if (s.role === "barber")  { ...own bookings... }
// everything else falls through here — assumed to be admin or super
```

A deny-list is only correct until somebody adds a role. `shop_manager` fell
into that last branch and was treated as salon management. My own bug, from
adding the role without auditing what `requireAuth` then let through.

**Fix.** All five now name who may enter, so a future role is refused by
default:

| Route | Now allows |
|---|---|
| `GET /bookings` | client, barber, admin, super_admin |
| `POST /bookings` | client, admin, super_admin |
| `GET /bookings/:id/invoice` (+PDF) | client, barber, admin, super_admin |
| `POST /coupons/validate` | client, admin, super_admin |
| `POST /payments/intent` | client, admin, super_admin |

Verified against a live server — the shop manager is now refused everywhere in
the salon, keeps their own warehouse, and nothing else moved:

```
appointment book   shop manager 403 · owner 200 · reception 200 · barber 200 · client 200
POST /bookings 403   invoice 403   coupons/validate 403   /clients 403
/reports/sales 403   /inventory 403   /users 403   /audit 403
/online/inventory 200            ← their actual job

barber coupons/validate 403 (unchanged)   barber bookings 200   client bookings 200
```

The console also refused to draw itself: a role with no visible tabs used to
get an empty sidebar over a working calendar — barber columns, "+ New booking",
the branch picker. It now shows a "wrong door" page pointing at `/shop`.

Two copy bugs fixed at the same time: the storefront footer still said
"Collect in branch or ask the desk about delivery" after collection was
removed, and the shop screen said "1 lines on sale".

---

## 2026-08-24 — `b9e959f` Invoices and warehouse changes

Seven pieces of work: a payments service, the online shop split off from the
salon, delivery-only ordering, user administration, password resets, and the
TRN on invoices.

### The online shop became its own operation

Branch stock and the website's stock are now different tables, different
screens and different people.

`online_stock` has **no branch column** — one warehouse for the whole UAE,
because everything sold online is delivered from it. Branch stock
(`stock_levels`) stays exactly what it was: the retail shelf and back bar,
managed by the salon team.

| | Branch stock | Online shop |
|---|---|---|
| Managed in | Team console → Inventory | `/shop`, by the shop manager |
| Sold by | The desk, at checkout | The website, delivered |
| Reservations | None — a desk sale is instant | Held from order until shipped |

A barber using the last bottle of oil at Marina Walk can no longer make the
website sell out, and a busy week online cannot leave the chair short. Proven
on a live server:

```
Straight Razor Kit          warehouse        Marina Walk shelf
  start                     14 (1 held)              6
  2 ordered online          14 (3 held)              6   ← shelf untouched
  order shipped             12 (1 held)              6
  1 sold at the desk        12 (1 held)              5   ← warehouse untouched
```

Also verified: a desk sale is refused when the shelf is short even though the
warehouse is full; stock promised to an order cannot be written off; the last
item cannot be sold twice.

**Collect-from-branch is gone** — schema, routes and UI. Every order is
delivered and an address is required. `/store/collection-points` returns 404.

An earlier iteration of this work split branch stock into two *channels*
instead. That was the wrong shape once the shop became a separate operation,
so it was reverted; the migration folds any leftover rows back into the branch
row.

### Stock reservations

An order holds stock the moment it is placed, not days later when someone marks
it shipped. The guard is one statement — `UPDATE ... WHERE qty - reserved >= n`
— so two clients ordering the last item at the same moment cannot both succeed.
Reserve and insert happen in one transaction: no reservation without an order,
no order without a reservation.

### A separate system for the shop, at `/shop`

New `shop_manager` role with its own id-and-password sign-in, off the team
console entirely. Whoever runs the shop is not on the salon floor: no branch,
no chair, and no code that also opens the till. Receiving, stock counts,
corrections, customer returns, reorder levels and a movement ledger.

The owner can look in — they own the stock. Reception and clients get 403.

### Storefront now respects stock

`/store/products` had been returning `available` and the grid ignored it, so a
sold-out product still showed "Add to cart" and the client only found out at
checkout with a 409. **My omission — the API was wired and the grid was left
alone.** Sold-out cards now dim and are unbuyable, scarce lines say "3 left",
and the quantity stepper stops at what can ship.

### Team tab — managing every account

There had been **no screen for user management at all**. Three endpoints
existed but nothing called them, so staff codes only existed because the seed
wrote them.

| Account | Credential | Who sets it |
|---|---|---|
| Staff | 4-digit keypad code | Owner types it, hands it over in person |
| Shop manager | id + password | Owner creates once, then it is theirs |
| Clients | password | Never staff — a reset link goes to their inbox |

Nothing on the screen can read a credential back; codes are an HMAC and
passwords a hash, so the only actions are replace and switch off. Deactivating
never deletes — invoices and bookings reference those rows.

Verified: a new code works and kills the old one while leaving others alone;
duplicate codes refused; reception gets 403 on everything except adding a
barber to their own branch; a manager changes their own password and the owner
cannot read it; a client poking the shop endpoint gets "Not allowed".

### Password resets

The *Forgot password?* link on the sign-in page pointed at `#` and had never
been built — **the same class of bug as the dead Google button.** Now real,
at `/forgot` and `/reset`.

- Only the **SHA-256 of the token** is stored, so a leak of the table is useless.
- **Single use** — the token is spent before the password changes, so two
  racing requests cannot both win — and it expires in an hour.
- The answer is **identical** for a real address, an address nobody has, and a
  malformed one. Anything else turns the form into a way of finding out who has
  an account at a men's salon.

Email reuses the notification outbox, so nothing user-facing blocks on a mail
API and a crash cannot lose the message. The dev provider prints the link;
real delivery needs `EMAIL_PROVIDER=resend`.

### TRN on every invoice

The invoice said **TAX INVOICE** but carried neither the supplier's Tax
Registration Number nor the registered legal name — which means it was not a
valid UAE tax invoice, and a client could not have reclaimed input VAT from it.

From the VAT certificate: **DASTAAN LIFE BARBERS L.L.C**, **TRN
104235451200003**, registered 01/06/2024, standard 5% rate.

```
DASTAAN LIFE BARBERS L.L.C
Dastaan — Marina Walk
TRN 104235451200003
TAX INVOICE
Invoice no.  INV-2026-00449
  Skin Fade & Beard      268.00
  Subtotal (excl. VAT)   369.52
  VAT 5% (AED)            18.48
  TOTAL PAID     AED     408.00
DASTAAN LIFE BARBERS L.L.C · TRN 104235451200003 · Zabeel 2, Dubai, UAE
```

Printed in the header and repeated in the footer, so a folded or cropped
receipt still carries it. The business block ships with every invoice response,
so the desk screen and the client's order history show it too. The VAT rate now
comes from config instead of being hardcoded in three files.

### Payments service

`dastaan-payments` — a separate deployable that is the only process holding
Stripe credentials. Two rules run through it: **the amount is decided from the
database, never from the request**, and **webhooks are recorded before they are
acted on**, because Stripe delivers at least once and retries for days.

Booking payment is all-now or all-after. No deposits: a half-paid appointment
is a reconciliation problem for the salon and a confusing screen for the
client.

Verified: amount always from the DB; 401 on a bad service token; webhook 400
without or with a forged signature; a replayed event returns `duplicate: true`.

**Not yet wired.** `PAYMENT_SERVICE_URL` in the main API still points at
nothing, and the booking wizard has no pay-now step.

### Migration safety

The riskiest part of this release was the migration running against a database
that already has data. Tested by rebuilding the **previous committed schema**
with 448 invoices and six weeks of history, then booting the new code on top:

```
migrated and started
branch stock rows: 9 (one per product, not doubled)
staff accounts intact: 12
online_stock rows: 6, all at zero
an invoice written BEFORE these changes: TRN present ✓
second boot fine — migration is idempotent
```

### Seed changes

- Demo clients now have emails (`<userid>@dastaan.test`, a reserved domain that
  cannot reach a real inbox). Without one, a password reset cannot be demoed at
  all — they previously had no email on file.
- The online warehouse is seeded separately from branch stock, with one line
  left low so the reorder warning has something to show.
- A shop manager exists: `shop` / `shop1234` — **a demo password.**

### Known gaps at the time of this release

- The new UI screens — Team, `/shop`, `/forgot`, `/reset`, storefront stock
  states — are typechecked and building but have **not been clicked through**.
  Compiling is not working.
- Payments boundary unwired; no pay-now step in the booking wizard; no
  "outstanding bills" view in the client's account.
- Email delivery unconfigured, so reset links only reach the server log.
- GPS attendance — day-2 requirement, not started.

---

## 2026-08-19 — `d7f3a40` Sign in with Google

Client-only Google sign-in over the authorization-code flow with state, PKCE
and a nonce. The button existed before this with no `onClick` and no route
behind it. Registration takes email and phone; email is what links a password
account to the same person arriving later through Google, instead of creating a
second account with its own loyalty balance.

---

## 2026-08-18 — `51fa565` Remove invented barber ranks

The console showed Master/Senior barber ranks that appear nowhere in the
requirements — invented, and wrong. Removed. The booking details form was also
using inline `<span>` labels; replaced with a proper field component.

---

## 2026-08-18 — `c60e095` Five console and booking defects

From client review:

- The calendar's red now-line was hardcoded to 2:38 pm. It now reads salon time
  (Asia/Dubai) and ticks every minute.
- Today / ‹ / › had no `onClick` at all; date and month navigation now work,
  with the owner able to see the whole history.
- The detail panel would not open for walk-in clients, who are most of the book.
- Booking failed with "Client name is required" for signed-in users.
- Console tabs a role cannot use are no longer rendered.

---

## 2026-08-17 — `2729ccf` Real slot availability

Booking the same barber into the same slot twice was possible. Three faults,
none of them in the API: the slot grid was hardcoded
(`const taken = [3,7,11,14]`), the page ignored `res.ok` and showed "Booking
confirmed" even on a 409, and no availability endpoint existed. All three
fixed, plus a timezone-safe clash check that stays in salon-local minutes.
