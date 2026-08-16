/* ------------------------------------------------------------------ */
/* Runtime feature flags.                                              */
/*                                                                     */
/* Payments are a go/no-go switch for the WHOLE application so the     */
/* platform can launch without card processing and have it turned on   */
/* later without a redeploy of business logic.                         */
/*                                                                     */
/*   PAYMENTS_ENABLED=0  → nothing charges a card anywhere. Store       */
/*                         orders are "pay in branch", POS records the  */
/*                         method the desk actually used, and every     */
/*                         payment-service route answers 503.           */
/*   PAYMENTS_ENABLED=1  → the payment service (separate deployable,    */
/*                         PCI scope isolated) is live.                 */
/*                                                                     */
/* PAYMENT_MODES picks which capture paths are on: online, terminal.   */
/* ------------------------------------------------------------------ */

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";

const modes = (process.env.PAYMENT_MODES ?? "online,terminal")
  .split(",")
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean);

export const config = {
  payments: {
    /** master go/no-go for anything that moves money */
    enabled: truthy(process.env.PAYMENTS_ENABLED),
    /** Stripe Payment Intents for store orders / deposits */
    online: truthy(process.env.PAYMENTS_ENABLED) && modes.includes("online"),
    /** Stripe Terminal card readers at the front desk */
    terminal: truthy(process.env.PAYMENTS_ENABLED) && modes.includes("terminal"),
    /** where the payment service lives (its own deployable) */
    serviceUrl: process.env.PAYMENT_SERVICE_URL ?? null,
    currency: "AED",
  },
} as const;

/** Public shape — safe to hand to the browser. No keys, no URLs. */
export const publicConfig = () => ({
  payments: {
    enabled: config.payments.enabled,
    online: config.payments.online,
    terminal: config.payments.terminal,
    currency: config.payments.currency,
  },
});

/** Guard for any route that would move money. Mirrors requireRole():
    replies 503 and returns false when payments are switched off. */
export function paymentsEnabled(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  kind: "online" | "terminal" = "online"
): boolean {
  if (config.payments.enabled && config.payments[kind]) return true;
  reply.code(503).send({
    error: "Card payments are not enabled yet — take payment at the desk.",
    paymentsEnabled: false,
  });
  return false;
}
