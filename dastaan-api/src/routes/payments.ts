/* ------------------------------------------------------------------ */
/* Payments.                                                            */
/*                                                                     */
/* Folded in from the former dastaan-payments service — previously a    */
/* separate deployable so Stripe keys and PCI scope never sat inside    */
/* the main API. Mounted under /payments — see PAYMENTS.md for the      */
/* full flow, schema, and security model. In short:                     */
/*                                                                     */
/*  1. The amount is decided here, from the database — never taken     */
/*     from the request. See resolvePayable().                         */
/*                                                                     */
/*  2. A Stripe webhook signature is verified before this file touches  */
/*     the database at all. See the /webhook handler below.            */
/*                                                                     */
/*  3. Webhooks are recorded before they are acted on — Stripe retries  */
/*     for days, so duplicates must be answered without reprocessing.   */
/*     See recordWebhookEventIfNew().                                  */
/*                                                                     */
/*  4. Every Stripe credential lives in stripe.ts and nowhere else.     */
/*     This file never imports the `stripe` package's runtime value,    */
/*     only its types, and never reads config.payments.stripe.         */
/*                                                                     */
/*  5. Every failure is one of the typed errors in payment-errors.ts —  */
/*     never a bare Error, never a raw Stripe/database error passed     */
/*     through. Each route handler wraps its own work in try/catch and  */
/*     hands anything it catches to sendPaymentError(), which answers   */
/*     known payment errors with their own status/code/message and      */
/*     rethrows anything else so index.ts's centralised error handler   */
/*     can apply its own safety net — nothing unsanitised ever reaches  */
/*     a client either way.                                            */
/*                                                                     */
/*  6. A payment is never marked paid optimistically — only the         */
/*     payment_intent.succeeded webhook does that, and only after       */
/*     assertAmountMatches() confirms Stripe charged what our own       */
/*     record expects. A refund the same way: never marked refunded     */
/*     without assertRefundWithinOriginal() first. See                  */
/*     payment-integrity.ts.                                            */
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
  cancelPaymentIntent,
  createRefund,
  verifyWebhookSignature,
  toMajor,
  paymentChoices,
} from "../stripe.js";
import type { Stripe } from "../stripe.js";
import {
  PaymentDomainError,
  ValidationError,
  OwnershipError,
  NotFoundError,
  ConflictError,
  PaymentsDisabledError,
  PaymentError,
  StripeConfigurationError,
  WebhookNotConfiguredError,
  InvalidWebhookSignatureError,
  IntegrityViolationError,
} from "../payment-errors.js";
import {
  type Logger,
  isValidStatusTransition,
  assertValidTransition,
  assertAmountMatches,
  assertRefundWithinOriginal,
  logPaymentEvent,
  logCriticalPaymentAlert,
  recordReconciliationNeeded,
  findOrderById,
  findBookingById,
  findInvoiceById,
  priceBookingServices,
} from "../payment-integrity.js";

/** A reply object shaped like what every route handler here actually calls. */
type ReplyLike = { code(n: number): { send(b: unknown): unknown } };

/** The three things a client can pay for. */
type PaymentKind = "order" | "booking" | "invoice";

/** An amount resolved from our own records, ready to charge. */
type Payable = { amount: number; kind: PaymentKind; description: string };

/** A resolved amount is never negative or zero — there is nothing to collect below this. */
const MIN_PAYABLE_AMOUNT = 0;

/** ISO currency code Stripe is asked to charge in, decided once at boot. */
const STRIPE_CURRENCY = config.payments.currency.toLowerCase();

/** Clients pay for their own things; staff may also start one at the desk. */
const INTENT_ROLES: Role[] = ["client", "admin", "super_admin"];

/** Refunds move money back out, so only staff may trigger one. */
const REFUND_ROLES: Role[] = ["admin", "super_admin"];

/* ---- messages sent to clients for cases with no typed error of their own ----
   Never the underlying Stripe or database error — those are logged
   server-side and nothing about them leaves this process. */
const GENERIC_VALIDATION_ERROR = "Invalid request";
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
/* Route registration — every handler is wrapped so nothing it or a      */
/* helper it calls can reach the client, or Fastify's own default        */
/* handler, unsanitised. See sendPaymentError() below.                   */
/* ==================================================================== */

