"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Calendar from "@/components/console/Calendar";
import AppointmentPanel from "@/components/console/AppointmentPanel";
import LoyaltyScan from "@/components/console/LoyaltyScan";
import ReportsView from "@/components/console/ReportsView";
import InventoryView from "@/components/console/InventoryView";
import CouponsView from "@/components/console/CouponsView";
import OrdersView from "@/components/console/OrdersView";
import ClientsView from "@/components/console/ClientsView";
import Logo, { LogoMark } from "@/components/Logo";
import MonthView from "@/components/console/MonthView";
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

type View = "calendar" | "clients" | "inventory" | "reports" | "coupons" | "orders";

/* Nav mirrors the API's permission matrix — the server enforces it too. */
const NAV: { icon: string; label: string; view: View; roles: string[] }[] = [
  { icon: "▦", label: "Calendar", view: "calendar", roles: ["admin", "super_admin", "barber"] },
  { icon: "◔", label: "Clients", view: "clients", roles: ["admin", "super_admin"] },
  { icon: "▤", label: "Inventory", view: "inventory", roles: ["admin", "super_admin"] },
  { icon: "◈", label: "Reports", view: "reports", roles: ["super_admin"] },
  { icon: "✦", label: "Coupons", view: "coupons", roles: ["super_admin"] },
  { icon: "⬡", label: "Orders", view: "orders", roles: ["super_admin"] },
];

const TITLES: Record<View, string> = {
  calendar: "Calendar",
  clients: "Clients",
  inventory: "Inventory",
  reports: "Sales reports",
  coupons: "Discount codes",
  orders: "Online orders",
};

export default function Console() {
  const [branchId, setBranchId] = useState("b1");
  const [appointments, setAppointments] = useState<Appointment[]>(dayAppointments);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(false); // true once real API data loads
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
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
        <Link
          href="/team"
          className="mt-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-ivory/40 transition-colors hover:text-st-cancel lg:justify-start lg:px-4"
        >
          <span>⏻</span>
          <span className="hidden lg:inline">Lock screen</span>
        </Link>
      </nav>

      {/* ---------- main ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
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
                <button className="btn-gold rounded-full px-5 py-1.5 text-[13px]">+ New booking</button>
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
                          return { invoiceNo: inv.invoiceNo, total: inv.total, vat: inv.vat };
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
