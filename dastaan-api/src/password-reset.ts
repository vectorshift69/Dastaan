/* ------------------------------------------------------------------ */
/* Password reset links.                                               */
/*                                                                     */
/* The rules this follows, and why:                                     */
/*                                                                     */
/*  1. Only the SHA-256 of the token is stored. The token itself exists */
/*     in one email and nowhere else, so a leak of this table gives an  */
/*     attacker nothing usable. Same reasoning as never storing a       */
/*     password.                                                       */
/*                                                                     */
/*  2. Single use, and short-lived. A link sitting in a mailbox, or     */
/*     forwarded to the wrong person, is worth nothing after it is      */
/*     spent or after an hour.                                          */
/*                                                                     */
/*  3. Asking for a reset never says whether the account exists. The    */
/*     answer is identical either way — otherwise the form becomes a    */
/*     way to find out who is a client here, which for a salon is       */
/*     somebody's private business.                                     */
/*                                                                     */
/*  4. Requesting a new link kills the outstanding ones, so the most    */
/*     recent email is always the one that works.                       */
/* ------------------------------------------------------------------ */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db, uid, now } from "./db.js";
import { enqueueEmail } from "./notify/service.js";

const TTL_MINUTES = Number(process.env.RESET_TTL_MINUTES ?? 60);
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issue a reset token for a user and return the raw token.
 *
 * The caller decides what to do with it — email it to a client, or hand it
 * back to nobody at all. Any outstanding tokens for the same user are spent
 * first so only the newest link works.
 */
export async function issueResetToken(userId: string, ip?: string): Promise<string> {
  await db.prepare(
    "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
  ).run(now(), userId);

  const token = randomBytes(32).toString("base64url"); // 256 bits, URL-safe
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();
  await db.prepare(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at, requested_ip, created_at) VALUES (?,?,?,?,?,?)"
  ).run(uid(), userId, hashToken(token), expiresAt, ip ?? null, now());
  return token;
}

/** Queue the email. Plain text on purpose — it renders everywhere and cannot hide a link. */
export async function sendResetEmail(toEmail: string, name: string, token: string) {
  const link = `${APP_URL}/reset?token=${token}`;
  await enqueueEmail(
    toEmail,
    "password_reset",
    "Reset your Dastaan password",
    [
      `Hi ${name},`,
      ``,
      `Someone asked to reset the password on your Dastaan account. If that was you, open this link:`,
      ``,
      link,
      ``,
      `The link works once and expires in ${TTL_MINUTES} minutes.`,
      ``,
      `If it wasn't you, ignore this email — your password has not changed.`,
      ``,
      `Dastaan`,
    ].join("\n")
  );
}

export type ResetCheck =
  | { ok: true; userId: string; resetId: string }
  | { ok: false; reason: string };

/**
 * Look up a token without spending it.
 *
 * The lookup is by hash, so this is an indexed equality check rather than a
 * scan-and-compare; the timingSafeEqual below guards the final comparison out
 * of habit, since the hash is derived from attacker-supplied input.
 */
export async function checkResetToken(token: string): Promise<ResetCheck> {
  if (!token || token.length < 20) return { ok: false, reason: "That link is not valid" };
  const hash = hashToken(token);
  const row = await db.prepare(
    "SELECT id, user_id, token_hash, expires_at, used_at FROM password_resets WHERE token_hash = ?"
  ).get(hash) as
    | { id: string; user_id: string; token_hash: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!row) return { ok: false, reason: "That link is not valid" };

  const a = Buffer.from(row.token_hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: "That link is not valid" };

  if (row.used_at) return { ok: false, reason: "That link has already been used" };
  if (Date.parse(row.expires_at) < Date.now())
    return { ok: false, reason: "That link has expired — ask for a new one" };

  return { ok: true, userId: row.user_id, resetId: row.id };
}

/** Spend the token. Returns false if someone else spent it first. */
export async function consumeResetToken(resetId: string): Promise<boolean> {
  const res = await db.prepare(
    "UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL"
  ).run(now(), resetId);
  return res.changes > 0;
}
