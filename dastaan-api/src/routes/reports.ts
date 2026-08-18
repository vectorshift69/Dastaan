/* ------------------------------------------------------------------ */
/* Reports & timeline history.                                         */
/*   Sales reports        — Super Admin ONLY (PRD 2.2, 12.1).          */
/*   Personal analytics   — each barber, self only (PRD 7).            */
/*   Timeline history     — daily calendar state archived so the past  */
/*                          stays queryable (PRD 13).                  */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { db, uid, now } from "../db.js";
import { requireRole, audit } from "../security.js";
import { salonToday } from "../time.js";
import { barberRating } from "./reviews.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/* salon time: on Render (UTC) a plain toISOString() rolls the day over at
   04:00 Dubai, so "today" would go blank while the salon was still open */
const today = () => salonToday();

type InvRow = {
  gross: number; tip: number; vat: number; total: number; discount: number;
  payment_method: string; items: string; created_at: string; branch_id: string;
};

export default async function reportRoutes(app: FastifyInstance) {
  /* ---------------- sales summary: SUPER ADMIN ONLY ---------------- */
  app.get("/reports/sales", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const q = req.query as { from?: string; to?: string; branchId?: string };
    const from = q.from && DATE_RE.test(q.from) ? q.from : today();
    const to = q.to && DATE_RE.test(q.to) ? q.to : today();

    const rows = (q.branchId
      ? await db.prepare(
          "SELECT gross, tip, vat, total, discount, payment_method, items, created_at, branch_id FROM invoices WHERE branch_id = ? AND created_at BETWEEN ? AND ?"
        ).all(q.branchId, `${from}T00:00:00`, `${to}T23:59:59.999Z`)
      : await db.prepare(
          "SELECT gross, tip, vat, total, discount, payment_method, items, created_at, branch_id FROM invoices WHERE created_at BETWEEN ? AND ?"
        ).all(`${from}T00:00:00`, `${to}T23:59:59.999Z`)) as InvRow[];

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const totals = { invoices: rows.length, revenue: 0, tips: 0, vat: 0, discounts: 0 };
    const byDay = new Map<string, { revenue: number; count: number }>();
    const byMethod = new Map<string, { revenue: number; count: number }>();
    const byService = new Map<string, { count: number; revenue: number }>();
    const byBranch = new Map<string, { revenue: number; count: number }>();

    for (const inv of rows) {
      totals.revenue += inv.total;
      totals.tips += inv.tip;
      totals.vat += inv.vat;
      totals.discounts += inv.discount;
      const day = inv.created_at.slice(0, 10);
      const d = byDay.get(day) ?? { revenue: 0, count: 0 };
      d.revenue += inv.total; d.count++; byDay.set(day, d);
      const m = byMethod.get(inv.payment_method) ?? { revenue: 0, count: 0 };
      m.revenue += inv.total; m.count++; byMethod.set(inv.payment_method, m);
      const b = byBranch.get(inv.branch_id) ?? { revenue: 0, count: 0 };
      b.revenue += inv.total; b.count++; byBranch.set(inv.branch_id, b);
      for (const item of JSON.parse(inv.items) as { name: string; price: number }[]) {
        const sv = byService.get(item.name) ?? { count: 0, revenue: 0 };
        sv.count++; sv.revenue += item.price; byService.set(item.name, sv);
      }
    }

    return {
      from, to, branchId: q.branchId ?? "all",
      totals: { ...totals, revenue: r2(totals.revenue), tips: r2(totals.tips), vat: r2(totals.vat), discounts: r2(totals.discounts) },
      byDay: [...byDay].map(([date, v]) => ({ date, revenue: r2(v.revenue), count: v.count })).sort((a, b) => a.date.localeCompare(b.date)),
      byMethod: [...byMethod].map(([method, v]) => ({ method, revenue: r2(v.revenue), count: v.count })),
      byBranch: [...byBranch].map(([branchId, v]) => ({ branchId, revenue: r2(v.revenue), count: v.count })),
      topServices: [...byService].map(([name, v]) => ({ name, ...v, revenue: r2(v.revenue) }))
        .sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    };
  });

  /* ---------------- barber personal analytics (self only) ---------------- */
  app.get("/reports/barber/me", async (req, reply) => {
    const s = await requireRole(req, reply, ["barber"]);
    if (!s) return;
    const q = req.query as { from?: string; to?: string };
    const from = q.from && DATE_RE.test(q.from) ? q.from : today().slice(0, 8) + "01"; // default: this month
    const to = q.to && DATE_RE.test(q.to) ? q.to : today();

    const bookings = await db.prepare(
      "SELECT id, status, paid, minutes FROM bookings WHERE barber_id = ? AND starts_at BETWEEN ? AND ?"
    ).all(s.sub, `${from}T00:00:00`, `${to}T23:59:59`) as { id: string; status: string; paid: number; minutes: number }[];

    let earnings = 0;
    for (const b of bookings) {
      const inv = await db.prepare("SELECT gross FROM invoices WHERE booking_id = ?").get(b.id) as { gross: number } | undefined;
      if (inv) earnings += inv.gross;
    }

    return {
      from, to,
      bookings: bookings.length,
      completed: bookings.filter((b) => b.paid).length,
      noShows: bookings.filter((b) => b.status === "No Show").length,
      cancelled: bookings.filter((b) => b.status === "Cancelled").length,
      minutesBooked: bookings.reduce((sum, b) => sum + b.minutes, 0),
      serviceRevenue: Math.round(earnings * 100) / 100, // their own chair only — no salon-wide figures (PRD 7)
      rating: await barberRating(s.sub), // { average, count } — PRD 7 "ratings"
    };
  });

  /* ---------------- timeline history (PRD 13) ---------------- */

  // archived day state: super any branch; admin own branch
  app.get("/reports/timeline", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { date?: string; branchId?: string };
    if (!q.date || !DATE_RE.test(q.date)) return reply.code(400).send({ error: "date=YYYY-MM-DD required" });
    const branchId = s.role === "admin" ? s.branchId! : (q.branchId ?? null);
    const rows = branchId
      ? await db.prepare(`SELECT date, branch_id AS "branchId", data, created_at AS "archivedAt" FROM day_snapshots WHERE date = ? AND branch_id = ?`).all(q.date, branchId)
      : await db.prepare(`SELECT date, branch_id AS "branchId", data, created_at AS "archivedAt" FROM day_snapshots WHERE date = ?`).all(q.date);
    return (rows as { date: string; branchId: string; data: string; archivedAt: string }[])
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  });

  // manual snapshot trigger (super) — the scheduler also runs this at day end
  app.post("/reports/snapshot", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const q = req.query as { date?: string };
    const date = q.date && DATE_RE.test(q.date) ? q.date : today();
    const count = await snapshotDay(date);
    await audit("timeline_snapshot", { actorId: s.sub, actorRole: s.role, detail: date, ip: req.ip });
    return { date, branchesArchived: count };
  });
}

/* Archive the full booking state of a day, per branch (upsert = re-running is safe) */
export async function snapshotDay(date: string): Promise<number> {
  const branches = await db.prepare("SELECT id FROM branches").all() as { id: string }[];
  for (const br of branches) {
    const bookings = await db.prepare(
      `SELECT id, barber_id, client_name, service_ids, starts_at, minutes, status, online, paid, cancel_reason
       FROM bookings WHERE branch_id = ? AND starts_at BETWEEN ? AND ? ORDER BY starts_at`
    ).all(br.id, `${date}T00:00:00`, `${date}T23:59:59`);
    await db.prepare(
      `INSERT INTO day_snapshots (id, date, branch_id, data, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(date, branch_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`
    ).run(uid(), date, br.id, JSON.stringify(bookings), now());
  }
  return branches.length;
}

/* Called from the scheduler: when the date rolls over, archive yesterday. */
let lastSeenDate = today();
export async function snapshotIfDayRolled() {
  const nowDate = today();
  if (nowDate !== lastSeenDate) {
    await snapshotDay(lastSeenDate);
    lastSeenDate = nowDate;
  }
}
