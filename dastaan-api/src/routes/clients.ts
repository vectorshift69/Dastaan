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

/** Turn stored service id lists into readable names, for a history list. */
async function withServiceNames(rows: Record<string, unknown>[]) {
  return Promise.all(rows.map(async (h) => ({
    ...h,
    paid: !!h.paid,
    services: await Promise.all((JSON.parse(h.serviceIds as string) as string[]).map(
      async (sid) =>
        (await db.prepare("SELECT name FROM services WHERE id = ?").get(sid) as { name: string } | undefined)?.name ?? "Service"
    )),
  })));
}

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
      /* Every row needs something to open the detail panel with. Registered
         clients have an account id; walk-ins only exist as a name on their
         bookings, so they are keyed by that name. Without this the front desk
         could not click a walk-in at all — and most of the book is walk-ins. */
      key: r.id ?? `name:${encodeURIComponent(r.name)}`,
      registered: !!r.registered,
      loyalty: r.id ? await loyaltyForClient(r.id) : null,
    })));
  });

  /* -------- one client: profile + booking history --------
     `id` is either an account id or `name:<walk-in name>`. Walk-ins have no
     account, so their profile is assembled from their bookings.            */
  app.get("/clients/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };

    if (id.startsWith("name:")) {
      const name = decodeURIComponent(id.slice(5));
      const scoped = s.role === "admin" ? "AND b.branch_id = ?" : "";
      const rows = (s.role === "admin"
        ? await db.prepare(
            `SELECT b.id, b.starts_at AS "startsAt", b.minutes, b.status, b.paid, b.branch_id AS "branchId",
                    b.client_phone AS "clientPhone", u.name AS barber, b.service_ids AS "serviceIds"
             FROM bookings b LEFT JOIN users u ON u.id = b.barber_id
             WHERE b.client_name = ? AND b.client_id IS NULL ${scoped}
             ORDER BY b.starts_at DESC LIMIT 50`
          ).all(name, s.branchId)
        : await db.prepare(
            `SELECT b.id, b.starts_at AS "startsAt", b.minutes, b.status, b.paid, b.branch_id AS "branchId",
                    b.client_phone AS "clientPhone", u.name AS barber, b.service_ids AS "serviceIds"
             FROM bookings b LEFT JOIN users u ON u.id = b.barber_id
             WHERE b.client_name = ? AND b.client_id IS NULL
             ORDER BY b.starts_at DESC LIMIT 50`
          ).all(name)) as Record<string, unknown>[];

      if (rows.length === 0) return reply.code(404).send({ error: "Client not found" });

      return {
        id,
        name,
        phone: (rows.find((r) => r.clientPhone)?.clientPhone as string | null) ?? null,
        userId: null,
        registered: false,
        loyalty: null,
        history: await withServiceNames(rows),
      };
    }

    const user = await db.prepare(
      `SELECT id, name, phone, user_id AS "userId", created_at AS "createdAt" FROM users WHERE id = ? AND role = 'client'`
    ).get(id) as Record<string, unknown> | undefined;
    if (!user) return reply.code(404).send({ error: "Client not found" });

    const historySql = `
      SELECT b.id, b.starts_at AS "startsAt", b.minutes, b.status, b.paid, b.branch_id AS "branchId",
             u.name AS barber, b.service_ids AS "serviceIds"
      FROM bookings b LEFT JOIN users u ON u.id = b.barber_id
      WHERE b.client_id = ? ${s.role === "admin" ? "AND b.branch_id = ?" : ""}
      ORDER BY b.starts_at DESC LIMIT 50`;
    const history = (s.role === "admin"
      ? await db.prepare(historySql).all(id, s.branchId)
      : await db.prepare(historySql).all(id)) as Record<string, unknown>[];

    return {
      ...user,
      registered: true,
      loyalty: await loyaltyForClient(id),
      history: await withServiceNames(history),
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

  /* -------- turn a walk-in into a client record, keeping their history ----
     The front desk sees a regular who has never registered; one press files
     them properly and back-links every past visit, so their loyalty starts
     from what they have already spent rather than zero. */
  app.post("/clients/register-walkin", async (req, reply) => {
    const st = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!st) return;
    const parsed = z.object({
      name: z.string().min(2).max(80),
      phone: z.string().max(24).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name is required" });
    const { name, phone } = parsed.data;

    const existing = await db.prepare(
      "SELECT id FROM bookings WHERE client_name = ? AND client_id IS NULL LIMIT 1"
    ).get(name);
    if (!existing) return reply.code(404).send({ error: "No walk-in visits found under that name" });

    const id = uid();
    await db.prepare("INSERT INTO users (id, role, name, phone, created_at) VALUES (?,?,?,?,?)")
      .run(id, "client", name, phone ?? null, now());
    const linked = await db.prepare(
      "UPDATE bookings SET client_id = ? WHERE client_name = ? AND client_id IS NULL"
    ).run(id, name);

    await audit("walkin_registered", { actorId: st.sub, actorRole: st.role, detail: `${name} → ${id}`, ip: req.ip });
    return reply.code(201).send({ id, name, linkedVisits: linked.changes });
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
