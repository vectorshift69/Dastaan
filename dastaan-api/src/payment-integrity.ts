/* ------------------------------------------------------------------ */
/* Payment integrity.                                                   */
/*                                                                     */
/* Everything that stops a payment record from silently drifting away    */
/* from reality: status transitions that can't skip a step, amounts     */
/* re-checked against their source record, refunds that can't exceed    */
/* what was actually charged, a durable trail when a webhook confirms    */
/* money moved but our own database write fails, and the structured      */
/* logging every payment event and every critical alert goes through.    */
/*                                                                     */
/* Stripe-agnostic on purpose — nothing here imports the `stripe`        */
/* package or touches a credential; it works with plain numbers and      */
/* database rows so it can be reasoned about (and tested) without a      */
/* Stripe account at all. See stripe.ts for the Stripe boundary.         */
/* ------------------------------------------------------------------ */

import { db, uid, now } from "./db.js";
import { toMinor } from "./stripe.js";
import { IntegrityViolationError } from "./payment-errors.js";

/** Minimal logger shape every helper below needs — matches Fastify's req.log. */
export type Logger = {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
};

/** Every state a payment row can be in, in the order money actually moves. */
export type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded";

/**
 * How much a stored dirham amount may differ from a freshly recomputed one
 * before it counts as a mismatch, to absorb floating-point rounding — not a
 * business tolerance for being "close enough".
 */
const AMOUNT_COMPARISON_TOLERANCE_AED = 0.005;

/* ==================================================================== */
/* Status transitions.                                                   */
/* ==================================================================== */

/**
 * Every transition a payment row is allowed to make. A state may always
 * "transition" to itself — an idempotent re-application (a replayed
 * webhook, a retried request) is a no-op, not a violation. Everything else
 * not listed is refused: a failed or cancelled payment can't later become
 * paid, a refund can't be undone, and nothing can go back to pending.
 *
 * "processing" is used two ways, both "a Stripe operation is in flight for
 * this payment": pending -> processing -> paid describes Stripe settling
 * the initial charge asynchronously; paid -> processing -> refunded is the
 * lock /refund takes out before calling Stripe, so a second refund request
 * arriving mid-call sees a non-"paid" status and is refused rather than
 * racing it. If that Stripe call fails, the lock is released back to paid
 * (processing -> paid) rather than left stuck.
 */
const VALID_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["pending", "processing", "paid", "failed", "cancelled"],
  processing: ["processing", "paid", "failed", "cancelled", "refunded"],
  paid: ["paid", "processing", "refunded"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  refunded: ["refunded"],
};

/**
 * Whether moving a payment from one status to another is a legal
 * transition.
 * @param from the current status
 * @param to the status being written
 * @returns true if the transition is allowed
 */
export function isValidStatusTransition(from: string, to: string): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from as PaymentStatus];
  return allowed !== undefined && allowed.includes(to as PaymentStatus);
}

/**
 * Guards every status-changing write to the payments table: reads the
 * current status and throws if the requested one is not reachable from it.
 * This is the single choke point every markPayment* helper in
 * routes/payments.ts goes through, so a bug elsewhere can never silently
 * skip a required step (e.g. jump straight to "paid" without ever having
 * been "pending"), and a replayed webhook can never un-refund a payment.
 * @param paymentId the payment row id
 * @param toStatus the status a caller is about to write
 * @throws {IntegrityViolationError} if the transition is not allowed
 */
export async function assertValidTransition(paymentId: string, toStatus: PaymentStatus): Promise<void> {
  const row = await db.prepare("SELECT status FROM payments WHERE id = ?").get<{ status: string }>(paymentId);
  if (!row) return; // nothing to protect — the caller's own write will affect zero rows
  if (!isValidStatusTransition(row.status, toStatus)) {
    throw new IntegrityViolationError(
      `Invalid payment status transition for ${paymentId}: ${row.status} -> ${toStatus}`,
      { paymentId, from: row.status, to: toStatus }
    );
  }
}

