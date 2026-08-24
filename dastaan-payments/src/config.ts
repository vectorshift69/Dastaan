/* ------------------------------------------------------------------ */
/* Payments configuration.                                             */
/*                                                                     */
/* The salon owns the Stripe account — money settles to them, never to */
/* us. This service holds their credentials and nothing else does:     */
/* that is the whole reason it is a separate deployable.               */
/*                                                                     */
/* The credentials sit behind `stripeAccount()` rather than being read */
/* inline, so moving to Stripe Connect later (salons linking their own */
/* account instead of handing over a key) is a change in one function  */
/* rather than a change everywhere.                                    */
/* ------------------------------------------------------------------ */

import Stripe from "stripe";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required — the payments service cannot start without it`);
  return v;
};

export const config = {
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? "0.0.0.0",

  /** Shared secret the main API sends as x-service-token. Nothing else may call us. */
  serviceToken: required("PAYMENT_SERVICE_TOKEN"),

  stripe: {
    secretKey: required("STRIPE_SECRET_KEY"),
    /** Set after creating the endpoint in Stripe. Without it webhooks are refused. */
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },

  currency: (process.env.CURRENCY ?? "aed").toLowerCase(),

  /* ---- how a booking may be paid ----
     Two choices at booking time and nothing in between: settle the whole
     thing now, or pay nothing now and settle after the visit — at the desk
     or from the client's own account in the app. No part-payments, because
     a half-paid appointment is a reconciliation problem for the salon and a
     confusing screen for the client.

     PAY_LATER_ENABLED exists so the salon can insist on prepayment later
     without a code change, if no-shows become a problem. */
  booking: {
    payNowEnabled: process.env.PAY_NOW_ENABLED !== "0",
    payLaterEnabled: process.env.PAY_LATER_ENABLED !== "0",
    /** a prepaid booking cancelled this far ahead is refunded in full */
    refundableUntilHours: Number(process.env.REFUND_HOURS ?? 24),
  },
} as const;

let client: Stripe | null = null;

/**
 * The Stripe client for the account money settles into.
 *
 * Today that is the salon's own account, reached with their secret key. If
 * this ever serves more than one salon, this is where Connect goes: take a
 * salon id, look up their connected account, and return a client scoped to
 * it. Nothing above this function needs to know which it is.
 */
export function stripeAccount(): Stripe {
  if (!client) {
    client = new Stripe(config.stripe.secretKey, {
      /* a label the salon will see against every charge in their dashboard,
         so they can tell our traffic from anything else they run */
      appInfo: { name: "Dastaan", version: "0.1.0" },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return client;
}

/** Dirhams → fils. Stripe counts in the smallest unit; AED has 2 decimals. */
export const toMinor = (amount: number): number => Math.round(amount * 100);

/** fils → dirhams, for anything we show or store. */
export const toMajor = (minor: number): number => Math.round(minor) / 100;

/** The ways a client may settle, as the booking page should offer them. */
export const paymentChoices = () => ({
  payNow: config.booking.payNowEnabled,
  payLater: config.booking.payLaterEnabled,
  refundableUntilHours: config.booking.refundableUntilHours,
  currency: config.currency,
});
