"use client";

/* ------------------------------------------------------------------ */
/* The online shop's back office.                                      */
/*                                                                     */
/* A separate system from the team console at /team, and separate on   */
/* purpose. Whoever runs the shop is not on the salon floor: they have */
/* no chair, no branch and no reason to hold a code that opens a till. */
/* They sign in here with an id and a password.                        */
/*                                                                     */
/* What they manage is one warehouse for the whole of the UAE. Every   */
/* order is delivered from it, so there is one stock figure per        */
/* product — no branches, nothing to allocate.                         */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { CURRENCY } from "@/lib/data";

type Row = {
  productId: string; name: string; sku: string | null; category: string; price: number;
  qty: number; reserved: number; available: number; reorderAt: number;
  low: boolean; updatedAt: string | null;
};
type Movement = {
  id: string; name: string; delta: number; reason: string;
  note: string | null; createdAt: string; actor: string | null;
};

export default function ShopBackOffice() {
  const [me, setMe] = useState<{ name: string; role: string } | null | "loading">("loading");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === "loading")
    return <div className="grid min-h-svh place-items-center bg-ink text-sm text-ivory/40">Loading…</div>;

  /* The owner can look in too — they own the stock. Anyone else, including
     salon staff signed in on the same browser, gets the sign-in form. */
  if (!me || (me.role !== "shop_manager" && me.role !== "super_admin"))
    return <ShopLogin onDone={setMe} />;

  return <Warehouse me={me} onSignOut={() => setMe(null)} />;
}

/* ------------------------------------------------------------------ */

