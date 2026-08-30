/* ------------------------------------------------------------------ */
/* Stripe boundary.                                                     */
/*                                                                     */
/* The ONLY module in this codebase that touches a Stripe credential —  */
/* the secret API key or the webhook signing secret — or imports the    */
/* `stripe` package's error classes. Nothing outside this file reads    */
/* `config.payments.stripe` or calls the Stripe client directly.        */
/* Routes ask for what they need (create an intent, verify a webhook,   */
/* issue a refund, cancel a dangling intent) through the functions       */
/* below, and always get back either plain data or one of the typed     */
/* errors from payment-errors.ts — never a raw Stripe SDK error and     */
/* never the client itself.                                             */
/*                                                                     */
/* The salon owns the Stripe account — money settles to them, never to  */
/* us. That is also why the credentials sit behind `stripeAccount()`     */
/* rather than being read inline: moving to Stripe Connect later        */
/* (salons linking their own account instead of handing over a key) is  */
/* a change in one function rather than a change everywhere.            */
/* ------------------------------------------------------------------ */

import Stripe from "stripe";
import { config } from "./config.js";
import {
  CardDeclinedError,
  InvalidWebhookSignatureError,
  PaymentError,
  StripeConfigurationError,
  StripeUnavailableError,
  WebhookNotConfiguredError,
  type PaymentDomainError,
} from "./payment-errors.js";

export type { Stripe };

/** Network retries Stripe's SDK will attempt before giving up on a call. */
const STRIPE_MAX_NETWORK_RETRIES = 2;

/** How long a single Stripe API call may take before the SDK times out. */
const STRIPE_TIMEOUT_MS = 20_000;

/** Fils per dirham — AED has 2 decimal places, same as most Stripe currencies. */
const MINOR_UNITS_PER_MAJOR = 100;

/** A signed webhook payload older than this is refused as a possible replay. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Shown against every charge in the salon's Stripe dashboard. */
const APP_INFO = { name: "Dastaan", version: "0.1.0" } as const;

let client: Stripe | null = null;

/**
 * The Stripe client for the account money settles into.
 *
 * Today that is the salon's own account, reached with their secret key. If
 * this ever serves more than one salon, this is where Connect goes: take a
 * salon id, look up their connected account, and return a client scoped to
 * it. Nothing above this function needs to know which it is.
 *
 * Private to this module — callers use the higher-level functions below
 * instead of reaching for the client directly.
 *
 * @returns a memoised Stripe client
 * @throws {Error} if STRIPE_SECRET_KEY is not configured — this is a boot
 *         misconfiguration, not a request-time failure, so it stays a plain
 *         Error rather than one of the typed request-time errors below
 */
function stripeAccount(): Stripe {
  if (!client) {
    if (!config.payments.stripe.secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required to take a card payment");
    }
    client = new Stripe(config.payments.stripe.secretKey, {
      appInfo: APP_INFO,
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
      timeout: STRIPE_TIMEOUT_MS,
    });
  }
  return client;
}

/**
 * Pulls the structured, non-message fields off a Stripe SDK error — the
 * parts that are safe and useful to log (type, code, decline code, the
 * charge it relates to, Stripe's own request id) without repeating
 * Stripe's freeform message text.
 * @param err a Stripe SDK error
 * @returns a plain object suitable for structured logging
 */
function extractStripeErrorDetails(err: Stripe.errors.StripeError): Record<string, unknown> {
  const cardErr = err as Stripe.errors.StripeCardError;
  return {
    stripeErrorType: err.type,
    stripeErrorCode: err.code,
    declineCode: cardErr.decline_code,
    charge: cardErr.charge,
    stripeRequestId: err.requestId,
    stripeStatusCode: err.statusCode,
  };
}

/**
 * Maps whatever the Stripe SDK threw to one of our own typed payment
 * errors. This is the ONLY place in the codebase that inspects
 * `Stripe.errors.*` — callers elsewhere never see a raw Stripe error.
 * @param err whatever was caught around a Stripe API call
 * @returns a typed PaymentDomainError appropriate to the failure
 */
function mapStripeError(err: unknown): PaymentDomainError {
  if (!(err instanceof Stripe.errors.StripeError)) {
    return new PaymentError("Non-Stripe error during a Stripe API call", {
      details: { raw: err instanceof Error ? err.message : String(err) },
    });
  }

  const details = extractStripeErrorDetails(err);

  if (err instanceof Stripe.errors.StripeCardError) {
    return new CardDeclinedError(details);
  }
  if (err instanceof Stripe.errors.StripeAuthenticationError || err instanceof Stripe.errors.StripePermissionError) {
    // Our key is invalid, revoked, or lacks permission — every payment call
    // will fail until a human fixes it. Flagged for a critical alert by the
    // caller (see sendPaymentError in routes/payments.ts).
    return new StripeConfigurationError(details);
  }
  if (
    err instanceof Stripe.errors.StripeConnectionError ||
    err instanceof Stripe.errors.StripeAPIError ||
    err instanceof Stripe.errors.StripeRateLimitError
  ) {
    return new StripeUnavailableError(details);
  }
  // StripeInvalidRequestError, StripeIdempotencyError, or anything else not
  // specifically handled above — almost always a bug in the parameters we
  // sent, not something the client did.
  return new PaymentError("Stripe rejected the request", { details });
}

