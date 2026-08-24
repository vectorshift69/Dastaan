/* ------------------------------------------------------------------ */
/* Inventory (PRD 10, permissions per PRD 2.2 + open item #3):         */
/*   Super Admin — full product CRUD, any stock adjustment, all        */
/*                 branches.                                           */
/*   Admin       — view own branch stock; "receive shipment" (positive */
/*                 additions only), each one logged.                   */
/*   Barber/Client — no access.                                        */
/* Every stock change is an immutable stock_movements row.             */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, audit } from "../security.js";

const productSchema = z.object({
  name: z.string().min(2).max(80),
  sku: z.string().max(40).optional(),
  category: z.string().min(2).max(40),
  kind: z.enum(["retail", "supply"]),
  price: z.number().min(0).max(100000).default(0),
});

const receiveSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().min(1).max(100000), // receiving is positive by definition
  note: z.string().max(200).optional(),
  branchId: z.string().optional(), // super admin may receive into any branch
});

const adjustSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1),
  delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "Delta cannot be 0"),
  note: z.string().max(200).optional(),
});

type Reason = "received" | "adjustment" | "pos_sale" | "online_sale" | "correction";

export async function moveStock(
  productId: string,
  branchId: string,
  delta: number,
  reason: Reason,
  actorId: string | null,
  note?: string
) {
  await db.prepare(
    `INSERT INTO stock_levels (product_id, branch_id, qty) VALUES (?,?,?)
     ON CONFLICT(product_id, branch_id) DO UPDATE SET qty = stock_levels.qty + excluded.qty`
  ).run(productId, branchId, delta);
  await db.prepare(
    "INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(uid(), productId, branchId, delta, reason, note ?? null, actorId, now());
}

export default async function inventoryRoutes(app: FastifyInstance) {
  /* ---------------- products (catalog) ---------------- */

  // staff can read the catalog (needed at POS); clients use /store/products
  app.get("/products", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    return await db.prepare(
      "SELECT id, name, sku, category, kind, price, active FROM products ORDER BY kind, category, name"
    ).all();
  });

  // create / update / retire: Super Admin only (PRD 2.2 "manage product listings")
  app.post("/products", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const p = parsed.data;
    if (p.sku && await db.prepare("SELECT id FROM products WHERE sku = ?").get(p.sku))
      return reply.code(409).send({ error: "SKU already exists" });
    const id = uid();
    await db.prepare(
      "INSERT INTO products (id, name, sku, category, kind, price, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, p.name, p.sku ?? null, p.category, p.kind, p.price, now());
    await audit("product_created", { actorId: s.sub, actorRole: s.role, detail: p.name, ip: req.ip });
    return reply.code(201).send({ id });
  });

  app.patch("/products/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = productSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const existing = await db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!existing) return reply.code(404).send({ error: "Product not found" });
    const p = parsed.data;
    await db.prepare(
      "UPDATE products SET name = ?, sku = ?, category = ?, kind = ?, price = ?, active = ? WHERE id = ?"
    ).run(
      p.name ?? (existing.name as string),
      p.sku !== undefined ? p.sku : (existing.sku as string | null),
      p.category ?? (existing.category as string),
      p.kind ?? (existing.kind as string),
      p.price ?? (existing.price as number),
      p.active === undefined ? (existing.active as number) : p.active ? 1 : 0,
      id
    );
    await audit("product_updated", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  // soft delete — history must survive (movements, invoices reference it)
  app.delete("/products/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const r = await db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(id);
    if (r.changes === 0) return reply.code(404).send({ error: "Product not found" });
    await audit("product_retired", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  /* ---------------- stock ---------------- */

  /* Branch stock — the retail shelf and the back bar at a location. The
     online shop's stock is not here and never has been: it is a separate
     warehouse with its own table, its own screen and its own login.
     admin → own branch; super → any (?branchId=) or all. */
  app.get("/inventory", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { branchId?: string };
    const branchId = s.role === "admin" ? s.branchId : (q.branchId ?? null);
    const base = `
      SELECT p.id AS "productId", p.name, p.sku, p.category, p.kind, p.price,
             l.branch_id AS "branchId", l.qty,
             l.reorder_at AS "reorderAt",
             (l.qty <= l.reorder_at) AS low
      FROM stock_levels l JOIN products p ON p.id = l.product_id
      WHERE p.active = 1`;
    return branchId
      ? await db.prepare(`${base} AND l.branch_id = ? ORDER BY p.kind, p.name`).all(branchId)
      : await db.prepare(`${base} ORDER BY l.branch_id, p.kind, p.name`).all();
  });

  // receive shipment: admin (own branch, positive only) or super
  app.post("/inventory/receive", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const branchId = s.role === "admin" ? s.branchId! : (parsed.data.branchId ?? s.branchId!);
    if (!await db.prepare("SELECT id FROM products WHERE id = ? AND active = 1").get(parsed.data.productId))
      return reply.code(400).send({ error: "Unknown product" });
    if (!await db.prepare("SELECT id FROM branches WHERE id = ?").get(branchId))
      return reply.code(400).send({ error: "Unknown branch" });
    await moveStock(parsed.data.productId, branchId, parsed.data.qty, "received", s.sub, parsed.data.note);
    await audit("stock_received", { actorId: s.sub, actorRole: s.role, detail: `${parsed.data.productId} +${parsed.data.qty} @ ${branchId}`, ip: req.ip });
    return { ok: true };
  });

  // free-form adjustment (corrections, wastage): Super Admin only
  app.post("/inventory/adjust", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { productId, branchId, delta, note } = parsed.data;
    if (!await db.prepare("SELECT id FROM products WHERE id = ?").get(productId))
      return reply.code(400).send({ error: "Unknown product" });
    await moveStock(productId, branchId, delta, "adjustment", s.sub, note);
    await audit("stock_adjusted", { actorId: s.sub, actorRole: s.role, detail: `${productId} ${delta > 0 ? "+" : ""}${delta} @ ${branchId}`, ip: req.ip });
    return { ok: true };
  });

  // movement history: admin own branch, super any
  app.get("/inventory/movements", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { branchId?: string; productId?: string };
    const branchId = s.role === "admin" ? s.branchId : (q.branchId ?? null);
    let sql = `
      SELECT m.id, m.product_id AS "productId", p.name, m.branch_id AS "branchId",
             m.delta, m.reason, m.note, m.created_at AS "createdAt"
      FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE 1=1`;
    const params: string[] = [];
    if (branchId) { sql += " AND m.branch_id = ?"; params.push(branchId); }
    if (q.productId) { sql += " AND m.product_id = ?"; params.push(q.productId); }
    sql += " ORDER BY m.created_at DESC LIMIT 200";
    return await db.prepare(sql).all(...params);
  });
}
