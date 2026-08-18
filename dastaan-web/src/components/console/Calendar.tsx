"use client";

import { useEffect, useState } from "react";
import {
  DAY_START,
  DAY_END,
  toMin,
  toLabel,
  svcById,
  STATUS_COLOR,
  type Appointment,
  type Barber,
} from "@/lib/data";
import { salonNowMinutes, salonToday } from "@/lib/time";

const PX_PER_MIN = 1.5; // 90px per hour

export default function Calendar({
  barbers,
  appointments,
  selectedId,
  onSelect,
  date,
}: {
  barbers: Barber[];
  appointments: Appointment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** the day being shown — the now-line only belongs on today */
  date?: string;
}) {
  /* Real salon time, refreshed every minute. Rendered on the client only:
     the server has no idea what time it is where the salon is, and a
     server-rendered value would be wrong the moment it hydrated. */
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMin(salonNowMinutes());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const showNow =
    nowMin !== null &&
    (date ?? salonToday()) === salonToday() &&
    nowMin >= DAY_START &&
    nowMin <= DAY_END;

  const hours: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) hours.push(m);
  const height = (DAY_END - DAY_START) * PX_PER_MIN;

  return (
    <div className="thin-scroll flex-1 overflow-auto">
      <div className="min-w-fit">
        {/* barber header row */}
        <div className="sticky top-0 z-20 flex border-b border-[#e2ddd0] bg-paper/95 backdrop-blur-sm">
          <div className="w-16 shrink-0" />
          {barbers.map((b) => (
            <div key={b.id} className="flex w-48 shrink-0 items-center gap-3 border-l border-[#eae6db] px-4 py-3">
              <div
                className="font-display flex h-9 w-9 items-center justify-center rounded-full text-xs text-white"
                style={{ background: `radial-gradient(circle at 35% 30%, ${b.tone}, #141414 80%)` }}
              >
                {b.initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-charcoal">{b.name}</p>
                <p className="text-[10px] tracking-wider text-charcoal/45 uppercase">{b.title}</p>
              </div>
            </div>
          ))}
        </div>

        {/* grid body */}
        <div className="relative flex">
          {/* time gutter */}
          <div className="relative w-16 shrink-0" style={{ height }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute right-2 -translate-y-1/2 text-[10px] font-semibold tracking-wide text-charcoal/40"
                style={{ top: (m - DAY_START) * PX_PER_MIN }}
              >
                {toLabel(m)}
              </span>
            ))}
          </div>

          {/* columns */}
          {barbers.map((b) => {
            const appts = appointments.filter((a) => a.barberId === b.id);
            return (
              <div
                key={b.id}
                className="relative w-48 shrink-0 border-l border-[#eae6db]"
                style={{ height }}
              >
                {/* hour lines */}
                {hours.slice(0, -1).map((m) => (
                  <div
                    key={m}
                    className="cal-hour absolute inset-x-0"
                    style={{ top: (m - DAY_START) * PX_PER_MIN, height: 60 * PX_PER_MIN }}
                  />
                ))}

                {/* appointment cards */}
                {appts.map((a) => {
                  const top = (toMin(a.start) - DAY_START) * PX_PER_MIN;
                  const h = a.minutes * PX_PER_MIN;
                  const color = STATUS_COLOR[a.status];
                  const muted = a.status === "Cancelled" || a.status === "No Show";
                  const selected = selectedId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => onSelect(a.id)}
                      className={`absolute inset-x-1 overflow-hidden rounded-lg border bg-white text-left shadow-card transition-all duration-200 hover:z-10 hover:-translate-y-px hover:shadow-lg ${
                        selected ? "z-10 ring-2 ring-gold" : "border-black/5"
                      } ${muted ? "opacity-55" : ""}`}
                      style={{ top: top + 1, height: h - 2, borderLeft: `4px solid ${color}` }}
                    >
                      <div className="px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-bold tracking-wide text-charcoal/55">
                            {toLabel(toMin(a.start))} – {toLabel(toMin(a.start) + a.minutes)}
                          </span>
                          <span className="flex items-center gap-1">
                            {/* booking type: ✓ with barber · ⟳ online */}
                            <span title={a.online ? "Booked online" : "Booked with barber"} className="text-[11px]" style={{ color }}>
                              {a.online ? "⟳" : "✓"}
                            </span>
                            {/* payment: filled = paid, outline = unpaid */}
                            <span
                              title={a.paid ? "Paid" : "Unpaid"}
                              className="inline-block h-2.5 w-2.5 rounded-full border"
                              style={{
                                borderColor: color,
                                background: a.paid ? color : "transparent",
                              }}
                            />
                          </span>
                        </div>
                        <p className={`mt-0.5 truncate text-[12.5px] font-bold text-ink ${muted ? "line-through" : ""}`}>
                          {a.client}
                        </p>
                        <p className="truncate text-[11px] text-charcoal/60">
                          {a.serviceIds.map((id) => svcById(id).name).join(" + ")}
                        </p>
                        {h > 80 && (
                          <span
                            className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase"
                            style={{ background: color }}
                          >
                            {a.status}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* now line — salon time, and only on today */}
          {showNow && (
            <div
              className="pointer-events-none absolute right-0 left-16 z-10 flex items-center"
              style={{ top: (nowMin! - DAY_START) * PX_PER_MIN }}
              title={`Now — ${toLabel(nowMin!)} in Dubai`}
            >
              <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-[#c0392b]" />
              <div className="h-px flex-1 bg-[#c0392b]/70" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
