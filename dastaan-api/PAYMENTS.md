# Payments

How Dastaan takes a card payment: the end-to-end flow, the database, error
handling, logging, the integrity checks, and how to exercise it locally with
the Stripe CLI. Code lives in four files:

| File | Owns |
|---|---|
| `src/routes/payments.ts` | The four routes, and every database query they need |
| `src/stripe.ts` | The only module that ever touches a Stripe credential |
| `src/payment-errors.ts` | The typed error classes every failure is one of |
| `src/payment-integrity.ts` | Status-transition guards, amount checks, structured logging, reconciliation |

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
| `POST /payments/refund` | admin, super_admin | Refund a paid booking or invoice |
| `POST /payments/webhook` | none — Stripe signature is the proof | Stripe's async confirmation of intents, failures and refunds |

Every error response from `/intent`, `/refund` and `/webhook` has the same
shape: `{ error: "<safe message>", code: "<machine code>", requestId: "<Fastify request id>" }`.
`code` is a `PaymentDomainError` subclass's own code (e.g. `card_declined`,
`ownership_error`) — see "Error handling" below. Quote `requestId` back when
asking about a specific failure; it's what ties a client-visible error to
the full server-side log entry for it.

## End-to-end flow

**Paying (`/intent`):**

1. Client or staff calls `POST /payments/intent` with exactly one of
   `orderId`, `bookingId` or `invoiceId`.
2. `resolvePayable()` looks up that record and works out what is owed —
   **the amount is always read from the database**, never taken from the
   request. For a booking, it re-prices every service on it from the
   `services` table.
3. If the caller is a client, `assertOwnership()` checks the record's
   `client_id` matches their own session — otherwise a client could pay
   (and thereby mark paid) an order or booking that isn't theirs by
   guessing an id.
4. `createPaymentIntent()` (in `stripe.ts`) opens a Stripe Payment Intent
   for that amount, tagged with metadata linking it back to the
   order/booking/invoice and to a new row we generate for it.
5. `persistPaymentOrCompensate()` inserts that row into `payments` with
   `status = 'pending'`, and (for a booking) remembers the intent id on the
   booking. **If this write fails, the Stripe intent is cancelled
   immediately** rather than left dangling — see "Payment integrity" below.
6. The client gets back a `clientSecret` and confirms the card with Stripe
   directly (Stripe Elements / Payment Element) — the card number itself
   never reaches this server.

**Confirmation (`/webhook`):** Stripe calls back once the card is actually
charged — see "Webhooks" below. **A payment is never marked `paid` at step
5 or anywhere else optimistically — only a verified `payment_intent.succeeded`
webhook does that.**

