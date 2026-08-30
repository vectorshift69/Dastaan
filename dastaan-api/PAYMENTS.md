# Payments

How Dastaan takes a card payment: the end-to-end flow, the two tables it
owns, the security model, and how to exercise it locally with the Stripe
CLI. Code lives in `src/routes/payments.ts` (the routes) and `src/stripe.ts`
(the only module that ever touches a Stripe credential).

This used to be a separate service (`dastaan-payments`) so Stripe keys and
PCI scope never sat inside the main API. It has since been folded into
`dastaan-api` so there is only one service to deploy; the isolation that
mattered — one module holding the credentials, amounts always priced
server-side — is preserved in code rather than by a network boundary.

## Master switch

Nothing here does anything unless `PAYMENTS_ENABLED=1`. With it unset or
`0`, `/payments/intent` and `/payments/refund` answer `503` and the rest of
the platform runs on cash / the desk's existing card machine — see
`paymentsEnabled()` in `src/config.ts`.

## Routes

All mounted under `/payments` (`src/index.ts` registers `paymentRoutes` with
`{ prefix: "/payments" }`):

| Route | Auth | Purpose |
|---|---|---|
| `POST /payments/intent` | client, admin, super_admin | Start paying for a store order, a booking, or an unsettled invoice |
| `GET /payments/choices` | none | Whether pay-now / pay-later are on, and the refund window, for the booking page |
| `POST /payments/refund` | admin, super_admin | Refund a succeeded booking or invoice payment |
| `POST /payments/webhook` | none — Stripe signature is the proof | Stripe's async confirmation of intents, failures and refunds |

## End-to-end flow

**Paying (`/intent`):**

1. Client or staff calls `POST /payments/intent` with exactly one of
   `orderId`, `bookingId` or `invoiceId`.
2. `resolvePayable()` looks up that record and works out what is owed —
   **the amount is always read from the database**, never taken from the
   request. For a booking, it re-prices every service on it from the
   `services` table.
3. If the caller is a client, `ownsResource()` checks the record's
   `client_id` matches their own session — otherwise a client could pay
   (and thereby mark paid) an order or booking that isn't theirs by
   guessing an id.
4. `createStripeIntent()` opens a Stripe Payment Intent for that amount,
   tagged with metadata linking it back to the order/booking/invoice and to
   a new row we generate for it.
5. `recordPayment()` inserts that row into `payments` with
   `status = 'requires_payment'`, and (for a booking) remembers the intent
   id on the booking so the desk can see a payment is in flight.
6. The client gets back a `clientSecret` and confirms the card with Stripe
   directly (Stripe Elements / Payment Element) — the card number itself
   never reaches this server.

**Confirmation (`/webhook`):** Stripe calls back once the card is actually
charged. See "Webhooks" below.

**Refunding (`/refund`):** Staff calls `POST /payments/refund` with a
`bookingId` or `invoiceId`. `processRefund()` finds the succeeded payment,
calls Stripe to refund it, and immediately marks the local row refunded (a
second click before Stripe's webhook arrives must not start a second
refund). The webhook's `charge.refunded` handler is the source of truth for
partial/final refund amounts.

## Database

Two tables, created in `migrate()` in `src/db.ts`.

**`payments`** — the ledger. One row per Payment Intent, `kind` is exactly
one of `order` / `booking` / `invoice` (enforced by a `CHECK`), status moves
`requires_payment → succeeded | failed`, then optionally `→ refunded`.
Nothing is ever deleted; this is what the salon's accountant would
reconcile against their own Stripe dashboard.

**`webhook_events`** — the idempotency guard. One row per Stripe event id,
inserted with `ON CONFLICT (id) DO NOTHING` before an event is processed —
see "Idempotency" below.

Plus columns folded onto existing tables:

- `bookings.payment_status` (`unpaid` / `prepaid`), `bookings.prepaid_amount`,
  `bookings.payment_intent_id`
- `invoices.settled`, `invoices.settled_at`

## Security model

- **Stripe credentials live only in `src/stripe.ts`.** No other file in
  this codebase imports the `stripe` package for its runtime value, or
  reads `config.payments.stripe.*`. `routes/payments.ts` only imports
  types and the higher-level functions (`createPaymentIntent`,
  `createRefund`, `verifyWebhookSignature`, …) — it never touches a Stripe
  client or a key directly.
- **Amount integrity.** Every amount charged comes from `resolvePayable()`,
  which reads the order total / booking service prices / invoice total from
  the database. The request body only ever supplies an id.
- **IDOR protection on `/intent`.** `ownsResource()` rejects a client
  session paying for an order or booking whose `client_id` isn't their own,
  with `403`. Staff (admin/super_admin) may act on any record. Invoices
  currently have no `client_id` of their own (they're reached via
  `booking_id`), so there is no ownership check on the invoice path yet —
  worth closing if invoice payment from the client app ships.
