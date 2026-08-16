"use client";

import { useCallback, useEffect, useState } from "react";
import { CURRENCY } from "@/lib/data";

type Coupon = {
  id: string; code: string; type: "percent" | "fixed"; value: number;
  scope: "services" | "products" | "both"; minAmount: number;
  maxUses: number | null; uses: number; validFrom: string | null;
  validTo: string | null; active: number;
};

export default function CouponsView() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [denied, setDenied] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/coupons");
    if (res.status === 401 || res.status === 403) { setDenied(true); return; }
    setDenied(false);
    setRows(await res.json());
  }, []);

  useEffect(() => { load().catch(() => setDenied(true)); }, [load]);

  const deactivate = async (id: string) => {
    await fetch(`/api/coupons/${id}`, { method: "DELETE" });
    setMsg("Coupon deactivated");
    load();
  };

  if (denied)
    return <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-charcoal/50">
      Coupons are managed by the Super Admin only.<br />Sign in at /team with the owner code.
    </div>;

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      <div className="flex items-center">
        <p className="text-sm text-charcoal/55">{rows.filter((r) => r.active).length} active · {rows.length} total</p>
        <button onClick={() => setShowNew(!showNew)} className="btn-gold ml-auto rounded-full px-5 py-1.5 text-[13px]">
          + New coupon
        </button>
      </div>

      {msg && <p className="mt-3 rounded-lg bg-st-started/10 px-4 py-2 text-sm text-st-started">{msg}</p>}
      {showNew && <NewCoupon onDone={() => { setShowNew(false); setMsg("Coupon created"); load(); }} />}

      <div className="mt-5 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Discount</th>
              <th className="px-4 py-2.5">Scope</th>
              <th className="px-4 py-2.5 text-right">Min spend</th>
              <th className="px-4 py-2.5 text-right">Used</th>
              <th className="px-4 py-2.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={`border-b border-black/5 last:border-0 hover:bg-paper/60 ${c.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-3 font-mono font-bold tracking-wider text-ink">{c.code}</td>
                <td className="px-4 py-3 text-charcoal/75">
                  {c.type === "percent" ? `${c.value}%` : `${CURRENCY} ${c.value}`}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-black/6 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-charcoal/60 uppercase">{c.scope}</span>
                </td>
                <td className="px-4 py-3 text-right text-charcoal/60">{c.minAmount ? `${CURRENCY} ${c.minAmount}` : "—"}</td>
                <td className="px-4 py-3 text-right text-charcoal/75">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {c.active ? (
                    <button onClick={() => deactivate(c.id)} className="rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-st-cancel hover:text-st-cancel">
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-xs font-bold tracking-wider text-charcoal/40 uppercase">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-charcoal/45">No coupons yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCoupon({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ code: "", type: "percent", value: "", scope: "both", minAmount: "", maxUses: "" });
  const [err, setErr] = useState<string | null>(null);
  const input = "rounded-xl border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold";

  const submit = async () => {
    setErr(null);
    const res = await fetch("/api/coupons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: f.code.trim(),
        type: f.type,
        value: Number(f.value) || 0,
        scope: f.scope,
        minAmount: Number(f.minAmount) || 0,
        maxUses: f.maxUses ? Number(f.maxUses) : null,
      }),
    });
    if (res.ok) return onDone();
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Failed");
  };

  return (
    <div className="animate-fade-up mt-4 rounded-2xl border border-gold/40 bg-white p-5">
      <div className="grid gap-2 sm:grid-cols-6">
        <input className={input + " sm:col-span-2"} placeholder="CODE" value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="percent">% off</option>
          <option value="fixed">{CURRENCY} off</option>
        </select>
        <input className={input} placeholder="Value" value={f.value}
          onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^0-9.]/g, "") })} />
        <select className={input} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
          <option value="both">Both</option>
          <option value="services">Services</option>
          <option value="products">Products</option>
        </select>
        <input className={input} placeholder="Min spend" value={f.minAmount}
          onChange={(e) => setF({ ...f, minAmount: e.target.value.replace(/[^0-9.]/g, "") })} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={input + " w-40"} placeholder="Max uses (blank = ∞)" value={f.maxUses}
          onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/[^0-9]/g, "") })} />
        <button onClick={submit} className="btn-gold rounded-xl px-6 text-sm font-bold">Create coupon</button>
        {err && <p className="self-center text-sm text-st-cancel">{err}</p>}
      </div>
    </div>
  );
}