export default async function paymentRoutes(app: FastifyInstance) {
  app.post("/intent", async (req, reply) => {
    const session = await requireRole(req, reply, INTENT_ROLES);
    if (!session) return;
    if (!paymentsEnabled(reply, "online")) return;

    try {
      const parsed = intentSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(GENERIC_VALIDATION_ERROR);
      const input = parsed.data;

      const payable = await resolvePayable(input, session);
      const paymentId = uid();
      const intent = await createPaymentIntent({
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

      await persistPaymentOrCompensate(paymentId, intent, payable, input, session, req.log);

      await audit("payment_intent_created", {
        actorId: session.sub,
        actorRole: session.role,
        detail: describePayable(payable.kind, input),
        ip: req.ip,
      });
      logPaymentEvent(req.log, {
        requestId: req.id,
        userId: session.sub,
        action: "intent_created",
        amount: payable.amount,
        currency: STRIPE_CURRENCY,
        stripePaymentIntentId: intent.id,
        outcome: "success",
      });

      return { amount: payable.amount, currency: STRIPE_CURRENCY, clientSecret: intent.client_secret };
    } catch (err) {
      return sendPaymentError(reply, { requestId: req.id, log: req.log, userId: session.sub, action: "intent_create_failed" }, err);
    }
  });

  app.get("/choices", async () => paymentChoices());

  app.post("/refund", async (req, reply) => {
    const session = await requireRole(req, reply, REFUND_ROLES);
    if (!session) return;
    if (!paymentsEnabled(reply, "online")) return;

    try {
      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(GENERIC_VALIDATION_ERROR);

      const refunded = await processRefund(parsed.data, session, req.id, req.ip, req.log);
      return { ok: true, refunded };
    } catch (err) {
      return sendPaymentError(reply, { requestId: req.id, log: req.log, userId: session.sub, action: "refund_failed" }, err);
    }
  });

  /* Unauthenticated — a valid Stripe signature is the proof, checked before
     anything else in this handler runs. */
  app.post("/webhook", async (req, reply) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") return reply.code(400).send({ error: "Missing signature", requestId: req.id });

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(req.body as Buffer, signature);
    } catch (err) {
      return sendWebhookVerificationError(reply, req.id, req.log, err);
    }

    // Only now — signature verified — is the database touched at all.
    const isNew = await recordWebhookEventIfNew(event);
    if (!isNew) {
      req.log.warn(
        { event: "payment_event", action: "webhook_duplicate", eventId: event.id, eventType: event.type, requestId: req.id },
        "duplicate webhook event received"
      );
      return reply.code(200).send({ received: true });
    }

    try {
      await handleWebhookEvent(event, req.id, req.log);
    } catch (err) {
      if (err instanceof IntegrityViolationError) {
        // Deliberately refused — a retry redelivers the identical mismatch,
        // so it cannot help, and the critical alert already fired inside
        // the handler. Keep the idempotency marker so Stripe does not spend
        // days retrying an event we will never accept.
        logPaymentEvent(req.log, { requestId: req.id, action: "webhook_rejected", outcome: "failure", errorCode: err.code });
        return reply.code(400).send({ error: err.clientMessage, code: err.code, requestId: req.id });
      }

      req.log.error(
        { err, eventId: event.id, eventType: event.type, requestId: req.id },
        "webhook handling failed — letting Stripe retry"
      );
      // Let Stripe retry: remove the marker so the retry is not treated as a
      // duplicate of a delivery we never actually finished. DO NOT swallow
      // this and answer 200 — a 500 here is correct.
      await forgetWebhookEvent(event.id);
      return reply.code(500).send({ error: GENERIC_SERVER_ERROR, requestId: req.id });
    }

    return { received: true };
  });
}

/**
 * Central place a route handler sends a caught error to. A known payment
 * error (anything extending PaymentDomainError) is logged with full
 * structured detail and answered with its own status/code/clientMessage.
 * Anything else is rethrown, unhandled, so index.ts's centralised
 * `setErrorHandler` can apply the exact same safety net it applies to
 * every other route — this function never guesses at a safe response for
 * an error it does not recognise.
 * @param reply the Fastify reply
 * @param ctx request-scoped logging context
 * @param err whatever the route handler caught
 */
