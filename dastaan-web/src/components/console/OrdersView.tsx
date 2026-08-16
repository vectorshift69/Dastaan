"use client";

import { useCallback, useEffect, useState } from "react";
import { CURRENCY } from "@/lib/data";

type Order = {
  id: string; orderNo: string;
  items: { productId: string; name: string; qty: number; price: number }[];
  subtotal: number; discount: number; couponCode: string | null;
  vat: number; total: number; status: "placed" | "paid" | "fulfilled" | "cancelled";
  createdAt: string;
};

const NEXT: Record<Order["status"], { label: string; to: string }[]> = {
  placed: [{ label: "Mark paid", to: "paid" }, { label: "Cancel", to: "cancelled" }],
  paid: [{ label: "Mark fulfilled", to: "fulfilled" }, { label: "Cancel", to: "cancelled" }],
  fulfilled: [],
  cancelled: [],
};

const STATUS_STYLE: Record<Order["status"], string> = {
  placed: "bg-st-booked/12 text-st-booked",
  paid: "bg-st-confirmed/12 text-st-confirmed",
  fulfilled: "bg-st-started/12 text-st-started",
  cancelled: "bg-st-cancel/12 text-st-cancel",
};

export default function OrdersView() {
  const [rows, setRows] = useState<Order[]>([]);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/store/orders");
    if (res.status === 401 || res.status === 403) { setDenied(true); return; }
    setDenied(false);
    setRows(await res.json());
  }, []);

  useEffect(() => { load().catch(() => setDenied(true)); }, [load]);

  const move = async (id: string, to: string) => {
    const res = await fetch(`/api/store/orders/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? `Order moved to ${to}` : (d.error ?? "Failed"));
    load();
  };

  if (denied)
    return <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-charcoal/50">
      Online store orders and sales figures are visible to the Super Admin only.<br />Sign in at /team with the owner code.
    </div>;

  const revenue = rows.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Orders" value={String(rows.length)} />
        <Kpi label="Store revenue" value={`${CURRENCY} ${revenue.toLocaleString()}`} gold />
        <Kpi label="Awaiting payment" value={String(rows.filter((o) => o.status === "placed").length)} />
        <Kpi label="To fulfil" value={String(rows.filter((o) => o.status === "paid").length)} />
      </div>

      {msg && <p className="mt-3 rounded-lg bg-paper px-4 py-2 text-sm text-charcoal/70">{msg}</p>}

      <div className="mt-5 space-y-3">
        {rows.map((o) => (
          <div key={o.id} className="rounded-2xl border border-black/8 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-bold text-ink">{o.orderNo}</p>
                <p className="text-xs text-charcoal/45">
                  {new Date(o.createdAt).toLocaleString("en-AE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase ${STATUS_STYLE[o.status]}`}>
                {o.status}
              </span>
            </div>

            <div className="mt-3 space-y-1 text-sm">
              {o.items.map((it) => (
                <div key={it.productId} className="flex justify-between text-charcoal/70">
                  <span>{it.qty}× {it.name}</span>
                  <span>{CURRENCY} {(it.price * it.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-black/10 pt-3">
              <div className="text-xs text-charcoal/55">
                {o.discount > 0 && <span className="mr-3">Discount {o.couponCode ? `(${o.couponCode})` : ""} −{CURRENCY} {o.discount.toFixed(2)}</span>}
                <span>incl. VAT {CURRENCY} {o.vat.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display text-xl text-ink">{CURRENCY} {o.total.toFixed(2)}</span>
                {NEXT[o.status].map((n) => (
                  <button
                    key={n.to}
                    onClick={() => move(o.id, n.to)}
                    className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                      n.to === "cancelled"
                        ? "border border-black/12 text-charcoal/60 hover:border-st-cancel hover:text-st-cancel"
                        : "bg-ink text-gold-2 hover:bg-coal-2"
                    }`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="p-6 text-sm text-charcoal/45">No online orders yet.</p>}
      </div>
    </div>
  );
}

function Kpi({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${gold ? "bg-ink text-gold-2" : "border border-black/8 bg-white"}`}>
      <p className={`text-[10px] font-bold tracking-[0.2em] uppercase ${gold ? "text-ivory/50" : "text-charcoal/45"}`}>{label}</p>
      <p className={`font-display mt-1.5 text-2xl ${gold ? "" : "text-ink"}`}>{value}</p>
    </div>
  );
}
