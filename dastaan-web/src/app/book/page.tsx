"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import StripePaymentForm from "@/components/StripePaymentForm";
import { useConfig } from "@/lib/config";
import {
  branches,
  services,
  barbers,
  CURRENCY,
  type Service,
} from "@/lib/data";

const BASE_STEPS = ["Branch", "Services", "Barber", "Time", "Details"] as const;
const PAYMENT_STEP = 5;

/* Kept across the /login?next=/book round-trip (and an accidental refresh)
   so a client who reaches step 5 without an account doesn't lose their
   branch/service/barber/time picks while they sign in. sessionStorage, not
   localStorage — this is a live in-progress draft, not something that
   should outlive the tab, and localStorage isn't reliably available in
   every preview/embedded context this runs in. */
const WIZARD_KEY = "dastaan.booking.wizard.v1";

type WizardDraft = {
  step: number;
  branchId: string | null;
  picked: string[];
  barberId: string | "any" | null;
  date: string;
  slot: string | null;
  forWho: "me" | "other";
  guest: { name: string; phone: string; email: string };
};

function loadWizardDraft(): Partial<WizardDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(WIZARD_KEY);
    return raw ? (JSON.parse(raw) as Partial<WizardDraft>) : {};
  } catch {
    return {};
  }
}

function saveWizardDraft(draft: WizardDraft) {
  try {
    window.sessionStorage.setItem(WIZARD_KEY, JSON.stringify(draft));
  } catch {
    // storage full or blocked — the wizard still works, it just won't survive a redirect
  }
}

function clearWizardDraft() {
  try {
    window.sessionStorage.removeItem(WIZARD_KEY);
  } catch {
    /* nothing to clean up if it never wrote */
  }
}

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

/** A labelled input. The label sits above the box and both fill their column,
 *  so a row of fields lines up however long the labels are. */
