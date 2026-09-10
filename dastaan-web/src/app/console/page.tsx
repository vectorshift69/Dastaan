"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Calendar from "@/components/console/Calendar";
import AppointmentPanel from "@/components/console/AppointmentPanel";
import LoyaltyScan from "@/components/console/LoyaltyScan";
import ReportsView from "@/components/console/ReportsView";
import InventoryView from "@/components/console/InventoryView";
import TeamView from "@/components/console/TeamView";
import CouponsView from "@/components/console/CouponsView";
import OrdersView from "@/components/console/OrdersView";
import ClientsView from "@/components/console/ClientsView";
import Logo, { LogoMark } from "@/components/Logo";
import MonthView from "@/components/console/MonthView";
import { TrainingBanner } from "@/components/console/TrainingBanner";
import { salonToday, relativeDay, prettyDate } from "@/lib/time";
import {
  barbers,
  branches,
  dayAppointments,
  type Appointment,
  type BookingStatus,
} from "@/lib/data";

/* API booking → console Appointment (start "HH:MM" from ISO) */
type ApiBooking = {
  id: string; barberId: string; client: string; phone: string;
  serviceIds: string[]; startsAt: string; minutes: number;
  status: BookingStatus; online: boolean; paid: boolean; cancelReason?: string;
  loyalty?: { tier: "Gold" | "Silver" | "Member"; points: number };
};
const fromApi = (b: ApiBooking): Appointment => ({
  id: b.id, barberId: b.barberId, client: b.client, phone: b.phone,
  serviceIds: b.serviceIds, start: b.startsAt.slice(11, 16), minutes: b.minutes,
  status: b.status, online: b.online, paid: b.paid, cancelReason: b.cancelReason,
  loyalty: b.loyalty,
});

type View = "calendar" | "clients" | "inventory" | "reports" | "coupons" | "orders" | "team";

/* Nav mirrors the API's permission matrix — the server enforces it too. */
const NAV: { icon: string; label: string; view: View; roles: string[] }[] = [
  { icon: "▦", label: "Calendar", view: "calendar", roles: ["admin", "super_admin", "barber"] },
  { icon: "◔", label: "Clients", view: "clients", roles: ["admin", "super_admin"] },
  { icon: "▤", label: "Inventory", view: "inventory", roles: ["admin", "super_admin"] },
  { icon: "◈", label: "Reports", view: "reports", roles: ["super_admin"] },
  { icon: "✦", label: "Coupons", view: "coupons", roles: ["super_admin"] },
  { icon: "⬡", label: "Orders", view: "orders", roles: ["super_admin"] },
  { icon: "◉", label: "Team", view: "team", roles: ["super_admin"] },
];

const TITLES: Record<View, string> = {
  calendar: "Calendar",
  clients: "Clients",
  inventory: "Branch stock",
  reports: "Sales reports",
  coupons: "Discount codes",
  orders: "Online orders",
  team: "Team & access",
};

