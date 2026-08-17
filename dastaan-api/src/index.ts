import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { migrate } from "./db.js";
import { config, publicConfig } from "./config.js";
import { originGuard } from "./security.js";
import authRoutes from "./routes/auth.js";
import bookingRoutes from "./routes/bookings.js";
import catalogRoutes from "./routes/catalog.js";
import loyaltyRoutes from "./routes/loyalty.js";
import inventoryRoutes from "./routes/inventory.js";
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

/* no stack traces or internals ever leave the server */
app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  if (err.statusCode && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  req.log.error(err);
  return reply.code(500).send({ error: "Something went wrong" });
});

app.get("/health", async () => ({ ok: true, service: "dastaan-api" }));

/* feature flags the web app reads on load (payments go/no-go) */
app.get("/config", async () => publicConfig());

await app.register(authRoutes);
await app.register(bookingRoutes);
await app.register(catalogRoutes);
await app.register(loyaltyRoutes);
await app.register(inventoryRoutes);
await app.register(reportRoutes);
await app.register(couponRoutes);
await app.register(storeRoutes);
await app.register(reviewRoutes);
await app.register(clientRoutes);
await app.register(paymentRoutes);

await startScheduler(); // delivers queued SMS (confirmations, 2h reminders, feedback)

// PRD 13: archive each day's calendar state when the date rolls over
const snapshotTimer = setInterval(snapshotIfDayRolled, 60_000);
snapshotTimer.unref();

app.log.info(
  `payments: ${config.payments.enabled ? `ENABLED (online=${config.payments.online}, terminal=${config.payments.terminal})` : "disabled — pay at the desk"}`
);

const port = Number(process.env.PORT || 4000);
await app.listen({ port, host: process.env.HOST || "127.0.0.1" });
