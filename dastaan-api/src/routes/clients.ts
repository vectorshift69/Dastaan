/* ------------------------------------------------------------------ */
/* Clients (PRD 2.2): Super Admin sees every client across branches;   */
/* Admin sees clients who have booked at their branch; Barbers get     */
/* nothing (PRD 7 — "cannot view or edit any client details").         */
/* Walk-ins recorded on bookings appear alongside registered accounts. */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, audit } from "../security.js";
import { loyaltyForClient } from "../loyalty.js";

const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(24).nullable().optional(),
});

type ClientRow = {
  id: string | null; name: string; phone: string | null;
  visits: number; lastVisit: string | null; registered: number;
};

export default async function clientRoutes(app: FastifyInstance) {
  /* -------- list / search -------- */
  app.get("/clients", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { search?: string; branchId?: string };
    const branchId = s.role === "admin" ? s.branchId : (q.branchId ?? null);
    const term = `%${(q.search ?? "").trim().toLowerCase()}%`;

    /* one row per person: registered clients keyed by user id, walk-ins by
       name+phone. Aggregated from bookings so history is always accurate. */
    const sql = `
      SELECT MIN(b.client_id) AS id,
             b.client_name AS name,
             MAX(b.client_phone) AS phone,
             COUNT(*) AS visits,
             MAX(b.starts_at) AS "lastVisit",
             (MIN(b.client_id) IS NOT NULL) AS registered
      FROM bookings b
      WHERE (?::text IS NULL OR b.branch_id = ?)
        AND (? = '%%' OR lower(b.client_name) LIKE ? OR lower(COALESCE(b.client_phone,'')) LIKE ?)
      GROUP BY b.client_name
      ORDER BY MAX(b.starts_at) DESC
      LIMIT 200`;
    const rows = await db.prepare(sql).all(branchId, branchId, term, term, term) as ClientRow[];

    return Promise.all(rows.map(async (r) => ({
      ...r,
      registered: !!r.registered,
      loyalty: r.id ? await loyaltyForClient(r.id) : null,
    })));
  });

  /* -------- one client: profile + booking history -------- */
  app.get("/clients/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };

    const user = await db.prepare(
      `SELECT id, name, phone, user_id AS "userId", created_at AS "createdAt" FROM users WHERE id = ? AND role = 'client'`
    ).get(id) as Record<string, unknown> | undefined;
    if (!user) return reply.code(404).send({ error: "Client not found" });

    const historySql = `
      SELECT b.id, b.starts_at AS "startsAt", b.minutes, b.status, b.paid, b.branch_id AS "branchId",
             u.name AS stylist, b.service_ids AS "serviceIds"
      FROM bookings b LEFT JOIN users u ON u.id = b.barber_id
      WHERE b.client_id = ? ${s.role === "admin" ? "AND b.branch_id = ?" : ""}
      ORDER BY b.starts_at DESC LIMIT 50`;
    const history = (s.role === "admin"
      ? await db.prepare(historySql).all(id, s.branchId)
      : await db.prepare(historySql).all(id)) as Record<string, unknown>[];

    return {
      ...user,
      loyalty: await loyaltyForClient(id),
      history: await Promise.all(history.map(async (h) => ({
        ...h,
        paid: !!h.paid,
        services: await Promise.all((JSON.parse(h.serviceIds as string) as string[]).map(
          async (sid) => (await db.prepare("SELECT name FROM services WHERE id = ?").get(sid) as { name: string } | undefined)?.name ?? "Service"
        )),
      }))),
    };
  });

  /* -------- edit client details (PRD 2.2: admin & super, not barbers) -------- */
  app.patch("/clients/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const existing = await db.prepare("SELECT name, phone FROM users WHERE id = ? AND role = 'client'").get(id) as
      | { name: string; phone: string | null } | undefined;
    if (!existing) return reply.code(404).send({ error: "Client not found" });

    await db.prepare("UPDATE users SET name = ?, phone = ? WHERE id = ?").run(
      parsed.data.name ?? existing.name,
      parsed.data.phone === undefined ? existing.phone : parsed.data.phone,
      id
    );
    await audit("client_updated", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    return { ok: true };
  });

  /* -------- create a walk-in client record (front desk) -------- */
  app.post("/clients", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const parsed = z.object({
      name: z.string().min(2).max(80),
      phone: z.string().max(24).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name is required" });

    const id = uid();
    // no credentials — the client can claim the account later by registering
    await db.prepare("INSERT INTO users (id, role, name, phone, created_at) VALUES (?,?,?,?,?)")
      .run(id, "client", parsed.data.name, parsed.data.phone ?? null, now());
    await audit("client_created", { actorId: s.sub, actorRole: s.role, detail: parsed.data.name, ip: req.ip });
    return reply.code(201).send({ id, name: parsed.data.name });
  });
}
