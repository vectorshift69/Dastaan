import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireAuth, requireRole, audit } from "../security.js";
import { checkCoupon } from "../coupons.js";

const couponSchema = z.object({
  code: z.string().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/, "letters, numbers, - _ only"),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive().max(100000),
  scope: z.enum(["services", "products", "both"]).default("both"),
  minAmount: z.number().min(0).default(0),
  maxUses: z.number().int().positive().nullable().default(null),
  validFrom: z.string().nullable().default(null),
  validTo: z.string().nullable().default(null),
}).refine((c) => c.type !== "percent" || c.value <= 100, { message: "Percent value must be ≤ 100" });

const validateSchema = z.object({
  code: z.string().min(1).max(30),
  amount: z.number().min(0),
  context: z.enum(["services", "products"]),
});

export default async function couponRoutes(app: FastifyInstance) {
  /* -------- CRUD: Super Admin only (open item #2 recommendation) -------- */
  app.get("/coupons", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    return await db.prepare(
      `SELECT id, code, type, value, scope, min_amount AS "minAmount", max_uses AS "maxUses",
              uses, valid_from AS "validFrom", valid_to AS "validTo", active
       FROM coupons ORDER BY created_at DESC`
    ).all();
  });

  app.post("/coupons", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const c = parsed.data;
    const code = c.code.toUpperCase();
    if (await db.prepare("SELECT id FROM coupons WHERE code = ?").get(code))
      return reply.code(409).send({ error: "That code already exists" });
    const id = uid();
    await db.prepare(
      `INSERT INTO coupons (id, code, type, value, scope, min_amount, max_uses, valid_from, valid_to, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, code, c.type, c.value, c.scope, c.minAmount, c.maxUses, c.validFrom, c.validTo, now());
    await audit("coupon_created", { actorId: s.sub, actorRole: s.role, detail: code, ip: req.ip });
    return reply.code(201).send({ id, code });
  });

  app.patch("/coupons/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ active: z.boolean().optional(), maxUses: z.number().int().positive().nullable().optional(), validTo: z.string().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const existing = await db.prepare("SELECT * FROM coupons WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!existing) return reply.code(404).send({ error: "Coupon not found" });
    const p = parsed.data;
    await db.prepare("UPDATE coupons SET active = ?, max_uses = ?, valid_to = ? WHERE id = ?").run(
      p.active === undefined ? (existing.active as number) : p.active ? 1 : 0,
      p.maxUses === undefined ? (existing.max_uses as number | null) : p.maxUses,
      p.validTo === undefined ? (existing.valid_to as string | null) : p.validTo,
      id
    );
    await audit("coupon_updated", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  app.delete("/coupons/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const r = await db.prepare("UPDATE coupons SET active = 0 WHERE id = ?").run(id); // deactivate — redemption history stays
    if (r.changes === 0) return reply.code(404).send({ error: "Coupon not found" });
    await audit("coupon_deactivated", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  app.get("/coupons/:id/redemptions", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    return await db.prepare(
      `SELECT context, amount_saved AS "amountSaved", client_id AS "clientId", created_at AS "createdAt" FROM coupon_redemptions WHERE coupon_id = ? ORDER BY created_at DESC LIMIT 200`
    ).all(id);
  });

  /* -------- validate: any signed-in user (POS staff or store client) -------- */
  app.post("/coupons/validate", async (req, reply) => {
    /* the desk at POS, or a client in the store — nobody else */
    const s = await requireRole(req, reply, ["client", "admin", "super_admin"]);
    if (!s) return;
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const result = await checkCoupon(parsed.data.code, parsed.data.amount, parsed.data.context);
    if (!result.ok) return reply.code(422).send({ error: result.reason });
    return { code: result.coupon.code, discount: result.discount, type: result.coupon.type, value: result.coupon.value };
  });
}