- **`/refund` is staff-only**, enforced by `requireRole` before the route
  handler does anything else — no Stripe call is reachable without it.
- **Webhook signature verification happens before any database access.**
  `verifyStripeWebhook()` runs first in the `/webhook` handler; only on
  success does the handler even look at `webhook_events`. An invalid
  signature never reaches the database.
- **Idempotency.** `recordWebhookEventIfNew()` does the
  `INSERT ... ON CONFLICT (id) DO NOTHING` and checks whether a row was
  actually inserted *before* `handleWebhookEvent()` runs. Stripe retries a
  webhook for days if it doesn't get a fast `2xx`; a duplicate delivery is
  acknowledged (`200`) without being reprocessed.
- **Transactional webhook writes.** Each event handler
  (`handlePaymentSucceeded`, `handlePaymentFailed`, `handleChargeRefunded`)
  wraps its writes in `db.transaction()`, so a failure partway through
  can't leave the payment row updated but the booking/order/invoice not
  (or vice versa). If a handler throws, `forgetWebhookEvent()` removes the
  idempotency marker so Stripe's retry is processed rather than silently
  dropped as a duplicate.
- **Sanitised errors.** Route handlers never forward a raw Stripe or
  database error to the client — `createStripeIntent()` and
  `processRefund()` log the real error via `req.log.error` and return one
  of the generic `GENERIC_*` messages defined at the top of
  `routes/payments.ts`. The only thing ever logged from a rejected webhook
  is that it was rejected — not the payload or the signature header.
- **Rate limiting.** These routes currently rely only on the global limit
  registered in `index.ts` (200 req/min/IP). `/intent` and `/refund` move
  real money and might warrant a tighter per-route limit, the way the auth
  routes already do (`config: { rateLimit: { ... } }` in
  `routes/auth.ts`). Not added yet — flagged here and in a comment at the
  top of `routes/payments.ts`.

## Environment variables

Set in `dastaan-api/.env` (see `.env.example`):

```bash
PAYMENTS_ENABLED=0            # 1 = Stripe is live; 0 = every card route answers 503
PAYMENT_MODES=online,terminal # which capture paths PAYMENTS_ENABLED turns on

STRIPE_SECRET_KEY=sk_test_... # the salon's own key — use sk_test_ until go-live
STRIPE_WEBHOOK_SECRET=whsec_... # from Stripe -> Developers -> Webhooks

PAY_NOW_ENABLED=1   # pay the whole appointment at booking time
PAY_LATER_ENABLED=1 # settle after the visit — set 0 to insist on prepayment
REFUND_HOURS=24     # a prepaid booking cancelled this far ahead refunds in full
```

`STRIPE_SECRET_KEY` is read lazily, the first time a route actually needs a
Stripe client (`stripeAccount()` in `src/stripe.ts`) — the server boots fine
with it unset as long as `PAYMENTS_ENABLED=0`, which is the default. Only
once payments are switched on does a missing key become an error, and only
when a payment route is actually called.

## Testing locally with the Stripe CLI

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and
   `stripe login`.
2. Set `STRIPE_SECRET_KEY` in `dastaan-api/.env` to a **test** key
   (`sk_test_...`) from the Stripe dashboard, and `PAYMENTS_ENABLED=1`.
3. Forward webhooks to your local server:

   ```bash
   stripe listen --forward-to localhost:4000/payments/webhook
   ```

   This prints a `whsec_...` value — put that in `STRIPE_WEBHOOK_SECRET`
   and restart the API.
4. Create an intent the same way the app would, e.g. against a seeded
   order id (sign in first to get a session cookie):

   ```bash
   curl -c cookies.txt -X POST localhost:4000/auth/client/login \
     -H "content-type: application/json" \
     -d '{"userId":"demo","password":"demo1234"}'

   curl -b cookies.txt -X POST localhost:4000/payments/intent \
     -H "content-type: application/json" \
     -d '{"orderId":"<a placed order id>"}'
   ```
5. Confirm the payment from the CLI without a browser, using the returned
   `clientSecret`'s intent id:

   ```bash
   stripe payment_intents confirm pi_xxx --payment-method=pm_card_visa
   ```
6. Watch the API logs — `stripe listen` delivers `payment_intent.succeeded`
   to `/payments/webhook`, and the order/booking/invoice should flip to
   paid. Re-run the same `confirm` command (or `stripe events resend`) to
   check the duplicate-delivery path answers `200` without re-applying the
   update.
7. Trigger a decline and a refund directly, without touching the app:

   ```bash
   stripe trigger payment_intent.payment_failed
   stripe trigger charge.refunded
   ```
