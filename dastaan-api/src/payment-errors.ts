/* ------------------------------------------------------------------ */
/* Typed payment errors.                                               */
/*                                                                     */
/* Every failure that can happen while moving money is one of these —   */
/* never a bare Error, never a raw Stripe or database exception passed  */
/* straight through. Each carries a stable machine-readable `code`, the */
/* HTTP `status` a route should answer with, and a `clientMessage` that  */
/* is safe to send as-is. `message` (Error's own field) and `details`   */
/* are for server-side logs only and must never be serialised into an   */
/* HTTP response — see sendPaymentError() in routes/payments.ts.        */
/* ------------------------------------------------------------------ */

export abstract class PaymentDomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  /** Safe to show a client verbatim. */
  readonly clientMessage: string;

  /** Structured context for server-side logs only — e.g. a Stripe error's
   *  type/code/decline_code, or the ids involved in a mismatch. Never sent
   *  to a client. */
  readonly details: Record<string, unknown>;

  constructor(message: string, options: { clientMessage?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = new.target.name;
    this.clientMessage = options.clientMessage ?? message;
    this.details = options.details ?? {};
  }
}

/** A request body failed validation. */
export class ValidationError extends PaymentDomainError {
  readonly code = "validation_error";
  readonly status = 400;
}

/** A client session tried to act on a resource it does not own (IDOR). */
export class OwnershipError extends PaymentDomainError {
  readonly code = "ownership_error";
  readonly status = 403;
}

/** The order/booking/invoice/payment being referenced does not exist. */
export class NotFoundError extends PaymentDomainError {
  readonly code = "not_found";
  readonly status = 404;
}

/** The resource exists but is in a state that cannot be acted on right now
 *  (already paid, already refunded, cancelled, …). */
export class ConflictError extends PaymentDomainError {
  readonly code = "conflict";
  readonly status = 409;
}

/** The master go/no-go switch, or a specific capture mode, is off. */
export class PaymentsDisabledError extends PaymentDomainError {
  readonly code = "payments_disabled";
  readonly status = 503;
}

/** Stripe declined the card itself (insufficient funds, expired, etc). */
export class CardDeclinedError extends PaymentDomainError {
  readonly code = "card_declined";
  readonly status = 402;
  constructor(details: Record<string, unknown>) {
    super("Stripe declined the card", {
      clientMessage: "Your card was declined. Please try a different payment method.",
      details,
    });
  }
}

/** Stripe itself is unreachable or rate-limiting us — likely to succeed on retry. */
export class StripeUnavailableError extends PaymentDomainError {
  readonly code = "stripe_unavailable";
  readonly status = 503;
  constructor(details: Record<string, unknown>) {
    super("Stripe API is unreachable or rate-limiting requests", {
      clientMessage: "Could not reach the payment provider. Please try again shortly.",
      details,
    });
  }
}

/** Our Stripe credentials are missing, revoked, or lack permission for the
 *  call being made — a configuration problem, not a transient one. Needs a
 *  human, immediately: nothing will succeed until it's fixed. */
export class StripeConfigurationError extends PaymentDomainError {
  readonly code = "stripe_configuration_error";
  readonly status = 500;
  constructor(details: Record<string, unknown>) {
    super("Stripe rejected our credentials or permissions", {
      clientMessage: "Something went wrong",
      details,
    });
  }
}

/** Any other Stripe API failure not specifically mapped above (bad request
 *  shape, idempotency conflict, …) — almost always our own bug. */
export class PaymentError extends PaymentDomainError {
  readonly code = "payment_error";
  readonly status = 502;
  constructor(message: string, options: { details?: Record<string, unknown> } = {}) {
    super(message, {
      clientMessage: "Could not process the payment. Please try again.",
      details: options.details,
    });
  }
}

/** STRIPE_WEBHOOK_SECRET is not configured. */
export class WebhookNotConfiguredError extends PaymentDomainError {
  readonly code = "webhook_not_configured";
  readonly status = 503;
  constructor(message: string) {
    super(message, { clientMessage: "Something went wrong" });
  }
}

/** A webhook payload's signature did not verify. */
export class InvalidWebhookSignatureError extends PaymentDomainError {
  readonly code = "invalid_webhook_signature";
  readonly status = 400;
  constructor(message: string) {
    super(message, { clientMessage: "Bad signature" });
  }
}

/**
 * A payment record failed one of the checks in payment-integrity.ts: an
 * amount that doesn't match its source, a refund larger than the original
 * payment, or a status transition that skips a required step. Always worth
 * a critical alert — see logCriticalPaymentAlert().
 */
export class IntegrityViolationError extends PaymentDomainError {
  readonly code = "integrity_violation";
  readonly status = 400;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, { clientMessage: "This payment could not be verified.", details });
  }
}
