/* ------------------------------------------------------------------ */
/* Client spend tier — a badge on the client's profile and in the      */
/* admin client list, driven purely by lifetime spend across both      */
/* bookings and the online store. Recomputed on every read rather than */
/* stored, so it is never out of sync with the invoices/orders it is   */
/* based on and needs no upkeep when either changes.                   */
/*                                                                     */
/* This is separate from the points-based loyalty card (loyalty.ts):   */
/* that program earns redeemable points from booking checkouts only;   */
/* this tier is a read-only status badge covering all spend.           */
/* ------------------------------------------------------------------ */

import { db } from "./db.js";

export type SpendTier = "Bronze" | "Silver" | "Gold" | "Platinum";

const THRESHOLDS: { tier: SpendTier; at: number }[] = [
  { tier: "Bronze", at: 0 },
  { tier: "Silver", at: 500 },
  { tier: "Gold", at: 1500 },
  { tier: "Platinum", at: 5000 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export const tierForSpend = (spend: number): SpendTier =>
  spend >= 5000 ? "Platinum" : spend >= 1500 ? "Gold" : spend >= 500 ? "Silver" : "Bronze";

/** Lifetime AED spend for a registered client: paid service invoices + paid/fulfilled store orders. */
export async function lifetimeSpend(clientId: string): Promise<number> {
  const bookings = await db.prepare(
    `SELECT COALESCE(SUM(i.total), 0) AS total
     FROM invoices i JOIN bookings b ON b.id = i.booking_id
     WHERE b.client_id = ?`
  ).get<{ total: number }>(clientId);
  const orders = await db.prepare(
    `SELECT COALESCE(SUM(o.total), 0) AS total FROM orders o
     WHERE o.client_id = ? AND o.status IN ('paid', 'fulfilled')`
  ).get<{ total: number }>(clientId);
  return r2(Number(bookings?.total ?? 0) + Number(orders?.total ?? 0));
}

export async function spendTierFor(clientId: string): Promise<{
  tier: SpendTier;
  spend: number;
  nextTier: { name: SpendTier; at: number } | null;
}> {
  const spend = await lifetimeSpend(clientId);
  const tier = tierForSpend(spend);
  const idx = THRESHOLDS.findIndex((t) => t.tier === tier);
  const next = THRESHOLDS[idx + 1] ?? null;
  return { tier, spend, nextTier: next ? { name: next.tier, at: next.at } : null };
}
