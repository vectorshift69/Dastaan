/* ------------------------------------------------------------------ */
/* Visit-based store credit: every 5th completed visit (a checked-out  */
/* booking) earns the client AED 25 credit, automatically, redeemable  */
/* against a store order. A ledger records every grant and redemption  */
/* so the running balance is always reconstructable, the same pattern  */
/* as points_transactions in loyalty.ts.                                */
/* ------------------------------------------------------------------ */

import { db, uid, now } from "./db.js";

const VISITS_PER_REWARD = 5;
const REWARD_AMOUNT = 25;

export type CreditAccount = {
  id: string;
  clientId: string;
  balance: number;
  visitCount: number;
};

type Row = { id: string; client_id: string; balance: number; visit_count: number };

const toApi = (r: Row): CreditAccount => ({
  id: r.id, clientId: r.client_id, balance: r.balance, visitCount: r.visit_count,
});

export async function ensureCreditAccount(clientId: string): Promise<CreditAccount> {
  const existing = await db.prepare("SELECT * FROM client_credit_accounts WHERE client_id = ?").get(clientId) as Row | undefined;
  if (existing) return toApi(existing);
  const id = uid();
  await db.prepare(
    "INSERT INTO client_credit_accounts (id, client_id, balance, visit_count, created_at) VALUES (?,?,0,0,?)"
  ).run(id, clientId, now());
  return { id, clientId, balance: 0, visitCount: 0 };
}

/** Called once per completed checkout. Returns the credit granted, if any (0 on visits that don't complete a set of five). */
export async function recordVisit(clientId: string, bookingId: string): Promise<number> {
  const acc = await ensureCreditAccount(clientId);
  const visitCount = acc.visitCount + 1;
  const earnsReward = visitCount % VISITS_PER_REWARD === 0;
  await db.prepare(
    "UPDATE client_credit_accounts SET visit_count = ?, balance = balance + ? WHERE id = ?"
  ).run(visitCount, earnsReward ? REWARD_AMOUNT : 0, acc.id);
  if (earnsReward) {
    await db.prepare(
      `INSERT INTO client_credit_transactions (id, account_id, delta, reason, booking_id, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(uid(), acc.id, REWARD_AMOUNT, "visit_reward", bookingId, now());
    return REWARD_AMOUNT;
  }
  return 0;
}

/** Cash change the client asked staff to hold toward a future visit, added
 *  straight to their store-credit balance at checkout. A separate ledger
 *  reason from the automatic 5-visit reward keeps the two distinguishable
 *  in a client's transaction history. */
export async function creditWallet(clientId: string, amount: number, bookingId: string): Promise<void> {
  if (amount <= 0) return;
  const acc = await ensureCreditAccount(clientId);
  await db.prepare("UPDATE client_credit_accounts SET balance = balance + ? WHERE id = ?").run(amount, acc.id);
  await db.prepare(
    `INSERT INTO client_credit_transactions (id, account_id, delta, reason, booking_id, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(uid(), acc.id, amount, "cash_held_at_checkout", bookingId, now());
}

export async function creditBalanceFor(clientId: string): Promise<{
  balance: number;
  visitCount: number;
  visitsToNextReward: number;
}> {
  const acc = await ensureCreditAccount(clientId);
  const visitsToNextReward = VISITS_PER_REWARD - (acc.visitCount % VISITS_PER_REWARD);
  return { balance: acc.balance, visitCount: acc.visitCount, visitsToNextReward };
}

/** Redeems up to `amount` of the client's credit against an order. Returns how much was actually applied (never more than the balance). */
export async function redeemCredit(clientId: string, amount: number, orderId: string): Promise<number> {
  if (amount <= 0) return 0;
  const acc = await ensureCreditAccount(clientId);
  const applied = Math.min(acc.balance, amount);
  if (applied <= 0) return 0;
  await db.prepare("UPDATE client_credit_accounts SET balance = balance - ? WHERE id = ?").run(applied, acc.id);
  await db.prepare(
    `INSERT INTO client_credit_transactions (id, account_id, delta, reason, order_id, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(uid(), acc.id, -applied, "store_redemption", orderId, now());
  return applied;
}
