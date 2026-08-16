/* ------------------------------------------------------------------ */
/* Online store (PRD 12).                                              */
/*   Clients — browse the storefront, place orders, see own orders.    */
/*   Super Admin — everything: all orders, status transitions, sales.  */
/*   Admin/Barber — NO access to store sales data (PRD 12.1).          */
/* Payment capture is open item #5 (gateway TBD) — orders are created  */
/* as 'placed'; the gateway callback will move them to 'paid'.         */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now, nextCounter } from "../db.js";
import { requireRole, audit } from "../security.js";
import { checkCoupon, redeemCoupon } from "../coupons.js";
import { moveStock } from "./inventory.js";
import { config } from "../config.js";

const VAT_RATE = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;
const STORE_BRANCH = process.env.STORE_FULFIL_BRANCH || "b1"; // stock is drawn from here on fulfilment

const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().min(1).max(50),
  })).min(1).max(30),
  couponCode: z.string().max(30).optional(),
});

const STATUS_FLOW: Record<string, string[]> = {
  placed: ["paid", "cancelled"],
  paid: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export default async function storeRoutes(app: FastifyInstance) {
  /* -------- storefront: public browse (retail products only) -------- */
  app.get("/store/products", async () =>
    db.prepare(
      "SELECT id, name, category, price FROM products WHERE kind = 'retail' AND active = 1 ORDER BY category, name"
    ).all()
  );

  /* -------- place an order (clients) -------- */
  app.post("/store/orders", async (req, reply) => {
    const s = requireRole(req, reply, ["client"]);
    if (!s) return;
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    // price everything server-side from the catalog — client prices are never trusted
    const items: { productId: string; name: string; qty: number; price: number }[] = [];
    for (const line of parsed.data.items) {
      const p = db.prepare(
        "SELECT id, name, price FROM products WHERE id = ? AND kind = 'retail' AND active = 1"
      ).get(line.productId) as { id: string; name: string; price: number } | undefined;
      if (!p) return reply.code(400).send({ error: "A product in your cart is unavailable" });
      items.push({ productId: p.id, name: p.name, qty: line.qty, price: p.price });
    }
    const subtotal = r2(items.reduce((sum, i) => sum + i.price * i.qty, 0));

    let discount = 0;
    let couponId: string | null = null;
    const code = parsed.data.couponCode?.trim();
    if (code) {
      const check = checkCoupon(code, subtotal, "products");
      if (!check.ok) return reply.code(422).send({ error: check.reason });
      discount = check.discount;
      couponId = check.coupon.id;
    }

    const gross = r2(Math.max(0, subtotal - discount));
    const vat = r2((gross * VAT_RATE) / (1 + VAT_RATE));
    const year = new Date().getFullYear();
    const orderNo = `ORD-${year}-${String(nextCounter(`order:${year}`)).padStart(5, "0")}`;

    const id = uid();
    db.prepare(
      `INSERT INTO orders (id, order_no, client_id, items, subtotal, discount, coupon_code, vat, total, fulfil_branch_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, orderNo, s.sub, JSON.stringify(items), subtotal, discount, code ? code.toUpperCase() : null, vat, gross, STORE_BRANCH, now(), now());

    if (couponId) redeemCoupon(couponId, `order:${id}`, discount, s.sub);
    audit("order_placed", { actorId: s.sub, actorRole: s.role, detail: orderNo, ip: req.ip });

    /* Payments go/no-go: with the flag off the order is simply reserved and
       paid for in branch. With it on, the client is handed off to the
       payment service to create a Stripe Payment Intent; the order only
       becomes 'paid' when that service confirms via webhook. */
    return reply.code(201).send({
      id, orderNo, subtotal, discount, vat, total: gross, status: "placed",
      payment: config.payments.online
        ? { required: true, next: "payment_intent", currency: config.payments.currency }
        : { required: false, note: "Pay when you collect in branch." },
    });
  });

  /* -------- my orders (clients) / all orders (SUPER ADMIN ONLY) -------- */
  app.get("/store/orders", async (req, reply) => {
    const s = requireRole(req, reply, ["client", "super_admin"]); // admins & barbers never see store sales (PRD 12.1)
    if (!s) return;
    const rows = s.role === "client"
      ? db.prepare("SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC LIMIT 50").all(s.sub)
      : db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Record<string, unknown>[]).map((o) => ({
      id: o.id, orderNo: o.order_no, items: JSON.parse(o.items as string),
      subtotal: o.subtotal, discount: o.discount, couponCode: o.coupon_code,
      vat: o.vat, total: o.total, status: o.status, createdAt: o.created_at,
      ...(s.role === "super_admin" ? { clientId: o.client_id } : {}),
    }));
  });

  /* -------- order lifecycle (SUPER ADMIN ONLY) -------- */
  app.patch("/store/orders/:id/status", async (req, reply) => {
    const s = requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: z.enum(["paid", "fulfilled", "cancelled"]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid status" });

    const o = db.prepare("SELECT status, items, fulfil_branch_id FROM orders WHERE id = ?").get(id) as
      | { status: string; items: string; fulfil_branch_id: string }
      | undefined;
    if (!o) return reply.code(404).send({ error: "Order not found" });
    if (!STATUS_FLOW[o.status]?.includes(parsed.data.status))
      return reply.code(409).send({ error: `Cannot go from ${o.status} to ${parsed.data.status}` });

    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(parsed.data.status, now(), id);

    // fulfilment draws stock from the fulfilment branch, logged like any movement
    if (parsed.data.status === "fulfilled") {
      for (const item of JSON.parse(o.items) as { productId: string; qty: number }[]) {
        moveStock(item.productId, o.fulfil_branch_id, -item.qty, "online_sale", s.sub, `order ${id}`);
      }
    }
    audit("order_status_changed", { actorId: s.sub, actorRole: s.role, detail: `${id} → ${parsed.data.status}`, ip: req.ip });
    return { ok: true };
  });
}
