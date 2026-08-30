"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe";

/** Mounts Stripe Elements for one Payment Intent and collects a card (or
 *  any other method Stripe offers for it). Card details never touch this
 *  server — Elements talks to Stripe directly. */
export default function StripePaymentForm({
  clientSecret,
  amountLabel,
  onSuccess,
}: {
  clientSecret: string;
  amountLabel: string;
  onSuccess: () => void;
}) {
  return (
    <Elements
      stripe={getStripe()}
      options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#c9a227" } } }}
    >
      <PaymentFields amountLabel={amountLabel} onSuccess={onSuccess} />
    </Elements>
  );
}

function PaymentFields({ amountLabel, onSuccess }: { amountLabel: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      /* Stripe's own message is written for a cardholder to read — a
         decline, an incomplete field, an expired card. Safe to show as-is. */
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      onSuccess();
      return;
    }
    setError("Payment could not be confirmed. Please try again.");
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit}>
      <div className="rounded-2xl border border-ivory/12 bg-coal p-5">
        <PaymentElement />
      </div>

      {error && (
        <p className="animate-shake mt-4 rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="btn-gold mt-5 w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Processing…" : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}
