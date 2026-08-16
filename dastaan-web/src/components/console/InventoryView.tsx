"use client";

import { useCallback, useEffect, useState } from "react";
import { CURRENCY, branches } from "@/lib/data";

type StockRow = {
  productId: string; name: string; sku: string | null; category: string;
  kind: "retail" | "supply"; price: number; branchId: string; qty: number;
  reorderAt: number; low: number;
};
type Movement = { id: string; name: string; branchId: string; delta: number; reason: string; note: string | null; createdAt: string };

export default function InventoryView({ role }: { role: string }) {
  const isSuper = role === "super_admin";
  const [branchId, setBranchId] = useState("b1");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [denied, setDenied] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "receive" | "adjust"; row: StockRow } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = isSuper ? `?branchId=${branchId}` : "";
    const [inv, mov] = await Promise.all([
      fetch(`/api/inventory${params}`),
      fetch(`/api/inventory/movements${params}`),
    ]);
    if (inv.status === 401 || inv.status === 403) { setDenied(true); return; }
    setDenied(false);
    setRows(await inv.json());
    if (mov.ok) setMovements((await mov.json()).slice(0, 12));
  }, [branchId, isSuper]);

  useEffect(() => { load().catch(() => setDenied(true)); }, [load]);

  if (denied) return <div className="flex flex-1 items-center justify-center p-10 text-sm text-charcoal/50">Inventory is staff-only. Sign in at /team.</div>;

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        {isSuper && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
            className="rounded-full border border-black/12 bg-white px-4 py-1.5 text-[13px] font-semibold outline-none">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.area}</option>)}
          </select>
        )}
        {isSuper && (
          <button onClick={() => setShowNew(!showNew)} className="btn-gold ml-auto rounded-full px-5 py-1.5 text-[13px]">
            + New product
          </button>
        )}
      </div>

      {msg && <p className="mt-3 rounded-lg bg-st-started/10 px-4 py-2 text-sm text-st-started">{msg}</p>}

      {showNew && isSuper && <NewProduct onDone={() => { setShowNew(false); setMsg("Product added"); load(); }} />}

      {/* stock table */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5">Kind</th>
              <th className="px-4 py-2.5 text-right">Price</th>
              <th className="px-4 py-2.5 text-right">In stock</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId + r.branchId} className="border-b border-black/5 last:border-0 hover:bg-paper/60">
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{r.name}</p>
                  <p className="text-xs text-charcoal/45">{r.sku ?? "—"} · {r.category}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${r.kind === "retail" ? "bg-gold/15 text-gold-dim" : "bg-black/6 text-charcoal/60"}`}>
                    {r.kind}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-charcoal/70">{r.kind === "retail" ? `${CURRENCY} ${r.price}` : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-bold ${r.low ? "text-st-cancel" : "text-ink"}`}>{r.qty}</span>
                  {!!r.low && <span className="ml-2 rounded-full bg-st-cancel/10 px-2 py-0.5 text-[10px] font-bold text-st-cancel uppercase">Low</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setDialog({ kind: "receive", row: r })} className="rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-gold">
                    Receive
                  </button>
                  {isSuper && (
                    <button onClick={() => setDialog({ kind: "adjust", row: r })} className="ml-2 rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-st-cancel">
                      Adjust
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* movements */}
      <section className="mt-5 rounded-2xl border border-black/8 bg-white p-5">
        <h3 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Recent movements</h3>
        <div className="mt-3 space-y-1.5 text-sm">
          {movements.map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b border-black/5 py-1.5 last:border-0">
              <span className="text-ink">{m.name}<span className="ml-2 text-xs text-charcoal/45">{m.reason.replaceAll("_", " ")}{m.note ? ` · ${m.note}` : ""}</span></span>
              <span className={`font-bold ${m.delta > 0 ? "text-st-started" : "text-st-cancel"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</span>
            </div>
          ))}
          {movements.length === 0 && <p className="text-charcoal/45">No movements yet.</p>}
        </div>
      </section>

      {dialog && (
        <StockDialog
          kind={dialog.kind}
          row={dialog.row}
          branchId={isSuper ? branchId : dialog.row.branchId}
          onClose={(changed) => { setDialog(null); if (changed) { setMsg("Stock updated"); load(); } }}
        />
      )}
    </div>
  );
}

function StockDialog({ kind, row, branchId, onClose }: {
  kind: "receive" | "adjust"; row: StockRow; branchId: string; onClose: (changed: boolean) => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const n = Number(qty);
    if (!n) { setErr(kind === "receive" ? "Enter a quantity" : "Enter a non-zero delta"); return; }
    const res = await fetch(`/api/inventory/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kind === "receive"
        ? { productId: row.productId, qty: Math.abs(Math.trunc(n)), note: note || undefined, branchId }
        : { productId: row.productId, branchId, delta: Math.trunc(n), note: note || undefined }),
    });
    if (res.ok) return onClose(true);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Failed");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel">
        <h3 className="text-lg font-bold text-ink">{kind === "receive" ? "Receive shipment" : "Adjust stock"}</h3>
        <p className="mt-1 text-sm text-charcoal/55">{row.name} · currently {row.qty}</p>
        <input
          value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9-]/g, ""))}
          placeholder={kind === "receive" ? "Quantity received" : "Delta (e.g. -3)"}
          className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
        />
        <input
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
          className="mt-2 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
        />
        {err && <p className="mt-2 text-sm text-st-cancel">{err}</p>}
        <div className="mt-4 flex gap-3">
          <button onClick={() => onClose(false)} className="flex-1 rounded-full border border-black/15 py-2.5 text-sm font-semibold text-charcoal/70">Cancel</button>
          <button onClick={submit} className="btn-gold flex-1 rounded-full py-2.5 text-sm font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}

function NewProduct({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", sku: "", category: "", kind: "retail", price: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name, sku: f.sku || undefined, category: f.category,
        kind: f.kind, price: Number(f.price) || 0,
      }),
    });
    if (res.ok) return onDone();
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Failed");
  };
  const input = "rounded-xl border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold";
  return (
    <div className="animate-fade-up mt-4 rounded-2xl border border-gold/40 bg-white p-5">
      <div className="grid gap-2 sm:grid-cols-5">
        <input className={input + " sm:col-span-2"} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={input} placeholder="SKU" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        <input className={input} placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="retail">Retail</option>
          <option value="supply">Supply</option>
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <input className={input + " w-40"} placeholder={`Price (${CURRENCY})`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })} />
        <button onClick={submit} className="btn-gold rounded-xl px-6 text-sm font-bold">Add product</button>
        {err && <p className="self-center text-sm text-st-cancel">{err}</p>}
      </div>
    </div>
  );
}
