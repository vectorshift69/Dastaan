import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireAuth, requireRole, audit } from "../security.js";
import { onBookingCreated, onBookingCancelled, onServicePaid, onInvoiceIssued, drainDue } from "../notify/service.js";
import { createInvoiceForBooking, invoiceToApi } from "../invoices.js";
import { renderInvoicePdf } from "../invoice-pdf.js";
import { earnPoints, loyaltyForClient } from "../loyalty.js";
import { checkCoupon, redeemCoupon } from "../coupons.js";
import { moveStock } from "./inventory.js";
import { createReviewInvite } from "./reviews.js";

const STATUSES = ["Booked", "Confirmed", "Arrived", "Started", "No Show", "Cancelled"] as const;

const createSchema = z.object({
  branchId: z.string().min(1),
  barberId: z.string().min(1), // or "any"
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  // local salon time, e.g. 2026-08-13T15:30:00 (timezone handling is branch-local by design)
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Invalid start time"),
  clientName: z.string().min(2).max(80).optional(), // staff-created bookings
  clientPhone: z.string().max(24).optional(),
  online: z.boolean().optional(),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().max(300).optional(),
});

const paidSchema = z.object({ paid: z.boolean() });

const checkoutSchema = z.object({
  price: z.number().min(0).max(100000),      // editable at checkout (PRD 11)
  discount: z.number().min(0).max(100000).default(0),
  tip: z.number().min(0).max(100000).default(0),
  method: z.enum(["Card", "Cash", "QR code", "Gift card", "Split"]),
  couponCode: z.string().max(30).optional(),
  // combined product + service checkout (PRD 11)
  products: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().min(1).max(50),
  })).max(20).optional(),
});

type BookingRow = {
  id: string; branch_id: string; barber_id: string; client_id: string | null;
  client_name: string; client_phone: string | null; service_ids: string;
  starts_at: string; minutes: number; status: string; online: number; paid: number;
  cancel_reason: string | null;
};

const toApi = async (b: BookingRow) => {
  const loyalty = b.client_id ? await loyaltyForClient(b.client_id) : null;
  return {
    id: b.id,
    branchId: b.branch_id,
    barberId: b.barber_id,
    client: b.client_name,
    phone: b.client_phone ?? "",
    serviceIds: JSON.parse(b.service_ids) as string[],
    startsAt: b.starts_at,
    minutes: b.minutes,
    status: b.status,
    online: !!b.online,
    paid: !!b.paid,
    cancelReason: b.cancel_reason ?? undefined,
    loyalty: loyalty ? { tier: loyalty.tier, points: loyalty.points } : undefined,
  };
};