function Field({
  label, value, onChange, placeholder, hint, required, type = "text", autoComplete, className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold tracking-[0.18em] text-ivory/50 uppercase">
        {label}
        {required && <span className="ml-1 text-gold-2">*</span>}
        {hint && <span className="ml-1.5 normal-case tracking-normal text-ivory/30">— {hint}</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-2 block w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-[15px] text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
      />
    </label>
  );
}

export default function BookingWizardPage() {
  return (
    <Suspense fallback={null}>
      <BookingWizard />
    </Suspense>
  );
}

function BookingWizard() {
  const searchParams = useSearchParams();
  const urlBranchId = searchParams.get("branchId");
  const urlServiceId = searchParams.get("serviceId") ?? searchParams.get("service");

  /* the lazy initializer runs exactly once, on first render, so a later
     re-render never re-reads storage and clobbers in-progress edits */
  const [draft] = useState<Partial<WizardDraft>>(() => {
    const d = loadWizardDraft();
    /* Bug #4: if the stored draft's booking datetime is in the past, discard it */
    if (d.date && d.slot) {
      const draftTime = new Date(`${d.date}T${d.slot}:00`).getTime();
      if (draftTime < Date.now()) {
        clearWizardDraft();
        return {};
      }
    }
    return d;
  });

  /* URL params override the draft for branch/service deep-links */
  const [step, setStep] = useState(() => {
    if (urlBranchId) return 1; // branch pre-selected, jump to services
    return draft.step ?? 0;
  });
  const [branchId, setBranchId] = useState<string | null>(urlBranchId ?? draft.branchId ?? null);
  const [picked, setPicked] = useState<string[]>(() => {
    if (urlServiceId) {
      const svc = services.find((s) => s.id === urlServiceId);
      return svc ? [svc.id] : (draft.picked ?? []);
    }
    return draft.picked ?? [];
  });
  const [barberId, setBarberId] = useState<string | "any" | null>(draft.barberId ?? null);
  const [date, setDate] = useState<string>(draft.date ?? localDay(0));
  const [slot, setSlot] = useState<string | null>(draft.slot ?? null);
  const [confirmed, setConfirmed] = useState(false);

  /* who is signed in — an appointment has to belong to somebody */
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [forWho, setForWho] = useState<"me" | "other">(draft.forWho ?? "me");
  const [guest, setGuest] = useState(draft.guest ?? { name: "", phone: "", email: "" });

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Feature #12: nearest branch based on user geolocation */
  const [nearestBranchId, setNearestBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: userLat, longitude: userLng } = pos.coords;
      const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const withDist = branches
        .filter((b) => b.lat != null && b.lng != null)
        .map((b) => ({ id: b.id, dist: haversine(userLat, userLng, b.lat!, b.lng!) }))
        .sort((a, c) => a.dist - c.dist);
      if (withDist.length > 0 && withDist[0].dist <= 20) {
        setNearestBranchId(withDist[0].id);
      }
    }, () => { /* geolocation denied — no suggestion */ });
  }, []);

  /* pay-now step (Fix 2) */
  const cfg = useConfig();
  const [choices, setChoices] = useState<{ payNow: boolean; payLater: boolean } | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [paidOnline, setPaidOnline] = useState(false);

  const branch = branches.find((b) => b.id === branchId);
  const branchBarbers = barbers.filter((b) => b.branchId === branchId);
  const pickedServices = picked.map((id) => services.find((s) => s.id === id)!) as Service[];
  const total = pickedServices.reduce((s, x) => s + x.price, 0);
  const minutes = pickedServices.reduce((s, x) => s + x.minutes, 0);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => localDay(i)), []);

  /* only offer to charge a card once both the master switch (from /api/config)
     AND the booking-specific choice (from /payments/choices) agree — never
     draw a payment step we can't actually honour */
  const payOnline = cfg.payments.online && !!choices?.payNow;
  const payLaterAvailable = !!choices?.payLater;
  const STEPS = useMemo(
    () => (payOnline ? [...BASE_STEPS, "Payment"] : [...BASE_STEPS]),
    [payOnline]
  );

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d && d.role === "client" ? d : null))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  useEffect(() => {
    fetch("/api/payments/choices")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChoices(d ? { payNow: !!d.payNow, payLater: !!d.payLater } : { payNow: false, payLater: false }))
      .catch(() => setChoices({ payNow: false, payLater: false }));
  }, []);

  /* Persist the in-progress wizard so it survives the /login?next=/book
     round-trip — cleared once the booking is actually confirmed or the
     client backs out. Skipped once a booking id exists: at that point the
     appointment is already made and there is nothing left to resume. */
  useEffect(() => {
    if (bookingId) return;
    saveWizardDraft({ step, branchId, picked, barberId, date, slot, forWho, guest });
  }, [step, branchId, picked, barberId, date, slot, forWho, guest, bookingId]);

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
    (step === 3 && !!slot && chosenStillFree) ||
    (step === 4 && !!me && (forWho === "me" || guest.name.trim().length >= 2) && !booking);

  const toggleService = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /* Opens a Payment Intent for the booking that was just created. The
     booking already exists and is unpaid at this point — a failure here
     just leaves the client able to pay at the salon instead, never blocks
     the appointment itself. */
  const startPaymentIntent = useCallback(async (id: string) => {
    setIntentLoading(true);
    setIntentError(null);
    try {
      const res = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntentError(data.error ?? "Could not start payment. You can still pay at the salon.");
        return;
      }
      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
    } catch {
      setIntentError("Can't reach the payment server. You can still pay at the salon.");
    } finally {
      setIntentLoading(false);
    }
  }, []);

  const payAtSalon = () => {
    clearWizardDraft();
    setConfirmed(true);
  };

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
            {forWho === "other" && guest.name.trim() && (
              <>
                <br />
                <span className="text-gold-2">for {guest.name.trim()}</span>
              </>
            )}
          </p>
          <div className="gold-rule mx-auto my-8 w-24" />
          {paidOnline && (
            <p className="text-sm font-semibold text-gold-2">Paid in full — see you soon.</p>
          )}
          <p className="mt-4 text-xs leading-relaxed tracking-wider text-ivory/35">
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
          <Link href="/" onClick={clearWizardDraft} className="text-sm text-ivory/45 hover:text-gold-2">
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
                      className={`relative rounded-2xl border p-7 text-left transition-all ${
                        branchId === b.id
                          ? "border-gold bg-gold/8 shadow-[0_0_40px_-15px_rgba(201,162,39,0.5)]"
                          : "border-ivory/12 bg-coal hover:border-ivory/30"
                      }`}
                    >
                      {nearestBranchId === b.id && (
                        <span className="absolute top-4 right-4 rounded-full bg-gold/20 px-2.5 py-1 text-[10px] font-bold tracking-wider text-gold-2 uppercase">
                          Nearest to you
                        </span>
                      )}
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

            {step === 4 && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Almost there</h1>

                {!meLoaded ? (
                  <p className="mt-6 text-sm text-ivory/45">One moment…</p>
                ) : !me ? (
                  /* An appointment has to belong to an account: it is how the
                     salon reaches you, how the reminder is sent, and how your
                     visits are counted. */
                  <div className="mt-8 rounded-2xl border border-ivory/12 bg-coal p-8">
                    <p className="text-[15px] font-semibold text-ivory">Sign in to confirm</p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-ivory/55">
                      We keep your appointment against your account so we can send the
                      confirmation and the reminder, and so your visits count towards
                      your loyalty card. It takes a moment.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <Link
                        href="/login?returnTo=/book"
                        className="btn-gold rounded-full px-7 py-3 text-sm tracking-wide"
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/login?returnTo=/book"
                        className="btn-ghost rounded-full px-7 py-3 text-sm tracking-wide"
                      >
                        Create an account
                      </Link>
                    </div>
                    <p className="mt-5 text-xs text-ivory/30">
                      Your choices are kept — you will come straight back here.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-ivory/45">Signed in as {me.name}</p>

                    <p className="mt-8 text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">
                      Who is this appointment for?
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {([
                        ["me", "Myself", me.name],
                        ["other", "Someone else", "A friend, or one of the family"],
                      ] as const).map(([val, title, sub]) => (
                        <button
                          key={val}
                          onClick={() => setForWho(val)}
                          className={`rounded-2xl border p-5 text-left transition-all ${
                            forWho === val
                              ? "border-gold bg-gold/8"
                              : "border-ivory/12 bg-coal hover:border-ivory/30"
                          }`}
                        >
                          <p className="text-sm font-semibold text-ivory">{title}</p>
                          <p className="mt-1 text-xs text-ivory/45">{sub}</p>
                        </button>
                      ))}
                    </div>

                    {forWho === "other" && (
                      <div className="animate-fade-up mt-7 max-w-xl rounded-2xl border border-ivory/12 bg-coal/70 p-6">
                        <p className="text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">
                          Their details
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-ivory/40">
                          The appointment stays on your account. We put their name against
                          the chair and send the reminder to them.
                        </p>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          <Field
                            label="Their name"
                            required
                            className="sm:col-span-2"
                            value={guest.name}
                            onChange={(v) => setGuest({ ...guest, name: v })}
                            placeholder="e.g. Yusuf Habib"
                            autoComplete="name"
                          />
                          <Field
                            label="Their mobile"
                            value={guest.phone}
                            onChange={(v) => setGuest({ ...guest, phone: v })}
                            placeholder="+971 50 000 0000"
                            autoComplete="tel"
                            type="tel"
                          />
                          <Field
                            label="Their email"
                            hint="optional"
                            value={guest.email}
                            onChange={(v) => setGuest({ ...guest, email: v })}
                            placeholder="name@example.com"
                            autoComplete="email"
                            type="email"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {error && (
                  <p className="animate-shake mt-6 max-w-md rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
                    {error}
                  </p>
                )}
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
                      {slots.filter((s) => {
                        /* Bug #3: hide slots that are already in the past for today */
                        const slotTime = new Date(`${date}T${s.time}:00`).getTime();
                        return slotTime > Date.now();
                      }).map((s) => (
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

            {step === PAYMENT_STEP && (
              <>
                <h1 className="font-display text-4xl font-medium text-ivory">Payment</h1>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-ivory/45">
                  Your appointment is booked. Pay now to settle it in full, or pay at the
                  salon after your visit.
                </p>

                <div className="mt-8 max-w-md">
                  {intentLoading ? (
                    <p className="text-sm text-ivory/45">Preparing payment…</p>
                  ) : clientSecret ? (
                    <StripePaymentForm
                      clientSecret={clientSecret}
                      amountLabel={`${CURRENCY} ${paymentAmount ?? total}`}
                      onSuccess={() => {
                        setPaidOnline(true);
                        clearWizardDraft();
                        setConfirmed(true);
                      }}
                    />
                  ) : intentError ? (
                    <>
                      <p className="animate-shake rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
                        {intentError}
                      </p>
                      <button
                        onClick={() => bookingId && startPaymentIntent(bookingId)}
                        className="btn-ghost mt-4 rounded-full px-6 py-2.5 text-sm"
                      >
                        Try again
                      </button>
                    </>
                  ) : null}
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
              {step > 0 && step < PAYMENT_STEP && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="btn-ghost flex-1 rounded-full py-3 text-sm tracking-wide"
                >
                  Back
                </button>
              )}
              {step === PAYMENT_STEP && payLaterAvailable && (
                <button
                  onClick={payAtSalon}
                  className="btn-ghost flex-1 rounded-full py-3 text-sm tracking-wide"
                >
                  Pay at the salon
                </button>
              )}
              {step < PAYMENT_STEP && (
              <button
                disabled={!canNext}
                onClick={async () => {
                  if (step !== 4) return setStep(step + 1);
                  if (!slot || !me) return;
                  setBooking(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/bookings", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        branchId, barberId, serviceIds: picked,
                        startsAt: `${date}T${slot}:00`,
                        ...(forWho === "other"
                          ? {
                              forSomeoneElse: true,
                              clientName: guest.name.trim(),
                              clientPhone: guest.phone.trim() || undefined,
                              clientEmail: guest.email.trim() || undefined,
                            }
                          : {}),
                      }),
                    });

                    if (res.ok) {
                      const created: { id: string } = await res.json();
                      if (payOnline) {
                        setBookingId(created.id);
                        setStep(PAYMENT_STEP);
                        await startPaymentIntent(created.id);
                      } else {
                        clearWizardDraft();
                        setConfirmed(true);
                      }
                      return;
                    }

                    /* Do NOT claim success when the server said no. The chair may
                       have been taken in the seconds since the grid loaded, so
                       reload it and let them pick again. */
                    const body = await res.json().catch(() => ({}));
                    if (res.status === 401) {
                      setError("Your session has expired — please sign in again.");
                      setMe(null);
                    } else if (res.status === 409) {
                      setError(body.error ?? "That slot has just been taken — please pick another.");
                      setSlot(null);
                      setStep(3);
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
                {step === 4 ? (booking ? "Confirming…" : "Confirm booking") : "Continue"}
              </button>
              )}
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
