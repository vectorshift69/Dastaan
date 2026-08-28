import Stripe from "stripe";
import { config } from "./config.js";

let client: Stripe | null = null;

/** The Stripe client for the account money settles into — the salon's own. */
export function stripeAccount(): Stripe {
  if (!client) {
    client = new Stripe(config.payments.stripe.secretKey, {
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
  payNow: config.payments.booking.payNowEnabled,
  payLater: config.payments.booking.payLaterEnabled,
  refundableUntilHours: config.payments.booking.refundableUntilHours,
  currency: config.payments.currency,
});
