/* ------------------------------------------------------------------ */
/* Payments.                                                            */
/*                                                                     */
/* Folded in from the former dastaan-payments service — previously a    */
/* separate deployable so Stripe keys and PCI scope never sat inside    */
/* the main API. Merged here so there is only one service to run.       */
/* Mounted under /payments — see PAYMENTS.md for the full flow, schema  */
/* and security model. In short:                                       */
/*                                                                     */
/*  1. The amount is decided here, from the database — never taken     */
/*     from the request. Otherwise anyone could pay AED 1 for a         */
/*     AED 300 bill. See resolvePayable().                             */
/*                                                                     */
/*  2. A Stripe webhook signature is verified before this file touches  */
/*     the database at all. See verifyStripeWebhook().                 */
/*                                                                     */
/*  3. Webhooks are recorded before they are acted on. Stripe delivers  */
/*     at least once and retries for days, so "did we already handle    */
/*     this event?" has to be answered from storage, not from memory.   */
/*     See recordWebhookEventIfNew().                                  */
/*                                                                     */
/*  4. Every Stripe credential lives in stripe.ts and nowhere else —    */
/*     this file never imports the `stripe` package for its runtime     */
/*     value, only for types, and never reads config.payments.stripe.  */
/*                                                                     */
/* NOTE — rate limiting: these routes currently rely only on the global */
/* limit registered in index.ts (200 req/min/IP). /intent and /refund   */
/* move real money and might deserve a tighter per-route limit, the way */
/* the auth routes already do (see routes/auth.ts). Not added here —    */
/* flagged for a follow-up.                                            */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, audit } from "../security.js";
import type { Role, Session } from "../security.js";
import { config, paymentsEnabled } from "../config.js";
import {
  createPaymentIntent,
  createRefund,
  verifyWebhookSignature,
  toMajor,
  paymentChoices,
  WebhookNotConfiguredError,
  InvalidWebhookSignatureError,
} from "../stripe.js";
import type { Stripe } from "../stripe.js";

/** Minimal logger shape the helpers below need — matches Fastify's req.log. */
type Logger = {
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
};

/** The three things a client can pay for. */
type PaymentKind = "order" | "booking" | "invoice";

/** A resolved amount is never negative or zero — there is nothing to collect below this. */
const MIN_PAYABLE_AMOUNT = 0;

/** ISO currency code Stripe is asked to charge in, decided once at boot. */
const STRIPE_CURRENCY = config.payments.currency.toLowerCase();

/** Clients pay for their own things; staff may also start one at the desk. */
const INTENT_ROLES: Role[] = ["client", "admin", "super_admin"];

/** Refunds move money back out, so only staff may trigger one. */
const REFUND_ROLES: Role[] = ["admin", "super_admin"];

/* ---- messages sent to clients ----
   Never the underlying Stripe or database error — those are logged
   server-side (with req.log) and nothing about them leaves this process. */
const GENERIC_VALIDATION_ERROR = "Invalid request";
const GENERIC_PAYMENT_ERROR = "Could not process the payment. Please try again.";
const GENERIC_SERVER_ERROR = "Something went wrong";

const intentSchema = z.object({
  orderId: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
  invoiceId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
}).refine(
  (v) => [v.orderId, v.bookingId, v.invoiceId].filter(Boolean).length === 1,
  "Provide exactly one of orderId, bookingId or invoiceId"
);
type IntentInput = z.infer<typeof intentSchema>;

const refundSchema = z.object({
  bookingId: z.string().min(1).optional(),
  invoiceId: z.string().min(1).optional(),
}).refine((v) => !!v.bookingId !== !!v.invoiceId, "Provide one of bookingId or invoiceId");
type RefundInput = z.infer<typeof refundSchema>;

/* ==================================================================== */
/* Route registration — handlers only orchestrate; see the helpers below */
/* for the actual work.                                                  */
/* ==================================================================== */

