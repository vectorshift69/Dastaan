/* ------------------------------------------------------------------ */
/* Loyalty program (PRD 6): digital card, QR scannable at a webcam-    */
/* equipped POS, points earned automatically at checkout, Apple Wallet */
/* pass when Apple certificates are configured.                        */
/* Earn rule: 1 point per AED of the service total (gross) — points    */
/* remain a redeemable currency of their own. The TIER shown alongside */
/* them, though, is the same Bronze/Silver/Gold/Platinum spend tier as */
/* the admin Clients view (tiers.ts) — there used to be a second,      */
/* points-derived Member/Silver/Gold tier here, which meant a client   */
/* could be shown two different, disagreeing tiers depending on which  */
/* screen they looked at. One spend-based tier now, everywhere.        */
/* ------------------------------------------------------------------ */

import { randomBytes } from "node:crypto";
import { db, uid, now } from "./db.js";
import { tierForSpend, lifetimeSpend, type SpendTier } from "./tiers.js";

export type LoyaltyAccount = {
  id: string;
  clientId: string;
  qrToken: string;
  points: number;
  lifetimePoints: number;
  tier: SpendTier;
};

type Row = { id: string; client_id: string; qr_token: string; points: number; lifetime_points: number };

async function toApi(r: Row): Promise<LoyaltyAccount> {
  const spend = await lifetimeSpend(r.client_id);
  return {
    id: r.id,
    clientId: r.client_id,
    qrToken: r.qr_token,
    points: r.points,
    lifetimePoints: r.lifetime_points,
    tier: tierForSpend(spend),
  };
}

export async function ensureAccount(clientId: string): Promise<LoyaltyAccount> {
  const existing = await db
    .prepare("SELECT * FROM loyalty_accounts WHERE client_id = ?")
    .get(clientId) as Row | undefined;
  if (existing) return toApi(existing);
  const id = uid();
  const token = randomBytes(16).toString("hex");
  await db.prepare(
    "INSERT INTO loyalty_accounts (id, client_id, qr_token, created_at) VALUES (?,?,?,?)"
  ).run(id, clientId, token, now());
  return toApi({ id, client_id: clientId, qr_token: token, points: 0, lifetime_points: 0 });
}

export async function findByToken(token: string): Promise<(LoyaltyAccount & { clientName: string; clientPhone: string | null }) | null> {
  const r = await db
    .prepare(
      `SELECT a.*, u.name AS client_name, u.phone AS client_phone
       FROM loyalty_accounts a JOIN users u ON u.id = a.client_id
       WHERE a.qr_token = ?`
    )
    .get(token) as (Row & { client_name: string; client_phone: string | null }) | undefined;
  if (!r) return null;
  return { ...(await toApi(r)), clientName: r.client_name, clientPhone: r.client_phone };
}

export async function earnPoints(clientId: string, bookingId: string, amountAed: number): Promise<number> {
  const pts = Math.floor(amountAed);
  if (pts <= 0) return 0;
  const acc = await ensureAccount(clientId);
  await db.prepare(
    "UPDATE loyalty_accounts SET points = points + ?, lifetime_points = lifetime_points + ? WHERE id = ?"
  ).run(pts, pts, acc.id);
  await db.prepare(
    "INSERT INTO points_transactions (id, account_id, booking_id, delta, reason, created_at) VALUES (?,?,?,?,?,?)"
  ).run(uid(), acc.id, bookingId, pts, "service_checkout", now());
  return pts;
}

export async function recentTransactions(accountId: string, limit = 10) {
  return await db
    .prepare(
      `SELECT delta, reason, created_at AS "createdAt" FROM points_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(accountId, limit);
}

export async function loyaltyForClient(clientId: string): Promise<LoyaltyAccount | null> {
  const r = await db.prepare("SELECT * FROM loyalty_accounts WHERE client_id = ?").get(clientId) as Row | undefined;
  return r ? await toApi(r) : null;
}
