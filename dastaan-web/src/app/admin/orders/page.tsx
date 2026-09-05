"use client";

import { useEffect, useState } from "react";
import { CURRENCY } from "@/lib/data";

type AdminOrder = {
  id: string;
  orderNo: string;
  clientName: string;
  clientEmail: string;
  items: { productId: string; name: string; qty: number; price: number }[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  address: string;
  status: "placed" | "paid" | "fulfilled" | "cancelled";
  createdAt: string;
};

const STATUS_STYLE: Record<AdminOrder["status"], string> = {
  placed: "border-blue-400/50 text-blue-300",
  paid: "border-teal-400/50 text-teal-300",
  fulfilled: "border-green-400/50 text-green-300",
  cancelled: "border-red-400/50 text-red-300",
};

const STATUS_LABEL: Record<AdminOrder["status"], string> = {
  placed: "Placed",
  paid: "Paid",
  fulfilled: "Shipped",
  cancelled: "Cancelled",
};

export default function AdminOrders() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/store/orders/admin")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(setOrders)
      .catch((e) => setError(e.message ?? "Failed to load orders"));
  }, []);

  return (
    <div>
      <h1 className="font-display text-4xl font-medium text-ivory">Online Orders</h1>
      <p className="mt-2 text-sm text-ivory/50">All store orders.</p>

      {error && (
        <div className="mt-8 rounded-2xl border border-red-400/30 bg-red-900/10 p-6 text-sm text-red-300">
          {error}
        </div>
      )}

      {orders === null && !error && (
        <p className="mt-10 text-sm text-ivory/45">Loading…</p>
      )}

      {orders?.length === 0 && (
        <div className="mt-10 rounded-2xl border border-ivory/10 bg-coal p-8 text-center">
          <p className="text-sm text-ivory/55">No orders yet.</p>
        </div>
      )}

      {orders && orders.length > 0 && (
        <div className="mt-8 space-y-4">
          {orders.map((o) => (
            <div key={o.id} className="rounded-2xl border border-ivory/12 bg-coal p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ivory">{o.orderNo}</p>
                  <p className="mt-0.5 text-sm text-ivory/55">{o.clientName} · {o.clientEmail}</p>
                  <p className="mt-0.5 text-xs text-ivory/35">{new Date(o.createdAt).toLocaleString("en-AE")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-bold tracking-wider uppercase ${STATUS_STYLE[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                  <span className="font-display text-xl text-gold-2">{CURRENCY} {o.total.toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                {o.items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between text-sm">
                    <span className="text-ivory/70">{item.name} × {item.qty}</span>
                    <span className="text-ivory/50">{CURRENCY} {(item.price * item.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-ivory/8 pt-4 text-xs text-ivory/40">
                <span>Subtotal: {CURRENCY} {o.subtotal.toFixed(2)}</span>
                {o.discount > 0 && <span>Discount: −{CURRENCY} {o.discount.toFixed(2)}</span>}
                <span>VAT: {CURRENCY} {o.vat.toFixed(2)}</span>
                <span className="ml-auto max-w-sm truncate">📦 {o.address}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