export default async function paymentRoutes(app: FastifyInstance) {
  app.post("/intent", async (req, reply) => {
    const session = await requireRole(req, reply, INTENT_ROLES);
    if (!session) return;
    if (!paymentsEnabled(reply, "online")) return;

    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: GENERIC_VALIDATION_ERROR });

    const payable = await resolvePayable(parsed.data, session);
    if (!payable.ok) return reply.code(payable.status).send({ error: payable.error });

    const paymentId = uid();
    const intent = await createStripeIntent(payable, parsed.data, paymentId, req.log);
    if (!intent) return reply.code(502).send({ error: GENERIC_PAYMENT_ERROR });

    await recordPayment(paymentId, intent.id, payable, parsed.data, session);

    await audit("payment_intent_created", {
      actorId: session.sub,
      actorRole: session.role,
      detail: describePayable(payable.kind, parsed.data),
      ip: req.ip,
    });

    return { amount: payable.amount, currency: STRIPE_CURRENCY, clientSecret: intent.client_secret };
  });

  app.get("/choices", async () => paymentChoices());

  app.post("/refund", async (req, reply) => {
    const session = await requireRole(req, reply, REFUND_ROLES);
    if (!session) return;
    if (!paymentsEnabled(reply, "online")) return;

    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: GENERIC_VALIDATION_ERROR });

    const result = await processRefund(parsed.data, session, req.ip, req.log);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    return { ok: true, refunded: result.refunded };
  });

  /* Unauthenticated — a valid Stripe signature is the proof, checked before
     anything else in this handler runs. */
  app.post("/webhook", async (req, reply) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") return reply.code(400).send({ error: "Missing signature" });

    const verification = verifyStripeWebhook(req.body as Buffer, signature, req.log);
    if (!verification.ok) return reply.code(verification.status).send({ error: verification.error });

    // Only now — signature verified — is the database touched at all.
    const event = verification.event;
    const isNew = await recordWebhookEventIfNew(event);
    if (!isNew) {
      req.log.info({ eventId: event.id }, "duplicate webhook ignored");
      return reply.code(200).send({ received: true });
    }

    try {
      await handleWebhookEvent(event);
    } catch (err) {
      req.log.error({ err, eventId: event.id }, "webhook handling failed");
      // Let Stripe retry: remove the marker so the retry is not treated as a
      // duplicate of a delivery we never actually finished.
      await forgetWebhookEvent(event.id);
      return reply.code(500).send({ error: GENERIC_SERVER_ERROR });
    }

    return { received: true };
  });
}

/* ==================================================================== */
/* /intent — resolving what is owed, and creating the Stripe intent.     */
/* ==================================================================== */

/** A payable amount successfully worked out from our own records. */
type PayableResolved = { ok: true; amount: number; kind: PaymentKind; description: string };
/** Why a payable could not be resolved, as an HTTP status + client-safe message. */
type PayableRejected = { ok: false; status: number; error: string };
type PayableResolution = PayableResolved | PayableRejected;

/**
 * Works out what is actually owed for an intent request, entirely from the
 * database — nothing here is taken from the request body but the id of the
 * thing being paid for. This is the amount-integrity boundary: whatever this
 * function returns is what Stripe is asked to charge.
 * @param input the parsed /intent request body
 * @param session the authenticated caller, for ownership checks
 * @returns the resolved amount/kind/description, or a rejection to send back
 */
async function resolvePayable(input: IntentInput, session: Session): Promise<PayableResolution> {
  if (input.orderId) return resolveOrderPayable(input.orderId, session);
  if (input.bookingId) return resolveBookingPayable(input.bookingId, session);
  return resolveInvoicePayable(input.invoiceId!);
}

/**
 * Resolves a store order into a payable amount, checking that a client
 * caller owns the order (IDOR protection — order ids are guessable).
 * @param orderId the order to price
 * @param session the authenticated caller
 * @returns the payable, or 404/403/409 if it cannot be paid
 */
async function resolveOrderPayable(orderId: string, session: Session): Promise<PayableResolution> {
  const order = await findOrderById(orderId);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (!ownsResource(session, order.client_id)) return { ok: false, status: 403, error: "Not allowed" };
  if (order.status !== "placed")
    return { ok: false, status: 409, error: `That order is already ${order.status}` };
  return { ok: true, amount: Number(order.total), kind: "order", description: "Dastaan store order" };
}

/**
 * Resolves a booking into a payable amount by pricing its services fresh
 * from the database, checking that a client caller owns the booking (IDOR
 * protection), and that pay-now is switched on and the booking is still
 * payable.
 * @param bookingId the booking to price
 * @param session the authenticated caller
 * @returns the payable, or 404/403/409/503 if it cannot be paid
 */