/* ==================================================================== */
/* Amount integrity.                                                     */
/* ==================================================================== */

/**
 * Verifies a Stripe PaymentIntent's charged amount matches what our own
 * payments row expects, in minor units so both sides are compared as
 * integers. Called from the payment_intent.succeeded webhook handler
 * before anything is marked paid.
 * @param paymentId the payment row id, for the error/log context
 * @param expectedAmountAed the amount our own record expects, in dirhams
 * @param actualAmountMinor the amount Stripe reports it charged, in fils
 * @param log request logger — a mismatch always logs a critical alert
 * @throws {IntegrityViolationError} if the amounts don't match
 */
export function assertAmountMatches(
  paymentId: string,
  expectedAmountAed: number,
  actualAmountMinor: number,
  log: Logger
): void {
  const expectedMinor = toMinor(expectedAmountAed);
  const toleranceMinor = toMinor(AMOUNT_COMPARISON_TOLERANCE_AED);
  if (Math.abs(expectedMinor - actualAmountMinor) > toleranceMinor) {
    logCriticalPaymentAlert(log, {
      action: "amount_mismatch",
      paymentId,
      expectedAmountMinor: expectedMinor,
      actualAmountMinor,
    });
    throw new IntegrityViolationError(
      `Payment ${paymentId} expected ${expectedMinor} (minor units) but Stripe charged ${actualAmountMinor}`,
      { paymentId, expectedAmountMinor: expectedMinor, actualAmountMinor }
    );
  }
}

/**
 * Verifies a refund does not exceed the amount originally charged. Called
 * from the charge.refunded webhook handler before recording it.
 * @param paymentId the payment row id, for the error/log context
 * @param originalAmountAed the amount originally charged, in dirhams
 * @param refundedAmountAed the cumulative amount refunded so far, in dirhams
 * @param log request logger — a violation always logs a critical alert
 * @throws {IntegrityViolationError} if the refund exceeds the original amount
 */
export function assertRefundWithinOriginal(
  paymentId: string,
  originalAmountAed: number,
  refundedAmountAed: number,
  log: Logger
): void {
  if (refundedAmountAed - originalAmountAed > AMOUNT_COMPARISON_TOLERANCE_AED) {
    logCriticalPaymentAlert(log, {
      action: "refund_exceeds_original",
      paymentId,
      originalAmountAed,
      refundedAmountAed,
    });
    throw new IntegrityViolationError(
      `Refund of ${refundedAmountAed} on payment ${paymentId} exceeds the original amount ${originalAmountAed}`,
      { paymentId, originalAmountAed, refundedAmountAed }
    );
  }
}

/* ==================================================================== */
/* Structured logging.                                                   */
/* ==================================================================== */

/** The lifecycle actions a payment event log entry can describe. */
export type PaymentAction =
  | "intent_created"
  | "intent_create_failed"
  | "payment_succeeded"
  | "payment_failed"
  | "refund_created"
  | "refund_failed"
  | "refund_confirmed"
  | "webhook_duplicate"
  | "webhook_rejected";

export type PaymentEventFields = {
  requestId?: string;
  userId?: string | null;
  action: PaymentAction;
  amount?: number;
  currency?: string;
  stripePaymentIntentId?: string;
  outcome: "success" | "failure";
  errorCode?: string;
};

/**
 * Writes one structured log entry for a payment lifecycle event. Always the
 * same shape, so a log pipeline can key off `event: "payment_event"`
 * without needing to know which route produced it. Never includes a raw
 * error message — a failed outcome carries `errorCode` (from a
 * PaymentDomainError's `code`) instead.
 * @param log request logger
 * @param fields the event to record — see {@link PaymentEventFields}
 */
export function logPaymentEvent(log: Logger, fields: PaymentEventFields): void {
  const entry = { event: "payment_event", timestamp: now(), ...fields };
  if (fields.outcome === "success") log.info(entry, `payment event: ${fields.action}`);
  else log.warn(entry, `payment event failed: ${fields.action}`);
}