function sendPaymentError(
  reply: ReplyLike,
  ctx: { requestId: string; log: Logger; userId?: string | null; action: "intent_create_failed" | "refund_failed" },
  err: unknown
): void {
  if (!(err instanceof PaymentDomainError)) {
    // Not one of ours — let the centralised handler decide, rather than
    // risk sending back something unsanitised.
    throw err;
  }

  if (err instanceof StripeConfigurationError) {
    // Our Stripe credentials are broken — nothing will succeed until a
    // human fixes it. This is not a per-request problem, so it always
    // pages regardless of which route hit it.
    logCriticalPaymentAlert(ctx.log, { action: "stripe_configuration_error", requestId: ctx.requestId, details: err.details });
  }

  logPaymentEvent(ctx.log, {
    requestId: ctx.requestId,
    userId: ctx.userId,
    action: ctx.action,
    outcome: "failure",
    errorCode: err.code,
  });
  // The technical detail — never sent to the client — for whoever is
  // debugging this later. Ordinary, expected conditions (a bad request, an
  // order that's already paid, a declined card) log at "warn" so they don't
  // drown out genuine server/Stripe failures ("error") in an alerting
  // dashboard.
  const logDetail = { code: err.code, details: err.details, requestId: ctx.requestId };
  if (err.status >= 500) ctx.log.error(logDetail, err.message);
  else ctx.log.warn(logDetail, err.message);

  reply.code(err.status).send({ error: err.clientMessage, code: err.code, requestId: ctx.requestId });
}

/**
 * Answers a failed webhook signature verification. Split out from the
 * route handler only to keep it short — still runs before any database
 * access, same as the caller.
 * @param reply the Fastify reply
 * @param requestId this request's Fastify-assigned id
 * @param log request logger
 * @param err whatever verifyWebhookSignature() threw
 */
function sendWebhookVerificationError(reply: ReplyLike, requestId: string, log: Logger, err: unknown): void {
  if (err instanceof WebhookNotConfiguredError) {
    log.error({ requestId }, "STRIPE_WEBHOOK_SECRET not set — refusing webhook");
    reply.code(503).send({ error: GENERIC_SERVER_ERROR, requestId });
    return;
  }
  if (err instanceof InvalidWebhookSignatureError) {
    // Anyone can POST here. Without a valid signature it is not Stripe —
    // log that it was rejected, never the payload or header that failed.
    log.warn({ requestId }, "rejected a webhook with an invalid signature");
    reply.code(400).send({ error: "Bad signature", requestId });
    return;
  }
  throw err;
}

/* ==================================================================== */
/* /intent — resolving what is owed, and creating the Stripe intent.     */
/* ==================================================================== */

/**
 * Works out what is actually owed for an intent request, entirely from the
 * database — nothing here is taken from the request body but the id of the
 * thing being paid for. This is the amount-integrity boundary: whatever
 * this function returns is what Stripe is asked to charge.
 * @param input the parsed /intent request body
 * @param session the authenticated caller, for ownership checks
 * @returns the resolved amount/kind/description
 * @throws {NotFoundError | OwnershipError | ConflictError | PaymentsDisabledError}
 */
async function resolvePayable(input: IntentInput, session: Session): Promise<Payable> {
  if (input.orderId) return resolveOrderPayable(input.orderId, session);
  if (input.bookingId) return resolveBookingPayable(input.bookingId, session);
  return resolveInvoicePayable(input.invoiceId!);
}

/**
 * Resolves a store order into a payable amount.
 * @param orderId the order to price
 * @param session the authenticated caller
 * @returns the payable
 * @throws {NotFoundError | OwnershipError | ConflictError}
 */
async function resolveOrderPayable(orderId: string, session: Session): Promise<Payable> {
  const order = await findOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found");
  assertOwnership(session, order.client_id);
  if (order.status !== "placed") throw new ConflictError(`That order is already ${order.status}`);
  return { amount: Number(order.total), kind: "order", description: "Dastaan store order" };
}

