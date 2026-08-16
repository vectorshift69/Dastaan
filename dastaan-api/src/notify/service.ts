/* ------------------------------------------------------------------ */
/* Notification service — outbox pattern (PRD 5.4).                    */
/* Enqueue writes a row; a scheduler loop delivers due rows with       */
/* retries + backoff. Nothing user-facing ever blocks on an SMS API,   */
/* and a crash can never lose a message. This module is the seam for a */
/* future standalone notification microservice.                        */
/* ------------------------------------------------------------------ */

import { db, uid, now } from "../db.js";
import { makeProvider } from "./provider.js";

const REMINDER_HOURS = 2; // PRD: at least 2 hours before the appointment
const MAX_ATTEMPTS = 5;
const DRAIN_INTERVAL_MS = 15_000;

const REVIEW_URL = process.env.REVIEW_URL || "https://dastaan.example/review";
const GOOGLE_REVIEW_URL =
  process.env.GOOGLE_REVIEW_URL || "https://g.page/r/dastaan/review";

const provider = makeProvider();

type BookingInfo = {
  id: string;
  client_name: string;
  client_phone: string | null;
  starts_at: string;
  branch_id: string;
};

const branchName = (id: string) =>
  (db.prepare("SELECT name FROM branches WHERE id = ?").get(id) as { name: string } | undefined)
    ?.name ?? "Dastaan";

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-AE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

function enqueue(
  bookingId: string | null,
  toPhone: string,
  kind: "confirmation" | "reminder" | "feedback" | "cancellation" | "invoice",
  body: string,
  scheduledAt: string
) {
  db.prepare(
    `INSERT INTO notifications (id, booking_id, to_phone, kind, body, scheduled_at, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(uid(), bookingId, toPhone, kind, body, scheduledAt, now());
}

function getBooking(bookingId: string): BookingInfo | undefined {
  return db
    .prepare("SELECT id, client_name, client_phone, starts_at, branch_id FROM bookings WHERE id = ?")
    .get(bookingId) as BookingInfo | undefined;
}

/* ---------------- triggers (called from routes) ---------------- */

export function onBookingCreated(bookingId: string) {
  const b = getBooking(bookingId);
  if (!b?.client_phone) return;
  const salon = branchName(b.branch_id);
  const when = timeLabel(b.starts_at);
  const first = b.client_name.split(" ")[0];

  // instant confirmation
  enqueue(
    b.id, b.client_phone, "confirmation",
    `${salon}: ${first}, your booking is confirmed for ${when}. Reply or call to change. See you soon!`,
    now()
  );

  // reminder ≥ 2h before (only for future appointments with enough lead time)
  const remindAt = new Date(Date.parse(b.starts_at) - REMINDER_HOURS * 3600_000);
  if (remindAt.getTime() > Date.now()) {
    enqueue(
      b.id, b.client_phone, "reminder",
      `${salon}: reminder — ${first}, we're expecting you at ${when}. Running late? Call us.`,
      remindAt.toISOString()
    );
  }
}

export function onBookingCancelled(bookingId: string) {
  const b = getBooking(bookingId);
  if (!b) return;
  // stop any pending reminder for this booking
  db.prepare(
    "UPDATE notifications SET status = 'cancelled' WHERE booking_id = ? AND status = 'pending' AND kind = 'reminder'"
  ).run(bookingId);
  if (!b.client_phone) return;
  enqueue(
    b.id, b.client_phone, "cancellation",
    `${branchName(b.branch_id)}: your booking for ${timeLabel(b.starts_at)} has been cancelled. Rebook any time — we'd love to see you.`,
    now()
  );
}

export function onServicePaid(bookingId: string, reviewToken?: string | null) {
  const b = getBooking(bookingId);
  if (!b?.client_phone) return;
  // send feedback request once only
  const already = db
    .prepare("SELECT id FROM notifications WHERE booking_id = ? AND kind = 'feedback'")
    .get(bookingId);
  if (already) return;
  const first = b.client_name.split(" ")[0];
  // personal single-use link so rating needs no login
  const link = reviewToken ? `${REVIEW_URL}/${reviewToken}` : REVIEW_URL;
  enqueue(
    b.id, b.client_phone, "feedback",
    `${branchName(b.branch_id)}: thanks for visiting, ${first}! How did we do? Rate your visit: ${link} — loved it? A Google review means the world: ${GOOGLE_REVIEW_URL}`,
    now()
  );
}

export function onInvoiceIssued(
  bookingId: string,
  invoiceNo: string,
  total: number,
  method: string
) {
  const b = getBooking(bookingId);
  if (!b?.client_phone) return;
  enqueue(
    b.id, b.client_phone, "invoice",
    `${branchName(b.branch_id)}: tax invoice ${invoiceNo} — AED ${total.toFixed(2)} paid by ${method}. Thank you, ${b.client_name.split(" ")[0]}!`,
    now()
  );
}

/* ---------------- scheduler ---------------- */

export async function drainDue(): Promise<number> {
  const due = db
    .prepare(
      "SELECT id, to_phone, body, attempts FROM notifications WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 20"
    )
    .all(new Date().toISOString()) as { id: string; to_phone: string; body: string; attempts: number }[];

  for (const n of due) {
    try {
      await provider.send(n.to_phone, n.body);
      db.prepare("UPDATE notifications SET status = 'sent', sent_at = ?, attempts = ? WHERE id = ?")
        .run(now(), n.attempts + 1, n.id);
    } catch (err) {
      const attempts = n.attempts + 1;
      const failedForGood = attempts >= MAX_ATTEMPTS;
      // exponential backoff: 1m, 4m, 9m, 16m
      const nextTry = new Date(Date.now() + attempts * attempts * 60_000).toISOString();
      db.prepare(
        "UPDATE notifications SET status = ?, attempts = ?, last_error = ?, scheduled_at = ? WHERE id = ?"
      ).run(
        failedForGood ? "failed" : "pending",
        attempts,
        String(err).slice(0, 300),
        failedForGood ? new Date().toISOString() : nextTry,
        n.id
      );
    }
  }
  return due.length;
}

export function startScheduler() {
  const timer = setInterval(() => {
    drainDue().catch((e) => console.error("notification drain failed:", e));
  }, DRAIN_INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the loop
  console.log(`notifications: scheduler running (provider: ${provider.name})`);
}
