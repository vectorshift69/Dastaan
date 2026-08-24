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

/* ------------------------------------------------------------------ */
/* Sign in with Google.                                                */
/*                                                                     */
/* Same switch pattern as payments: with no client id configured the   */
/* feature is simply off — the routes answer 503 and the web app does  */
/* not draw the button. That is better than a button that does         */
/* nothing, which is what shipped before this was wired up.            */
/* ------------------------------------------------------------------ */
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

/* ------------------------------------------------------------------ */
/* The registered business.                                            */
/*                                                                     */
/* A UAE tax invoice is only valid if it carries the supplier's legal   */
/* name and Tax Registration Number, so the TRN is not decoration —     */
/* without it the client cannot reclaim input VAT and the salon is      */
/* non-compliant with FTA rules. It belongs on every invoice, every     */
/* receipt, and anything else that looks like a bill.                   */
/*                                                                     */
/* Taken from the VAT registration certificate, and overridable by env  */
/* so a correction never needs a code change. The TRN is printed on     */
/* every invoice by law, so it is not a secret and is safe in the repo. */
/* ------------------------------------------------------------------ */
const business = {
  legalName: process.env.BUSINESS_LEGAL_NAME ?? "DASTAAN LIFE BARBERS L.L.C",
  trn: process.env.BUSINESS_TRN ?? "104235451200003",
  /* the address on the VAT certificate, which is the one the FTA has —
     branch addresses are separate and printed alongside it */
  registeredAddress: process.env.BUSINESS_ADDRESS ?? "Zabeel 2, Dubai, UAE",
  phone: process.env.BUSINESS_PHONE ?? "+971 54 719 6833",
  /** UAE standard rate. A rate change is a config change, not a rewrite. */
  vatRate: Number(process.env.VAT_RATE ?? 0.05),
};

export const config = {
  business,
  auth: {
    google: {
      enabled: Boolean(googleClientId && googleClientSecret),
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      /** must match a redirect URI registered in the Google Cloud console */
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
    },
  },
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
  /* printed on every invoice by law, so nothing here is private */
  business: {
    legalName: business.legalName,
    trn: business.trn,
    vatRate: business.vatRate,
  },
  auth: {
    /* the web app draws the Google button only when this is true */
    google: config.auth.google.enabled,
  },
  payments: {
    enabled: config.payments.enabled,
    online: config.payments.online,
    terminal: config.payments.terminal,
    currency: config.payments.currency,
  },
});

/** Guard for any route that would move money. Mirrors await requireRole():
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