/**
 * Logs a critical, page-someone-now alert: an amount mismatch, a refund
 * that exceeds the original charge, an invalid status transition, a
 * misconfigured Stripe credential, or a payment that needs manual
 * reconciliation. Uses `error` level (Pino has no distinct "critical"
 * level) with an explicit `severity`/`alert` marker so a log-based alerting
 * rule can match on it without matching every ordinary error.
 * @param log request logger
 * @param fields whatever context explains the alert
 */
export function logCriticalPaymentAlert(log: Logger, fields: Record<string, unknown>): void {
  log.error(
    { event: "payment_critical_alert", severity: "critical", alert: true, timestamp: now(), ...fields },
    "PAYMENT INTEGRITY ALERT"
  );
}

/* ==================================================================== */
/* Reconciliation — the last line of defence.                            */
/* ==================================================================== */

export type ReconciliationInput = {
  paymentId?: string | null;
  intentId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  /** a short machine code, e.g. a PaymentDomainError's `code` */
  reason: string;
  /** human-readable context — safe, curated text, never a raw error message */
  detail: string;
  amount?: number | null;
  currency?: string | null;
};

/**
 * Writes a durable "a human needs to look at this" record: Stripe settled
 * or refunded money and our own database could not be made to agree with
 * it (a transaction rolled back, an amount didn't match, a write outright
 * failed). Called from the payment_intent.succeeded and charge.refunded
 * webhook handlers, and from the /intent route if a payment row can't be
 * written after Stripe already created the intent.
 *
 * Deliberately does not throw on its own failure — the caller already has
 * the original error to propagate, and a second failure here must never
 * replace or hide it. If even this write fails, that is itself logged at
 * critical level so it is not silently lost.
 * @param input what to record — see {@link ReconciliationInput}
 * @param log request logger
 */