/**
 * Converts a dirham amount to fils, the smallest currency unit Stripe
 * accounts in.
 * @param amount amount in dirhams (e.g. 45.5)
 * @returns the same amount in fils, rounded to the nearest whole unit
 */
export const toMinor = (amount: number): number => Math.round(amount * MINOR_UNITS_PER_MAJOR);

/**
 * Converts a fils amount (as Stripe reports it) back to dirhams.
 * @param minor amount in fils
 * @returns the same amount in dirhams
 */
export const toMajor = (minor: number): number => Math.round(minor) / MINOR_UNITS_PER_MAJOR;

/**
 * The ways a client may settle, as the booking page should offer them.
 * @returns the current pay-now / pay-later switches and refund window
 */
export const paymentChoices = () => ({
  payNow: config.payments.booking.payNowEnabled,
  payLater: config.payments.booking.payLaterEnabled,
  refundableUntilHours: config.payments.booking.refundableUntilHours,
  currency: config.payments.currency.toLowerCase(),
});

/** Everything needed to open a new Stripe Payment Intent. */
export type CreatePaymentIntentInput = {
  /** amount owed, in dirhams — always sourced from our own records */
  amountAed: number;
  /** lower-case ISO currency code, e.g. "aed" */
  currency: string;
  /** shown to the client and in the Stripe dashboard */
  description: string;
  /** free-form tags so a charge can be traced back to what it paid for */
  metadata: Record<string, string>;
  /** makes a retried request return the existing intent instead of a new one */
  idempotencyKey: string;
};

/**
 * Creates a Stripe Payment Intent for an amount already decided by the
 * caller from the database.
 * @param input the intent to create — see {@link CreatePaymentIntentInput}
 * @returns the created Stripe PaymentIntent
 * @throws {CardDeclinedError | StripeUnavailableError | StripeConfigurationError | PaymentError}
 *         never the raw Stripe SDK error
 */
export async function createPaymentIntent(input: CreatePaymentIntentInput): Promise<Stripe.PaymentIntent> {
  try {
    return await stripeAccount().paymentIntents.create(
      {
        amount: toMinor(input.amountAed),
        currency: input.currency,
        description: input.description,
        automatic_payment_methods: { enabled: true },
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey }
    );
  } catch (err) {
    throw mapStripeError(err);
  }
}

/**
 * Cancels a Payment Intent — used when our own database write for a
 * payment fails right after Stripe successfully created the intent, so the
 * intent does not sit there indefinitely with no local record of it.
 * @param paymentIntentId the Stripe PaymentIntent id to cancel
 * @throws {StripeUnavailableError | StripeConfigurationError | PaymentError}
 *         never the raw Stripe SDK error
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<void> {
  try {
    await stripeAccount().paymentIntents.cancel(paymentIntentId);
  } catch (err) {
    throw mapStripeError(err);
  }
}

/**
 * Refunds a payment intent in full.
 * @param paymentIntentId the Stripe PaymentIntent id to refund
 * @returns the created Stripe Refund
 * @throws {StripeUnavailableError | StripeConfigurationError | PaymentError}
 *         never the raw Stripe SDK error
 */
export async function createRefund(paymentIntentId: string): Promise<Stripe.Refund> {
  try {
    return await stripeAccount().refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund:${paymentIntentId}` }
    );
  } catch (err) {
    throw mapStripeError(err);
  }
}

/**
 * Verifies a raw webhook payload against Stripe's signature header and
 * returns the parsed event. MUST be called, and must succeed, before the
 * payload is trusted for any database read or write — anyone can POST to
 * the webhook route, and a valid signature is the only proof a request
 * actually came from Stripe.
 *
 * @param payload the exact raw request body Stripe sent (not re-serialised JSON)
 * @param signature the `stripe-signature` request header
 * @returns the verified Stripe event
 * @throws {WebhookNotConfiguredError} if STRIPE_WEBHOOK_SECRET is not set
 * @throws {InvalidWebhookSignatureError} if the signature does not match,
 *         or the payload is older than the allowed tolerance
 */
export function verifyWebhookSignature(payload: Buffer, signature: string): Stripe.Event {
  if (!config.payments.stripe.webhookSecret) {
    throw new WebhookNotConfiguredError("STRIPE_WEBHOOK_SECRET is not set");
  }
  try {
    return stripeAccount().webhooks.constructEvent(
      payload,
      signature,
      config.payments.stripe.webhookSecret,
      WEBHOOK_TOLERANCE_SECONDS
    );
  } catch {
    // Never rethrow the SDK's own error — it can echo back header/payload
    // fragments, which have no business reaching a log line about a request
    // that just failed to prove it came from Stripe.
    throw new InvalidWebhookSignatureError("Stripe webhook signature verification failed");
  }
}