/**
 * Resolves a booking into a payable amount by pricing its services fresh
 * from the database.
 * @param bookingId the booking to price
 * @param session the authenticated caller
 * @returns the payable
 * @throws {PaymentsDisabledError | NotFoundError | OwnershipError | ConflictError}
 */
async function resolveBookingPayable(bookingId: string, session: Session): Promise<Payable> {
  if (!config.payments.booking.payNowEnabled)
    throw new PaymentsDisabledError("Paying at the time of booking is switched off");

  const booking = await findBookingById(bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  assertOwnership(session, booking.client_id);
  if (booking.payment_status === "prepaid") throw new ConflictError("That appointment is already paid");
  if (booking.status === "Cancelled") throw new ConflictError("That booking is cancelled");

  const amount = await priceBookingServices(JSON.parse(booking.service_ids) as string[]);
  if (amount <= MIN_PAYABLE_AMOUNT) throw new ConflictError("Nothing to pay for that booking");

  return { amount, kind: "booking", description: "Dastaan appointment" };
}

/**
 * Resolves an unsettled invoice (a bill the client is settling from the app
 * after their visit) into a payable amount. No ownership check exists yet
 * here because invoices carry no client id of their own — see PAYMENTS.md.
 * @param invoiceId the invoice to price
 * @returns the payable
 * @throws {NotFoundError | ConflictError}
 */
async function resolveInvoicePayable(invoiceId: string): Promise<Payable> {
  const invoice = await findInvoiceById(invoiceId);
  if (!invoice) throw new NotFoundError("Bill not found");
  if (invoice.settled) throw new ConflictError("That bill is already settled");
  return { amount: Number(invoice.total), kind: "invoice", description: `Dastaan ${invoice.invoice_no}` };
}

/**
 * Guards against a client session acting on a resource it does not own —
 * the IDOR check that closes /intent. Staff (admin/super_admin) may act on
 * any resource.
 * @param session the authenticated caller
 * @param ownerId the resource's owning client id, if any
 * @throws {OwnershipError} if a client session does not own the resource
 */
function assertOwnership(session: Session, ownerId: string | null): void {
  if (session.role === "client" && ownerId !== session.sub) throw new OwnershipError("Not allowed");
}

/**
 * Writes the payment ledger row for a newly created Stripe intent. If the
 * write fails, the Stripe intent is cancelled immediately — the client
 * must never receive a clientSecret for an intent our own ledger has no
 * record of. If the cancel ALSO fails, a payment_reconciliation_needed
 * record is written so a genuinely dangling intent is never silently lost.
 * @param paymentId our own generated payment row id
 * @param intent the Stripe intent just created
 * @param payable the resolved amount/kind this intent is for
 * @param input the original /intent request
 * @param session the authenticated caller
 * @param log request logger
 * @throws {PaymentError} always, if the write fails — the original DB error is never re-thrown directly
 */
async function persistPaymentOrCompensate(
  paymentId: string,
  intent: Stripe.PaymentIntent,
  payable: Payable,
  input: IntentInput,
  session: Session,
  log: Logger
): Promise<void> {
  try {
    await recordPayment(paymentId, intent.id, payable, input, session);
  } catch (dbErr) {
    log.error(
      { err: dbErr, stripePaymentIntentId: intent.id, paymentId },
      "failed to record payment — cancelling the Stripe intent"
    );
    try {
      await cancelPaymentIntent(intent.id);
    } catch (cancelErr) {
      await recordReconciliationNeeded(
        {
          paymentId,
          intentId: intent.id,
          reason: "db_write_failed_and_cancel_failed",
          detail:
            "Payment row could not be written and the Stripe intent could not be cancelled — a live intent may exist with no local record.",
          amount: payable.amount,
          currency: STRIPE_CURRENCY,
        },
        log
      );
      log.error({ err: cancelErr, stripePaymentIntentId: intent.id }, "failed to cancel dangling Stripe intent after DB write failure");
    }
    throw new PaymentError("Could not record the payment. Please try again.", {
      details: { stripePaymentIntentId: intent.id },
    });
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

/**
 * Refunds the succeeded payment behind a booking or invoice: validates it
 * hasn't already been refunded, locks it into "processing" so a second
 * click cannot race a second refund, calls Stripe, then updates our own
 * ledger. The role check for who may call this happens in the route
 * handler before this function — never inside it — so no Stripe call can
 * be reached without already having proven the caller is staff.
 * @param input the parsed /refund request body
 * @param session the authenticated (already role-checked) caller
 * @param requestId this request's Fastify-assigned id, for the log entry
 * @param ip the caller's IP, recorded on the audit log entry
 * @param log request logger
 * @returns the refunded amount
 * @throws {NotFoundError | ConflictError | CardDeclinedError | StripeUnavailableError | StripeConfigurationError | PaymentError}
 */
async function processRefund(
  input: RefundInput,
  session: Session,
  requestId: string,
  ip: string,
  log: Logger
): Promise<number> {
  const payment = input.bookingId
    ? await findPaymentByBooking(input.bookingId)
    : await findPaymentByInvoice(input.invoiceId!);

  if (!payment) throw new NotFoundError("No payment found to refund");
  if (payment.status !== "paid") throw new ConflictError("That payment never completed");
  if (Number(payment.refunded_amount) >= Number(payment.amount))
    throw new ConflictError("That payment has already been refunded");

  // Lock it before the Stripe call — a second /refund request for the same
  // payment arriving while this one is in flight sees status "processing",
  // not "paid", and is refused by the check above instead of racing us.
  await markPaymentProcessing(payment.id);
  try {
    await createRefund(payment.intent_id);
  } catch (err) {
    // The Stripe call never took effect — release the lock so a later
    // attempt is not blocked forever.
    await markPaymentPaid(payment.id);
    throw err;
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
  logPaymentEvent(log, {
    requestId,
    userId: session.sub,
    action: "refund_created",
    amount: Number(payment.amount),
    currency: STRIPE_CURRENCY,
    stripePaymentIntentId: payment.intent_id,
    outcome: "success",
  });

  return Number(payment.amount);
}

/* ==================================================================== */
/* /webhook                                                              */
/* ==================================================================== */

/**
 * Dispatches a verified Stripe event to its handler.
 * @param event the verified Stripe event
 * @param requestId this request's Fastify-assigned id, for log entries
 * @param log request logger
 */
async function handleWebhookEvent(event: Stripe.Event, requestId: string, log: Logger): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent, event, requestId, log);
    case "payment_intent.processing":
      return handlePaymentProcessing(event.data.object as Stripe.PaymentIntent);
    case "payment_intent.payment_failed":
      return handlePaymentFailed(event.data.object as Stripe.PaymentIntent, requestId, log);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge, event, requestId, log);
    default:
      // Everything else is noise for us; acknowledging it stops Stripe
      // retrying events we will never care about.
      return;
  }
}