export async function recordReconciliationNeeded(input: ReconciliationInput, log: Logger): Promise<void> {
  logCriticalPaymentAlert(log, {
    action: "reconciliation_needed",
    paymentId: input.paymentId,
    intentId: input.intentId,
    eventId: input.eventId,
    reason: input.reason,
  });
  try {
    await db
      .prepare(
        `INSERT INTO payment_reconciliation_needed
           (id, payment_id, intent_id, event_id, event_type, reason, detail, amount, currency, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        uid(),
        input.paymentId ?? null,
        input.intentId ?? null,
        input.eventId ?? null,
        input.eventType ?? null,
        input.reason,
        input.detail,
        input.amount ?? null,
        input.currency ?? null,
        now()
      );
  } catch (writeErr) {
    log.error(
      { err: writeErr, intentId: input.intentId, eventId: input.eventId, reason: input.reason },
      "CRITICAL: failed to write payment_reconciliation_needed row — a settled payment may go untracked"
    );
  }
}

/* ==================================================================== */
/* Source-of-truth lookups — what a payment SHOULD cost, read fresh.      */
/* ==================================================================== */

type OrderRow = { id: string; client_id: string; total: number; status: string };
type BookingRow = {
  id: string;
  client_id: string | null;
  service_ids: string;
  payment_status: string;
  status: string;
};
type InvoiceRow = { id: string; invoice_no: string; total: number; settled: number };

/**
 * Looks up a store order by id.
 * @param orderId the order id
 * @returns the order, or undefined if it does not exist
 */
export async function findOrderById(orderId: string): Promise<OrderRow | undefined> {
  return db.prepare("SELECT id, client_id, total, status FROM orders WHERE id = ?").get<OrderRow>(orderId);
}

/**
 * Looks up a booking by id.
 * @param bookingId the booking id
 * @returns the booking, or undefined if it does not exist
 */
export async function findBookingById(bookingId: string): Promise<BookingRow | undefined> {
  return db
    .prepare("SELECT id, client_id, service_ids, payment_status, status FROM bookings WHERE id = ?")
    .get<BookingRow>(bookingId);
}

/**
 * Looks up an invoice by id.
 * @param invoiceId the invoice id
 * @returns the invoice, or undefined if it does not exist
 */
export async function findInvoiceById(invoiceId: string): Promise<InvoiceRow | undefined> {
  return db.prepare("SELECT id, invoice_no, total, settled FROM invoices WHERE id = ?").get<InvoiceRow>(invoiceId);
}

/**
 * Sums the current price of each service on a booking. Prices are read
 * fresh from the services table — never trusted from a caller.
 * @param serviceIds the booking's service ids
 * @returns the total price in dirhams
 */
export async function priceBookingServices(serviceIds: string[]): Promise<number> {
  let total = 0;
  for (const serviceId of serviceIds) {
    const service = await db.prepare("SELECT price FROM services WHERE id = ?").get<{ price: number }>(serviceId);
    total += Number(service?.price ?? 0);
  }
  return total;
}

/* ==================================================================== */
/* Ad-hoc / audit integrity check.                                       */
/* ==================================================================== */

type PaymentAuditRow = {
  id: string;
  intent_id: string | null;
  kind: string;
  order_id: string | null;
  booking_id: string | null;
  invoice_id: string | null;
  amount: number;
  status: string;
};

export type IntegrityCheckResult = { paymentId: string; ok: boolean; issues: string[] };

/**
 * Re-verifies a stored payment row against reality: does its amount still
 * match the underlying order/booking/invoice, is its status one this
 * codebase recognises, and does a paid record carry the Stripe intent that
 * paid it. Read-only — for ad-hoc reconciliation or a future admin tool,
 * not called automatically on every request.
 * @param paymentId the payment row id to check
 * @returns which checks passed, and a human-readable issue for each that didn't
 */
export async function integrityCheck(paymentId: string): Promise<IntegrityCheckResult> {
  const payment = await db
    .prepare(
      "SELECT id, intent_id, kind, order_id, booking_id, invoice_id, amount, status FROM payments WHERE id = ?"
    )
    .get<PaymentAuditRow>(paymentId);

  if (!payment) return { paymentId, ok: false, issues: ["payment record not found"] };

  const issues: string[] = [];

  const sourceAmount = await sourceAmountFor(payment);
  if (sourceAmount === null) {
    issues.push(`source record (${payment.kind}:${payment.order_id ?? payment.booking_id ?? payment.invoice_id}) no longer exists`);
  } else if (Math.abs(sourceAmount - Number(payment.amount)) > AMOUNT_COMPARISON_TOLERANCE_AED) {
    issues.push(`amount ${payment.amount} does not match current source amount ${sourceAmount}`);
  }

  if (!(payment.status in VALID_STATUS_TRANSITIONS)) {
    issues.push(`unrecognised status "${payment.status}"`);
  }

  if (payment.status === "paid" && !payment.intent_id) {
    issues.push("status is paid but no Stripe payment intent id is recorded");
  }

  return { paymentId, ok: issues.length === 0, issues };
}

/**
 * Recomputes what a payment SHOULD cost today, from its source record.
 * @param payment the payment row (or the subset of it identifying its source)
 * @returns the current source amount in dirhams, or null if the source no longer exists
 */
async function sourceAmountFor(
  payment: Pick<PaymentAuditRow, "kind" | "order_id" | "booking_id" | "invoice_id">
): Promise<number | null> {
  if (payment.kind === "order" && payment.order_id) {
    const order = await findOrderById(payment.order_id);
    return order ? Number(order.total) : null;
  }
  if (payment.kind === "booking" && payment.booking_id) {
    const booking = await findBookingById(payment.booking_id);
    if (!booking) return null;
    return priceBookingServices(JSON.parse(booking.service_ids) as string[]);
  }
  if (payment.kind === "invoice" && payment.invoice_id) {
    const invoice = await findInvoiceById(payment.invoice_id);
    return invoice ? Number(invoice.total) : null;
  }
  return null;
}
