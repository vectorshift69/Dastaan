import "./load-env.js"; // MUST be first — populates process.env before other modules read it
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { migrate } from "./db.js";
import { config, publicConfig } from "./config.js";
import { originGuard } from "./security.js";
import { PaymentDomainError, StripeConfigurationError } from "./payment-errors.js";
import { logCriticalPaymentAlert } from "./payment-integrity.js";
import authRoutes from "./routes/auth.js";
import googleAuthRoutes from "./routes/google-auth.js";
import bookingRoutes from "./routes/bookings.js";
import catalogRoutes from "./routes/catalog.js";
import loyaltyRoutes from "./routes/loyalty.js";
import inventoryRoutes from "./routes/inventory.js";
import onlineInventoryRoutes from "./routes/online-inventory.js";
import userRoutes from "./routes/users.js";
import reportRoutes, { snapshotIfDayRolled } from "./routes/reports.js";
import couponRoutes from "./routes/coupons.js";
import storeRoutes from "./routes/store.js";
import reviewRoutes from "./routes/reviews.js";
import clientRoutes from "./routes/clients.js";
import paymentRoutes from "./routes/payments.js";
import { startScheduler } from "./notify/service.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || "info" },
  trustProxy: process.env.TRUST_PROXY === "1",
  bodyLimit: 64 * 1024, // 64 KB is plenty for JSON APIs
});

await migrate();

await app.register(helmet); // security headers
await app.register(cookie); // httpOnly session cookie parsing
await app.register(rateLimit, {
  global: true,
  max: 200, // per IP per minute, tighter per-route limits on auth
  timeWindow: "1 minute",
});

/* CSRF defence: SameSite=Lax cookie + Origin allow-list on mutations */
app.addHook("onRequest", async (req, reply) => {
  if (!await originGuard(req, reply)) return reply;
});

/* ------------------------------------------------------------------ */
/* Centralised error handler.                                          */
/*                                                                     */
/* Every route in this app throws rather than crashes on its own — this */
/* is the single place that decides what an uncaught exception looks   */
/* like once it leaves a route handler. No stack trace, SQL error,      */
/* Stripe error, or internal field name ever reaches a response body;   */
/* the full error (with a stack trace and this request's id) is logged  */
/* server-side instead, and the request id is handed back to the       */
/* client so they can reference it in a support request.               */
/*                                                                     */
/* Payment routes (routes/payments.ts) catch and answer their own       */
/* PaymentDomainError instances directly via sendPaymentError(), with   */
/* the specific status/code that error carries — the handling for them  */
/* here is a defence-in-depth backstop in case one is ever thrown       */
/* somewhere that forgot to catch it, not the primary path.             */
/* ------------------------------------------------------------------ */
app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  const requestId = req.id;

  if (err instanceof PaymentDomainError) {
    if (err instanceof StripeConfigurationError) {
      logCriticalPaymentAlert(req.log, { action: "stripe_configuration_error", requestId, details: err.details });
    }
    req.log.error({ err, code: err.code, details: err.details, requestId, route: req.url }, "unhandled payment error");
    return reply.code(err.status).send({ error: err.clientMessage, code: err.code, requestId });
  }

  // A route elsewhere in the app deliberately threw a curated, safe,
  // short business message with its own status (e.g. "Booking not found",
  // 404) — never a stack trace or a driver error, so it is fine to pass
  // through as-is. Anything without an explicit sub-500 status falls to
  // the generic branch below.
  if (err.statusCode && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ error: err.message, requestId });
  }

  req.log.error({ err, requestId, route: req.url }, "unhandled error");
  return reply.code(500).send({ error: "Something went wrong", requestId });
});

app.get("/health", async () => ({ ok: true, service: "dastaan-api" }));

/* feature flags the web app reads on load (payments go/no-go) */
app.get("/config", async () => publicConfig());

/* Stripe webhooks need the raw body to verify the signature, so JSON
   parsing is turned off for that one route. Must match its mounted path —
   see the /payments prefix on paymentRoutes below. */
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  if (req.url?.startsWith("/payments/webhook")) return done(null, body);
  try { done(null, JSON.parse(body.toString("utf8"))); }
  catch { done(new Error("Invalid JSON"), undefined); }
});

await app.register(authRoutes);
await app.register(googleAuthRoutes);
await app.register(bookingRoutes);
await app.register(catalogRoutes);
await app.register(loyaltyRoutes);
await app.register(inventoryRoutes);
await app.register(onlineInventoryRoutes);
await app.register(userRoutes);
await app.register(reportRoutes);
await app.register(couponRoutes);
await app.register(storeRoutes);
await app.register(reviewRoutes);
await app.register(clientRoutes);
await app.register(paymentRoutes, { prefix: "/payments" });

await startScheduler(); // delivers queued SMS (confirmations, 2h reminders, feedback)

// PRD 13: archive each day's calendar state when the date rolls over
const snapshotTimer = setInterval(snapshotIfDayRolled, 60_000);
snapshotTimer.unref();

app.log.info(
  `payments: ${config.payments.enabled ? `ENABLED (online=${config.payments.online}, terminal=${config.payments.terminal})` : "disabled — pay at the desk"}`
);

const port = Number(process.env.PORT || 4000);
await app.listen({ port, host: process.env.HOST || "127.0.0.1" });