async function logEvent(bookingId: string, actorId: string | null, actorRole: string | null, action: string, detail?: string) {
  await db.prepare(
    "INSERT INTO booking_events (id, booking_id, actor_id, actor_role, action, detail, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uid(), bookingId, actorId, actorRole, action, detail ?? null, now());
}

export default async function bookingRoutes(app: FastifyInstance) {
  /* -------- list bookings (role-scoped) -------- */
  app.get("/bookings", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;
    const q = req.query as { date?: string; branchId?: string };

    if (s.role === "client") {
      const rows = await db
        .prepare("SELECT * FROM bookings WHERE client_id = ? ORDER BY starts_at DESC LIMIT 100")
        .all(s.sub) as BookingRow[];
      return Promise.all(rows.map(toApi));
    }

    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : new Date().toISOString().slice(0, 10);
    const from = `${date}T00:00:00`;
    const to = `${date}T23:59:59`;

    if (s.role === "barber") {
      const rows = await db
        .prepare("SELECT * FROM bookings WHERE barber_id = ? AND starts_at BETWEEN ? AND ? ORDER BY starts_at")
        .all(s.sub, from, to) as BookingRow[];
      return Promise.all(rows.map(toApi));
    }

    // admin: own branch only; super_admin: any branch (optional filter)
    const branchId = s.role === "admin" ? s.branchId : (q.branchId ?? null);
    const rows = branchId
      ? (await db.prepare("SELECT * FROM bookings WHERE branch_id = ? AND starts_at BETWEEN ? AND ? ORDER BY starts_at")
          .all(branchId, from, to) as BookingRow[])
      : (await db.prepare("SELECT * FROM bookings WHERE starts_at BETWEEN ? AND ? ORDER BY starts_at")
          .all(from, to) as BookingRow[]);
    return Promise.all(rows.map(toApi));
  });

  /* -------- create booking (client self-serve or staff) -------- */
  app.post("/bookings", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;
    if (s.role === "barber") return reply.code(403).send({ error: "Barbers cannot create bookings" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const body = parsed.data;

    if (s.role === "admin" && body.branchId !== s.branchId)
      return reply.code(403).send({ error: "Wrong branch" });

    const branch = await db.prepare("SELECT id FROM branches WHERE id = ?").get(body.branchId);
    if (!branch) return reply.code(400).send({ error: "Unknown branch" });

    // services must exist & be active
    const services: ({ id: string; minutes: number } | undefined)[] = [];
    for (const sid of body.serviceIds) {
      services.push(await db.prepare("SELECT id, minutes FROM services WHERE id = ? AND active = 1").get(sid) as { id: string; minutes: number } | undefined);
    }
    if (services.some((x) => !x)) return reply.code(400).send({ error: "Unknown service" });
    const minutes = services.reduce((sum, x) => sum + x!.minutes, 0);

    // resolve barber ("any" → first free in branch)
    let barberId = body.barberId;
    const branchBarbers = await db
      .prepare("SELECT id FROM users WHERE branch_id = ? AND role IN ('barber','admin') AND role = 'barber' AND active = 1")
      .all(body.branchId) as { id: string }[];
    if (barberId === "any") {
      let free: { id: string } | undefined;
      for (const cand of branchBarbers) {
        if (!(await overlaps(cand.id, body.startsAt, minutes))) { free = cand; break; }
      }
      if (!free) return reply.code(409).send({ error: "No stylist free at that time" });
      barberId = free.id;
    } else {
      if (!branchBarbers.some((b) => b.id === barberId))
        return reply.code(400).send({ error: "Stylist not at this branch" });
      if (await overlaps(barberId, body.startsAt, minutes))
        return reply.code(409).send({ error: "That time was just taken — pick another slot" });
    }

    const isClient = s.role === "client";
    const clientRow = isClient
      ? (await db.prepare("SELECT name, phone FROM users WHERE id = ?").get(s.sub) as { name: string; phone: string | null })
      : null;
    const clientName = isClient ? clientRow!.name : body.clientName;
    if (!clientName) return reply.code(400).send({ error: "Client name required" });

    const id = uid();
    await db.prepare(
      `INSERT INTO bookings (id, branch_id, barber_id, client_id, client_name, client_phone,
        service_ids, starts_at, minutes, status, online, paid, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'Booked',?,0,?,?)`
    ).run(
      id, body.branchId, barberId,
      isClient ? s.sub : null,
      clientName,
      (isClient ? clientRow!.phone : body.clientPhone) ?? null,
      JSON.stringify(body.serviceIds), body.startsAt, minutes,
      isClient || body.online ? 1 : 0,
      now(), now()
    );
    await logEvent(id, s.sub, s.role, "created");
    await onBookingCreated(id); // instant SMS confirmation + 2h-before reminder (PRD 5.4)
    await drainDue().catch(() => {}); // deliver the confirmation right away
    return reply.code(201).send({ id, barberId, minutes });
  });

  /* -------- status pipeline (staff only; Cancel requires reason) -------- */
  app.patch("/bookings/:id/status", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid status" });
    const { status, reason } = parsed.data;

    const b = await db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
    if (!b) return reply.code(404).send({ error: "Booking not found" });
    if (s.role === "admin" && b.branch_id !== s.branchId)
      return reply.code(403).send({ error: "Wrong branch" });

    if (status === "Cancelled" && !reason?.trim())
      return reply.code(400).send({ error: "A cancellation reason is required" });

    await db.prepare("UPDATE bookings SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ?")
      .run(status, status === "Cancelled" ? reason!.trim() : b.cancel_reason, now(), id);
    await logEvent(id, s.sub, s.role, `status:${status}`, status === "Cancelled" ? reason : undefined);
    await audit("booking_status_changed", { actorId: s.sub, actorRole: s.role, detail: `${id} → ${status}`, ip: req.ip });
    if (status === "Cancelled") {
      await onBookingCancelled(id); // notify client + void the pending reminder
      await drainDue().catch(() => {});
    }
    return { ok: true };
  });

  /* -------- payment flag (staff only) -------- */
  app.patch("/bookings/:id/paid", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = paidSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const b = await db.prepare("SELECT branch_id FROM bookings WHERE id = ?").get(id) as { branch_id: string } | undefined;
    if (!b) return reply.code(404).send({ error: "Booking not found" });
    if (s.role === "admin" && b.branch_id !== s.branchId)
      return reply.code(403).send({ error: "Wrong branch" });

    await db.prepare("UPDATE bookings SET paid = ?, updated_at = ? WHERE id = ?").run(parsed.data.paid ? 1 : 0, now(), id);
    await logEvent(id, s.sub, s.role, `paid:${parsed.data.paid}`);
    await audit("booking_paid_changed", { actorId: s.sub, actorRole: s.role, detail: id, ip: req.ip });
    if (parsed.data.paid) {
      await onServicePaid(id); // post-service feedback request (in-app + Google review)
      await drainDue().catch(() => {});
    }
    return { ok: true };
  });

  /* -------- checkout: pay + auto-invoice + SMS, one atomic action (PRD 9 & 11) -------- */
  app.post("/bookings/:id/checkout", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const b = await db.prepare("SELECT branch_id, status FROM bookings WHERE id = ?").get(id) as
      | { branch_id: string; status: string }
      | undefined;
    if (!b) return reply.code(404).send({ error: "Booking not found" });
    if (s.role === "admin" && b.branch_id !== s.branchId)
      return reply.code(403).send({ error: "Wrong branch" });
    if (b.status === "Cancelled" || b.status === "No Show")
      return reply.code(409).send({ error: `Cannot check out a ${b.status.toLowerCase()} booking` });

    // products sold at the desk — priced from the catalog, stock checked
    const productLines: { productId: string; name: string; qty: number; price: number }[] = [];
    for (const line of parsed.data.products ?? []) {
      const p = await db.prepare(
        "SELECT id, name, price FROM products WHERE id = ? AND kind = 'retail' AND active = 1"
      ).get(line.productId) as { id: string; name: string; price: number } | undefined;
      if (!p) return reply.code(400).send({ error: "Unknown product" });
      const stock = await db.prepare(
        "SELECT qty FROM stock_levels WHERE product_id = ? AND branch_id = ?"
      ).get(line.productId, b.branch_id) as { qty: number } | undefined;
      if (!stock || stock.qty < line.qty)
        return reply.code(409).send({ error: `Not enough stock for ${p.name} (${stock?.qty ?? 0} left)` });
      productLines.push({ productId: p.id, name: p.name, qty: line.qty, price: p.price });
    }
    const productTotal = productLines.reduce((sum, p) => sum + p.price * p.qty, 0);

    // coupon (optional) — validated and priced server-side, never trusted from the client
    let couponDiscount = 0;
    let couponId: string | null = null;
    const couponCode = parsed.data.couponCode?.trim();
    if (couponCode) {
      const check = await checkCoupon(couponCode, Math.max(0, parsed.data.price + productTotal - parsed.data.discount), "services");
      if (!check.ok) return reply.code(422).send({ error: check.reason });
      couponDiscount = check.discount;
      couponId = check.coupon.id;
    }

    const invoice = await createInvoiceForBooking(id, {
      ...parsed.data,
      issuedBy: s.sub,
      couponCode: couponCode ? couponCode.toUpperCase() : null,
      couponDiscount,
      productLines,
    });

    // draw the sold products out of this branch's stock, logged as pos_sale
    for (const p of productLines) {
      await moveStock(p.productId, b.branch_id, -p.qty, "pos_sale", s.sub, `invoice ${invoice.invoiceNo}`);
    }

    if (couponId) {
      const owner0 = await db.prepare("SELECT client_id FROM bookings WHERE id = ?").get(id) as { client_id: string | null };
      await redeemCoupon(couponId, `invoice:${invoice.id}`, couponDiscount, owner0.client_id);
    }

    await db.prepare("UPDATE bookings SET paid = 1, status = 'Started', updated_at = ? WHERE id = ?").run(now(), id);
    await logEvent(id, s.sub, s.role, "checkout", `${invoice.invoiceNo} · AED ${invoice.total}`);
    await audit("checkout_completed", { actorId: s.sub, actorRole: s.role, detail: `${id} ${invoice.invoiceNo}`, ip: req.ip });

    await onInvoiceIssued(id, invoice.invoiceNo, invoice.total, invoice.paymentMethod);
    await onServicePaid(id, await createReviewInvite(id)); // feedback request with a single-use rating link
    await drainDue().catch(() => {});

    // loyalty: registered clients earn 1 point per AED of the service total
    const owner = await db.prepare("SELECT client_id FROM bookings WHERE id = ?").get(id) as { client_id: string | null };
    const pointsEarned = owner.client_id ? await earnPoints(owner.client_id, id, invoice.gross) : 0;

    return reply.code(201).send({ ...invoice, pointsEarned });
  });

  /* -------- invoices (staff, branch-scoped) -------- */
  app.get("/invoices", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { branchId?: string };
    const branchId = s.role === "admin" ? s.branchId : (q.branchId ?? null);
    const rows = branchId
      ? await db.prepare("SELECT * FROM invoices WHERE branch_id = ? ORDER BY created_at DESC LIMIT 200").all(branchId)
      : await db.prepare("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Parameters<typeof invoiceToApi>[0][]).map(invoiceToApi);
  });

  /* shared loader with per-role authorization */
  const loadInvoiceAuthorized = async (req: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1], bookingId: string) => {
    const s = await requireAuth(req, reply);
    if (!s) return null;
    const row = await db.prepare("SELECT * FROM invoices WHERE booking_id = ?").get(bookingId) as
      | Parameters<typeof invoiceToApi>[0]
      | undefined;
    if (!row) {
      reply.code(404).send({ error: "No invoice for this booking" });
      return null;
    }
    if (s.role === "client") {
      const owns = await db.prepare("SELECT id FROM bookings WHERE id = ? AND client_id = ?").get(bookingId, s.sub);
      if (!owns) { reply.code(403).send({ error: "Not allowed" }); return null; }
    }
    if (s.role === "admin" && row.branch_id !== s.branchId) {
      reply.code(403).send({ error: "Wrong branch" });
      return null;
    }
    if (s.role === "barber") { reply.code(403).send({ error: "Not allowed" }); return null; }
    return invoiceToApi(row);
  };

  app.get("/bookings/:id/invoice", async (req, reply) => {
    const inv = await loadInvoiceAuthorized(req, reply, (req.params as { id: string }).id);
    if (!inv) return;
    return inv;
  });

  /* downloadable PDF of the invoice */
  app.get("/bookings/:id/invoice/pdf", async (req, reply) => {
    const inv = await loadInvoiceAuthorized(req, reply, (req.params as { id: string }).id);
    if (!inv) return;
    const pdf = await renderInvoicePdf(inv);
    reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${inv.invoiceNo}.pdf"`)
      .send(pdf);
  });

  /* -------- notification outbox (staff visibility) -------- */
  app.get("/notifications", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const q = req.query as { bookingId?: string };
    if (q.bookingId) {
      return await db
        .prepare(
          `SELECT id, booking_id AS "bookingId", kind, body, status, scheduled_at AS "scheduledAt", sent_at AS "sentAt" FROM notifications WHERE booking_id = ? ORDER BY created_at DESC`
        )
        .all(q.bookingId);
    }
    // admins see their branch's messages; super admin sees all
    const rows =
      s.role === "super_admin"
        ? await db.prepare(
            `SELECT n.id, n.booking_id AS "bookingId", n.kind, n.body, n.status, n.scheduled_at AS "scheduledAt", n.sent_at AS "sentAt" FROM notifications n ORDER BY n.created_at DESC LIMIT 100`
          ).all()
        : await db.prepare(
            `SELECT n.id, n.booking_id AS "bookingId", n.kind, n.body, n.status, n.scheduled_at AS "scheduledAt", n.sent_at AS "sentAt"
             FROM notifications n JOIN bookings b ON b.id = n.booking_id
             WHERE b.branch_id = ? ORDER BY n.created_at DESC LIMIT 100`
          ).all(s.branchId);
    return rows;
  });
}

/* overlap: same barber, existing active booking intersecting the window */
async function overlaps(barberId: string, startsAt: string, minutes: number): Promise<boolean> {
  const start = Date.parse(startsAt);
  const end = start + minutes * 60_000;
  const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start); dayEnd.setHours(23, 59, 59, 999);
  const rows = await db
    .prepare(
      `SELECT starts_at, minutes FROM bookings
       WHERE barber_id = ? AND status NOT IN ('Cancelled','No Show')
       AND starts_at BETWEEN ? AND ?`
    )
    .all(barberId, dayStart.toISOString(), dayEnd.toISOString()) as { starts_at: string; minutes: number }[];
  return rows.some((r) => {
    const s = Date.parse(r.starts_at);
    const e = s + r.minutes * 60_000;
    return start < e && s < end;
  });
}