**Refunding (`/refund`):** Staff calls `POST /payments/refund` with a
`bookingId` or `invoiceId`. `processRefund()` finds the paid payment, locks
it into `processing` (so a second click can't race a second refund), calls
Stripe to refund it, and marks the local row `refunded` immediately (if the
Stripe call fails, the lock is released back to `paid`). The webhook's
`charge.refunded` handler is the source-of-truth confirmation, and is where
partial/final refund amounts are actually recorded.

## Database

Three tables, created in `migrate()` in `src/db.ts`.

**`payments`** — the ledger. One row per Payment Intent, `kind` is exactly
one of `order` / `booking` / `invoice` (enforced by a `CHECK`). `status`
moves `pending → processing → paid → refunded`, or `pending`/`processing →
failed`/`cancelled` — the full graph of what's legal lives in
`VALID_STATUS_TRANSITIONS` in `payment-integrity.ts` and is enforced by
`assertValidTransition()` on every write, not just documented here.
`processing` is used two ways — Stripe settling the initial charge
asynchronously, and the lock `/refund` holds while its own Stripe call is in
flight — see the comment on `VALID_STATUS_TRANSITIONS`. Nothing is ever
deleted; this is what the salon's accountant would reconcile against their
own Stripe dashboard.

**`webhook_events`** — the idempotency guard. One row per Stripe event id,
inserted with `ON CONFLICT (id) DO NOTHING` before an event is processed —
see "Idempotency" below.

**`payment_reconciliation_needed`** — the compensation trail. Written any
time Stripe has confirmed money moved but this database could not be made
to agree with it — see "Payment integrity" below. `resolved_at` /
`resolved_by` / `resolution_note` stay empty until a human closes the row
out; nothing in this codebase does that automatically.

Plus columns folded onto existing tables:

- `bookings.payment_status` (`unpaid` / `prepaid`), `bookings.prepaid_amount`,
  `bookings.payment_intent_id`
- `invoices.settled`, `invoices.settled_at`

## Error handling

Every failure in the payments code is one of the typed classes in
`payment-errors.ts` — `ValidationError`, `OwnershipError`, `NotFoundError`,
`ConflictError`, `PaymentsDisabledError`, `CardDeclinedError`,
`StripeUnavailableError`, `StripeConfigurationError`, `PaymentError`,
`WebhookNotConfiguredError`, `InvalidWebhookSignatureError`,
`IntegrityViolationError` — never a bare `Error`, and never a raw Stripe SDK
or database error passed through. Each carries a stable `code`, the HTTP
`status` to answer with, and a `clientMessage` that's safe to send as-is;
`message` and `details` (e.g. a Stripe error's type/code/decline_code) are
for server-side logs only.

- **`/intent` and `/refund`** each wrap their whole handler body in
  `try/catch`. Whatever they catch goes to `sendPaymentError()`: a known
  `PaymentDomainError` is logged (structured event + technical detail — see
  "Logging") and answered with its own status/code/message; anything else
  is **rethrown**, deliberately, so it reaches `index.ts`'s centralised
  `setErrorHandler` rather than have this function guess at a safe response
  for an error shape it doesn't recognise.
- **`/webhook`** has its own bespoke handling instead of `sendPaymentError`,
  because it needs different HTTP semantics per failure: a bad signature is
  `400` before anything is touched; an `IntegrityViolationError` (an amount
  mismatch, say) is `400` with the idempotency marker *kept* (retrying
  can't fix a persistent mismatch); anything else is `500` with the marker
  *removed* so Stripe retries — see "Webhooks" below.
- **`index.ts`'s centralised `setErrorHandler`** is the backstop: it logs
  the full error (with a stack trace, the route, and `request.id`) and
  answers with `{ error: "Something went wrong", requestId }` — never a
  stack trace, SQL error, or Stripe error in the body. It also recognises
  `PaymentDomainError` directly (in case one is ever thrown somewhere that
  forgot to catch it) and answers with that error's own status/code, same
  as `sendPaymentError` would. Other routes in the app that throw a curated
  `Object.assign(new Error(...), { statusCode })` (e.g. `invoices.ts`) keep
  working exactly as before — this file didn't touch that pattern's
  behaviour outside the payments routes.
- **Stripe SDK errors are mapped, never passed through.** `mapStripeError()`
  in `stripe.ts` is the *only* place `Stripe.errors.*` is inspected:
  `StripeCardError` → `CardDeclinedError` (`402`); `StripeAuthenticationError`
  / `StripePermissionError` → `StripeConfigurationError` (`500`, always logs
  a critical alert — see "Logging" — because it means our credentials are
  broken and nothing will succeed until a human fixes it);
  `StripeConnectionError` / `StripeAPIError` / `StripeRateLimitError` →
  `StripeUnavailableError` (`503`); anything else (`StripeInvalidRequestError`,
  `StripeIdempotencyError`, …) → `PaymentError` (`502`), almost always our
  own bug in the request shape.

## Logging

Every payment lifecycle event goes through `logPaymentEvent()`
(`payment-integrity.ts`), which always writes the same shape:
`{ event: "payment_event", timestamp, requestId, userId, action, amount,
currency, stripePaymentIntentId, outcome, errorCode }`. A failed outcome
carries `errorCode` (a `PaymentDomainError`'s `code`) — **never a raw error
message** in this structured entry. Actions: `intent_created`,
`intent_create_failed`, `payment_succeeded`, `payment_failed`,
`refund_created`, `refund_failed`, `refund_confirmed`, `webhook_duplicate`,
`webhook_rejected`.

- **`request.id`** (Fastify's own, built in) is threaded through every log
  entry and every error response as `requestId`.
- **Technical detail** — the actual `code`/`details`/`message` behind a
  failure — is logged separately from the structured event, at `warn` for
  an ordinary 4xx condition (declined card, already-paid order) and `error`
  for a 5xx one (Stripe unreachable, our credentials broken), so routine
  "the customer's card was declined" traffic doesn't drown out genuine
  infrastructure failures in an alerting dashboard.
- **Stripe API errors are logged with their structured fields** — type,
  code, decline_code, charge, Stripe's own request id — via
  `extractStripeErrorDetails()` in `stripe.ts`, attached as a
  `PaymentDomainError`'s `.details`. Never Stripe's freeform message text,
  and never sent to a client — see "Error handling".
- **A duplicate webhook event logs a `warn`**, not `info` — see
  `recordWebhookEventIfNew()`'s call site in the `/webhook` handler.
- **`logCriticalPaymentAlert()`** is the page-someone-now path: an amount
  mismatch, a refund exceeding the original charge, an invalid status
  transition, a broken Stripe credential, or anything written to
  `payment_reconciliation_needed`. Logged at `error` level (Pino has no
  distinct "critical" level) with `severity: "critical", alert: true` so a
  log-based alerting rule can match on it specifically.
- **Webhook processing failures are never swallowed.** If
  `handleWebhookEvent()` throws anything other than an
  `IntegrityViolationError`, the full error is logged and the idempotency
  marker is removed so **Stripe retries** — the route answers `500`
  deliberately; it does not catch-and-return-`200`.

## Payment integrity

- **Status transitions can't skip a step.** `assertValidTransition()`
  (`payment-integrity.ts`) is the single choke point every status-changing
  write in `routes/payments.ts` goes through: it reads the current status
  and refuses (`IntegrityViolationError`) anything not in
  `VALID_STATUS_TRANSITIONS` — a payment can't go straight from `pending`
  to `refunded`, a `failed` payment can't later become `paid`, nothing can
  regress to `pending`. A state may always "transition" to itself (a
  replayed webhook, a retried request, is a no-op, not a violation).
- **A payment is marked `paid` only after the webhook verifies the
  amount.** `assertAmountMatches()` compares Stripe's reported `amount` on
  `payment_intent.succeeded` against the `payments` row's own `amount`
  (both in fils, so the comparison is exact-integer) *before*
  `markPaymentPaid()` runs — inside the same database transaction as the
  rest of the webhook's writes. A mismatch throws `IntegrityViolationError`,
  logs a critical alert, and the transaction rolls back: nothing is ever
  marked paid on a mismatched amount.
- **A refund can't exceed the original charge.** `assertRefundWithinOriginal()`
  runs the same way inside the `charge.refunded` handler, before
  `recordChargeRefund()` writes anything.
- **A failed database write after Stripe already created an intent cancels
  it.** `persistPaymentOrCompensate()` (in `routes/payments.ts`) catches a
  failed `recordPayment()` write and calls `cancelPaymentIntent()`
  immediately — the client never receives a `clientSecret` for an intent
  this database has no record of. If the cancel *also* fails, that's a
  `payment_reconciliation_needed` row (reason
  `db_write_failed_and_cancel_failed`) plus a critical alert.
- **A failed webhook transaction after Stripe already settled money writes
  a reconciliation record.** If `handlePaymentSucceeded()` or
  `handleChargeRefunded()`'s transaction fails for *any* reason — an
  amount mismatch, a booking row that's vanished, a database blip —
  `recordReconciliationNeeded()` writes a row to
  `payment_reconciliation_needed` (intent id, event id, a reason code, a
  curated detail string, the amount) *before* the original error is
  re-thrown. This never replaces the normal retry behaviour (Stripe still
  retries a `500`); it's a durable trail in case retries also don't
  resolve it, so a settled or refunded payment is never silently
  unaccounted for. `recordReconciliationNeeded()` itself never throws — if
  even *that* write fails, it's logged at critical level rather than
  masking the original error.
- **`integrityCheck(paymentId)`** (`payment-integrity.ts`, exported, not
  wired to a route yet) re-verifies a stored payment against reality:
  recomputes what its source order/booking/invoice currently costs and
  compares it to the stored amount, confirms its status is one this
  codebase recognises, and confirms a `paid` record carries a Stripe intent
  id. Read-only, for ad-hoc use in a REPL/script or a future admin
  endpoint — not run automatically on every request. A booking whose
  service price changed *after* it was paid will legitimately show as a
  mismatch here; that's the tool doing its job, not a bug.
- **Known limitation:** a reconciliation row and a successful later retry
  can both exist for the same failure — nothing here automatically detects
  "oh, this one actually got fixed on retry" and closes the row. Resolving
  a `payment_reconciliation_needed` row is a manual step (`resolved_at` /
  `resolved_by` / `resolution_note` are there for it) that checks current
  payment status first.
- **Rate limiting.** These routes still rely only on the global limit
  registered in `index.ts` (200 req/min/IP). `/intent` and `/refund` move
  real money and might warrant a tighter per-route limit, the way the auth
  routes already do (`config: { rateLimit: { ... } }` in `routes/auth.ts`).
  Not added yet — flagged here and in a comment at the top of
  `routes/payments.ts`.

## Security model (summary)

- **Stripe credentials live only in `src/stripe.ts`.** No other file reads
  `config.payments.stripe.*`, imports the `stripe` package's runtime value,
  or calls the Stripe client directly. `routes/payments.ts` only imports
  types and the higher-level functions (`createPaymentIntent`,
  `cancelPaymentIntent`, `createRefund`, `verifyWebhookSignature`, …).
- **IDOR protection on `/intent`.** `assertOwnership()` rejects a client
  session paying for an order or booking whose `client_id` isn't their
  own, with `403`. Staff (admin/super_admin) may act on any record.
  Invoices currently have no `client_id` of their own (they're reached via
  `booking_id`), so there is no ownership check on the invoice path yet —
  worth closing if invoice payment from the client app ships.
- **`/refund` is staff-only**, enforced by `requireRole` before the route
  handler does anything else — no Stripe call is reachable without it.
- **Webhook signature verification happens before any database access.**
  `verifyWebhookSignature()` (`stripe.ts`) runs first in the `/webhook`
  handler; only on success does the handler even look at `webhook_events`.
- **Idempotency.** See "Logging" and "Payment integrity" above —
  `recordWebhookEventIfNew()` gates everything else in the handler.

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
   check the duplicate-delivery path logs a `warn` and answers `200`
   without re-applying the update.
7. Trigger a decline and a refund directly, without touching the app:

   ```bash
   stripe trigger payment_intent.payment_failed
   stripe trigger charge.refunded
   ```
8. To see the amount-mismatch path (`400`, critical alert, no retry): edit
   a `payments` row's `amount` directly in the database after creating an
   intent but before confirming it, then confirm — the webhook's
   `assertAmountMatches()` should reject it and the row should stay
   `pending`, not `paid`.
