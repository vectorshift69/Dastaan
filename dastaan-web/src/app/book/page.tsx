"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Logo from "@/components/Logo";
import {
  branches,
  services,
  barbers,
  CURRENCY,
  type Service,
} from "@/lib/data";

const STEPS = ["Branch", "Services", "Barber", "Time"] as const;

/* Local calendar date — never toISOString(), which would roll over to
   tomorrow after 20:00 in Dubai and book people into the wrong day. */
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const prettyDay = (iso: string, i: number) => {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-AE", { weekday: "short", day: "numeric", month: "short" });
};
/* "14:30" → "2:30 pm" */
const pretty = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? "pm" : "am"}`;
};

type Slot = { time: string; available: boolean };

export default function BookingWizard() {
  const [step, setStep] = useState(0);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string | "any" | null>(null);
  const [date, setDate] = useState<string>(localDay(0));
  const [slot, setSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branch = branches.find((b) => b.id === branchId);
  const branchBarbers = barbers.filter((b) => b.branchId === branchId);
  const pickedServices = picked.map((id) => services.find((s) => s.id === id)!) as Service[];
  const total = pickedServices.reduce((s, x) => s + x.price, 0);
  const minutes = pickedServices.reduce((s, x) => s + x.minutes, 0);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => localDay(i)), []);

  /* Ask the server what is actually free. Re-asked whenever the barber, the
     day or the length of the appointment changes — a longer appointment needs
     a longer gap, so the same grid can't be reused. */
  const loadSlots = useCallback(async () => {
    if (!branchId || !barberId || minutes === 0) return;
    setLoadingSlots(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/availability?branchId=${branchId}&barberId=${barberId}&date=${date}&minutes=${minutes}`
      );
      if (!res.ok) throw new Error();
      const data: { slots: Slot[] } = await res.json();
      setSlots(data.slots);
    } catch {
      setSlots([]);
      setError("Couldn’t load available times. Please try again.");
    } finally {
      setLoadingSlots(false);
    }
  }, [branchId, barberId, date, minutes]);

  useEffect(() => { if (step === 3) loadSlots(); }, [step, loadSlots]);

  /* a slot that was free when the grid loaded may have gone since */
  const chosenStillFree = slots.find((s) => s.time === slot)?.available ?? false;

  const canNext =
    (step === 0 && !!branchId) ||
    (step === 1 && picked.length > 0) ||
    (step === 2 && !!barberId) ||
    (step === 3 && !!slot && chosenStillFree && !booking);

  const toggleService = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (confirmed) {
    const b = barberId === "any" ? null : branchBarbers.find((x) => x.id === barberId);
    return (
      <div className="grain flex min-h-svh items-center justify-center bg-ink px-6">
        <div className="animate-fade-up w-full max-w-md text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-gold bg-gold/10 shadow-[0_0_50px_-10px_rgba(201,162,39,0.6)]">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#e3c25e" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="font-display mt-8 text-4xl font-medium text-ivory">Booking confirmed</h1>
          <p className="mt-4 text-sm leading-relaxed text-ivory/55">
            {pickedServices.map((s) => s.name).join(" + ")} · {slot ? pretty(slot) : ""}
            <br />
            {prettyDay(date, days.indexOf(date))}
            {days.indexOf(date) > 1 ? "" : ` · ${new Date(`${date}T12:00:00`).toLocaleDateString("en-AE", { weekday: "long", day: "numeric", month: "long" })}`}
            <br />
            {b ? `with ${b.name}` : "with the first available barber"} at {branch?.name}
          </p>
          <div className="gold-rule mx-auto my-8 w-24" />
          <p className="text-xs leading-relaxed tracking-wider text-ivory/35">
            A confirmation text has been sent to your phone.
            <br />
            You&apos;ll get a reminder 2 hours before your appointment.
          </p>
          <Link href="/" className="btn-gold mt-10 inline-block rounded-full px-10 py-3.5 text-sm tracking-widest uppercase">
            Done
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grain min-h-svh bg-ink pb-40 lg:pb-16">
      {/* header */}
      <header className="border-b border-ivory/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" aria-label="Dastaan — home" className="text-ivory transition-opacity hover:opacity-80">
            <Logo markClass="h-7 w-auto" wordClass="h-[19px] w-auto" />
          </Link>
          <Link href="/" className="text-sm text-ivory/45 hover:text-gold-2">
            Cancel
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-10 lg:px-10">
        {/* stepper */}
        <ol className="flex items-center gap-2 sm:gap-4">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2 sm:gap-4">
              <button
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-2.5 ${i < step ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                    i === step
                      ? "border-gold bg-gold text-ink"
                      : i < step
                        ? "border-gold/60 text-gold"
                        : "border-ivory/20 text-ivory/35"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span
                  className={`hidden text-xs font-semibold tracking-[0.15em] uppercase sm:block ${
                    i === step ? "text-ivory" : "text-ivory/35"
                  }`}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-ivory/12" />}
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_340px]">
          {/* ---------------- step content ---------------- */}
          <div className="animate-fade-up" key={step}>
            {step === 0 && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Choose your branch</h1>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => { setBranchId(b.id); setBarberId(null); }}
                      className={`rounded-2xl border p-7 text-left transition-all ${
                        branchId === b.id
                          ? "border-gold bg-gold/8 shadow-[0_0_40px_-15px_rgba(201,162,39,0.5)]"
                          : "border-ivory/12 bg-coal hover:border-ivory/30"
                      }`}
                    >
                      <p className="text-[11px] tracking-[0.28em] text-gold uppercase">{b.area}</p>
                      <h3 className="font-display mt-2 text-2xl text-ivory">{b.name}</h3>
                      <p className="mt-3 text-sm text-ivory/50">{b.address}</p>
                      <p className="mt-2 text-xs tracking-wide text-ivory/40">{b.hours}</p>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Pick your services</h1>
                <p className="mt-2 text-sm text-ivory/45">Select one or more.</p>
                <div className="mt-8 space-y-3">
                  {services.map((s) => {
                    const on = picked.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleService(s.id)}
                        className={`flex w-full items-center justify-between rounded-xl border px-6 py-4.5 text-left transition-all ${
                          on ? "border-gold bg-gold/8" : "border-ivory/12 bg-coal hover:border-ivory/30"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold transition-all ${
                              on ? "border-gold bg-gold text-ink" : "border-ivory/30 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          <div>
                            <p className="text-[15px] font-medium text-ivory">{s.name}</p>
                            <p className="mt-0.5 text-xs text-ivory/40">{s.minutes} min · {s.category}</p>
                          </div>
                        </div>
                        <span className="font-semibold text-gold">{CURRENCY} {s.price}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Choose your barber</h1>
                <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <button
                    onClick={() => setBarberId("any")}
                    className={`rounded-2xl border p-6 text-center transition-all ${
                      barberId === "any" ? "border-gold bg-gold/8" : "border-ivory/12 bg-coal hover:border-ivory/30"
                    }`}
                  >
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-ivory/30 text-2xl text-ivory/50">
                      ✦
                    </div>
                    <p className="mt-4 text-sm font-medium text-ivory">First available</p>
                    <p className="mt-1 text-[11px] tracking-wider text-ivory/40 uppercase">Fastest slot</p>
                  </button>
                  {branchBarbers.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setBarberId(b.id)}
                      className={`rounded-2xl border p-6 text-center transition-all ${
                        barberId === b.id ? "border-gold bg-gold/8" : "border-ivory/12 bg-coal hover:border-ivory/30"
                      }`}
                    >
                      <div
                        className="font-display mx-auto flex h-16 w-16 items-center justify-center rounded-full text-xl text-ivory/90"
                        style={{ background: `radial-gradient(circle at 35% 30%, ${b.tone}, #141414 75%)` }}
                      >
                        {b.initials}
                      </div>
                      <p className="mt-4 text-sm font-medium text-ivory">{b.name}</p>
                      <p className="mt-1 text-[11px] tracking-wider text-ivory/40 uppercase">
                        {b.title} · ★ {b.rating.toFixed(1)}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Pick a time</h1>
                <p className="mt-2 text-sm text-ivory/45">
                  {minutes} minutes needed · crossed-out times are already taken
                </p>

                {/* which day */}
                <div className="thin-scroll mt-6 flex gap-2 overflow-x-auto pb-2">
                  {days.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => { setDate(d); setSlot(null); }}
                      className={`shrink-0 rounded-full border px-4 py-2 text-xs tracking-wide transition-all ${
                        date === d
                          ? "border-gold bg-gold/10 text-gold-2 font-bold"
                          : "border-ivory/15 bg-coal text-ivory/70 hover:border-gold/50"
                      }`}
                    >
                      {prettyDay(d, i)}
                    </button>
                  ))}
                </div>

                {loadingSlots ? (
                  <p className="mt-8 text-sm text-ivory/45">Checking the diary…</p>
                ) : slots.length === 0 ? (
                  <p className="mt-8 text-sm text-ivory/55">
                    {error ?? "No times available on this day — try another."}
                  </p>
                ) : (
                  <>
                    <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                      {slots.map((s) => (
                        <button
                          key={s.time}
                          disabled={!s.available}
                          onClick={() => { setSlot(s.time); setError(null); }}
                          title={s.available ? undefined : "Already booked"}
                          className={`rounded-lg border py-3 text-sm transition-all ${
                            !s.available
                              ? "cursor-not-allowed border-ivory/6 text-ivory/20 line-through"
                              : slot === s.time
                                ? "border-gold bg-gold text-ink font-bold"
                                : "border-ivory/15 bg-coal text-ivory/80 hover:border-gold/60"
                          }`}
                        >
                          {pretty(s.time)}
                        </button>
                      ))}
                    </div>
                    {slots.every((s) => !s.available) && (
                      <p className="mt-5 text-sm text-ivory/55">
                        {barberId === "any"
                          ? "Fully booked that day. Try another date."
                          : "That barber is fully booked. Pick another day, or go back and choose “First available”."}
                      </p>
                    )}
                  </>
                )}

                {error && slots.length > 0 && (
                  <p className="animate-shake mt-5 rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          {/* ---------------- summary card ---------------- */}
          <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-ivory/10 bg-coal/95 p-5 backdrop-blur-md lg:static lg:h-fit lg:rounded-2xl lg:border lg:bg-coal lg:p-7">
            <p className="hidden text-[11px] tracking-[0.28em] text-gold uppercase lg:block">Your booking</p>
            <div className="mt-0 space-y-2.5 lg:mt-5">
              <SummaryRow label="Branch" value={branch ? branch.area : "—"} />
              <SummaryRow
                label="Services"
                value={picked.length ? `${picked.length} selected · ${minutes} min` : "—"}
              />
              <SummaryRow
                label="Barber"
                value={
                  barberId === "any"
                    ? "First available"
                    : barberId
                      ? branchBarbers.find((b) => b.id === barberId)?.name ?? "—"
                      : "—"
                }
              />
              <SummaryRow label="Day" value={prettyDay(date, days.indexOf(date))} />
              <SummaryRow label="Time" value={slot ? pretty(slot) : "—"} />
            </div>
            <div className="my-4 h-px bg-ivory/10 lg:my-5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-ivory/50">Total</span>
              <span className="font-display text-2xl text-gold-2">
                {CURRENCY} {total}
              </span>
            </div>
            <div className="mt-4 flex gap-3 lg:mt-6">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="btn-ghost flex-1 rounded-full py-3 text-sm tracking-wide"
                >
                  Back
                </button>
              )}
              <button
                disabled={!canNext}
                onClick={async () => {
                  if (step !== 3) return setStep(step + 1);
                  if (!slot) return;
                  setBooking(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/bookings", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        branchId, barberId, serviceIds: picked,
                        startsAt: `${date}T${slot}:00`,
                      }),
                    });

                    if (res.ok) { setConfirmed(true); return; }

                    /* Do NOT claim success when the server said no. The chair may
                       have been taken in the seconds since the grid loaded, so
                       reload it and let them pick again. */
                    const body = await res.json().catch(() => ({}));
                    if (res.status === 401) {
                      setError("Please sign in to confirm your booking.");
                    } else if (res.status === 409) {
                      setError(body.error ?? "That slot has just been taken — please pick another.");
                      setSlot(null);
                      await loadSlots();
                    } else {
                      setError(body.error ?? "Couldn’t confirm that booking. Please try again.");
                      await loadSlots();
                    }
                  } catch {
                    setError("Can’t reach the salon right now. Please try again in a moment.");
                  } finally {
                    setBooking(false);
                  }
                }}
                className="btn-gold flex-1 rounded-full py-3 text-sm tracking-widest uppercase disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === 3 ? (booking ? "Confirming…" : "Confirm booking") : "Continue"}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ivory/40">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium text-ivory">{value}</span>
    </div>
  );
}
