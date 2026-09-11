/* ------------------------------------------------------------------ */
/* Reports & timeline history.                                         */
/*   Sales reports        — Super Admin ONLY (PRD 2.2, 12.1).          */
/*   Personal analytics   — each barber, self only (PRD 7).            */
/*   Timeline history     — daily calendar state archived so the past  */
/*                          stays queryable (PRD 13).                  */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
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
  split_detail: string | null; barber_id: string | null; barber_name: string | null;
};

/** A Split invoice's total belongs to no single till — it goes to whichever
 *  actual payment methods the client used, in the amounts they used them.
 *  Decomposing it here is what lets a cash-reconciliation report answer
 *  "how much cash actually changed hands today" without a Split line always
 *  quietly excluded from it. */
function methodContributions(inv: InvRow): { method: string; amount: number }[] {
  if (inv.payment_method === "Split" && inv.split_detail) {
    const { cash, card } = JSON.parse(inv.split_detail) as { cash: number; card: number };
    const parts: { method: string; amount: number }[] = [];
    if (cash > 0) parts.push({ method: "Cash", amount: cash });
    if (card > 0) parts.push({ method: "Card", amount: card });
    if (parts.length) return parts;
  }
  return [{ method: inv.payment_method, amount: inv.total }];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

type SalesFilter = { from: string; to: string; branchId?: string; barberId?: string };

async function loadInvoices(f: SalesFilter): Promise<InvRow[]> {
  const cols = "gross, tip, vat, total, discount, payment_method, split_detail, items, created_at, branch_id, barber_id, barber_name";
  const conds = ["created_at BETWEEN ? AND ?"];
  const params: unknown[] = [`${f.from}T00:00:00`, `${f.to}T23:59:59.999Z`];
  if (f.branchId) { conds.push("branch_id = ?"); params.push(f.branchId); }
  if (f.barberId) { conds.push("barber_id = ?"); params.push(f.barberId); }
  return await db.prepare(`SELECT ${cols} FROM invoices WHERE ${conds.join(" AND ")}`).all(...params) as InvRow[];
}

/** Shared by the JSON report and the Excel export, so the two can never disagree. */
async function salesReport(f: SalesFilter) {
  const rows = await loadInvoices(f);

  const totals = { invoices: rows.length, revenue: 0, tips: 0, vat: 0, discounts: 0 };
  const byDay = new Map<string, { revenue: number; count: number }>();
  const byMethod = new Map<string, { revenue: number; count: number }>();
  const byService = new Map<string, { count: number; revenue: number }>();
  const byBranch = new Map<string, { revenue: number; count: number }>();
  const byBarber = new Map<string, { name: string; revenue: number; count: number }>();

  for (const inv of rows) {
    totals.revenue += inv.total;
    totals.tips += inv.tip;
    totals.vat += inv.vat;
    totals.discounts += inv.discount;
    const day = inv.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { revenue: 0, count: 0 };
    d.revenue += inv.total; d.count++; byDay.set(day, d);
    for (const part of methodContributions(inv)) {
      const m = byMethod.get(part.method) ?? { revenue: 0, count: 0 };
      m.revenue += part.amount; m.count++; byMethod.set(part.method, m);
    }
    const b = byBranch.get(inv.branch_id) ?? { revenue: 0, count: 0 };
    b.revenue += inv.total; b.count++; byBranch.set(inv.branch_id, b);
    if (inv.barber_id) {
      const br = byBarber.get(inv.barber_id) ?? { name: inv.barber_name ?? "—", revenue: 0, count: 0 };
      br.revenue += inv.total; br.count++; byBarber.set(inv.barber_id, br);
    }
    for (const item of JSON.parse(inv.items) as { name: string; price: number }[]) {
      const sv = byService.get(item.name) ?? { count: 0, revenue: 0 };
      sv.count++; sv.revenue += item.price; byService.set(item.name, sv);
    }
  }

  return {
    from: f.from, to: f.to, branchId: f.branchId ?? "all", barberId: f.barberId ?? "all",
    rows,
    totals: { ...totals, revenue: r2(totals.revenue), tips: r2(totals.tips), vat: r2(totals.vat), discounts: r2(totals.discounts) },
    byDay: [...byDay].map(([date, v]) => ({ date, revenue: r2(v.revenue), count: v.count })).sort((a, b) => a.date.localeCompare(b.date)),
    byMethod: [...byMethod].map(([method, v]) => ({ method, revenue: r2(v.revenue), count: v.count })),
    byBranch: [...byBranch].map(([branchId, v]) => ({ branchId, revenue: r2(v.revenue), count: v.count })),
    byBarber: [...byBarber].map(([barberId, v]) => ({ barberId, name: v.name, revenue: r2(v.revenue), count: v.count }))
      .sort((a, b) => b.revenue - a.revenue),
    topServices: [...byService].map(([name, v]) => ({ name, ...v, revenue: r2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

/** Builds the workbook shared by the sales export — one summary sheet, one line per invoice. */
function buildSalesWorkbook(report: Awaited<ReturnType<typeof salesReport>>, branchLabel: string, barberLabel: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dastaan";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 20 }];
  summary.addRow(["Report period", `${report.from} to ${report.to}`]);
  summary.addRow(["Branch", branchLabel]);
  summary.addRow(["Barber", barberLabel]);
  summary.addRow([]);
  summary.addRow(["Invoices", report.totals.invoices]);
  summary.addRow(["Revenue (AED)", report.totals.revenue]);
  summary.addRow(["Tips (AED)", report.totals.tips]);
  summary.addRow(["VAT collected (AED)", report.totals.vat]);
  summary.addRow(["Discounts given (AED)", report.totals.discounts]);
  summary.getRow(1).font = { bold: true };

  const byBarber = wb.addWorksheet("By barber");
  byBarber.columns = [{ width: 24 }, { width: 12 }, { width: 16 }];
  byBarber.addRow(["Barber", "Invoices", "Revenue (AED)"]).font = { bold: true };
  for (const b of report.byBarber) byBarber.addRow([b.name, b.count, b.revenue]);

  const byMethod = wb.addWorksheet("By payment method");
  byMethod.addRow(["Method", "Count", "Revenue (AED)"]).font = { bold: true };
  for (const m of report.byMethod) byMethod.addRow([m.method, m.count, m.revenue]);
  byMethod.columns = [{ width: 18 }, { width: 10 }, { width: 16 }];

  const byService = wb.addWorksheet("Top services");
  byService.addRow(["Service", "Count", "Revenue (AED)"]).font = { bold: true };
  for (const sv of report.topServices) byService.addRow([sv.name, sv.count, sv.revenue]);
  byService.columns = [{ width: 28 }, { width: 10 }, { width: 16 }];

  const invoicesSheet = wb.addWorksheet("Invoices");
  invoicesSheet.addRow(["Date", "Barber", "Payment method", "Gross", "Discount", "VAT", "Tip", "Total"]).font = { bold: true };
  invoicesSheet.columns = [{ width: 20 }, { width: 22 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 12 }];
  for (const inv of report.rows) {
    invoicesSheet.addRow([inv.created_at, inv.barber_name ?? "—", inv.payment_method, inv.gross, inv.discount, inv.vat, inv.tip, inv.total]);
  }

  return wb;
}

export default async function reportRoutes(app: FastifyInstance) {
  /* ---------------- sales summary: SUPER ADMIN ONLY ---------------- */
  app.get("/reports/sales", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const q = req.query as { from?: string; to?: string; branchId?: string; barberId?: string };
    const from = q.from && DATE_RE.test(q.from) ? q.from : today();
    const to = q.to && DATE_RE.test(q.to) ? q.to : today();
    const { rows: _rows, ...report } = await salesReport({ from, to, branchId: q.branchId, barberId: q.barberId });
    return report;
  });

  /* ---------------- sales export (Excel): SUPER ADMIN ONLY ---------------- */
  app.get("/reports/sales/export", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const q = req.query as { from?: string; to?: string; branchId?: string; barberId?: string };
    const from = q.from && DATE_RE.test(q.from) ? q.from : today();
    const to = q.to && DATE_RE.test(q.to) ? q.to : today();
    const report = await salesReport({ from, to, branchId: q.branchId, barberId: q.barberId });

    const branchRow = q.branchId
      ? await db.prepare("SELECT name FROM branches WHERE id = ?").get(q.branchId) as { name: string } | undefined
      : undefined;
    const barberRow = q.barberId
      ? await db.prepare("SELECT name FROM users WHERE id = ?").get(q.barberId) as { name: string } | undefined
      : undefined;

    const wb = buildSalesWorkbook(report, branchRow?.name ?? "All branches", barberRow?.name ?? "All barbers");
    const buffer = await wb.xlsx.writeBuffer();

    await audit("sales_report_exported", { actorId: s.sub, actorRole: s.role, detail: `${from}..${to}`, ip: req.ip });
    reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="dastaan-sales-${from}_to_${to}.xlsx"`)
      .send(Buffer.from(buffer));
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
