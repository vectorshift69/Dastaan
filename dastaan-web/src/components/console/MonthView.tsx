"use client";

/* ------------------------------------------------------------------ */
/* Month overview.                                                     */
/*                                                                     */
/* The console could only ever show today, which made the history in   */
/* the database unreachable from the screen. This is the way in: a     */
/* month at a glance, click a day to open it.                          */
/*                                                                     */
/* The owner sees takings per day; reception sees appointment counts   */
/* only, because turnover is not theirs to see. The server decides     */
/* that — it simply doesn't send revenue to an admin.                  */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";
import { CURRENCY } from "@/lib/data";
import { addMonth, monthGrid, salonToday } from "@/lib/time";

type Day = {
  date: string;
  total: number;
  served: number;
  cancelled: number;
  noShows: number;
  revenue: number | null;
};

const MONTH_NAME = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-AE", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

export default function MonthView({
  branchId,
  onPickDay,
}: {
  branchId: string;
  onPickDay: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => salonToday().slice(0, 7));
  const [days, setDays] = useState<Record<string, Day>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings/month?month=${month}&branchId=${branchId}`);
      if (res.status === 401 || res.status === 403) { setDenied(true); return; }
      setDenied(false);
      const data: { days: Day[] } = await res.json();
      setDays(Object.fromEntries(data.days.map((d) => [d.date, d])));
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [month, branchId]);

  useEffect(() => { load(); }, [load]);

  if (denied)
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-charcoal/50">
        The month view is available to reception and the owner.
      </div>
    );

  const { firstWeekday, days: dayCount, year, month: mNum } = monthGrid(month);
  const today = salonToday();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, i) =>
      `${year}-${String(mNum).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
  ];

  const monthTotal = Object.values(days).reduce((n, d) => n + d.total, 0);
  const monthRevenue = Object.values(days).reduce((n, d) => n + (d.revenue ?? 0), 0);
  const showsRevenue = Object.values(days).some((d) => d.revenue !== null);

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      {/* month stepper */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setMonth(addMonth(month, -1))}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-charcoal/60 hover:bg-black/5 hover:text-ink"
        >‹</button>
        <h2 className="font-display min-w-52 text-center text-xl font-semibold text-ink">
          {MONTH_NAME(month)}
        </h2>
        <button
          onClick={() => setMonth(addMonth(month, 1))}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-charcoal/60 hover:bg-black/5 hover:text-ink"
        >›</button>

        <div className="ml-auto flex items-center gap-5 text-sm">
          <span className="text-charcoal/60">
            <span className="font-bold text-ink">{monthTotal}</span> appointments
          </span>
          {showsRevenue && (
            <span className="text-charcoal/60">
              <span className="font-bold text-gold-dim">
                {CURRENCY} {monthRevenue.toLocaleString()}
              </span> taken
            </span>
          )}
        </div>
      </div>

      {/* weekday headings */}
      <div className="mt-6 grid grid-cols-7 gap-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-bold tracking-[0.15em] text-charcoal/40 uppercase">
            {d}
          </div>
        ))}

        {cells.map((iso, i) => {
          if (!iso) return <div key={`pad${i}`} />;
          const d = days[iso];
          const isToday = iso === today;
          const isFuture = iso > today;
          return (
            <button
              key={iso}
              onClick={() => onPickDay(iso)}
              className={`min-h-24 rounded-xl border p-2.5 text-left transition-all hover:border-gold hover:shadow-sm ${
                isToday ? "border-gold bg-gold/8" : "border-black/8 bg-white"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-sm font-bold ${isToday ? "text-gold-dim" : "text-ink"}`}>
                  {Number(iso.slice(8))}
                </span>
                {d && d.total > 0 && (
                  <span className="text-[11px] font-semibold text-charcoal/50">{d.total}</span>
                )}
              </div>

              {d && d.total > 0 ? (
                <div className="mt-2 space-y-1">
                  {d.revenue !== null && d.revenue > 0 && (
                    <p className="text-[12px] font-bold text-gold-dim">
                      {CURRENCY} {d.revenue.toLocaleString()}
                    </p>
                  )}
                  <p className="text-[11px] text-charcoal/55">
                    {d.served} served
                    {isFuture && d.served === 0 ? "" : ""}
                  </p>
                  {(d.noShows > 0 || d.cancelled > 0) && (
                    <p className="text-[11px] text-st-cancel/80">
                      {d.noShows > 0 && `${d.noShows} no-show`}
                      {d.noShows > 0 && d.cancelled > 0 && " · "}
                      {d.cancelled > 0 && `${d.cancelled} cancelled`}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-charcoal/25">
                  {loading ? "" : isFuture ? "—" : "closed"}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-charcoal/40">
        Click any day to open its diary. History goes back as far as the salon’s records.
      </p>
    </div>
  );
}
