/* ------------------------------------------------------------------ */
/* Training & Motivational Quotes                                       */
/*                                                                     */
/* Training: admin uploads a video + deadline. Staff must watch it     */
/* fully (no skipping). Progress is saved server-side so they can      */
/* resume. After the deadline, overdue staff are suspended — no new    */
/* availability or bookings until the video is marked complete.        */
/*                                                                     */
/* Quotes: admin adds motivational quotes. Staff see one per day as    */
/* a mandatory 15-second popup on login.                               */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireAuth, requireRole } from "../security.js";

/* ------------------------------------------------------------------ */
/* Shared helper — used by bookings.ts to enforce suspension           */
/* ------------------------------------------------------------------ */

/** Returns true if the user has at least one overdue, unwatched video. */
export async function isBarberSuspended(userId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 FROM training_videos v
    LEFT JOIN training_progress p ON p.video_id = v.id AND p.user_id = ?
    WHERE v.active = 1
      AND v.deadline < ?
      AND (p.completed IS NULL OR p.completed = 0)
    LIMIT 1
  `).get<{ 1: number }>(userId, now());
  return !!row;
}

/* ------------------------------------------------------------------ */
/* Hardcoded quote suggestions shown in the admin UI                   */
/* ------------------------------------------------------------------ */

const SUGGESTED_QUOTES = [
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { quote: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { quote: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { quote: "Excellence is always the result of high intention, sincere effort, and intelligent execution.", author: "Aristotle" },
  { quote: "Every day is a new opportunity to be better than yesterday.", author: "Unknown" },
  { quote: "Clients do not come first. Employees come first. If you take care of your employees, they will take care of the clients.", author: "Richard Branson" },
  { quote: "A great barber doesn't just cut hair — they craft confidence.", author: "Dastaan" },
  { quote: "The difference between ordinary and extraordinary is that little extra.", author: "Jimmy Johnson" },
];

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const createVideoSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  videoUrl: z.string().url("Must be a valid video URL"),
  deadline: z.string().datetime("Must be a valid ISO datetime"),
});

const progressSchema = z.object({
  progressSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().min(1).optional(),
});

const addQuoteSchema = z.object({
  quote: z.string().min(5).max(500),
  author: z.string().max(100).optional(),
});

/* ------------------------------------------------------------------ */
/* Route helpers                                                        */
/* ------------------------------------------------------------------ */

/** Fetch all active videos with the calling user's progress attached. */
async function getVideosForUser(userId: string) {
  return db.prepare(`
    SELECT v.id, v.title, v.description, v.video_url, v.deadline,
           p.progress_seconds, p.duration_seconds, p.completed, p.completed_at
    FROM   training_videos v
    LEFT JOIN training_progress p ON p.video_id = v.id AND p.user_id = ?
    WHERE  v.active = 1
    ORDER  BY v.deadline ASC
  `).all<{
    id: string; title: string; description: string | null; video_url: string;
    deadline: string; progress_seconds: number | null; duration_seconds: number | null;
    completed: number | null; completed_at: string | null;
  }>(userId);
}

function toVideoApi(
  v: Awaited<ReturnType<typeof getVideosForUser>>[number],
  nowIso: string
) {
  return {
    id: v.id,
    title: v.title,
    description: v.description ?? null,
    videoUrl: v.video_url,
    deadline: v.deadline,
    progressSeconds: v.progress_seconds ?? 0,
    durationSeconds: v.duration_seconds ?? null,
    completed: v.completed === 1,
    completedAt: v.completed_at ?? null,
    overdue: !v.completed && v.deadline < nowIso,
  };
}

/** Upsert progress, never moving the saved position backward. */
async function upsertProgress(
  videoId: string,
  userId: string,
  progressSeconds: number,
  durationSeconds: number | null
) {
  await db.prepare(`
    INSERT INTO training_progress
      (id, video_id, user_id, progress_seconds, duration_seconds, completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT (video_id, user_id) DO UPDATE SET
      progress_seconds = GREATEST(training_progress.progress_seconds, EXCLUDED.progress_seconds),
      duration_seconds = COALESCE(EXCLUDED.duration_seconds, training_progress.duration_seconds),
      updated_at       = EXCLUDED.updated_at
  `).run(uid(), videoId, userId, progressSeconds, durationSeconds, now(), now());
}

/** Mark a video completed (idempotent — won't overwrite an existing completed_at). */
async function markCompleted(videoId: string, userId: string) {
  await db.prepare(`
    INSERT INTO training_progress
      (id, video_id, user_id, progress_seconds, completed, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, 0, 1, ?, ?, ?)
    ON CONFLICT (video_id, user_id) DO UPDATE SET
      completed    = 1,
      completed_at = COALESCE(training_progress.completed_at, EXCLUDED.completed_at),
      updated_at   = EXCLUDED.updated_at
  `).run(uid(), videoId, userId, now(), now(), now());
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export default async function trainingRoutes(app: FastifyInstance) {

  /* ---- Staff: list required videos with own progress ---- */
  app.get("/training", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;
    const nowIso = now();
    const videos = await getVideosForUser(s.sub);
    return videos.map(v => toVideoApi(v, nowIso));
  });

  /* ---- Staff: save playback progress (called every ~10 s by player) ---- */
  app.put("/training/:id/progress", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;

    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });

    await upsertProgress(
      (req.params as { id: string }).id,
      s.sub,
      parsed.data.progressSeconds,
      parsed.data.durationSeconds ?? null,
    );
    return { ok: true };
  });

  /* ---- Staff: mark video as fully completed ---- */
  app.post("/training/:id/complete", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;

    const videoId = (req.params as { id: string }).id;
    const video = await db.prepare(
      "SELECT id FROM training_videos WHERE id = ? AND active = 1"
    ).get<{ id: string }>(videoId);
    if (!video) return reply.code(404).send({ error: "Video not found" });

    await markCompleted(videoId, s.sub);
    return { ok: true };
  });

  /* ---- Admin: create a training video with deadline ---- */
  app.post("/admin/training", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;

    const parsed = createVideoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });

    const id = uid();
    await db.prepare(
      `INSERT INTO training_videos (id, title, description, video_url, deadline, created_by, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(id, parsed.data.title, parsed.data.description ?? null, parsed.data.videoUrl, parsed.data.deadline, s.sub, now());

    return reply.code(201).send({ id });
  });

  /* ---- Admin: list all videos with completion stats ---- */
  app.get("/admin/training", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;

    const [videos, staffRow] = await Promise.all([
      db.prepare(`
        SELECT v.id, v.title, v.description, v.video_url, v.deadline, v.created_at,
               COUNT(p.user_id) FILTER (WHERE p.completed = 1) AS completed_count,
               COUNT(DISTINCT u.id) AS total_staff
        FROM   training_videos v
        CROSS  JOIN (SELECT id FROM users WHERE role IN ('barber','admin','super_admin') AND active = 1) u
        LEFT   JOIN training_progress p ON p.video_id = v.id AND p.user_id = u.id
        WHERE  v.active = 1
        GROUP  BY v.id
        ORDER  BY v.deadline ASC
      `).all<{
        id: string; title: string; description: string | null; video_url: string;
        deadline: string; created_at: string; completed_count: number; total_staff: number;
      }>(),
      db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role IN ('barber','admin','super_admin') AND active = 1"
      ).get<{ count: number }>(),
    ]);

    const nowIso = now();
    return videos.map(v => ({
      id: v.id,
      title: v.title,
      description: v.description ?? null,
      videoUrl: v.video_url,
      deadline: v.deadline,
      createdAt: v.created_at,
      completedCount: Number(v.completed_count),
      totalStaff: Number(staffRow?.count ?? v.total_staff),
      overdue: v.deadline < nowIso,
    }));
  });

  /* ---- Admin: deactivate a training video ---- */
  app.delete("/admin/training/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    await db.prepare("UPDATE training_videos SET active = 0 WHERE id = ?").run(
      (req.params as { id: string }).id
    );
    return { ok: true };
  });

  /* ================================================================ */
  /* Motivational Quotes                                              */
  /* ================================================================ */

  /* ---- Admin: get AI-style suggestions to pick from ---- */
  app.get("/admin/quotes/suggestions", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    return SUGGESTED_QUOTES;
  });

  /* ---- Admin: add a quote ---- */
  app.post("/admin/quotes", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;

    const parsed = addQuoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });

    const id = uid();
    await db.prepare(
      `INSERT INTO motivational_quotes (id, quote, author, active, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(id, parsed.data.quote, parsed.data.author ?? null, s.sub, now());

    return reply.code(201).send({ id });
  });

  /* ---- Admin: list all quotes ---- */
  app.get("/admin/quotes", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;

    const rows = await db.prepare(
      "SELECT id, quote, author, active, created_at FROM motivational_quotes ORDER BY created_at DESC"
    ).all<{ id: string; quote: string; author: string | null; active: number; created_at: string }>();

    return rows.map(r => ({ ...r, active: r.active === 1 }));
  });

  /* ---- Admin: toggle a quote on/off ---- */
  app.patch("/admin/quotes/:id", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;

    const { active } = req.body as { active: boolean };
    await db.prepare("UPDATE motivational_quotes SET active = ? WHERE id = ?").run(
      active ? 1 : 0,
      (req.params as { id: string }).id
    );
    return { ok: true };
  });

  /* ---- Staff: get today's quote (one per user per day) ---- */
  app.get("/quotes/daily", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;

    const today = now().slice(0, 10); // "YYYY-MM-DD"

    // Return the same quote if already seen today
    const seen = await db.prepare(
      "SELECT quote_id FROM quote_views WHERE user_id = ? AND viewed_date = ?"
    ).get<{ quote_id: string }>(s.sub, today);

    const quoteId = seen?.quote_id ?? null;

    const quote = quoteId
      ? await db.prepare(
          "SELECT id, quote, author FROM motivational_quotes WHERE id = ?"
        ).get<{ id: string; quote: string; author: string | null }>(quoteId)
      : await db.prepare(
          "SELECT id, quote, author FROM motivational_quotes WHERE active = 1 ORDER BY RANDOM() LIMIT 1"
        ).get<{ id: string; quote: string; author: string | null }>();

    if (!quote) return reply.code(204).send();

    // Record view (ignore conflict — user already has a row for today)
    if (!seen) {
      await db.prepare(
        `INSERT INTO quote_views (id, quote_id, user_id, viewed_date) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, viewed_date) DO NOTHING`
      ).run(uid(), quote.id, s.sub, today);
    }

    return quote;
  });
}
