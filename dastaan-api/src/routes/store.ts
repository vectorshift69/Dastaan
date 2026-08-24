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
import { reserveOnline, releaseOnline, consumeOnline, type Line } from "./online-inventory.js";
import { config } from "../config.js";

const VAT_RATE = config.business.vatRate;
const r2 = (n: number) => Math.round(n * 100) / 100;

/* Everything bought online is delivered. There is no collect-from-branch:
   the branches keep their stock for the chair and the walk-in shelf, and the
   shop ships from its own warehouse. One address, one journey, no chance of
   a client arriving for something a barber has already used. */
const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().min(1).max(50),
  })).min(1).max(30),
  couponCode: z.string().max(30).optional(),
  address: z.string({ error: "A delivery address is required" })
    .min(10, "That address is too short — include the building and area")
    .max(400),
});

const STATUS_FLOW: Record<string, string[]> = {
  placed: ["paid", "cancelled"],
  paid: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

/* A store order is always paid in full — there is no pay-later for goods.
   An appointment is a promise of time and can be settled afterwards; a jar
   of pomade walking out of the door cannot. */
const STORE_REQUIRES_FULL_PAYMENT = true;

export default async function storeRoutes(app: FastifyInstance) {
  /* -------- storefront: public browse (retail products only) -------- */
  app.get("/store/products", async () => {
    /* One stock figure for the whole country, because there is one warehouse
       and everything ships from it. Never the branch shelves: those belong to
       the chair, and the website cannot see or sell them. */
    return await db.prepare(
      `SELECT p.id, p.name, p.category, p.price,
              GREATEST(0, COALESCE(o.qty, 0) - COALESCE(o.reserved, 0)) AS available
       FROM products p LEFT JOIN online_stock o ON o.product_id = p.id
       WHERE p.kind = 'retail' AND p.active = 1
       ORDER BY p.category, p.name`
    ).all();
  });

  /* -------- place an order (clients) -------- */
  app.post("/store/orders", async (req, reply) => {
    const s = await requireRole(req, reply, ["client"]);
    if (!s) return;
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    // price everything server-side from the catalog — client prices are never trusted
    const items: { productId: string; name: string; qty: number; price: number }[] = [];
    for (const line of parsed.data.items) {
      const p = await db.prepare(
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
      const check = await checkCoupon(code, subtotal, "products");
      if (!check.ok) return reply.code(422).send({ error: check.reason });
      discount = check.discount;
      couponId = check.coupon.id;
    }

    const gross = r2(Math.max(0, subtotal - discount));
    const vat = r2((gross * VAT_RATE) / (1 + VAT_RATE));
    const year = new Date().getFullYear();

    const body = parsed.data;
    const lines: Line[] = items.map((i) => ({ productId: i.productId, qty: i.qty }));

    const id = uid();
    const orderNo = `ORD-${year}-${String(await nextCounter(`order:${year}`)).padStart(5, "0")}`;

    /* Reserve first, write the order second, and do both or neither. A
       reservation without an order would quietly lose stock; an order
       without a reservation would oversell. */
    try {
      await db.transaction(async () => {
        const held = await reserveOnline(lines);
        if (!held.ok) {
          const name = items.find((i) => i.productId === held.productId)?.name ?? "An item";
          throw Object.assign(
            new Error(
              held.available === 0
                ? `${name} has just sold out`
                : `Only ${held.available} of ${name} left in stock`
            ),
            { statusCode: 409 }
          );
        }

        await db.prepare(
          `INSERT INTO orders (id, order_no, client_id, items, subtotal, discount, coupon_code, vat, total,
             address, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(id, orderNo, s.sub, JSON.stringify(items), subtotal, discount,
          code ? code.toUpperCase() : null, vat, gross, body.address, now(), now());

        if (couponId) await redeemCoupon(couponId, `order:${id}`, discount, s.sub);
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "Could not place that order" });
    }

    await audit("order_placed", { actorId: s.sub, actorRole: s.role, detail: orderNo, ip: req.ip });

    /* Goods are always paid for in full — see STORE_REQUIRES_FULL_PAYMENT.
       With card payments off, that means paying at the counter. */
    return reply.code(201).send({
      id, orderNo, subtotal, discount, vat, total: gross, status: "placed",
      address: body.address,
      payment: config.payments.online
        ? { required: STORE_REQUIRES_FULL_PAYMENT, next: "payment_intent", currency: config.payments.currency }
        : { required: false, note: "Pay on delivery." },
    });
  });

  /* -------- my orders (clients) / all orders (SUPER ADMIN ONLY) -------- */
  app.get("/store/orders", async (req, reply) => {
    const s = await requireRole(req, reply, ["client", "super_admin"]); // admins & barbers never see store sales (PRD 12.1)
    if (!s) return;
    const rows = s.role === "client"
      ? await db.prepare("SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC LIMIT 50").all(s.sub)
      : await db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Record<string, unknown>[]).map((o) => ({
      id: o.id, orderNo: o.order_no, items: JSON.parse(o.items as string),
      subtotal: o.subtotal, discount: o.discount, couponCode: o.coupon_code,
      vat: o.vat, total: o.total, status: o.status, createdAt: o.created_at,
      address: o.address,
      ...(s.role === "super_admin" ? { clientId: o.client_id } : {}),
    }));
  });

  /* -------- order lifecycle (SUPER ADMIN ONLY) -------- */
  app.patch("/store/orders/:id/status", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: z.enum(["paid", "fulfilled", "cancelled"]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid status" });

    const o = await db.prepare(
      "SELECT status, items, order_no FROM orders WHERE id = ?"
    ).get(id) as { status: string; items: string; order_no: string } | undefined;
    if (!o) return reply.code(404).send({ error: "Order not found" });
    if (!STATUS_FLOW[o.status]?.includes(parsed.data.status))
      return reply.code(409).send({ error: `Cannot go from ${o.status} to ${parsed.data.status}` });

    const lines = (JSON.parse(o.items) as { productId: string; qty: number }[])
      .map((i) => ({ productId: i.productId, qty: i.qty }));

    await db.transaction(async () => {
      await db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
        .run(parsed.data.status, now(), id);

      /* Shipping the parcel turns the hold into a real movement out of the
         warehouse, and writes it to the ledger like any other sale. */
      if (parsed.data.status === "fulfilled") {
        await consumeOnline(lines, s.sub, `order ${o.order_no}`);
      }
      /* Cancelling puts it back on sale. Without this, a cancelled order
         would hold stock hostage forever. */
      if (parsed.data.status === "cancelled") {
        await releaseOnline(lines);
      }
    });
    await audit("order_status_changed", { actorId: s.sub, actorRole: s.role, detail: `${id} → ${parsed.data.status}`, ip: req.ip });
    return { ok: true };
  });
}