/**
 * Marks a payment paid and settles whatever it paid for (order, booking or
 * invoice), all inside one transaction — so a failure partway through
 * cannot leave the ledger updated without the booking/order/invoice
 * updated, or vice versa. The amount Stripe reports is verified against
 * our own record before anything is written; a mismatch never reaches the
 * database update at all. If the transaction fails for ANY reason after
 * Stripe has already settled the money, a payment_reconciliation_needed
 * record is written before the original error is re-thrown — money is
 * never silently lost even if this handler cannot finish.
 * @param intent the Stripe PaymentIntent that succeeded
 * @param event the original webhook event, for the reconciliation record
 * @param requestId this request's Fastify-assigned id, for the log entry
 * @param log request logger
 */
async function handlePaymentSucceeded(
  intent: Stripe.PaymentIntent,
  event: Stripe.Event,
  requestId: string,
  log: Logger
): Promise<void> {
  let payerId: string | null = null;
  let paymentId: string | undefined;

  try {
    await db.transaction(async () => {
      const payment = await findPaymentByIntentId(intent.id);
      if (!payment) return; // not ours
      payerId = payment.client_id;
      paymentId = payment.id;

      assertAmountMatches(payment.id, Number(payment.amount), intent.amount, log);

      await markPaymentPaid(payment.id);
      if (payment.kind === "order" && payment.order_id) await markOrderPaid(payment.order_id);
      if (payment.kind === "booking" && payment.booking_id)
        await markBookingPrepaid(payment.booking_id, Number(payment.amount));
      if (payment.kind === "invoice" && payment.invoice_id) await markInvoiceSettled(payment.invoice_id);
    });
  } catch (err) {
    await recordReconciliationNeeded(
      {
        paymentId,
        intentId: intent.id,
        eventId: event.id,
        eventType: event.type,
        reason: err instanceof PaymentDomainError ? err.code : "webhook_transaction_failed",
        detail:
          err instanceof PaymentDomainError
            ? err.message
            : "unexpected error while applying payment_intent.succeeded",
        amount: toMajor(intent.amount),
        currency: intent.currency,
      },
      log
    );
    throw err;
  }

  logPaymentEvent(log, {
    requestId,
    userId: payerId,
    action: "payment_succeeded",
    amount: toMajor(intent.amount),
    currency: intent.currency,
    stripePaymentIntentId: intent.id,
    outcome: "success",
  });
}

