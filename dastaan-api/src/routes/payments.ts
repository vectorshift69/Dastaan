/* ------------------------------------------------------------------ */
/* Payments boundary.                                                  */
/*                                                                     */
/* The money-moving code lives in a SEPARATE service (dastaan-payments) */
/* so Stripe keys and PCI scope never sit inside the main API. These    */
/* routes are only the boundary: they check the go/no-go flag, verify   */
/* who is asking, and proxy to that service.                           */
/*                                                                     */
/* With PAYMENTS_ENABLED=0 every route here answers 503 and the rest of */
/* the platform keeps working with cash / the desk's existing machine.  */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole, audit } from "../security.js";
import { config, paymentsEnabled } from "../config.js";

const intentSchema = z.object({
  orderId: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
}).refine((v) => !!v.orderId !== !!v.bookingId, "Provide exactly one of orderId or bookingId");

const terminalSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().min(0.5).max(100000),
  readerId: z.string().min(1).optional(),
});

class ServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function callPaymentService(path: string, body: unknown) {
  if (!config.payments.serviceUrl) {
    throw new ServiceError("Payment service is not configured yet", 503);
  }
  const res = await fetch(`${config.payments.serviceUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // service-to-service auth; the payment service rejects anything else
      "x-service-token": process.env.PAYMENT_SERVICE_TOKEN ?? "",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ServiceError((data as { error?: string }).error ?? "Payment failed", res.status);
  return data;
}

/** Never let a payment-service failure surface as a 500 with no context. */
function replyServiceError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  const e = err instanceof ServiceError ? err : new ServiceError("Payment failed", 502);
  reply.code(e.status).send({ error: e.message });
}

export default async function paymentRoutes(app: FastifyInstance) {
  /* -------- online: create a Payment Intent for a store order -------- */
  app.post("/payments/intent", async (req, reply) => {
    const s = requireAuth(req, reply);
    if (!s) return;
    if (!paymentsEnabled(reply, "online")) return;

    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    if (parsed.data.orderId) {
      const o = db.prepare("SELECT id, client_id, total, status FROM orders WHERE id = ?").get(parsed.data.orderId) as
        | { id: string; client_id: string; total: number; status: string } | undefined;
      if (!o) return reply.code(404).send({ error: "Order not found" });
      if (s.role === "client" && o.client_id !== s.sub) return reply.code(403).send({ error: "Not allowed" });
      if (o.status !== "placed") return reply.code(409).send({ error: `Order is already ${o.status}` });

      try {
        const result = await callPaymentService("/intents", {
          reference: `order:${o.id}`,
          amount: Math.round(o.total * 100), // minor units
          currency: config.payments.currency,
        });
        audit("payment_intent_created", { actorId: s.sub, actorRole: s.role, detail: `order:${o.id}`, ip: req.ip });
        return result;
      } catch (err) {
        return replyServiceError(reply, err);
      }
    }

    return reply.code(400).send({ error: "Booking deposits are not enabled yet" });
  });

  /* -------- terminal: charge a card reader at the front desk -------- */
  app.post("/payments/terminal", async (req, reply) => {
    const s = requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    if (!paymentsEnabled(reply, "terminal")) return;

    const parsed = terminalSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const b = db.prepare("SELECT id, branch_id FROM bookings WHERE id = ?").get(parsed.data.bookingId) as
      | { id: string; branch_id: string } | undefined;
    if (!b) return reply.code(404).send({ error: "Booking not found" });
    if (s.role === "admin" && b.branch_id !== s.branchId) return reply.code(403).send({ error: "Wrong branch" });

    try {
      const result = await callPaymentService("/terminal/charge", {
        reference: `booking:${b.id}`,
        amount: Math.round(parsed.data.amount * 100),
        currency: config.payments.currency,
        branchId: b.branch_id,
        readerId: parsed.data.readerId,
      });
      audit("terminal_charge_started", { actorId: s.sub, actorRole: s.role, detail: `booking:${b.id}`, ip: req.ip });
      return result;
    } catch (err) {
      return replyServiceError(reply, err);
    }
  });

  /* -------- readers available at a branch (for the POS picker) -------- */
  app.get("/payments/readers", async (req, reply) => {
    const s = requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    if (!paymentsEnabled(reply, "terminal")) return;
    const branchId = s.role === "admin" ? s.branchId : (req.query as { branchId?: string }).branchId;
    try {
      return await callPaymentService("/terminal/readers", { branchId });
    } catch (err) {
      return replyServiceError(reply, err);
    }
  });
}
