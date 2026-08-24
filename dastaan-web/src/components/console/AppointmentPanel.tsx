"use client";

import { useEffect, useMemo, useState } from "react";
import { useConfig } from "@/lib/config";
import {
  svcById,
  apptTotal,
  toMin,
  toLabel,
  CURRENCY,
  STATUS_COLOR,
  type Appointment,
  type BookingStatus,
} from "@/lib/data";

const PIPELINE: BookingStatus[] = ["Booked", "Confirmed", "Arrived", "Started"];
const TIPS = [0, 10, 18, 25];
const METHODS = ["Card", "Cash", "QR code", "Gift card", "Split"] as const;
/* shown only when Stripe Terminal is switched on for the whole app */
const TERMINAL_METHOD = "Card (reader)";

export type CheckoutResult = { invoiceNo: string; total: number; vat: number } | null;
type Product = { id: string; name: string; category: string; price: number };
type ProductLine = { productId: string; name: string; price: number; qty: number };

export default function AppointmentPanel({
  appt,
  onClose,
  onUpdate,
  onCheckout,
}: {
  appt: Appointment;
  onClose: () => void;
  onUpdate: (patch: Partial<Appointment>) => void;
  onCheckout?: (args: {
    price: number; discount: number; tip: number; method: string;
    couponCode?: string; products?: { productId: string; qty: number }[];
  }) => Promise<CheckoutResult>;
}) {
  const [mode, setMode] = useState<"details" | "checkout" | "done">("details");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  /* checkout state */
  const [ckStep, setCkStep] = useState(0); // 0 tip · 1 payment · 2 confirm
  const [tipPct, setTipPct] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [price, setPrice] = useState(apptTotal(appt));
  const [discount, setDiscount] = useState(0);

  const tip = useMemo(() => {
    if (customTip !== "") return Number(customTip) || 0;
    if (tipPct === null) return 0;
    return Math.round((price * tipPct) / 100 * 100) / 100;
  }, [tipPct, customTip, price]);

  const [invoice, setInvoice] = useState<{ invoiceNo: string; vat?: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);

  /* --- POS: retail products sold with the service (PRD 11) --- */
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const cfg = useConfig();
  const { payments } = cfg;

  useEffect(() => {
    fetch("/api/store/products")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const productTotal = productLines.reduce((s, p) => s + p.price * p.qty, 0);
  const addProduct = (p: Product) => {
    setProductLines((lines) => {
      const found = lines.find((l) => l.productId === p.id);
      return found
        ? lines.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...lines, { productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
    setPickerOpen(false);
    setProductSearch("");
    setCoupon(null); // amount changed — code must be re-validated
  };
  const setProductQty = (productId: string, qty: number) => {
    setProductLines((lines) => lines.map((l) => (l.productId === productId ? { ...l, qty } : l)).filter((l) => l.qty > 0));
    setCoupon(null);
  };

  const toPay = Math.max(0, price + productTotal - discount - (coupon?.discount ?? 0) + tip);

  const applyCoupon = async () => {
    setCouponErr(null);
    if (!couponInput.trim()) return;
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), amount: Math.max(0, price + productTotal - discount), context: "services" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setCoupon({ code: d.code, discount: d.discount });
      else { setCoupon(null); setCouponErr(d.error ?? "Code not valid"); }
    } catch { setCouponErr("Can't reach the server"); }
  };

  const saveCancel = () => {
    if (!reason.trim()) return;
    onUpdate({ status: "Cancelled", cancelReason: reason.trim() });
    setCancelOpen(false);
    setReason("");
  };

  const complete = async () => {
    setPaying(true);
    // the API creates the invoice + sends the SMS in one atomic step
    const result = onCheckout
      ? await onCheckout({
          price, discount, tip, method: method ?? "Cash", couponCode: coupon?.code,
          products: productLines.map((l) => ({ productId: l.productId, qty: l.qty })),
        }).catch(() => null)
      : null;
    setInvoice(result ?? { invoiceNo: `INV-DEMO-${appt.id.toUpperCase()}` });
    onUpdate({ paid: true, status: "Started" });
    setPaying(false);
    setMode("done");
  };

  return (
    <aside className="animate-fade-in flex h-full w-full flex-col overflow-hidden border-l border-[#e2ddd0] bg-white md:w-[400px] md:shrink-0">
      {/* header */}
      <div className="flex items-start justify-between border-b border-[#eee9dd] px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="font-display flex h-12 w-12 items-center justify-center rounded-full bg-ink text-lg text-gold-2">
            {appt.client[0]}
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-ink">{appt.client}</h2>
            <p className="text-xs text-charcoal/55">{appt.phone}</p>
            {appt.loyalty && (
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-gold-dim uppercase">
                ◆ {appt.loyalty.tier} · {appt.loyalty.points.toLocaleString()} pts
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="rounded-full p-1.5 text-charcoal/40 transition-colors hover:bg-black/5 hover:text-ink" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto">
        {/* ============ DETAILS ============ */}
        {mode === "details" && (
          <div className="px-6 py-5">
            <div className="flex items-center justify-between rounded-xl bg-paper px-4 py-3">
              <div>
                <p className="text-[11px] font-bold tracking-wider text-charcoal/45 uppercase">Today</p>
                <p className="text-sm font-bold text-ink">
                  {toLabel(toMin(appt.start))} – {toLabel(toMin(appt.start) + appt.minutes)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold tracking-wider text-charcoal/45 uppercase">
                  {appt.online ? "⟳ Online booking" : "✓ With barber"}
                </p>
                <p className={`text-sm font-bold ${appt.paid ? "text-st-started" : "text-st-cancel"}`}>
                  {appt.paid ? "● Paid" : "○ Unpaid"}
                </p>
              </div>
            </div>

            {/* status pipeline */}
            <p className="mt-6 text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Service status</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {PIPELINE.map((s) => {
                const active = appt.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => onUpdate({ status: s })}
                    className={`rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-all ${
                      active ? "text-white" : "border-black/10 bg-white text-charcoal/70 hover:border-black/30"
                    }`}
                    style={active ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] } : undefined}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => onUpdate({ status: "No Show" })}
                className={`rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-all ${
                  appt.status === "No Show" ? "border-st-noshow bg-st-noshow text-white" : "border-black/10 text-charcoal/70 hover:border-st-noshow/60"
                }`}
              >
                No Show
              </button>
              <button
                onClick={() => setCancelOpen(true)}
                className={`rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-all ${
                  appt.status === "Cancelled" ? "border-st-cancel bg-st-cancel text-white" : "border-black/10 text-charcoal/70 hover:border-st-cancel/60"
                }`}
              >
                Cancel…
              </button>
            </div>
            {appt.status === "Cancelled" && appt.cancelReason && (
              <p className="mt-3 rounded-lg bg-st-cancel/8 px-4 py-2.5 text-xs text-st-cancel">
                Reason: {appt.cancelReason}
              </p>
            )}

            {/* services */}
            <p className="mt-7 text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Services</p>
            <div className="mt-3 space-y-2">
              {appt.serviceIds.map((id) => {
                const s = svcById(id);
                return (
                  <div key={id} className="flex items-center justify-between rounded-xl border border-black/8 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{s.name}</p>
                      <p className="text-xs text-charcoal/50">{s.minutes} min</p>
                    </div>
                    <span className="text-sm font-bold text-ink">{CURRENCY} {s.price}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-dashed border-black/15 pt-4">
              <span className="text-sm font-semibold text-charcoal/60">Total</span>
              <span className="font-display text-2xl font-semibold text-ink">
                {CURRENCY} {apptTotal(appt)}
              </span>
            </div>
          </div>
        )}

        {/* ============ CHECKOUT ============ */}
        {mode === "checkout" && (
          <div className="px-6 py-5">
            {/* mini stepper */}
            <div className="flex items-center gap-2">
              {["Tip", "Payment", "Confirm"].map((s, i) => (
                <div key={s} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                      i <= ckStep ? "bg-ink text-gold-2" : "bg-black/8 text-charcoal/40"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className={`text-[11px] font-bold tracking-wider uppercase ${i === ckStep ? "text-ink" : "text-charcoal/35"}`}>
                    {s}
                  </span>
                  {i < 2 && <div className="h-px flex-1 bg-black/10" />}
                </div>
              ))}
            </div>

            {ckStep === 0 && (
              <div className="animate-fade-up mt-6">
                {/* --- products sold at the desk --- */}
                <div className="rounded-xl border border-black/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Products</p>
                    <button
                      onClick={() => setPickerOpen(!pickerOpen)}
                      className="rounded-full border border-ink px-3 py-1 text-xs font-bold text-ink hover:bg-ink hover:text-white"
                    >
                      {pickerOpen ? "Close" : "+ Add product"}
                    </button>
                  </div>

                  {pickerOpen && (
                    <div className="animate-fade-up mt-3">
                      <input
                        autoFocus
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search products…"
                        className="w-full rounded-xl border border-black/12 px-4 py-2.5 text-sm outline-none focus:border-gold"
                      />
                      <div className="thin-scroll mt-2 max-h-52 overflow-y-auto rounded-xl border border-black/8">
                        {catalog
                          .filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase()))
                          .map((p) => (
                            <button
                              key={p.id}
                              onClick={() => addProduct(p)}
                              className="flex w-full items-center justify-between border-b border-black/5 px-4 py-2.5 text-left last:border-0 hover:bg-paper"
                            >
                              <span>
                                <span className="text-sm font-semibold text-ink">{p.name}</span>
                                <span className="ml-2 text-xs text-charcoal/45">{p.category}</span>
                              </span>
                              <span className="text-sm font-bold text-ink">{CURRENCY} {p.price}</span>
                            </button>
                          ))}
                        {catalog.length === 0 && (
                          <p className="px-4 py-3 text-sm text-charcoal/45">No products available.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {productLines.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {productLines.map((l) => (
                        <div key={l.productId} className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                            <p className="text-xs text-charcoal/45">{CURRENCY} {l.price} each</p>
                          </div>
                          <div className="flex items-center rounded-full border border-black/15 bg-white">
                            <button onClick={() => setProductQty(l.productId, l.qty - 1)} aria-label="Decrease"
                              className="flex h-7 w-7 items-center justify-center text-charcoal/60 hover:text-ink">−</button>
                            <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                            <button onClick={() => setProductQty(l.productId, l.qty + 1)} aria-label="Increase"
                              className="flex h-7 w-7 items-center justify-center text-charcoal/60 hover:text-ink">+</button>
                          </div>
                          <span className="w-20 text-right text-sm font-bold text-ink">
                            {CURRENCY} {(l.price * l.qty).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !pickerOpen && <p className="mt-2 text-xs text-charcoal/45">No products on this sale.</p>
                  )}
                </div>

                <p className="mt-6 text-sm font-semibold text-charcoal/70">Add a tip for the barber?</p>
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  {TIPS.map((t) => (
                    <button
                      key={t}
                      onClick={() => { setTipPct(t); setCustomTip(""); }}
                      className={`rounded-xl border px-4 py-4 text-left transition-all ${
                        tipPct === t && customTip === "" ? "border-ink bg-ink text-white" : "border-black/12 hover:border-black/35"
                      }`}
                    >
                      <p className="text-[15px] font-bold">{t === 0 ? "No tip" : `${t}%`}</p>
                      {t > 0 && (
                        <p className={`text-xs ${tipPct === t && customTip === "" ? "text-white/60" : "text-charcoal/45"}`}>
                          {CURRENCY} {((price * t) / 100).toFixed(2)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-charcoal/50">Custom tip ({CURRENCY})</span>
                  <input
                    inputMode="decimal"
                    value={customTip}
                    onChange={(e) => { setCustomTip(e.target.value.replace(/[^0-9.]/g, "")); setTipPct(null); }}
                    placeholder="0.00"
                    className="mt-1.5 w-full rounded-xl border border-black/12 px-4 py-3 text-sm outline-none focus:border-gold"
                  />
                </label>
              </div>
            )}

            {ckStep === 1 && (
              <div className="animate-fade-up mt-6">
                <p className="text-sm font-semibold text-charcoal/70">How is {appt.client.split(" ")[0]} paying?</p>
                {payments.terminal && (
                  <button
                    onClick={() => setMethod(TERMINAL_METHOD)}
                    className={`mt-4 flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition-all ${
                      method === TERMINAL_METHOD ? "border-ink bg-ink text-white" : "border-gold/60 bg-gold/8 hover:border-ink"
                    }`}
                  >
                    <span>
                      <span className="text-[14px] font-bold">Card reader</span>
                      <span className={`ml-2 text-xs ${method === TERMINAL_METHOD ? "text-white/60" : "text-charcoal/50"}`}>
                        charge on the terminal
                      </span>
                    </span>
                    <span className="text-[10px] font-bold tracking-wider uppercase opacity-70">Stripe</span>
                  </button>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`rounded-xl border px-4 py-4 text-left text-[14px] font-bold transition-all ${
                        method === m ? "border-ink bg-ink text-white" : "border-black/12 hover:border-black/35"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {ckStep === 2 && (
              <div className="animate-fade-up mt-6 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-charcoal/50">Price ({CURRENCY}) — editable</span>
                  <input
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    className="mt-1.5 w-full rounded-xl border border-black/12 px-4 py-3 text-sm font-semibold outline-none focus:border-gold"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-charcoal/50">Manual discount ({CURRENCY}) — default 0</span>
                  <input
                    inputMode="decimal"
                    value={discount || ""}
                    onChange={(e) => setDiscount(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    placeholder="0.00"
                    className="mt-1.5 w-full rounded-xl border border-black/12 px-4 py-3 text-sm outline-none focus:border-gold"
                  />
                </label>
                <div>
                  <span className="text-xs font-semibold text-charcoal/50">Coupon code</span>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      value={couponInput}
                      onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCoupon(null); setCouponErr(null); }}
                      placeholder="e.g. WELCOME10"
                      className="flex-1 rounded-xl border border-black/12 px-4 py-3 text-sm tracking-wider uppercase outline-none focus:border-gold"
                    />
                    <button type="button" onClick={applyCoupon} className="rounded-xl border border-ink px-4 text-sm font-bold text-ink hover:bg-ink hover:text-white">
                      Apply
                    </button>
                  </div>
                  {coupon && (
                    <p className="mt-1.5 text-xs font-semibold text-st-started">
                      ✓ {coupon.code} applied — {CURRENCY} {coupon.discount.toFixed(2)} off
                    </p>
                  )}
                  {couponErr && <p className="mt-1.5 text-xs text-st-cancel">{couponErr}</p>}
                </div>
                <div className="rounded-xl bg-paper px-4 py-4 text-sm">
                  <Row k="Services" v={`${CURRENCY} ${price.toFixed(2)}`} />
                  {productLines.map((l) => (
                    <Row key={l.productId} k={`${l.qty}× ${l.name}`} v={`${CURRENCY} ${(l.price * l.qty).toFixed(2)}`} />
                  ))}
                  {discount > 0 && <Row k="Discount" v={`− ${CURRENCY} ${discount.toFixed(2)}`} />}
                  {coupon && <Row k={`Coupon ${coupon.code}`} v={`− ${CURRENCY} ${coupon.discount.toFixed(2)}`} />}
                  {tip > 0 && <Row k={`Tip${customTip === "" && tipPct ? ` (${tipPct}%)` : ""}`} v={`${CURRENCY} ${tip.toFixed(2)}`} />}
                  <Row k={`Paying by ${method ?? "—"}`} v="" />
                  <div className="my-2 h-px bg-black/10" />
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">To pay</span>
                    <span className="font-display text-xl font-semibold text-ink">{CURRENCY} {toPay.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ DONE ============ */}
        {mode === "done" && (
          <div className="animate-fade-up flex flex-col items-center px-6 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-st-started/12">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3f9142" strokeWidth="2.2"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3 className="font-display mt-5 text-2xl font-semibold text-ink">Sale completed</h3>
            <p className="mt-2 text-sm text-charcoal/55">
              {CURRENCY} {toPay.toFixed(2)} · {method}
            </p>
            <div className="mt-6 w-full rounded-xl border border-black/10 bg-paper px-5 py-4 text-left">
              <p className="text-[11px] font-bold tracking-wider text-charcoal/45 uppercase">Tax invoice</p>
              <p className="mt-1 text-sm font-bold text-ink">{invoice?.invoiceNo}</p>
              {typeof invoice?.vat === "number" && (
                <p className="mt-0.5 text-xs text-charcoal/55">
                  includes {CURRENCY} {invoice.vat.toFixed(2)} VAT ({(cfg.business.vatRate * 100).toFixed(0)}%)
                </p>
              )}
              {/* the TRN belongs on anything that calls itself a tax invoice —
                  a client asking for one at the desk will look for it here */}
              {cfg.business.trn && (
                <p className="mt-1.5 border-t border-black/8 pt-1.5 text-[11px] text-charcoal/50">
                  {cfg.business.legalName}<br />
                  <span className="font-semibold text-charcoal/70">TRN {cfg.business.trn}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-charcoal/50">
                Generated automatically and sent to {appt.client.split(" ")[0]} by SMS.
              </p>
            </div>
            {invoice && !invoice.invoiceNo.startsWith("INV-DEMO") && (
              <a
                href={`/api/bookings/${appt.id}/invoice/pdf`}
                download
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-ink/20 py-3 text-sm font-bold text-ink transition-colors hover:border-gold hover:text-gold-dim"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Download invoice (PDF)
              </a>
            )}
            <button onClick={onClose} className="btn-gold mt-4 w-full rounded-full py-3 text-sm tracking-widest uppercase">
              Back to calendar
            </button>
          </div>
        )}
      </div>

      {/* footer action */}
      {mode === "details" && appt.status !== "Cancelled" && appt.status !== "No Show" && (
        <div className="border-t border-[#eee9dd] px-6 py-4">
          <button
            onClick={() => setMode("checkout")}
            className="w-full rounded-full bg-ink py-3.5 text-sm font-bold tracking-widest text-gold-2 uppercase transition-all hover:bg-coal-2 hover:shadow-lg"
          >
            Checkout · {CURRENCY} {apptTotal(appt)}
          </button>
          <p className="mt-2 text-center text-[11px] text-charcoal/45">Products can be added at checkout</p>
        </div>
      )}
      {mode === "checkout" && (
        <div className="flex gap-3 border-t border-[#eee9dd] px-6 py-4">
          <button
            onClick={() => (ckStep === 0 ? setMode("details") : setCkStep(ckStep - 1))}
            className="flex-1 rounded-full border border-black/15 py-3 text-sm font-semibold text-charcoal/70 hover:border-black/40"
          >
            Back
          </button>
          <button
            disabled={(ckStep === 1 && !method) || paying}
            onClick={() => (ckStep === 2 ? complete() : setCkStep(ckStep + 1))}
            className="btn-gold flex-[2] rounded-full py-3 text-sm tracking-widest uppercase disabled:opacity-40"
          >
            {paying ? "Processing…" : ckStep === 2 ? `Pay ${CURRENCY} ${toPay.toFixed(2)}` : "Continue"}
          </button>
        </div>
      )}

      {/* ============ CANCEL MODAL ============ */}
      {cancelOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
          <div className="animate-fade-up w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-bold text-ink">Cancel this booking?</h3>
            <p className="mt-1 text-sm text-charcoal/55">A reason is required before the change is saved.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client called to cancel — travelling"
              className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-st-cancel"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => { setCancelOpen(false); setReason(""); }}
                className="flex-1 rounded-full border border-black/15 py-2.5 text-sm font-semibold text-charcoal/70"
              >
                Keep booking
              </button>
              <button
                onClick={saveCancel}
                disabled={!reason.trim()}
                className="flex-1 rounded-full bg-st-cancel py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-charcoal/65">
      <span>{k}</span>
      <span className="font-semibold text-ink">{v}</span>
    </div>
  );
}
