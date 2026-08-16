/* Coupon engine (PRD 8). Creation is Super-Admin-only (open item #2
   recommendation); redemption works at both POS checkout (services) and
   the online store (products). All validation is server-side. */

import { db, uid, now } from "./db.js";

export type CouponRow = {
  id: string; code: string; type: "percent" | "fixed"; value: number;
  scope: "services" | "products" | "both"; min_amount: number;
  max_uses: number | null; uses: number; valid_from: string | null;
  valid_to: string | null; active: number;
};

export type CouponCheck =
  | { ok: true; coupon: CouponRow; discount: number }
  | { ok: false; reason: string };

/* Validate a code against an amount + context. Returns the discount. */
export function checkCoupon(
  code: string,
  amount: number,
  context: "services" | "products"
): CouponCheck {
  const c = db
    .prepare("SELECT * FROM coupons WHERE code = ?")
    .get(code.trim().toUpperCase()) as CouponRow | undefined;
  if (!c || !c.active) return { ok: false, reason: "Code not recognised" };
  if (c.scope !== "both" && c.scope !== context)
    return { ok: false, reason: `This code is only valid for ${c.scope}` };
  const nowIso = now();
  if (c.valid_from && nowIso < c.valid_from) return { ok: false, reason: "Code not active yet" };
  if (c.valid_to && nowIso > c.valid_to) return { ok: false, reason: "Code has expired" };
  if (c.max_uses !== null && c.uses >= c.max_uses) return { ok: false, reason: "Code fully redeemed" };
  if (amount < c.min_amount)
    return { ok: false, reason: `Minimum spend is AED ${c.min_amount}` };

  const raw = c.type === "percent" ? (amount * c.value) / 100 : c.value;
  const discount = Math.round(Math.min(raw, amount) * 100) / 100;
  return { ok: true, coupon: c, discount };
}

/* Record a successful redemption (call only after the sale is committed). */
export function redeemCoupon(
  couponId: string,
  context: string, // invoice:<id> | order:<id>
  amountSaved: number,
  clientId: string | null
) {
  db.prepare("UPDATE coupons SET uses = uses + 1 WHERE id = ?").run(couponId);
  db.prepare(
    "INSERT INTO coupon_redemptions (id, coupon_id, context, amount_saved, client_id, created_at) VALUES (?,?,?,?,?,?)"
  ).run(uid(), couponId, context, amountSaved, clientId, now());
}
