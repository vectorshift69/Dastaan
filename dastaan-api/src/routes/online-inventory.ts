/* ------------------------------------------------------------------ */
/* The online shop's stock.                                            */
/*                                                                     */
/* One warehouse for the whole of the UAE. Everything bought on the    */
/* website is delivered from it, so it has no branch against it — the  */
/* question "which branch does this jar belong to?" has no answer and  */
/* does not need one.                                                  */
/*                                                                     */
/* This is deliberately not the branch inventory in inventory.ts:      */
/*                                                                     */
/*   · different stock    — a bottle here is not on any shelf          */
/*   · different people   — run by whoever runs the shop, not the desk */
/*   · different login    — an id and password, not a keypad code      */
/*                                                                     */
/* So a barber using the last bottle of oil at Marina Walk cannot make */
/* the website sell out, and a busy week online cannot leave the chair */
/* short.                                                              */
/*                                                                     */
/* Reservations                                                        */
/* ------------                                                        */
/* An order holds stock the moment it is placed, not days later when   */
/* someone marks it shipped — otherwise the shop sells what it does    */
/* not have and finds out when it tries to pack the box.               */
/*                                                                     */
/*   available = qty - reserved                                        */
/*                                                                     */
/*   reserve → order placed                                            */
/*   release → order cancelled, stock goes back on sale                */
/*   consume → order shipped: the hold becomes a real movement out      */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, audit } from "../security.js";

export type Line = { productId: string; qty: number };

/** Who may touch the warehouse: the person who runs the shop, and the owner. */
const SHOP_ROLES = ["shop_manager", "super_admin"] as const;

async function record(
  productId: string,
  delta: number,
  reason: "received" | "adjustment" | "online_sale" | "correction" | "returned",
  actorId: string | null,
  note?: string
) {
  await db.prepare(
    "INSERT INTO online_stock_movements (id, product_id, delta, reason, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uid(), productId, delta, reason, note ?? null, actorId, now());
}

/** Add to or take from the warehouse, with a line in the ledger for it. */
export async function moveOnlineStock(
  productId: string,
  delta: number,
  reason: "received" | "adjustment" | "correction" | "returned",
  actorId: string | null,
  note?: string
) {
  await db.prepare(
    `INSERT INTO online_stock (product_id, qty, updated_at) VALUES (?,?,?)
     ON CONFLICT(product_id) DO UPDATE SET qty = online_stock.qty + excluded.qty, updated_at = excluded.updated_at`
  ).run(productId, delta, now());
  await record(productId, delta, reason, actorId, note);
}

/**
 * Hold stock for an order. All lines or none.
 *
 * The UPDATE ... WHERE qty - reserved >= n is the part that matters: the
 * check and the write are one statement, so two clients ordering the last
 * item at the same moment cannot both succeed.
 */
export async function reserveOnline(
  lines: Line[]
): Promise<{ ok: true } | { ok: false; productId: string; available: number }> {
  const held: Line[] = [];
  for (const line of lines) {
    const res = await db.prepare(
      `UPDATE online_stock SET reserved = reserved + ?
       WHERE product_id = ? AND qty - reserved >= ?`
    ).run(line.qty, line.productId, line.qty);

    if (res.changes === 0) {
      /* not enough — undo whatever we already held so the order fails clean */
      for (const h of held) {
        await db.prepare(
          "UPDATE online_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id = ?"
        ).run(h.qty, h.productId);
      }
      const row = await db.prepare(
        "SELECT qty - reserved AS available FROM online_stock WHERE product_id = ?"
      ).get(line.productId) as { available: number } | undefined;
      return { ok: false, productId: line.productId, available: Math.max(0, Number(row?.available ?? 0)) };
    }
    held.push(line);
  }
  return { ok: true };
}

/** Put held stock back on sale — a cancelled order. */
export async function releaseOnline(lines: Line[]) {
  for (const line of lines) {
    await db.prepare(
      "UPDATE online_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id = ?"
    ).run(line.qty, line.productId);
  }
}

/** The parcel has gone out: the hold becomes a real movement out of stock. */
export async function consumeOnline(lines: Line[], actorId: string | null, note: string) {
  for (const line of lines) {
    await db.prepare(
      `UPDATE online_stock SET qty = qty - ?, reserved = GREATEST(0, reserved - ?), updated_at = ?
       WHERE product_id = ?`
    ).run(line.qty, line.qty, now(), line.productId);
    await record(line.productId, -line.qty, "online_sale", actorId, note);
  }
}

/** What the storefront may sell right now. */
export async function onlineAvailability(): Promise<Record<string, number>> {
  const rows = await db.prepare(
    "SELECT product_id AS id, GREATEST(0, qty - reserved) AS available FROM online_stock"
  ).all() as { id: string; available: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.available)]));
}

/* ------------------------------------------------------------------ */

const receiveSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().min(1).max(100000), // receiving is positive by definition
  note: z.string().max(200).optional(),
});

const adjustSchema = z.object({
  productId: z.string().min(1),
  delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "Enter a non-zero change"),
  reason: z.enum(["adjustment", "correction", "returned"]).default("adjustment"),
  note: z.string().max(200).optional(),
});

const reorderSchema = z.object({
  productId: z.string().min(1),
  reorderAt: z.number().int().min(0).max(10000),
});

export default async function onlineInventoryRoutes(app: FastifyInstance) {
  /* Everything the shop sells, with what is free to sell and what is
     already promised to an order. Products with no warehouse row yet show
     as zero rather than going missing — the shop manager needs to see a
     product exists before they can receive any of it. */
  app.get("/online/inventory", async (req, reply) => {
    const s = await requireRole(req, reply, [...SHOP_ROLES]);
    if (!s) return;
    return await db.prepare(
      `SELECT p.id AS "productId", p.name, p.sku, p.category, p.price,
              COALESCE(o.qty, 0)                              AS qty,
              COALESCE(o.reserved, 0)                         AS reserved,
              GREATEST(0, COALESCE(o.qty, 0) - COALESCE(o.reserved, 0)) AS available,
              COALESCE(o.reorder_at, 5)                       AS "reorderAt",
              (COALESCE(o.qty, 0) <= COALESCE(o.reorder_at, 5)) AS low,
              o.updated_at AS "updatedAt"
       FROM products p LEFT JOIN online_stock o ON o.product_id = p.id
       WHERE p.active = 1 AND p.kind = 'retail'
       ORDER BY p.category, p.name`
    ).all();
  });

  /* A delivery into the warehouse. */
  app.post("/online/inventory/receive", async (req, reply) => {
    const s = await requireRole(req, reply, [...SHOP_ROLES]);
    if (!s) return;
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { productId, qty, note } = parsed.data;
    if (!await db.prepare("SELECT id FROM products WHERE id = ? AND kind = 'retail' AND active = 1").get(productId))
      return reply.code(400).send({ error: "Unknown product" });
    await moveOnlineStock(productId, qty, "received", s.sub, note);
    await audit("online_stock_received", { actorId: s.sub, actorRole: s.role, detail: `${productId} +${qty}`, ip: req.ip });
    return { ok: true };
  });

  /* Counts, breakages, customer returns. Stock already promised to an order
     cannot be written off from under it — cancel the order first. */
  app.post("/online/inventory/adjust", async (req, reply) => {
    const s = await requireRole(req, reply, [...SHOP_ROLES]);
    if (!s) return;
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { productId, delta, reason, note } = parsed.data;
    const row = await db.prepare(
      "SELECT qty, reserved FROM online_stock WHERE product_id = ?"
    ).get(productId) as { qty: number; reserved: number } | undefined;

    if (delta < 0) {
      const free = Math.max(0, Number(row?.qty ?? 0) - Number(row?.reserved ?? 0));
      if (free < -delta)
        return reply.code(409).send({
          error: free === 0
            ? "There is none of that free to take out — the rest is held for orders"
            : `Only ${free} is free to take out — the rest is held for orders`,
        });
    }
    await moveOnlineStock(productId, delta, reason, s.sub, note);
    await audit("online_stock_adjusted", { actorId: s.sub, actorRole: s.role, detail: `${productId} ${delta > 0 ? "+" : ""}${delta}`, ip: req.ip });
    return { ok: true };
  });

  /* When to warn that a line is running out. */
  app.post("/online/inventory/reorder-level", async (req, reply) => {
    const s = await requireRole(req, reply, [...SHOP_ROLES]);
    if (!s) return;
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    await db.prepare(
      `INSERT INTO online_stock (product_id, qty, reorder_at, updated_at) VALUES (?,0,?,?)
       ON CONFLICT(product_id) DO UPDATE SET reorder_at = excluded.reorder_at`
    ).run(parsed.data.productId, parsed.data.reorderAt, now());
    return { ok: true };
  });

  /* The warehouse ledger — every change, newest first. */
  app.get("/online/inventory/movements", async (req, reply) => {
    const s = await requireRole(req, reply, [...SHOP_ROLES]);
    if (!s) return;
    const q = req.query as { productId?: string };
    let sql = `
      SELECT m.id, m.product_id AS "productId", p.name, m.delta, m.reason, m.note,
             m.created_at AS "createdAt", u.name AS "actor"
      FROM online_stock_movements m
      JOIN products p ON p.id = m.product_id
      LEFT JOIN users u ON u.id = m.actor_id
      WHERE 1=1`;
    const params: string[] = [];
    if (q.productId) { sql += " AND m.product_id = ?"; params.push(q.productId); }
    sql += " ORDER BY m.created_at DESC LIMIT 200";
    return await db.prepare(sql).all(...params);
  });
}
