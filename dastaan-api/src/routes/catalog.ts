import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, hmacCode, audit } from "../security.js";

const staffSchema = z.object({
  name: z.string().min(2).max(80),
  role: z.enum(["admin", "barber"]),
  branchId: z.string().min(1),
  title: z.string().max(60).optional(),
  code: z.string().regex(/^\d{4}$/, "4 digits"),
});

const resetCodeSchema = z.object({ code: z.string().regex(/^\d{4}$/, "4 digits") });

export default async function catalogRoutes(app: FastifyInstance) {
  /* -------- public catalog -------- */
  app.get("/branches", async () =>
    await db.prepare("SELECT id, name, area, address, hours, phone FROM branches").all()
  );

  app.get("/services", async () =>
    await db.prepare("SELECT id, name, minutes, price, category FROM services WHERE active = 1").all()
  );

  app.get("/barbers", async (req) => {
    const q = req.query as { branchId?: string };
    const rows = q.branchId
      ? await db.prepare(
          `SELECT id, name, title, branch_id AS "branchId" FROM users WHERE role = 'barber' AND active = 1 AND branch_id = ?`
        ).all(q.branchId)
      : await db.prepare(
          `SELECT id, name, title, branch_id AS "branchId" FROM users WHERE role = 'barber' AND active = 1`
        ).all();
    return rows;
  });

  /* -------- staff management -------- */
  // list staff: super admin sees all; admin sees own-branch barbers
  app.get("/staff", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const rows =
      s.role === "super_admin"
        ? await db.prepare(
            `SELECT id, name, role, title, branch_id AS "branchId", active FROM users WHERE role != 'client'`
          ).all()
        : await db.prepare(
            `SELECT id, name, role, title, branch_id AS "branchId", active FROM users WHERE role = 'barber' AND branch_id = ?`
          ).all(s.branchId);
    return rows; // note: code hashes are never selected, let alone returned
  });

  // create staff: super admin → admin or barber anywhere; admin → barber in own branch (PRD 2.2)
  app.post("/staff", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const body = parsed.data;

    if (s.role === "admin" && (body.role !== "barber" || body.branchId !== s.branchId))
      return reply.code(403).send({ error: "Admins can only add barbers to their own branch" });

    const branch = await db.prepare("SELECT id FROM branches WHERE id = ?").get(body.branchId);
    if (!branch) return reply.code(400).send({ error: "Unknown branch" });

    const h = hmacCode(body.code);
    if (await db.prepare("SELECT id FROM users WHERE code_hmac = ?").get(h))
      return reply.code(409).send({ error: "That code is unavailable — pick another" });

    const id = uid();
    await db.prepare(
      "INSERT INTO users (id, role, name, title, branch_id, code_hmac, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, body.role, body.name, body.title ?? null, body.branchId, h, now());
    await audit("staff_created", { actorId: s.sub, actorRole: s.role, detail: `${body.role}:${body.name}`, ip: req.ip });
    return reply.code(201).send({ id, name: body.name, role: body.role });
  });

  // reset any staff member's code: super admin only (PRD 2.2 / 14)
  app.post("/staff/:id/reset-code", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = resetCodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Code must be 4 digits" });

    const target = await db.prepare("SELECT id, role FROM users WHERE id = ? AND role != 'client'").get(id);
    if (!target) return reply.code(404).send({ error: "Staff member not found" });

    const h = hmacCode(parsed.data.code);
    if (await db.prepare("SELECT id FROM users WHERE code_hmac = ? AND id != ?").get(h, id))
      return reply.code(409).send({ error: "That code is unavailable — pick another" });

    await db.prepare("UPDATE users SET code_hmac = ? WHERE id = ?").run(h, id);
    await audit("staff_code_reset", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  /* -------- audit trail (super admin only) -------- */
  app.get("/audit", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    return await db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200").all();
  });
}