async function resolveBookingPayable(bookingId: string, session: Session): Promise<PayableResolution> {
  if (!config.payments.booking.payNowEnabled)
    return { ok: false, status: 503, error: "Paying at the time of booking is switched off" };

  const booking = await findBookingById(bookingId);
  if (!booking) return { ok: false, status: 404, error: "Booking not found" };
  if (!ownsResource(session, booking.client_id)) return { ok: false, status: 403, error: "Not allowed" };
  if (booking.payment_status === "prepaid")
    return { ok: false, status: 409, error: "That appointment is already paid" };
  if (booking.status === "Cancelled")
    return { ok: false, status: 409, error: "That booking is cancelled" };

  const amount = await priceBookingServices(JSON.parse(booking.service_ids) as string[]);
  if (amount <= MIN_PAYABLE_AMOUNT) return { ok: false, status: 409, error: "Nothing to pay for that booking" };

  return { ok: true, amount, kind: "booking", description: "Dastaan appointment" };
}

/**
 * Resolves an unsettled invoice (a bill the client is settling from the app
 * after their visit) into a payable amount. No ownership check exists yet
 * here because invoices carry no client id of their own — see PAYMENTS.md.
 * @param invoiceId the invoice to price
 * @returns the payable, or 404/409 if it cannot be paid
 */
async function resolveInvoicePayable(invoiceId: string): Promise<PayableResolution> {
  const invoice = await findInvoiceById(invoiceId);
  if (!invoice) return { ok: false, status: 404, error: "Bill not found" };
  if (invoice.settled) return { ok: false, status: 409, error: "That bill is already settled" };
  return {
    ok: true,
    amount: Number(invoice.total),
    kind: "invoice",
    description: `Dastaan ${invoice.invoice_no}`,
  };
}

/**
 * Returns whether `session` may act on a resource owned by `ownerId`. Staff
 * (admin/super_admin) may act on any resource; a client session may only
 * act on their own — the check that closes the IDOR on /intent.
 * @param session the authenticated caller
 * @param ownerId the resource's owning client id, if any
 * @returns true if the caller is allowed to pay for this resource
 */
function ownsResource(session: Session, ownerId: string | null): boolean {
  return session.role !== "client" || ownerId === session.sub;
}

/**
 * Calls Stripe to open a Payment Intent for a resolved payable, catching and
 * logging any Stripe failure rather than letting it reach the client.
 * @param payable the amount/kind/description to charge, from resolvePayable()
 * @param input the original /intent request, for building metadata
 * @param paymentId our own payment row id, tagged onto the Stripe intent
 * @param log request logger to record the real failure reason
 * @returns the created Stripe intent, or null if Stripe could not be reached
 */
async function createStripeIntent(
  payable: PayableResolved,
  input: IntentInput,
  paymentId: string,
  log: Logger
): Promise<Stripe.PaymentIntent | null> {
  try {
    return await createPaymentIntent({
      amountAed: payable.amount,
      currency: STRIPE_CURRENCY,
      description: payable.description,
      // so the salon can trace a charge back to a booking or bill
      metadata: {
        kind: payable.kind,
        orderId: input.orderId ?? "",
        bookingId: input.bookingId ?? "",
        invoiceId: input.invoiceId ?? "",
        paymentId,
      },
      // a double tap, or a retried request, returns the same intent rather
      // than charging the client twice
      idempotencyKey: `${payable.kind}:${input.orderId ?? input.bookingId ?? input.invoiceId}`,
    });
  } catch (err) {
    log.error({ err }, "stripe payment intent creation failed");
    return null;
  }
}

/**
 * Builds the audit-log detail string for a resolved payable.
 * @param kind the payable's kind
 * @param input the original /intent request
 * @returns a "kind:id" string, e.g. "booking:abc123"
 */
function describePayable(kind: PaymentKind, input: IntentInput): string {
  return `${kind}:${input.orderId ?? input.bookingId ?? input.invoiceId}`;
}

/* ==================================================================== */
/* /refund                                                               */
/* ==================================================================== */

type RefundResult = { ok: true; refunded: number } | { ok: false; status: number; error: string };

/**
 * Refunds the succeeded payment behind a booking or invoice: validates it
 * hasn't already been refunded, calls Stripe, then updates our own ledger.
 * The role check for who may call this happens in the route handler, before
 * this function — never inside it — so no Stripe call can be reached
 * without already having proven the caller is staff.
 * @param input the parsed /refund request body
 * @param session the authenticated (already role-checked) caller
 * @param ip the caller's IP, recorded on the audit log entry
 * @param log request logger to record a real Stripe failure reason
 * @returns the refunded amount, or a rejection to send back
 */
