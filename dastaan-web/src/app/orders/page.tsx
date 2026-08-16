"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { CURRENCY } from "@/lib/data";

type Order = {
  id: string; orderNo: string;
  items: { productId: string; name: string; qty: number; price: number }[];
  subtotal: number; discount: number; couponCode: string | null;
  vat: number; total: number;
  status: "placed" | "paid" | "fulfilled" | "cancelled";
  createdAt: string;
};

const STATUS_COPY: Record<Order["status"], { label: string; tone: string }> = {
  placed: { label: "Placed", tone: "border-st-booked/50 text-[#8fb4dd]" },
  paid: { label: "Paid", tone: "border-st-confirmed/50 text-[#7fd0c5]" },
  fulfilled: { label: "Ready / collected", tone: "border-st-started/50 text-[#8fce92]" },
  cancelled: { label: "Cancelled", tone: "border-st-cancel/50 text-[#e08a80]" },
};

export default function MyOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    fetch("/api/store/orders")
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) { setSignedOut(true); return; }
        setOrders(await r.json());
      })
      .catch(() => setOrders([]));
  }, []);

  return (
    <div className="grain min-h-screen bg-ink text-ivory">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 pt-32 pb-24 lg:px-10">
        <p className="eyebrow">Your account</p>
        <h1 className="font-display mt-4 text-4xl font-medium md:text-6xl">My orders</h1>

        {signedOut && (
          <div className="mt-10 rounded-2xl border border-ivory/10 bg-coal p-8 text-center">
            <p className="text-sm text-ivory/55">Sign in to see your orders.</p>
            <Link href="/login" className="btn-gold mt-6 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
              Sign in
            </Link>
          </div>
        )}

        {!signedOut && orders === null && <p className="mt-10 text-sm text-ivory/45">Loading…</p>}

        {orders?.length === 0 && (
          <div className="mt-10 rounded-2xl border border-ivory/10 bg-coal p-8 text-center">
            <p className="text-sm text-ivory/55">No orders yet.</p>
            <Link href="/store" className="btn-gold mt-6 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
              Visit the store
            </Link>
          </div>
        )}

        <div className="mt-10 space-y-4">
          {orders?.map((o) => (
            <article key={o.id} className="rounded-2xl border border-ivory/10 bg-coal p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold text-ivory">{o.orderNo}</p>
                  <p className="mt-0.5 text-xs text-ivory/40">
                    {new Date(o.createdAt).toLocaleString("en-AE", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold tracking-widest uppercase ${STATUS_COPY[o.status].tone}`}>
                  {STATUS_COPY[o.status].label}
                </span>
              </div>

              <div className="mt-4 space-y-1.5 text-sm">
                {o.items.map((it) => (
                  <div key={it.productId} className="flex justify-between text-ivory/70">
                    <span>{it.qty}× {it.name}</span>
                    <span>{CURRENCY} {(it.price * it.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-end justify-between border-t border-dashed border-ivory/10 pt-4">
                <div className="text-xs text-ivory/40">
                  {o.discount > 0 && <p>Discount {o.couponCode ? `(${o.couponCode})` : ""} −{CURRENCY} {o.discount.toFixed(2)}</p>}
                  <p>incl. VAT {CURRENCY} {o.vat.toFixed(2)}</p>
                </div>
                <span className="font-display text-2xl text-gold-2">{CURRENCY} {o.total.toFixed(2)}</span>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
