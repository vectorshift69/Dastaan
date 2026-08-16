"use client";

import { useCallback, useEffect, useState } from "react";
import { CURRENCY } from "@/lib/data";

type ClientRow = {
  id: string | null; name: string; phone: string | null;
  visits: number; lastVisit: string | null; registered: boolean;
  loyalty: { tier: string; points: number } | null;
};

type Detail = {
  id: string; name: string; phone: string | null; userId: string | null;
  loyalty: { tier: string; points: number; lifetimePoints: number } | null;
  history: { id: string; startsAt: string; status: string; paid: boolean; stylist: string; services: string[] }[];
};

export default function ClientsView() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [denied, setDenied] = useState(false);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });

  const load = useCallback(async (term: string) => {
    const res = await fetch(`/api/clients?search=${encodeURIComponent(term)}`);
    if (res.status === 401 || res.status === 403) { setDenied(true); return; }
    setDenied(false);
    setRows(await res.json());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(search).catch(() => setDenied(true)); }, 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const open = async (id: string) => {
    const res = await fetch(`/api/clients/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setSelected(d);
    setForm({ name: d.name, phone: d.phone ?? "" });
    setEditing(false);
  };

  const save = async () => {
    if (!selected) return;
    const res = await fetch(`/api/clients/${selected.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, phone: form.phone || null }),
    });
    if (res.ok) { setEditing(false); open(selected.id); load(search); }
  };

  if (denied)
    return <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-charcoal/50">
      Client records are visible to reception and the owner only.
    </div>;

  return (
    <div className="flex min-h-0 flex-1">
      {/* list */}
      <div className="thin-scroll flex-1 overflow-y-auto p-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full max-w-sm rounded-full border border-black/12 bg-white px-5 py-2.5 text-sm outline-none focus:border-gold"
        />
        <p className="mt-3 text-xs text-charcoal/45">{rows.length} client{rows.length === 1 ? "" : "s"}</p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-black/8 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5 text-right">Visits</th>
                <th className="px-4 py-2.5 text-right">Last visit</th>
                <th className="px-4 py-2.5 text-right">Loyalty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={(c.id ?? c.name) + c.visits}
                  onClick={() => c.id && open(c.id)}
                  className={`border-b border-black/5 last:border-0 ${c.id ? "cursor-pointer hover:bg-paper/60" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{c.name}</p>
                    <p className="text-xs text-charcoal/45">
                      {c.phone ?? "no phone"}
                      {!c.registered && <span className="ml-2 rounded-full bg-black/6 px-2 py-0.5 text-[10px] tracking-wider uppercase">walk-in</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink">{c.visits}</td>
                  <td className="px-4 py-3 text-right text-charcoal/60">
                    {c.lastVisit ? new Date(c.lastVisit).toLocaleDateString("en-AE", { day: "numeric", month: "short" }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.loyalty ? (
                      <span className="rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-gold-dim uppercase">
                        ◆ {c.loyalty.tier} · {c.loyalty.points.toLocaleString()}
                      </span>
                    ) : <span className="text-charcoal/35">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-charcoal/45">No clients found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* detail panel */}
      {selected && (
        <aside className="animate-fade-in thin-scroll w-[380px] shrink-0 overflow-y-auto border-l border-[#e2ddd0] bg-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="font-display flex h-12 w-12 items-center justify-center rounded-full bg-ink text-lg text-gold-2">
                {selected.name[0]}
              </div>
              <div>
                <h2 className="text-[17px] font-bold text-ink">{selected.name}</h2>
                <p className="text-xs text-charcoal/55">{selected.phone ?? "no phone on file"}</p>
              </div>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close" className="rounded-full p-1.5 text-charcoal/40 hover:bg-black/5 hover:text-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
            </button>
          </div>

          {selected.loyalty && (
            <div className="mt-4 rounded-xl bg-ink px-4 py-3">
              <p className="text-[10px] tracking-[0.2em] text-ivory/45 uppercase">Loyalty</p>
              <p className="font-display mt-0.5 text-xl text-gold-2">
                {selected.loyalty.points.toLocaleString()} pts · {selected.loyalty.tier}
              </p>
            </div>
          )}

          {/* edit details */}
          <div className="mt-5">
            {editing ? (
              <div className="space-y-2">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold" placeholder="Name" />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-xl border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold" placeholder="Phone" />
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="flex-1 rounded-full border border-black/15 py-2 text-sm font-semibold text-charcoal/70">Cancel</button>
                  <button onClick={save} className="btn-gold flex-1 rounded-full py-2 text-sm font-bold">Save</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEditing(true)} className="rounded-full border border-black/12 px-4 py-1.5 text-xs font-bold hover:border-gold">
                Edit details
              </button>
            )}
          </div>

          <p className="mt-6 text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Booking history</p>
          <div className="mt-3 space-y-2">
            {selected.history.map((h) => (
              <div key={h.id} className="rounded-xl border border-black/8 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">
                    {new Date(h.startsAt).toLocaleDateString("en-AE", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <span className={`text-[10px] font-bold tracking-wider uppercase ${h.paid ? "text-st-started" : "text-charcoal/45"}`}>
                    {h.paid ? "paid" : h.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-charcoal/55">{h.services.join(" + ")} · {h.stylist}</p>
              </div>
            ))}
            {selected.history.length === 0 && <p className="text-sm text-charcoal/45">No bookings yet.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