/**
 * Moves a payment into "processing" when Stripe reports it has begun an
 * asynchronous capture (some payment methods settle this way; cards
 * usually go straight to succeeded). Only acts when the current status is
 * still "pending" — Stripe does not guarantee webhook delivery order, and
 * "processing" is also used as /refund's concurrency lock (see
 * VALID_STATUS_TRANSITIONS in payment-integrity.ts), so a late-arriving
 * processing event for an intent that has already succeeded, or a payment
 * that's mid-refund, is silently ignored rather than incorrectly
 * regressing its status. Lower-stakes than the other webhook handlers —
 * no money has moved yet — so a failure here just lets Stripe's normal
 * retry handle it, no reconciliation record.
 * @param intent the Stripe PaymentIntent now processing
 */
async function handlePaymentProcessing(intent: Stripe.PaymentIntent): Promise<void> {
  await db.transaction(async () => {
    const payment = await findPaymentByIntentId(intent.id);
    if (!payment || payment.status !== "pending") return; // not ours, or a stale/out-of-order event
    await markPaymentProcessing(payment.id);
  });
}

/**
 * Records why a payment failed, so the front desk and the client's own
 * account can show a reason rather than a silent nothing-happened.
 * @param intent the Stripe PaymentIntent that failed
 * @param requestId this request's Fastify-assigned id, for the log entry
 * @param log request logger
 */
async function handlePaymentFailed(intent: Stripe.PaymentIntent, requestId: string, log: Logger): Promise<void> {
  const reason = intent.last_payment_error?.message ?? "Payment failed";
  await db.transaction(async () => {
    await markPaymentFailed(intent.id, reason);
  });
  logPaymentEvent(log, {
    requestId,
    action: "payment_failed",
    amount: toMajor(intent.amount),
    currency: intent.currency,
    stripePaymentIntentId: intent.id,
    outcome: "failure",
    errorCode: intent.last_payment_error?.code,
  });
}

/**
 * Records a refund confirmed at Stripe's end (the async confirmation of
 * either an in-app refund or one issued directly from the Stripe
 * dashboard). The refunded amount is verified against the original charge
 * before anything is written — it can never exceed it. Like
 * handlePaymentSucceeded, any failure after Stripe has already refunded
 * the money is captured as a reconciliation record before the error is
 * re-thrown.
 * @param charge the Stripe Charge that was refunded
 * @param event the original webhook event, for the reconciliation record
 * @param requestId this request's Fastify-assigned id, for the log entry
 * @param log request logger
 */
async function handleChargeRefunded(
  charge: Stripe.Charge,
  event: Stripe.Event,
  requestId: string,
  log: Logger
): Promise<void> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;

  const refundedAmount = toMajor(charge.amount_refunded);
  let payerId: string | null = null;
  let paymentId: string | undefined;

  try {
    await db.transaction(async () => {
      const payment = await findPaymentByIntentId(intentId);
      if (!payment) return; // not ours
      payerId = payment.client_id;
      paymentId = payment.id;

      assertRefundWithinOriginal(payment.id, Number(payment.amount), refundedAmount, log);

      await recordChargeRefund(intentId, refundedAmount);
    });
  } catch (err) {
    await recordReconciliationNeeded(
      {
        paymentId,
        intentId,
        eventId: event.id,
        eventType: event.type,
        reason: err instanceof PaymentDomainError ? err.code : "webhook_transaction_failed",
        detail: err instanceof PaymentDomainError ? err.message : "unexpected error while applying charge.refunded",
        amount: refundedAmount,
        currency: charge.currency,
      },
      log
    );
    throw err;
  }

  logPaymentEvent(log, {
    requestId,
    userId: payerId,
    action: "refund_confirmed",
    amount: refundedAmount,
    currency: charge.currency,
    stripePaymentIntentId: intentId,
    outcome: "success",
  });
}

