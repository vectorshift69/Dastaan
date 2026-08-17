/* ------------------------------------------------------------------ */
/* Reviews & ratings (PRD 5.4 — the post-service feedback message       */
/* routes to an in-app review, then nudges toward a Google review).     */
/* A review is created (unsubmitted) at checkout with a single-use      */
/* token; the SMS link carries it, so no login is required to rate.     */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole } from "../security.js";

const submitSchema = z.object({
  token: z.string().min(8).max(80),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(600).optional(),
});

/* called at checkout — returns the token for the feedback SMS link */
export async function createReviewInvite(bookingId: string): Promise<string | null> {
  const b = await db.prepare(
    "SELECT id, barber_id, branch_id, client_id, client_name FROM bookings WHERE id = ?"
  ).get(bookingId) as
    | { id: string; barber_id: string; branch_id: string; client_id: string | null; client_name: string }
    | undefined;
  if (!b) return null;
  const existing = await db.prepare("SELECT token FROM reviews WHERE booking_id = ?").get(bookingId) as
    | { token: string } | undefined;
  if (existing) return existing.token;

  const token = randomBytes(12).toString("hex");
  await db.prepare(
    "INSERT INTO reviews (id, booking_id, barber_id, branch_id, client_id, client_name, token, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(uid(), b.id, b.barber_id, b.branch_id, b.client_id, b.client_name, token, now());
  return token;
}

export async function barberRating(barberId: string): Promise<{ average: number | null; count: number }> {
  const r = await db.prepare(
    "SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM reviews WHERE barber_id = ? AND submitted_at IS NOT NULL"
  ).get(barberId) as { avg: number | null; n: number };
  return { average: r.avg ? Math.round(Number(r.avg) * 10) / 10 : null, count: Number(r.n) };
}

export default async function reviewRoutes(app: FastifyInstance) {
  /* -------- open the review form from the SMS link (no login) -------- */
  app.get("/reviews/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const r = await db.prepare(
      `SELECT r.client_name AS "clientName", r.rating, r.submitted_at AS "submittedAt",
              u.name AS "barberName", b.name AS "branchName"
       FROM reviews r
       JOIN users u ON u.id = r.barber_id
       JOIN branches b ON b.id = r.branch_id
       WHERE r.token = ?`
    ).get(token);
    if (!r) return reply.code(404).send({ error: "This review link is not valid" });
    return r;
  });

  /* -------- submit a rating (single use, rate-limited) -------- */
  app.post("/reviews", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { token, rating, comment } = parsed.data;

    const r = await db.prepare("SELECT id, submitted_at FROM reviews WHERE token = ?").get(token) as
      | { id: string; submitted_at: string | null } | undefined;
    if (!r) return reply.code(404).send({ error: "This review link is not valid" });
    if (r.submitted_at) return reply.code(409).send({ error: "You've already rated this visit — thank you!" });

    await db.prepare("UPDATE reviews SET rating = ?, comment = ?, submitted_at = ? WHERE id = ?")
      .run(rating, comment?.trim() || null, now(), r.id);
    return { ok: true, rating };
  });

  /* -------- public: a barber's rating summary + recent comments -------- */
  app.get("/barbers/:id/reviews", async (req) => {
    const { id } = req.params as { id: string };
    const summary = await barberRating(id);
    const recent = await db.prepare(
      `SELECT rating, comment, submitted_at AS "submittedAt", client_name AS "clientName"
       FROM reviews WHERE barber_id = ? AND submitted_at IS NOT NULL AND comment IS NOT NULL
       ORDER BY submitted_at DESC LIMIT 10`
    ).all(id);
    return { ...summary, recent };
  });

  /* -------- staff: reviews for the branch (admins) / all (super) -------- */
  app.get("/reviews", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const base = `
      SELECT r.rating, r.comment, r.client_name AS "clientName", r.submitted_at AS "submittedAt",
             u.name AS "barberName", r.branch_id AS "branchId"
      FROM reviews r JOIN users u ON u.id = r.barber_id
      WHERE r.submitted_at IS NOT NULL`;
    return s.role === "admin"
      ? await db.prepare(`${base} AND r.branch_id = ? ORDER BY r.submitted_at DESC LIMIT 100`).all(s.branchId)
      : await db.prepare(`${base} ORDER BY r.submitted_at DESC LIMIT 100`).all();
  });
}
