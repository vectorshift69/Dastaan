"use client";

import { useEffect, useState } from "react";
import { CURRENCY, branches, barbers } from "@/lib/data";

type Sales = {
  from: string; to: string; branchId: string; barberId: string;
  totals: { invoices: number; revenue: number; tips: number; vat: number; discounts: number };
  byDay: { date: string; revenue: number; count: number }[];
  byMethod: { method: string; revenue: number; count: number }[];
  byBranch: { branchId: string; revenue: number; count: number }[];
  byBarber: { barberId: string; name: string; revenue: number; count: number }[];
  topServices: { name: string; count: number; revenue: number }[];
};

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "This month", days: -1 }, // -1 = special-cased below
  { label: "90 days", days: 89 },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsView() {
  const [days, setDays] = useState(6);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [data, setData] = useState<Sales | null>(null);
  const [denied, setDenied] = useState(false);
  const [exporting, setExporting] = useState(false);

  /* the resolved from/to actually sent to the API — a custom range (either
     date typed in) wins over the day-count presets entirely */
  const range = (() => {
    if (customFrom || customTo) {
      const to = customTo || iso(new Date());
      const from = customFrom || to;
      return { from, to };
    }
    const to = new Date();
    const from = new Date();
    if (days === -1) from.setDate(1); // this month, from the 1st
    else from.setDate(to.getDate() - days);
    return { from: iso(from), to: iso(to) };
  })();

  useEffect(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (branchId) params.set("branchId", branchId);
    if (barberId) params.set("barberId", barberId);
    fetch(`/api/reports/sales?${params}`)
      .then(async (r) => {
        if (r.status === 403 || r.status === 401) { setDenied(true); return; }
        setDenied(false);
        setData(await r.json());
      })
      .catch(() => setDenied(true));
  }, [range.from, range.to, branchId, barberId]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (branchId) params.set("branchId", branchId);
      if (barberId) params.set("barberId", barberId);
      const res = await fetch(`/api/reports/sales/export?${params}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dastaan-sales-${range.from}_to_${range.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (denied)
    return (
      <Empty msg="Sales reports are visible to the Super Admin only. Sign in at /team with the owner code." />
    );
  if (!data) return <Empty msg="Loading report…" />;

  const maxDay = Math.max(1, ...data.byDay.map((d) => d.revenue));

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => { setDays(p.days); setCustomFrom(""); setCustomTo(""); }}
            className={`rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors ${
              !customFrom && !customTo && days === p.days ? "bg-ink text-gold-2" : "border border-black/12 text-charcoal/70 hover:border-black/35"
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 rounded-full border border-black/12 bg-white px-3 py-1">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-[120px] bg-transparent text-[12.5px] outline-none"
          />
          <span className="text-charcoal/35">–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-[120px] bg-transparent text-[12.5px] outline-none"
          />
        </div>
        <select
          value={barberId}
          onChange={(e) => setBarberId(e.target.value)}
          className="rounded-full border border-black/12 bg-white px-4 py-1.5 text-[13px] font-semibold outline-none"
        >
          <option value="">All barbers</option>
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="rounded-full border border-black/12 bg-white px-4 py-1.5 text-[13px] font-semibold outline-none"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.area}</option>
          ))}
        </select>
        <button
          onClick={exportXlsx}
          disabled={exporting}
          className="btn-gold ml-auto rounded-full px-5 py-1.5 text-[13px] disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "⬇ Export to Excel"}
        </button>
      </div>

      {/* KPI cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Revenue" value={`${CURRENCY} ${data.totals.revenue.toLocaleString()}`} gold />
        <Kpi label="Sales" value={String(data.totals.invoices)} />
        <Kpi label="Tips" value={`${CURRENCY} ${data.totals.tips.toLocaleString()}`} />
        <Kpi label="VAT collected" value={`${CURRENCY} ${data.totals.vat.toLocaleString()}`} />
        <Kpi label="Discounts given" value={`${CURRENCY} ${data.totals.discounts.toLocaleString()}`} />
      </div>

      {/* revenue by day */}
      <section className="mt-6 rounded-2xl border border-black/8 bg-white p-5">
        <h3 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Revenue by day</h3>
        {data.byDay.length === 0 ? (
          <p className="mt-6 text-sm text-charcoal/45">No sales in this period.</p>
        ) : (
          <div className="mt-4 flex h-40 items-end gap-2">
            {data.byDay.map((d) => (
              <div key={d.date} className="group relative flex max-w-24 min-w-8 flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-gold-dim to-gold-2 transition-all group-hover:from-ink group-hover:to-charcoal"
                  style={{ height: `${Math.max(4, (d.revenue / maxDay) * 130)}px` }}
                />
                <span className="mt-1.5 text-center text-[10px] font-semibold text-charcoal/45">{d.date.slice(5)}</span>
                <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[10px] font-bold whitespace-nowrap text-gold-2 opacity-0 transition-opacity group-hover:opacity-100">
                  {CURRENCY} {d.revenue}
                </div>
              </div>
            ))}
            <div className="flex-[99]" />
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* payment methods + branches */}
        <section className="rounded-2xl border border-black/8 bg-white p-5">
          <h3 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Payment methods</h3>
          <div className="mt-3 space-y-2">
            {data.byMethod.map((m) => (
              <BarRow key={m.method} label={m.method} value={m.revenue} max={data.totals.revenue} sub={`${m.count}×`} />
            ))}
            {data.byMethod.length === 0 && <p className="text-sm text-charcoal/45">—</p>}
          </div>
          <h3 className="mt-6 text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Branches</h3>
          <div className="mt-3 space-y-2">
            {data.byBranch.map((b) => (
              <BarRow
                key={b.branchId}
                label={branches.find((x) => x.id === b.branchId)?.area ?? b.branchId}
                value={b.revenue}
                max={data.totals.revenue}
                sub={`${b.count}×`}
              />
            ))}
          </div>
        </section>

        {/* top services */}
        <section className="rounded-2xl border border-black/8 bg-white p-5">
          <h3 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Top services</h3>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {data.topServices.map((s2, i) => (
                <tr key={s2.name} className="border-b border-black/5 last:border-0">
                  <td className="py-2 pr-2 text-charcoal/40">{i + 1}</td>
                  <td className="py-2 font-semibold text-ink">{s2.name}</td>
                  <td className="py-2 text-right text-charcoal/55">{s2.count}×</td>
                  <td className="py-2 text-right font-bold text-ink">{CURRENCY} {s2.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {data.topServices.length === 0 && (
                <tr><td className="py-4 text-charcoal/45">No sales yet in this period.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* by barber */}
        <section className="rounded-2xl border border-black/8 bg-white p-5">
          <h3 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">By barber</h3>
          <div className="mt-3 space-y-2">
            {data.byBarber.map((b) => (
              <BarRow key={b.barberId} label={b.name} value={b.revenue} max={data.totals.revenue} sub={`${b.count}×`} />
            ))}
            {data.byBarber.length === 0 && <p className="text-sm text-charcoal/45">No sales yet in this period.</p>}
          </div>
        </section>
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

function BarRow({ label, value, max, sub }: { label: string; value: number; max: number; sub: string }) {
  return (
    <div>
      <div className="flex justify-between text-[13px]">
        <span className="font-semibold text-ink">{label}</span>
        <span className="text-charcoal/55">{CURRENCY} {value.toLocaleString()} · {sub}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/6">
        <div className="h-full rounded-full bg-gradient-to-r from-gold-dim to-gold-2" style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="flex flex-1 items-center justify-center p-10 text-sm text-charcoal/50">{msg}</div>;
}