/* ==================================================================== */
/* Database helpers — every payments-related query lives here, nowhere   */
/* else in this file. Status-changing writes go through                 */
/* assertValidTransition() (payment-integrity.ts) so a bug elsewhere     */
/* can never silently skip a required step.                             */
/* ==================================================================== */

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
  payable: Payable,
  input: IntentInput,
  session: Session
): Promise<void> {
  await db.prepare(
    `INSERT INTO payments (id, intent_id, kind, order_id, booking_id, invoice_id, client_id,
       amount, currency, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, ?)
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
 * Moves a payment to "processing" — used as a lock ahead of the Stripe
 * refund call so a concurrent second refund attempt sees a non-"paid"
 * status and is refused, and as the ordinary intermediate state some
 * Stripe payment methods pass through before succeeding.
 * @param paymentId the payment row id
 * @throws {IntegrityViolationError} if the current status cannot legally move to "processing"
 */
async function markPaymentProcessing(paymentId: string): Promise<void> {
  await assertValidTransition(paymentId, "processing");
  await db.prepare("UPDATE payments SET status = 'processing', updated_at = ? WHERE id = ?").run(now(), paymentId);
}

/**
 * Marks a payment paid. Only ever called from the payment_intent.succeeded
 * webhook handler (after amount verification) or to release the
 * "processing" lock when a refund attempt's Stripe call fails — never
 * optimistically at intent-creation time.
 * @param paymentId the payment row id
 * @throws {IntegrityViolationError} if the current status cannot legally move to "paid"
 */
async function markPaymentPaid(paymentId: string): Promise<void> {
  await assertValidTransition(paymentId, "paid");
  await db.prepare("UPDATE payments SET status = 'paid', updated_at = ? WHERE id = ?").run(now(), paymentId);
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
 * @throws {IntegrityViolationError} if the current status cannot legally move to "failed"
 */
async function markPaymentFailed(intentId: string, reason: string): Promise<void> {
  const row = await db
    .prepare("SELECT id, status FROM payments WHERE intent_id = ?")
    .get<{ id: string; status: string }>(intentId);
  if (!row) return;
  if (!isValidStatusTransition(row.status, "failed")) {
    throw new IntegrityViolationError(`Invalid payment status transition for ${row.id}: ${row.status} -> failed`, {
      paymentId: row.id,
      from: row.status,
      to: "failed",
    });
  }
  await db
    .prepare("UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason, now(), row.id);
}

/**
 * Marks a payment fully refunded, initiated from our own /refund route.
 * @param paymentId the payment row id
 * @throws {IntegrityViolationError} if the current status cannot legally move to "refunded"
 */
async function markPaymentRefunded(paymentId: string): Promise<void> {
  await assertValidTransition(paymentId, "refunded");
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
  client_id: string | null;
  amount: number;
  status: string;
};

/**
 * Looks up a payment by its Stripe PaymentIntent id — how webhook events,
 * which only carry the Stripe id, are matched back to our own ledger row.
 * @param intentId the Stripe PaymentIntent id
 * @returns the payment, or undefined if it is not one of ours
 */
async function findPaymentByIntentId(intentId: string): Promise<PaymentByIntentRow | undefined> {
  return db
    .prepare(
      "SELECT id, kind, order_id, booking_id, invoice_id, client_id, amount, status FROM payments WHERE intent_id = ?"
    )
    .get<PaymentByIntentRow>(intentId);
}

/**
 * Records a (possibly partial) refund confirmed at Stripe's end, marking
 * the payment fully refunded once the refunded amount reaches its total.
 * Callers must call assertRefundWithinOriginal() first — this function
 * only writes.
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
