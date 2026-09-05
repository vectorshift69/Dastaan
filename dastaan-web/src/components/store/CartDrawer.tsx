"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useConfig } from "@/lib/config";
import { CURRENCY } from "@/lib/data";
import StripePaymentForm from "@/components/StripePaymentForm";

type Placed = { orderNo: string; total: number; vat: number; discount: number };
type PendingOrder = Placed & { id: string };

export default function CartDrawer({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const { payments } = useConfig();
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  /* Everything is delivered — there is no collect-from-branch — so an
     address is the one thing we always have to ask for. Pre-filled from
     the user's saved profile when they're signed in. */
  const [address, setAddress] = useState("");

  /* Bug #11: pre-fill address from user profile */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.address && !address) setAddress(d.address);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Order has been created (unpaid) and is waiting on a card, or on the
     client choosing "pay on delivery" instead. */
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [paidOnline, setPaidOnline] = useState(false);

  const total = Math.max(0, cart.subtotal - (coupon?.discount ?? 0));

  const startPaymentIntent = async (orderId: string) => {
    setIntentLoading(true);
    setIntentError(null);
    try {
      const res = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntentError(d.error ?? "Could not start payment. You can still pay on delivery.");
        return;
      }
      setClientSecret(d.clientSecret);
    } catch {
      setIntentError("Can't reach the payment server. You can still pay on delivery.");
    } finally {
      setIntentLoading(false);
    }
  };

  const payOnDelivery = () => {
    if (pendingOrder) setPlaced(pendingOrder);
  };

  const applyCoupon = async () => {
    setCouponErr(null);
    if (!couponInput.trim()) return;
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), amount: cart.subtotal, context: "products" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setCoupon({ code: d.code, discount: d.discount });
      else if (res.status === 401) { setCoupon(null); setCouponErr("Sign in to use a code"); }
      else { setCoupon(null); setCouponErr(d.error ?? "Code not valid"); }
    } catch {
      setCouponErr("Can't reach the server");
    }
  };

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch("/api/store/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          couponCode: coupon?.code,
          address: address.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) { setNeedsSignIn(true); return; }
      if (!res.ok) { setError(d.error ?? "Could not place the order"); return; }
      const order: PendingOrder = { id: d.id, orderNo: d.orderNo, total: d.total, vat: d.vat, discount: d.discount };
      cart.clear();
      if (d.payment?.required) {
        setPendingOrder(order);
        await startPaymentIntent(order.id);
      } else {
        setPlaced(order);
      }
    } catch {
      setError("Can't reach the server");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm" onClick={onClose} />

      <aside className="animate-fade-in relative flex h-full w-full max-w-md flex-col border-l border-ivory/10 bg-coal shadow-panel">
        <header className="flex items-center justify-between border-b border-ivory/10 px-6 py-5">
          <h2 className="font-display text-xl text-ivory">
            {placed
              ? "Order placed"
              : pendingOrder
                ? "Payment"
                : `Your cart${cart.count ? ` · ${cart.count}` : ""}`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-ivory/45 hover:bg-white/5 hover:text-ivory">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </header>

        {/* ---- payment (order placed, unpaid, waiting on a card or "pay on delivery") ---- */}
        {pendingOrder && !placed ? (
          <div className="animate-fade-up flex flex-1 flex-col overflow-y-auto px-6 py-8">
            <p className="text-sm text-ivory/55">{pendingOrder.orderNo}</p>
            <h3 className="font-display mt-1 text-2xl text-ivory">
              {CURRENCY} {pendingOrder.total.toFixed(2)}
            </h3>

            <div className="mt-6">
              {intentLoading ? (
                <p className="text-sm text-ivory/45">Preparing payment…</p>
              ) : clientSecret ? (
                <StripePaymentForm
                  clientSecret={clientSecret}
                  amountLabel={`${CURRENCY} ${pendingOrder.total.toFixed(2)}`}
                  onSuccess={() => { setPaidOnline(true); setPlaced(pendingOrder); }}
                />
              ) : intentError ? (
                <>
                  <p className="animate-shake rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
                    {intentError}
                  </p>
                  <button
                    onClick={() => startPaymentIntent(pendingOrder.id)}
                    className="btn-ghost mt-4 rounded-full px-6 py-2.5 text-sm"
                  >
                    Try again
                  </button>
                </>
              ) : null}
            </div>

            <button onClick={payOnDelivery} className="btn-ghost mt-6 w-full rounded-full py-3 text-sm tracking-wide">
              Pay on delivery instead
            </button>
          </div>
        ) : placed ? (
          <div className="animate-fade-up flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold bg-gold/10">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e3c25e" strokeWidth="2"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p className="font-display mt-6 text-2xl text-ivory">{placed.orderNo}</p>
            <p className="mt-2 text-sm text-ivory/55">
              {CURRENCY} {placed.total.toFixed(2)} · incl. VAT {CURRENCY} {placed.vat.toFixed(2)}
            </p>
            <p className="mt-6 text-xs leading-relaxed text-ivory/40">
              {paidOnline
                ? "Payment received. We'll email you when it ships."
                : "We'll confirm your order and let you know when it ships. Pay on delivery."}
            </p>
            <Link href="/orders" className="btn-gold mt-8 rounded-full px-8 py-3 text-sm tracking-widest uppercase">
              View my orders
            </Link>
          </div>
        ) : cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <p className="text-sm text-ivory/50">Your cart is empty.</p>
            <button onClick={onClose} className="btn-ghost mt-6 rounded-full px-7 py-2.5 text-sm">Keep browsing</button>
          </div>
        ) : (
          <>
            {/* ---- lines ---- */}
            <div className="thin-scroll flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-3">
                {cart.lines.map((l) => (
                  <div key={l.productId} className="flex gap-4 rounded-2xl border border-ivory/10 bg-ink p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={l.image_url ?? `https://placehold.co/80x80/1a1a1a/c9a227?text=${encodeURIComponent(l.name.split(" ")[0])}`}
                      alt={l.name}
                      className="h-16 w-10 shrink-0 rounded-md object-contain ring-1 ring-gold/25"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ivory">{l.name}</p>
                      <p className="mt-0.5 text-xs text-ivory/45">{CURRENCY} {l.price} each</p>

                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex items-center rounded-full border border-ivory/20">
                          <Qty onClick={() => cart.setQty(l.productId, l.qty - 1)} label="Decrease">−</Qty>
                          <span className="w-8 text-center text-sm font-bold text-ivory">{l.qty}</span>
                          <Qty onClick={() => cart.setQty(l.productId, l.qty + 1)} label="Increase">+</Qty>
                        </div>
                        <button
                          onClick={() => cart.remove(l.productId)}
                          className="text-xs tracking-wider text-ivory/40 uppercase transition-colors hover:text-[#e08a80]"
                        >
                          Remove
                        </button>
                        <span className="ml-auto text-sm font-bold text-gold-2">
                          {CURRENCY} {(l.price * l.qty).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={cart.clear}
                className="mt-4 text-xs tracking-wider text-ivory/35 uppercase transition-colors hover:text-[#e08a80]"
              >
                Clear cart
              </button>

              {/* delivery */}
              <div className="mt-6">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Delivery address</span>
                <textarea
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setError(null); }}
                  rows={3}
                  placeholder="Building, apartment, area, emirate"
                  className="mt-2 w-full resize-none rounded-2xl border border-ivory/15 bg-ink px-4 py-3 text-sm text-ivory outline-none placeholder:text-ivory/25 focus:border-gold"
                />
                <p className="mt-1.5 text-[11px] text-ivory/30">We deliver anywhere in the UAE.</p>
              </div>

              {/* coupon */}
              <div className="mt-6">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Discount code</span>
                <div className="mt-2 flex gap-2">
                  <input
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCoupon(null); setCouponErr(null); }}
                    placeholder="e.g. WELCOME10"
                    className="flex-1 rounded-full border border-ivory/15 bg-ink px-4 py-2.5 text-sm tracking-wider text-ivory uppercase outline-none placeholder:text-ivory/25 focus:border-gold"
                  />
                  <button onClick={applyCoupon} className="btn-ghost rounded-full px-5 text-sm">Apply</button>
                </div>
                {coupon && <p className="mt-2 text-xs font-semibold text-gold-2">✓ {coupon.code} — {CURRENCY} {coupon.discount.toFixed(2)} off</p>}
                {couponErr && <p className="mt-2 text-xs text-[#e08a80]">{couponErr}</p>}
              </div>
            </div>

            {/* ---- footer ---- */}
            <footer className="border-t border-ivory/10 px-6 py-5">
              <div className="flex items-center justify-between text-sm text-ivory/55">
                <span>Subtotal</span>
                <span>{CURRENCY} {cart.subtotal.toFixed(2)}</span>
              </div>
              {coupon && (
                <div className="mt-1 flex items-center justify-between text-sm text-gold-2">
                  <span>{coupon.code}</span>
                  <span>− {CURRENCY} {coupon.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-ivory/10 pt-3">
                <span className="text-sm font-semibold text-ivory">Total</span>
                <span className="font-display text-2xl text-gold-2">{CURRENCY} {total.toFixed(2)}</span>
              </div>

              {needsSignIn ? (
                <div className="mt-4">
                  <p className="text-xs text-ivory/55">Sign in to place your order — your cart is saved.</p>
                  <Link href="/login" className="btn-gold mt-3 block rounded-full py-3 text-center text-sm tracking-widest uppercase">
                    Sign in
                  </Link>
                </div>
              ) : (
                <button
                  onClick={placeOrder}
                  disabled={placing || address.trim().length < 5}
                  title={address.trim().length < 5 ? "Add a delivery address first" : undefined}
                  className="btn-gold mt-4 w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:opacity-50"
                >
                  {placing ? "Placing…" : payments.online ? "Pay now" : "Place order"}
                </button>
              )}
              {error && <p className="mt-3 text-xs text-[#e08a80]">{error}</p>}
              <p className="mt-3 text-center text-[10px] tracking-wider text-ivory/30">
                Prices include 5% VAT · {payments.online ? "secure card payment" : "pay on delivery"}
              </p>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function Qty({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-ivory/70 transition-colors hover:bg-gold hover:text-ink"
    >
      {children}
    </button>
  );
}