async function processRefund(input: RefundInput, session: Session, ip: string, log: Logger): Promise<RefundResult> {
  const payment = input.bookingId
    ? await findPaymentByBooking(input.bookingId)
    : await findPaymentByInvoice(input.invoiceId!);

  if (!payment) return { ok: false, status: 404, error: "No payment found to refund" };
  if (payment.status !== "succeeded") return { ok: false, status: 409, error: "That payment never completed" };
  if (Number(payment.refunded_amount) >= Number(payment.amount))
    return { ok: false, status: 409, error: "That payment has already been refunded" };

  try {
    await createRefund(payment.intent_id);
  } catch (err) {
    log.error({ err }, "stripe refund failed");
    return { ok: false, status: 502, error: GENERIC_PAYMENT_ERROR };
  }

  // The webhook confirms it, but recording it now stops a second press
  // starting another refund.
  await markPaymentRefunded(payment.id);
  if (input.bookingId) await markBookingUnpaid(input.bookingId);

  await audit("payment_refunded", {
    actorId: session.sub,
    actorRole: session.role,
    detail: `${input.bookingId ? "booking" : "invoice"}:${input.bookingId ?? input.invoiceId}`,
    ip,
  });

  return { ok: true, refunded: Number(payment.amount) };
}

/* ==================================================================== */
/* /webhook                                                              */
/* ==================================================================== */

type WebhookVerification = { ok: true; event: Stripe.Event } | { ok: false; status: number; error: string };

/**
 * Verifies a webhook request's signature before any part of it is trusted.
 * This is the security boundary for the whole route: nothing below this
 * function runs — no database read or write — until it returns ok.
 * @param payload the raw request body, exactly as Stripe sent it
 * @param signature the stripe-signature header
 * @param log request logger to record a rejected/misconfigured webhook
 * @returns the verified event, or a rejection to send back
 */
function verifyStripeWebhook(payload: Buffer, signature: string, log: Logger): WebhookVerification {
  try {
    return { ok: true, event: verifyWebhookSignature(payload, signature) };
  } catch (err) {
    if (err instanceof WebhookNotConfiguredError) {
      log.error("STRIPE_WEBHOOK_SECRET not set — refusing webhook");
      return { ok: false, status: 503, error: GENERIC_SERVER_ERROR };
    }
    if (err instanceof InvalidWebhookSignatureError) {
      // Anyone can POST here. Without a valid signature it is not Stripe —
      // log that it was rejected, never the payload or header that failed.
      log.warn("rejected a webhook with an invalid signature");
      return { ok: false, status: 400, error: "Bad signature" };
    }
    log.error({ err }, "unexpected webhook verification failure");
    return { ok: false, status: 400, error: "Bad signature" };
  }
}

/**
 * Dispatches a verified Stripe event to its handler. Every case below wraps
 * its database writes in a single transaction, so a failure partway through
 * (e.g. a booking that no longer exists) cannot leave the ledger updated
 * without the booking updated, or vice versa.
 * @param event the verified Stripe event
 */
async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
    case "payment_intent.payment_failed":
      return handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge);
    default:
      // Everything else is noise for us; acknowledging it stops Stripe
      // retrying events we will never care about.
      return;
  }
}

/**
 * Marks a payment succeeded and settles whatever it paid for (order,
 * booking or invoice), all inside one transaction.
 * @param intent the Stripe PaymentIntent that succeeded
 */
async function handlePaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  await db.transaction(async () => {
    const payment = await findPaymentByIntentId(intent.id);
    if (!payment) return; // not ours

    await markPaymentSucceeded(payment.id);
    if (payment.kind === "order" && payment.order_id) await markOrderPaid(payment.order_id);
    if (payment.kind === "booking" && payment.booking_id)
      await markBookingPrepaid(payment.booking_id, Number(payment.amount));
    if (payment.kind === "invoice" && payment.invoice_id) await markInvoiceSettled(payment.invoice_id);
  });
}

/**
 * Records why a payment failed, so the front desk and the client's own
 * account can show a reason rather than a silent nothing-happened.
 * @param intent the Stripe PaymentIntent that failed
 */
async function handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  await db.transaction(async () => {
    await markPaymentFailed(intent.id, intent.last_payment_error?.message ?? "Payment failed");
  });
}

/**
 * Records a refund confirmed at Stripe's end (as opposed to the one we
 * initiate ourselves in processRefund — this is the async confirmation of
 * either path).
 * @param charge the Stripe Charge that was refunded
 */
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  await db.transaction(async () => {
    await recordChargeRefund(intentId, toMajor(charge.amount_refunded));
  });
}

/* ==================================================================== */
/* Database helpers — every payments-related query lives here, nowhere   */
/* else in this file.                                                    */
/* ==================================================================== */

