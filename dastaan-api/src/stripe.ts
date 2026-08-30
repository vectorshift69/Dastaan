/* ------------------------------------------------------------------ */
/* Stripe boundary.                                                     */
/*                                                                     */
/* The ONLY module in this codebase that touches a Stripe credential —  */
/* the secret API key or the webhook signing secret. Nothing outside    */
/* this file imports the `stripe` package, reads `config.payments.stripe`,*/
/* or calls the Stripe client directly. Routes ask for what they need   */
/* (create an intent, verify a webhook, issue a refund) through the     */
/* functions below, and get back plain data or a typed error — never    */
/* the client itself.                                                   */
/*                                                                     */
/* The salon owns the Stripe account — money settles to them, never to  */
/* us. That is also why the credentials sit behind `stripeAccount()`     */
/* rather than being read inline: moving to Stripe Connect later        */
/* (salons linking their own account instead of handing over a key) is  */
/* a change in one function rather than a change everywhere.            */
/* ------------------------------------------------------------------ */

import Stripe from "stripe";
import { config } from "./config.js";

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

/** Thrown by {@link verifyWebhookSignature} when STRIPE_WEBHOOK_SECRET is unset. */
export class WebhookNotConfiguredError extends Error {}

/** Thrown by {@link verifyWebhookSignature} when the signature does not match. */
export class InvalidWebhookSignatureError extends Error {}

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
 * @throws {Error} if STRIPE_SECRET_KEY is not configured
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
 * @throws whatever the Stripe SDK throws on a failed API call — callers are
 *         expected to catch this and never forward the raw error to a client
 */
export async function createPaymentIntent(input: CreatePaymentIntentInput): Promise<Stripe.PaymentIntent> {
  return stripeAccount().paymentIntents.create(
    {
      amount: toMinor(input.amountAed),
      currency: input.currency,
      description: input.description,
      automatic_payment_methods: { enabled: true },
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey }
  );
}

/**
 * Refunds a payment intent in full.
 * @param paymentIntentId the Stripe PaymentIntent id to refund
 * @returns the created Stripe Refund
 * @throws whatever the Stripe SDK throws on a failed API call — callers are
 *         expected to catch this and never forward the raw error to a client
 */
export async function createRefund(paymentIntentId: string): Promise<Stripe.Refund> {
  return stripeAccount().refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund:${paymentIntentId}` }
  );
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