function ShopLogin({ onDone }: { onDone: (me: { name: string; role: string }) => void }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/shop/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userId.trim(), password }),
    });
    setBusy(false);
    if (res.ok) return onDone(await res.json());
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not sign you in");
  };

  return (
    <div className="grid min-h-svh place-items-center bg-ink px-6 text-ivory">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center text-ivory">
          <Logo stacked markClass="h-12 w-auto" wordClass="h-6 w-auto" />
        </Link>
        <p className="mt-6 text-center text-[11px] font-bold tracking-[0.22em] text-gold-2 uppercase">
          Online shop
        </p>
        <h1 className="mt-1 text-center text-2xl font-bold">Stock &amp; orders</h1>

        <form onSubmit={submit} className="mt-7 space-y-3">
          <input
            value={userId} onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID" autoComplete="username" autoCapitalize="none"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-gold"
          />
          <input
            value={password} onChange={(e) => setPassword(e.target.value)}
            type="password" placeholder="Password" autoComplete="current-password"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-gold"
          />
          {err && <p className="text-sm text-st-cancel">{err}</p>}
          <button
            type="submit" disabled={busy}
            className="btn-gold w-full rounded-full py-3 text-sm font-bold disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-ivory/35">
          Salon staff sign in at <Link href="/team" className="underline hover:text-ivory/60">/team</Link> with
          their keypad code. This is a different system.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Warehouse({ me, onSignOut }: { me: { name: string; role: string }; onSignOut: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [dialog, setDialog] = useState<{ kind: "receive" | "adjust"; row: Row } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [inv, mov] = await Promise.all([
      fetch("/api/online/inventory"),
      fetch("/api/online/inventory/movements"),
    ]);
    if (inv.ok) setRows(await inv.json());
    if (mov.ok) setMovements((await mov.json()).slice(0, 12));
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    onSignOut();
  };

  const held = rows.reduce((n, r) => n + r.reserved, 0);
  const lowLines = rows.filter((r) => r.low).length;

  return (
    <div className="min-h-svh bg-paper text-ink">
      <header className="flex flex-wrap items-center gap-4 border-b border-black/10 bg-ink px-6 py-4 text-ivory">
        <Link href="/" className="text-ivory">
          <Logo markClass="h-7 w-auto" wordClass="h-[19px] w-auto" />
        </Link>
        <div className="gold-rule hidden h-6 w-px sm:block" />
        <p className="text-[11px] font-bold tracking-[0.2em] text-gold-2 uppercase">Online shop</p>
        <div className="ml-auto flex items-center gap-4">
          <p className="text-right text-sm">
            <span className="font-semibold">{me.name}</span>
            <span className="ml-2 text-[11px] text-ivory/40">
              {me.role === "super_admin" ? "owner" : "shop manager"}
            </span>
          </p>
          {me.role === "shop_manager" && (
            <button
              onClick={() => setChangingPassword(true)}
              className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-bold hover:border-gold"
            >
              Change password
            </button>
          )}
          <button onClick={signOut} className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-bold hover:border-gold">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold">Warehouse stock</h1>
          <p className="text-[13px] text-charcoal/55">
            {rows.filter((r) => r.available > 0).length} lines on sale
            {held > 0 && <> · {held} held for orders</>}
            {lowLines > 0 && <> · <span className="font-bold text-st-cancel">{lowLines} low</span></>}
          </p>
        </div>

        <p className="mt-3 max-w-2xl rounded-xl bg-white px-4 py-2.5 text-[13px] leading-relaxed text-charcoal/60">
          One stock figure for the whole of the UAE — everything ordered on the site is
          delivered from here. The branches&rsquo; own shelves are counted separately by
          the salon team and are not part of this.
        </p>

        {msg && <p className="mt-3 rounded-lg bg-st-started/10 px-4 py-2 text-sm text-st-started">{msg}</p>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-black/8 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-right">In stock</th>
                <th className="px-4 py-2.5 text-right">Held</th>
                <th className="px-4 py-2.5 text-right">Can sell</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b border-black/5 last:border-0 hover:bg-paper/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{r.name}</p>
                    <p className="text-xs text-charcoal/45">{r.sku ?? "—"} · {r.category}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-charcoal/70">{CURRENCY} {r.price}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold ${r.low ? "text-st-cancel" : "text-ink"}`}>{r.qty}</span>
                    {r.low && (
                      <span className="ml-2 rounded-full bg-st-cancel/10 px-2 py-0.5 text-[10px] font-bold text-st-cancel uppercase">
                        Low
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-charcoal/60">{r.reserved || "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-ink">{r.available}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setDialog({ kind: "receive", row: r })}
                      className="rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-gold">
                      Receive
                    </button>
                    <button onClick={() => setDialog({ kind: "adjust", row: r })}
                      className="ml-2 rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-st-cancel">
                      Adjust
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-charcoal/45">Nothing to show yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-5 rounded-2xl border border-black/8 bg-white p-5">
          <h2 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Recent movements</h2>
          <div className="mt-3 space-y-1.5 text-sm">
            {movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-4 border-b border-black/5 py-1.5 last:border-0">
                <span className="text-ink">
                  {m.name}
                  <span className="ml-2 text-xs text-charcoal/45">
                    {m.reason.replaceAll("_", " ")}{m.note ? ` · ${m.note}` : ""}{m.actor ? ` · ${m.actor}` : ""}
                  </span>
                </span>
                <span className={`font-bold ${m.delta > 0 ? "text-st-started" : "text-st-cancel"}`}>
                  {m.delta > 0 ? "+" : ""}{m.delta}
                </span>
              </div>
            ))}
            {movements.length === 0 && <p className="text-charcoal/45">No movements yet.</p>}
          </div>
        </section>
      </main>

      {dialog && (
        <StockDialog
          kind={dialog.kind}
          row={dialog.row}
          onClose={(changed) => { setDialog(null); if (changed) { setMsg(changed); load(); } }}
        />
      )}

      {changingPassword && (
        <ChangePassword onClose={(done) => { setChangingPassword(false); if (done) setMsg(done); }} />
      )}
    </div>
  );
}

function StockDialog({ kind, row, onClose }: {
  kind: "receive" | "adjust"; row: Row; onClose: (msg: string | null) => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<"adjustment" | "correction" | "returned">("adjustment");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Math.trunc(Number(qty));
    if (!n) { setErr(kind === "receive" ? "Enter a quantity" : "Enter a non-zero change"); return; }
    setBusy(true);
    const res = await fetch(`/api/online/inventory/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kind === "receive"
        ? { productId: row.productId, qty: Math.abs(n), note: note || undefined }
        : { productId: row.productId, delta: n, reason, note: note || undefined }),
    });
    setBusy(false);
    if (res.ok)
      return onClose(kind === "receive"
        ? `Received ${Math.abs(n)} × ${row.name}`
        : `${row.name} adjusted by ${n > 0 ? "+" : ""}${n}`);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Failed");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel">
        <h3 className="text-lg font-bold text-ink">
          {kind === "receive" ? "Receive a delivery" : "Adjust stock"}
        </h3>
        <p className="mt-1 text-sm text-charcoal/55">
          {row.name} · {row.qty} in stock{row.reserved > 0 && `, ${row.reserved} held for orders`}
        </p>

        <input
          value={qty}
          onChange={(e) => { setQty(e.target.value.replace(kind === "receive" ? /[^0-9]/g : /[^0-9-]/g, "")); setErr(null); }}
          placeholder={kind === "receive" ? "Quantity received" : "Change (e.g. -3)"}
          inputMode={kind === "receive" ? "numeric" : "text"}
          className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
        />
        {kind === "adjust" && (
          <select
            value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}
            className="mt-2 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
          >
            <option value="adjustment">Stock count</option>
            <option value="correction">Correction</option>
            <option value="returned">Customer return</option>
          </select>
        )}
        <input
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
          className="mt-2 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
        />
        {kind === "adjust" && row.reserved > 0 && (
          <p className="mt-2 text-xs text-charcoal/50">
            {row.reserved} is promised to orders and cannot be written off — cancel the order first.
          </p>
        )}
        {err && <p className="mt-2 text-sm text-st-cancel">{err}</p>}

        <div className="mt-4 flex gap-3">
          <button onClick={() => onClose(null)} className="flex-1 rounded-full border border-black/15 py-2.5 text-sm font-semibold text-charcoal/70">
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className="btn-gold flex-1 rounded-full py-2.5 text-sm font-bold disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* The owner sets the first password and hands it over; from here on it is
   the manager's own. Asking for the current one means a session left open
   on a shared machine cannot quietly take the account over. */
function ChangePassword({ onClose }: { onClose: (msg: string | null) => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setErr("At least 8 characters"); return; }
    if (password !== confirm) { setErr("Those two don't match"); return; }
    setBusy(true);
    const res = await fetch("/api/auth/shop/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current, password }),
    });
    setBusy(false);
    if (res.ok) return onClose("Your password is changed");
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not change it");
  };

  const field = "mt-2 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel">
        <h3 className="text-lg font-bold text-ink">Change your password</h3>
        <p className="mt-1 text-sm leading-relaxed text-charcoal/55">
          Only you will know it — the owner cannot read it back.
        </p>
        <input
          value={current} onChange={(e) => { setCurrent(e.target.value); setErr(null); }}
          type="password" placeholder="Current password" autoComplete="current-password"
          className={field}
        />
        <input
          value={password} onChange={(e) => { setPassword(e.target.value); setErr(null); }}
          type="password" placeholder="New password" autoComplete="new-password"
          className={field}
        />
        <input
          value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(null); }}
          type="password" placeholder="New password again" autoComplete="new-password"
          className={field}
        />
        {err && <p className="mt-2 text-sm text-st-cancel">{err}</p>}
        <div className="mt-4 flex gap-3">
          <button onClick={() => onClose(null)} className="flex-1 rounded-full border border-black/15 py-2.5 text-sm font-semibold text-charcoal/70">
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className="btn-gold flex-1 rounded-full py-2.5 text-sm font-bold disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