export default function Console() {
  const [branchId, setBranchId] = useState("b1");
  const [appointments, setAppointments] = useState<Appointment[]>(dayAppointments);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(false); // true once real API data loads
  const [me, setMe] = useState<{ id?: string; name: string; role: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const router = useRouter();

  const lockScreen = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/team");
  }, [router]);
  const [view, setView] = useState<View>("calendar");
  /* the day being looked at — the console used to be hardwired to today */
  const [date, setDate] = useState<string>(salonToday());
  const [mode, setMode] = useState<"day" | "month">("day");
  const [loadingDay, setLoadingDay] = useState(false);

  /* load today's bookings from the API; fall back to demo data if signed out */
  useEffect(() => {
    (async () => {
      setLoadingDay(true);
      try {
        const [meRes, res] = await Promise.all([
          fetch("/api/auth/me"),
          fetch(`/api/bookings?date=${date}&branchId=${branchId}`),
        ]);
        setMe(meRes.ok ? await meRes.json() : null);
        if (res.ok) {
          const data: ApiBooking[] = await res.json();
          setAppointments(data.map(fromApi));
          setLive(true);
          setSelectedId(null);
        }
      } catch {
        /* API offline — keep demo data */
      } finally {
        setLoadingDay(false);
      }
    })();
  }, [branchId, date]);

  /* step a day at a time; the archive goes back as far as the data does */
  const shiftDay = (n: number) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    setDate(new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10));
    setSelectedId(null);
  };

  /* Only ever offer what this role can actually open. While the session is
     still loading `me` is null, and we show just the calendar rather than
     flashing tabs the user will never be allowed to use. */
  const visibleNav = NAV.filter((n) => (me ? n.roles.includes(me.role) : n.view === "calendar"));

  /* if the role changes under us (lock screen → different code), drop back to
     a view they are allowed to see */
  useEffect(() => {
    if (me && !visibleNav.some((n) => n.view === view)) setView("calendar");
  }, [me, view, visibleNav]);

  /* A role with no tabs at all has no business on this screen. Without this
     the shop manager got an empty sidebar but a full calendar behind it —
     barber columns, "+ New booking", the branch picker. The API refuses them
     now, but the console should not be drawing the salon's day to someone who
     does not work in the salon. */
  const belongsHere = !me || visibleNav.length > 0;

  const branch = branches.find((b) => b.id === branchId)!;
  const branchBarbers = barbers.filter((b) => b.branchId === branchId);
  const selected = appointments.find((a) => a.id === selectedId) ?? null;

  const updateAppt = (patch: Partial<Appointment>) => {
    // optimistic UI, then persist to the API (server re-checks permissions)
    setAppointments((list) =>
      list.map((a) => (a.id === selectedId ? { ...a, ...patch } : a))
    );
    if (!live || !selectedId) return;
    const headers = { "content-type": "application/json" };
    if (patch.status) {
      fetch(`/api/bookings/${selectedId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: patch.status, reason: patch.cancelReason }),
      }).catch(() => {});
    }
    if (typeof patch.paid === "boolean") {
      fetch(`/api/bookings/${selectedId}/paid`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ paid: patch.paid }),
      }).catch(() => {});
    }
  };

  if (!belongsHere)
    return (
      <div className="grid h-svh place-items-center bg-paper px-6 text-center text-ink">
        <div className="max-w-sm">
          <p className="text-[11px] font-bold tracking-[0.2em] text-charcoal/40 uppercase">
            Wrong door
          </p>
          <h1 className="font-display mt-2 text-2xl">This is the salon console</h1>
          <p className="mt-3 text-sm leading-relaxed text-charcoal/55">
            You are signed in as {me?.name}. The online shop is managed at{" "}
            <Link href="/shop" className="font-semibold text-gold-dim underline">/shop</Link>.
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex h-svh overflow-hidden bg-paper text-ink">
      {/* ---------- sidebar ---------- */}
      <nav className="flex w-16 shrink-0 flex-col items-center border-r border-black/20 bg-ink py-5 lg:w-56 lg:items-stretch lg:px-4">
        <Link href="/" aria-label="Dastaan — home" className="flex items-center justify-center text-ivory lg:justify-start">
          <LogoMark className="h-7 w-auto lg:hidden" />
          <Logo className="hidden lg:inline-flex" markClass="h-7 w-auto" wordClass="h-[19px] w-auto" />
        </Link>
        <div className="gold-rule mx-auto mt-4 w-8 lg:w-full" />
        <div className="mt-6 flex flex-1 flex-col gap-1.5">
          {visibleNav.map((n) => (
            <button
              key={n.label}
              onClick={() => { setView(n.view); setSelectedId(null); }}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all lg:px-4 ${
                view === n.view
                  ? "bg-gold/15 font-bold text-gold-2"
                  : "text-ivory/50 hover:bg-white/5 hover:text-ivory"
              }`}
            >
              <span className="mx-auto text-base lg:mx-0">{n.icon}</span>
              <span className="hidden lg:inline">{n.label}</span>
            </button>
          ))}
        </div>
        <div className="hidden rounded-xl bg-white/5 px-4 py-3 lg:block">
          <p className="text-[10px] tracking-wider text-ivory/40 uppercase">
            {live ? "Signed in" : "Demo data — sign in at /team"}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ivory">{me?.name ?? "Guest"}</p>
          <p className="text-[11px] text-gold-2">
            {(me?.role ?? "preview").replace("_", " ")} · {branch.area}
          </p>
        </div>
        <button
          onClick={lockScreen}
          className="mt-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-ivory/40 transition-colors hover:text-st-cancel lg:justify-start lg:px-4"
        >
          <span>⏻</span>
          <span className="hidden lg:inline">Lock screen</span>
        </button>
      </nav>

      {/* ---------- main ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* overdue training banner — only shown when the logged-in user has pending videos */}
        <TrainingBanner />
        {/* top bar */}
        <header className="flex flex-wrap items-center gap-3 border-b border-[#e2ddd0] bg-white px-5 py-3">
          {view === "calendar" ? (
            <>
              <button
                onClick={() => { setDate(salonToday()); setMode("day"); setSelectedId(null); }}
                className={`rounded-full border px-4 py-1.5 text-[13px] font-bold ${
                  date === salonToday() && mode === "day"
                    ? "border-gold bg-gold/10 text-gold-dim"
                    : "border-black/12 hover:border-black/35"
                }`}
              >
                Today
              </button>

              {mode === "day" && (
                <div className="flex items-center gap-1">
                  <IconBtn label="Previous day" onClick={() => shiftDay(-1)}>‹</IconBtn>
                  {/* a real date field, so you can jump years back without clicking */}
                  <label className="relative min-w-44 text-center text-sm font-bold">
                    <span className={date === salonToday() ? "" : "text-gold-dim"}>
                      {relativeDay(date)}
                      <span className="ml-1.5 font-normal text-charcoal/50">
                        {prettyDate(date, { weekday: undefined })}
                      </span>
                    </span>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSelectedId(null); } }}
                      aria-label="Jump to a date"
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                  <IconBtn label="Next day" onClick={() => shiftDay(1)}>›</IconBtn>
                </div>
              )}

              {/* day / month toggle — the month grid is how you find a past day */}
              <div className="flex overflow-hidden rounded-full border border-black/12 text-[12px] font-bold">
                {(["day", "month"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setSelectedId(null); }}
                    className={`px-3.5 py-1.5 capitalize transition-colors ${
                      mode === m ? "bg-ink text-ivory" : "text-charcoal/60 hover:text-ink"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {loadingDay && mode === "day" && (
                <span className="text-xs text-charcoal/40">loading…</span>
              )}
            </>
          ) : (
            <h1 className="font-display text-xl font-semibold text-ink">{TITLES[view]}</h1>
          )}

          <div className="ml-auto flex items-center gap-3">
            {view === "calendar" && (
              <>
                {/* branch switcher */}
                <select
                  value={branchId}
                  onChange={(e) => { setBranchId(e.target.value); setSelectedId(null); }}
                  className="rounded-full border border-black/12 bg-white px-4 py-1.5 text-[13px] font-semibold outline-none hover:border-black/35"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setScanOpen(true)}
                  className="flex items-center gap-2 rounded-full border border-black/12 px-4 py-1.5 text-[13px] font-bold hover:border-gold hover:text-gold-dim"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"/></svg>
                  Scan card
                </button>
                <button
                  onClick={() => setNewBookingOpen(true)}
                  className="btn-gold rounded-full px-5 py-1.5 text-[13px]"
                >
                  + New booking
                </button>
              </>
            )}
          </div>

          {/* legend (calendar only) */}
          {view === "calendar" && (
            <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10.5px] font-semibold tracking-wide text-charcoal/55">
              <Legend color="var(--color-st-booked)" label="Booked" />
              <Legend color="var(--color-st-confirmed)" label="Confirmed" />
              <Legend color="var(--color-st-arrived)" label="Arrived" />
              <Legend color="var(--color-st-started)" label="Started" />
              <Legend color="var(--color-st-completed)" label="Completed" />
              <Legend color="var(--color-st-noshow)" label="No show" />
              <Legend color="var(--color-st-cancel)" label="Cancelled" />
              <span className="ml-2">✓ with barber · ⟳ online</span>
              <span>● paid · ○ unpaid</span>
            </div>
          )}
        </header>

        {/* ---------- owner views ---------- */}
        {view === "clients" && <ClientsView />}
        {view === "reports" && <ReportsView />}
        {view === "inventory" && <InventoryView role={me?.role ?? "admin"} />}
        {view === "coupons" && <CouponsView />}
        {view === "orders" && <OrdersView />}
        {view === "team" && <TeamView meId={me?.id} />}

        {/* calendar + panel */}
        {view === "calendar" && mode === "month" && (
          <MonthView
            branchId={branchId}
            onPickDay={(d) => { setDate(d); setMode("day"); setSelectedId(null); }}
          />
        )}

        {view === "calendar" && mode === "day" && (
        <div className="relative flex min-h-0 flex-1">
          <Calendar
            barbers={branchBarbers}
            appointments={appointments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            date={date}
          />
          {selected && (
            <div className="absolute inset-0 z-20 md:static md:z-auto md:flex">
              <div className="absolute inset-0 bg-ink/30 md:hidden" onClick={() => setSelectedId(null)} />
              <div className="absolute inset-y-0 right-0 w-full max-w-[400px] md:static md:max-w-none">
                <AppointmentPanel
                  key={selected.id}
                  appt={selected}
                  onClose={() => setSelectedId(null)}
                  onUpdate={updateAppt}
                  onCheckout={
                    live
                      ? async (args) => {
                          const res = await fetch(`/api/bookings/${selected.id}/checkout`, {
                            // args include products[] for combined product+service sales
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(args),
                          });
                          if (!res.ok) return null;
                          const inv = await res.json();
                          return { invoiceNo: inv.invoiceNo, total: inv.total, vat: inv.vat, stripeRef: inv.stripeRef };
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      {scanOpen && <LoyaltyScan onClose={() => setScanOpen(false)} />}
      {newBookingOpen && (
        <NewBookingModal
          branchId={branchId}
          barbers={branchBarbers}
          date={date}
          onClose={() => setNewBookingOpen(false)}
          onCreated={(appt) => {
            setAppointments((prev) => [...prev, appt]);
            setNewBookingOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Walk-in booking modal                                                */
/* ------------------------------------------------------------------ */
import { services as ALL_SERVICES } from "@/lib/data";

type Slot = { time: string; available: boolean };

function NewBookingModal({
  branchId, barbers, date, onClose, onCreated,
}: {
  branchId: string;
  barbers: typeof import("@/lib/data").barbers;
  date: string;
  onClose: () => void;
  onCreated: (appt: Appointment) => void;
}) {
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? "");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const branchServices = ALL_SERVICES;
  const toggleService = (id: string) => {
    setServiceIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    setTime(null); // reset slot when services change
  };

  const totalMinutes = branchServices
    .filter((s) => serviceIds.includes(s.id))
    .reduce((sum, s) => sum + s.minutes, 0);

  /* load availability whenever barber, services or date change */
  useEffect(() => {
    if (serviceIds.length === 0 || !barberId) { setSlots([]); return; }
    setLoadingSlots(true);
    setTime(null);
    fetch(`/api/availability?branchId=${branchId}&barberId=${barberId}&date=${date}&minutes=${totalMinutes}`)
      .then((r) => r.ok ? r.json() : { slots: [] })
      .then((d) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [barberId, serviceIds.join(","), date, branchId, totalMinutes]);

  const submit = async () => {
    if (!clientName.trim()) { setErr("Client name is required"); return; }
    if (serviceIds.length === 0) { setErr("Select at least one service"); return; }
    if (!time) { setErr("Pick a time slot"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          barberId,
          serviceIds,
          startsAt: `${date}T${time}:00`,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim() || undefined,
          online: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "Booking failed"); setSaving(false); return; }
      onCreated({
        id: data.id,
        barberId,
        client: clientName.trim(),
        phone: clientPhone.trim(),
        serviceIds,
        start: time,
        minutes: totalMinutes,
        status: "Booked",
        online: false,
        paid: false,
      });
    } catch { setErr("Network error — try again"); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-md rounded-2xl bg-white p-7 shadow-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">Walk-in booking</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-charcoal/40 hover:bg-black/5 hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {/* client */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-charcoal/50">Client name *</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Ahmed Al-Rashid"
                className="mt-1 w-full rounded-xl border border-black/12 px-3 py-2.5 text-sm outline-none focus:border-gold" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-charcoal/50">Phone (optional)</span>
              <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+971 50…"
                className="mt-1 w-full rounded-xl border border-black/12 px-3 py-2.5 text-sm outline-none focus:border-gold" />
            </label>
          </div>

          {/* barber */}
          <label className="block">
            <span className="text-xs font-semibold text-charcoal/50">Barber</span>
            <select value={barberId} onChange={(e) => { setBarberId(e.target.value); setTime(null); }}
              className="mt-1 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold">
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>

          {/* time slots — same availability engine as the client wizard */}
          <div>
            <p className="text-xs font-semibold text-charcoal/50">
              Available times {totalMinutes > 0 && `(${totalMinutes} min needed)`}
            </p>
            {serviceIds.length === 0 ? (
              <p className="mt-2 text-xs text-charcoal/40">Select services first to see available slots</p>
            ) : loadingSlots ? (
              <p className="mt-2 text-xs text-charcoal/40">Loading slots…</p>
            ) : slots.length === 0 ? (
              <p className="mt-2 text-xs text-charcoal/40">No slots available — try another barber or date</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.filter((s) => {
                  const slotTime = new Date(`${date}T${s.time}:00`).getTime();
                  return slotTime > Date.now();
                }).map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setTime(s.time)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                      !s.available
                        ? "cursor-not-allowed border-black/8 text-charcoal/25 line-through"
                        : time === s.time
                          ? "border-ink bg-ink text-gold-2"
                          : "border-black/15 hover:border-ink"
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* services */}
          <div>
            <p className="text-xs font-semibold text-charcoal/50">Services *</p>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-black/10">
              {branchServices.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center justify-between border-b border-black/5 px-4 py-2.5 last:border-0 hover:bg-paper">
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)}
                      className="accent-gold" />
                    <span className="text-sm font-semibold text-ink">{s.name}</span>
                    <span className="text-xs text-charcoal/45">{s.minutes} min</span>
                  </span>
                  <span className="text-sm font-bold text-ink">AED {s.price}</span>
                </label>
              ))}
            </div>
          </div>

          {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</p>}
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-full border border-black/15 py-3 text-sm font-semibold text-charcoal/70 hover:border-black/40">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="btn-gold flex-[2] rounded-full py-3 text-sm tracking-widest uppercase disabled:opacity-40">
            {saving ? "Booking…" : "Book walk-in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children, label, onClick,
}: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-charcoal/60 transition-colors hover:bg-black/5 hover:text-ink"
    >
      {children}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