type OrderRow = { id: string; client_id: string; total: number; status: string };

/**
 * Looks up a store order by id.
 * @param orderId the order id
 * @returns the order, or undefined if it does not exist
 */
async function findOrderById(orderId: string): Promise<OrderRow | undefined> {
  return db.prepare("SELECT id, client_id, total, status FROM orders WHERE id = ?").get<OrderRow>(orderId);
}

type BookingRow = {
  id: string;
  client_id: string | null;
  service_ids: string;
  payment_status: string;
  status: string;
};

/**
 * Looks up a booking by id.
 * @param bookingId the booking id
 * @returns the booking, or undefined if it does not exist
 */
async function findBookingById(bookingId: string): Promise<BookingRow | undefined> {
  return db
    .prepare("SELECT id, client_id, service_ids, payment_status, status FROM bookings WHERE id = ?")
    .get<BookingRow>(bookingId);
}

/**
 * Sums the current price of each service on a booking. Prices are read
 * fresh from the services table — never trusted from the caller.
 * @param serviceIds the booking's service ids
 * @returns the total price in dirhams
 */
async function priceBookingServices(serviceIds: string[]): Promise<number> {
  let total = 0;
  for (const serviceId of serviceIds) {
    const service = await db.prepare("SELECT price FROM services WHERE id = ?").get<{ price: number }>(serviceId);
    total += Number(service?.price ?? 0);
  }
  return total;
}

type InvoiceRow = { id: string; invoice_no: string; total: number; settled: number };

/**
 * Looks up an invoice by id.
 * @param invoiceId the invoice id
 * @returns the invoice, or undefined if it does not exist
 */
async function findInvoiceById(invoiceId: string): Promise<InvoiceRow | undefined> {
  return db
    .prepare("SELECT id, invoice_no, total, settled FROM invoices WHERE id = ?")
    .get<InvoiceRow>(invoiceId);
}

/**
 * Inserts the payment ledger row for a newly created Stripe intent, and for
 * a booking payment, remembers the intent id on the booking itself.
 * @param paymentId our own generated payment row id
 * @param intentId the Stripe PaymentIntent id
 * @param payable the resolved amount/kind this intent is for
 * @param input the original /intent request, for the order/booking/invoice id
 * @param session the authenticated caller, used as the payer when none was given
 */
async function recordPayment(
  paymentId: string,
  intentId: string,
  payable: PayableResolved,
  input: IntentInput,
  session: Session
): Promise<void> {
  await db.prepare(
    `INSERT INTO payments (id, intent_id, kind, order_id, booking_id, invoice_id, client_id,
       amount, currency, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'requires_payment', ?, ?)
     ON CONFLICT (intent_id) DO NOTHING`
  ).run(
    paymentId,
    intentId,
    payable.kind,
    input.orderId ?? null,
    input.bookingId ?? null,
    input.invoiceId ?? null,
    input.clientId ?? session.sub,
    payable.amount,
    STRIPE_CURRENCY,
    now(),
    now()
  );

  if (payable.kind === "booking") {
    await db.prepare("UPDATE bookings SET payment_intent_id = ? WHERE id = ?").run(intentId, input.bookingId);
  }
}

type PaymentRow = { id: string; intent_id: string; amount: number; status: string; refunded_amount: number };

/**
 * Looks up the payment for a booking, if a booking-kind payment exists.
 * @param bookingId the booking id
 * @returns the payment, or undefined if none exists
 */
async function findPaymentByBooking(bookingId: string): Promise<PaymentRow | undefined> {
  return db
    .prepare("SELECT id, intent_id, amount, status, refunded_amount FROM payments WHERE booking_id = ? AND kind = 'booking'")
    .get<PaymentRow>(bookingId);
}

/**
 * Looks up the payment for an invoice, if an invoice-kind payment exists.
 * @param invoiceId the invoice id
 * @returns the payment, or undefined if none exists
 */
async function findPaymentByInvoice(invoiceId: string): Promise<PaymentRow | undefined> {
  return db
    .prepare("SELECT id, intent_id, amount, status, refunded_amount FROM payments WHERE invoice_id = ? AND kind = 'invoice'")
    .get<PaymentRow>(invoiceId);
}

/**
 * Marks a payment fully refunded.
 * @param paymentId the payment row id
 */
async function markPaymentRefunded(paymentId: string): Promise<void> {
  await db
    .prepare("UPDATE payments SET status = 'refunded', refunded_amount = amount, updated_at = ? WHERE id = ?")
    .run(now(), paymentId);
}

