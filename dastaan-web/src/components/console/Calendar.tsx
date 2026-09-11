"use client";

import { useEffect, useState } from "react";
import {
  DAY_START,
  DAY_END,
  toMin,
  toLabel,
  svcById,
  STATUS_COLOR,
  categoryColorFor,
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

  /* Mobile: one barber's day at a time — the desktop's side-by-side columns
     don't fit a phone screen, and shrinking them further just makes every
     card unreadable. A phone gets a barber switcher instead. Kept as its own
     piece of state (not derived from `barbers[0]`) so switching barbers
     doesn't fight the desktop layout, which shows all of them at once. */
  const [mobileBarberId, setMobileBarberId] = useState<string | null>(barbers[0]?.id ?? null);
  useEffect(() => {
    if (!barbers.some((b) => b.id === mobileBarberId)) setMobileBarberId(barbers[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbers]);
  const mobileBarber = barbers.find((b) => b.id === mobileBarberId) ?? null;

  const NowLine = () => (
    <div
      className="pointer-events-none absolute right-0 left-16 z-10 flex items-center"
      style={{ top: (nowMin! - DAY_START) * PX_PER_MIN }}
      title={`Now — ${toLabel(nowMin!)} in Dubai`}
    >
      <span className="-ml-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#c0392b]" />
      <div className="h-px flex-1 bg-[#c0392b]/70" />
    </div>
  );

  return (
    <div className="thin-scroll flex-1 overflow-auto">
      {/* ============ desktop: every barber, side by side ============ */}
      <div className="hidden min-w-fit md:block">
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

        <div className="relative flex">
          <TimeGutter hours={hours} height={height} />
          {barbers.map((b) => (
            <BarberColumn
              key={b.id}
              widthClass="w-48 shrink-0"
              appts={appointments.filter((a) => a.barberId === b.id)}
              hours={hours}
              height={height}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {showNow && <NowLine />}
        </div>
      </div>

      {/* ============ mobile: one barber, with a switcher ============ */}
      <div className="md:hidden">
        <div className="sticky top-0 z-20 flex gap-1.5 overflow-x-auto border-b border-[#e2ddd0] bg-paper/95 px-3 py-2.5 backdrop-blur-sm">
          {barbers.map((b) => (
            <button
              key={b.id}
              onClick={() => setMobileBarberId(b.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                mobileBarberId === b.id ? "border-ink bg-ink text-gold-2" : "border-black/12 text-charcoal/70"
              }`}
            >
              <span
                className="font-display flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-white"
                style={{ background: `radial-gradient(circle at 35% 30%, ${b.tone}, #141414 80%)` }}
              >
                {b.initials}
              </span>
              {b.name}
            </button>
          ))}
        </div>

        {mobileBarber ? (
          <div className="relative flex">
            <TimeGutter hours={hours} height={height} />
            <BarberColumn
              widthClass="flex-1"
              appts={appointments.filter((a) => a.barberId === mobileBarber.id)}
              hours={hours}
              height={height}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            {showNow && <NowLine />}
          </div>
        ) : (
          <p className="p-6 text-center text-sm text-charcoal/45">No barbers at this branch.</p>
        )}
      </div>
    </div>
  );
}

function TimeGutter({ hours, height }: { hours: number[]; height: number }) {
  return (
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
  );
}

/** One barber's column of appointment cards — shared by the desktop grid
 *  (fixed width, many side by side) and the mobile single-barber view
 *  (full width, one at a time), so the two can never drift apart. */
function BarberColumn({
  widthClass,
  appts,
  hours,
  height,
  selectedId,
  onSelect,
}: {
  widthClass: string;
  appts: Appointment[];
  hours: number[];
  height: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={`relative border-l border-[#eae6db] ${widthClass}`} style={{ height }}>
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
        /* Checked out early — the card only spans the actual visit, not the
           original estimate, so the freed remainder of the slot reads as
           open (same blank space any free chair has). */
        const scheduledEnd = toMin(a.start) + a.minutes;
        const completedMin = a.completed !== undefined ? Math.max(toMin(a.start), toMin(a.completed)) : undefined;
        const ranShort = completedMin !== undefined && completedMin < scheduledEnd;
        const effectiveEnd = ranShort ? completedMin : scheduledEnd;
        const shownMinutes = Math.max(15, effectiveEnd - toMin(a.start));
        const h = shownMinutes * PX_PER_MIN;
        const color = STATUS_COLOR[a.status];
        const catColor = categoryColorFor(a.serviceIds);
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
                <span className="text-[10px] font-bold tracking-wide text-charcoal/55" title={ranShort ? "Checked out early — rest of the slot is free" : undefined}>
                  {toLabel(toMin(a.start))} – {toLabel(effectiveEnd)}
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
              <p className="flex items-center gap-1 truncate text-[11px] text-charcoal/60">
                {catColor && (
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: catColor }}
                    title={svcById(a.serviceIds[0]!).category}
                  />
                )}
                <span className="truncate">{a.serviceIds.map((id) => svcById(id).name).join(" + ")}</span>
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
}
