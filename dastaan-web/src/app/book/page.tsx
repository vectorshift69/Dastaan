"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  branches,
  services,
  barbers,
  CURRENCY,
  type Service,
} from "@/lib/data";

const STEPS = ["Branch", "Services", "Stylist", "Time"] as const;

export default function BookingWizard() {
  const [step, setStep] = useState(0);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string | "any" | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const branch = branches.find((b) => b.id === branchId);
  const branchBarbers = barbers.filter((b) => b.branchId === branchId);
  const pickedServices = picked.map((id) => services.find((s) => s.id === id)!) as Service[];
  const total = pickedServices.reduce((s, x) => s + x.price, 0);
  const minutes = pickedServices.reduce((s, x) => s + x.minutes, 0);

  const slots = useMemo(() => {
    const out: string[] = [];
    for (let m = 10 * 60; m <= 20 * 60; m += 30) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      out.push(`${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`);
    }
    return out;
  }, []);

  const canNext =
    (step === 0 && !!branchId) ||
    (step === 1 && picked.length > 0) ||
    (step === 2 && !!barberId) ||
    (step === 3 && !!slot);

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
            {pickedServices.map((s) => s.name).join(" + ")} · {slot} today
            <br />
            {b ? `with ${b.name}` : "with the first available stylist"} at {branch?.name}
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
          <Link href="/" className="font-display text-xl font-semibold tracking-[0.22em] text-ivory">
            DASTAAN
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
                <h1 className="font-display text-4xl font-medium text-ivory">Choose your stylist</h1>
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
                <p className="mt-2 text-sm text-ivory/45">Today · {minutes} minutes needed</p>
                <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {slots.map((t, i) => {
                    const taken = [3, 7, 11, 14].includes(i); // mock unavailable
                    return (
                      <button
                        key={t}
                        disabled={taken}
                        onClick={() => setSlot(t)}
                        className={`rounded-lg border py-3 text-sm transition-all ${
                          taken
                            ? "cursor-not-allowed border-ivory/6 text-ivory/20 line-through"
                            : slot === t
                              ? "border-gold bg-gold text-ink font-bold"
                              : "border-ivory/15 bg-coal text-ivory/80 hover:border-gold/60"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
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
                label="Stylist"
                value={
                  barberId === "any"
                    ? "First available"
                    : barberId
                      ? branchBarbers.find((b) => b.id === barberId)?.name ?? "—"
                      : "—"
                }
              />
              <SummaryRow label="Time" value={slot ?? "—"} />
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
                  // persist via the API when signed in (guests still see the demo confirmation)
                  try {
                    const [hh, mmAp] = (slot ?? "10:00 am").split(":");
                    const mm = mmAp!.slice(0, 2);
                    const pm = (slot ?? "").includes("pm");
                    let h = Number(hh) % 12;
                    if (pm) h += 12;
                    const startsAt = `${new Date().toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:${mm}:00`;
                    await fetch("/api/bookings", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ branchId, barberId, serviceIds: picked, startsAt }),
                    });
                  } catch { /* offline demo */ }
                  setConfirmed(true);
                }}
                className="btn-gold flex-1 rounded-full py-3 text-sm tracking-widest uppercase disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === 3 ? "Confirm booking" : "Continue"}
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