/**
 * Reopens a booking as unpaid after its prepayment is refunded.
 * @param bookingId the booking id
 */
async function markBookingUnpaid(bookingId: string): Promise<void> {
  await db.prepare("UPDATE bookings SET payment_status = 'unpaid', prepaid_amount = 0 WHERE id = ?").run(bookingId);
}

type PaymentByIntentRow = {
  id: string;
  kind: string;
  order_id: string | null;
  booking_id: string | null;
  invoice_id: string | null;
  amount: number;
};

/**
 * Looks up a payment by its Stripe PaymentIntent id — how webhook events,
 * which only carry the Stripe id, are matched back to our own ledger row.
 * @param intentId the Stripe PaymentIntent id
 * @returns the payment, or undefined if it is not one of ours
 */
async function findPaymentByIntentId(intentId: string): Promise<PaymentByIntentRow | undefined> {
  return db
    .prepare("SELECT id, kind, order_id, booking_id, invoice_id, amount FROM payments WHERE intent_id = ?")
    .get<PaymentByIntentRow>(intentId);
}

/**
 * Marks a payment succeeded.
 * @param paymentId the payment row id
 */
async function markPaymentSucceeded(paymentId: string): Promise<void> {
  await db.prepare("UPDATE payments SET status = 'succeeded', updated_at = ? WHERE id = ?").run(now(), paymentId);
}

/**
 * Marks a store order paid, only if it is still in the "placed" state.
 * @param orderId the order id
 */
async function markOrderPaid(orderId: string): Promise<void> {
  await db
    .prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'placed'")
    .run(now(), orderId);
}

/**
 * Marks a booking prepaid for the amount actually charged.
 * @param bookingId the booking id
 * @param amount the amount charged, in dirhams
 */
async function markBookingPrepaid(bookingId: string, amount: number): Promise<void> {
  await db
    .prepare(
      "UPDATE bookings SET payment_status = 'prepaid', prepaid_amount = ?, paid = 1, updated_at = ? WHERE id = ?"
    )
    .run(amount, now(), bookingId);
}

/**
 * Marks an invoice settled.
 * @param invoiceId the invoice id
 */
async function markInvoiceSettled(invoiceId: string): Promise<void> {
  await db.prepare("UPDATE invoices SET settled = 1, settled_at = ? WHERE id = ?").run(now(), invoiceId);
}

/**
 * Records why a payment failed.
 * @param intentId the Stripe PaymentIntent id
 * @param reason Stripe's own decline reason, shown to staff — never returned
 *               from an HTTP response
 */
async function markPaymentFailed(intentId: string, reason: string): Promise<void> {
  await db
    .prepare("UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE intent_id = ?")
    .run(reason, now(), intentId);
}

/**
 * Records a (possibly partial) refund confirmed at Stripe's end, marking the
 * payment fully refunded once the refunded amount reaches its total.
 * @param intentId the Stripe PaymentIntent id
 * @param refundedAmount the total refunded so far, in dirhams
 */
async function recordChargeRefund(intentId: string, refundedAmount: number): Promise<void> {
  await db
    .prepare(
      `UPDATE payments SET refunded_amount = ?, status = CASE WHEN ? >= amount THEN 'refunded' ELSE status END,
         updated_at = ? WHERE intent_id = ?`
    )
    .run(refundedAmount, refundedAmount, now(), intentId);
}

/**
 * Idempotency guard: records a webhook event id the first time it is seen.
 * MUST be called, and its result checked, before any further processing —
 * this is what stops a Stripe retry from paying or refunding something
 * twice.
 * @param event the verified Stripe event
 * @returns true if this is the first time the event has been seen, false if
 *          it is a duplicate delivery that must not be reprocessed
 */
async function recordWebhookEventIfNew(event: Stripe.Event): Promise<boolean> {
  const relatedObjectId = (event.data.object as { id?: string }).id ?? null;
  const result = await db
    .prepare(
      "INSERT INTO webhook_events (id, type, payment_intent, received_at) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING"
    )
    .run(event.id, event.type, relatedObjectId, now());
  return result.changes > 0;
}

/**
 * Removes a webhook event's idempotency marker so a failed delivery is
 * retried by Stripe instead of being mistaken for one we already handled.
 * @param eventId the Stripe event id
 */
async function forgetWebhookEvent(eventId: string): Promise<void> {
  await db.prepare("DELETE FROM webhook_events WHERE id = ?").run(eventId);
}
