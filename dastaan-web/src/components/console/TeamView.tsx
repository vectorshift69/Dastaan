"use client";

/* ------------------------------------------------------------------ */
/* Team — who can sign in, and how.                                    */
/*                                                                     */
/* Three kinds of account sit here because the owner thinks of them as */
/* one list ("who can get in?"), even though they work differently:    */
/*                                                                     */
/*   staff        4-digit keypad code, typed by the owner and passed   */
/*                on in person                                         */
/*   shop manager id and password, created once and then theirs        */
/*   clients      never touched by hand — a reset link goes to them    */
/*                                                                     */
/* Nothing on this screen can read an existing credential back. Codes  */
/* are stored as an HMAC and passwords as a hash, so the only actions  */
/* available are "replace" and "switch off".                           */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";
import { branches } from "@/lib/data";

type User = {
  id: string; role: string; name: string; title: string | null;
  userId: string | null; email: string | null;
  branchId: string | null; branchArea: string | null;
  active: number | boolean; createdAt: string;
  hasCode: boolean; hasPassword: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Owner",
  admin: "Reception",
  barber: "Barber",
  shop_manager: "Online shop",
};

const ROLE_TONE: Record<string, string> = {
  super_admin: "bg-gold/15 text-gold-dim",
  admin: "bg-st-started/12 text-st-started",
  barber: "bg-black/6 text-charcoal/70",
  shop_manager: "bg-[#6a5acd]/12 text-[#5b4bbd]",
};

export default function TeamView({ meId }: { meId?: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<"staff" | "shop" | null>(null);
  const [dialog, setDialog] = useState<{ kind: "code" | "password"; user: User } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.status === 401 || res.status === 403) { setDenied(true); return; }
    setDenied(false);
    setUsers(await res.json());
  }, []);

  useEffect(() => { load().catch(() => setDenied(true)); }, [load]);

  const say = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 6000); };

  const toggleActive = async (u: User) => {
    const turningOff = !!u.active;
    if (turningOff && !confirm(`Switch off ${u.name}? They will not be able to sign in. Their history stays.`)) return;
    const res = await fetch(`/api/users/${u.id}/active`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !turningOff }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { say(`${u.name} ${turningOff ? "switched off" : "switched back on"}`); load(); }
    else setErr(d.error ?? "Could not do that");
  };

  const sendClientReset = async (clientId: string, name: string) => {
    const res = await fetch(`/api/users/clients/${clientId}/send-reset`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) say(`Reset link sent to ${d.sentTo} for ${name}`);
    else setErr(d.error ?? "Could not send it");
  };

  if (denied)
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-charcoal/50">
        Only the owner can manage who signs in.
      </div>
    );

  const staff = users.filter((u) => ["super_admin", "admin", "barber"].includes(u.role));
  const managers = users.filter((u) => u.role === "shop_manager");

  return (
    <div className="thin-scroll flex-1 overflow-y-auto p-6">
      <p className="max-w-2xl rounded-xl bg-white px-4 py-2.5 text-[13px] leading-relaxed text-charcoal/60">
        Codes and passwords are stored scrambled, so no one — not even you — can read an
        existing one back. You can only replace it or switch the account off.
      </p>

      {msg && <p className="mt-3 rounded-lg bg-st-started/10 px-4 py-2 text-sm text-st-started">{msg}</p>}
      {err && <p className="mt-3 rounded-lg bg-st-cancel/10 px-4 py-2 text-sm text-st-cancel">{err}</p>}

      {/* ---------- salon staff ---------- */}
      <div className="mt-5 flex items-center gap-3">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">
          Salon team · keypad codes
        </h2>
        <button
          onClick={() => setAdding(adding === "staff" ? null : "staff")}
          className="btn-gold ml-auto rounded-full px-5 py-1.5 text-[13px]"
        >
          + Add someone
        </button>
      </div>

      {adding === "staff" && (
        <AddStaff
          onDone={(name) => { setAdding(null); say(`${name} added — give them their code`); load(); }}
          onCancel={() => setAdding(null)}
        />
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Branch</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} className={`border-b border-black/5 last:border-0 hover:bg-paper/60 ${!u.active ? "opacity-45" : ""}`}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">
                    {u.name}
                    {u.id === meId && <span className="ml-2 text-[10px] font-bold tracking-wider text-gold-dim uppercase">You</span>}
                  </p>
                  <p className="text-xs text-charcoal/45">
                    {u.title ?? "—"}{!u.active && " · switched off"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${ROLE_TONE[u.role]}`}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-charcoal/70">{u.branchArea ?? "—"}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setDialog({ kind: "code", user: u })}
                    className="rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-gold">
                    {u.id === meId ? "Change my code" : "Set new code"}
                  </button>
                  {u.id !== meId && (
                    <button onClick={() => toggleActive(u)}
                      className="ml-2 rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-st-cancel">
                      {u.active ? "Switch off" : "Switch on"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- online shop ---------- */}
      <div className="mt-8 flex items-center gap-3">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">
          Online shop · id &amp; password
        </h2>
        <button
          onClick={() => setAdding(adding === "shop" ? null : "shop")}
          className="btn-gold ml-auto rounded-full px-5 py-1.5 text-[13px]"
        >
          + Add a manager
        </button>
      </div>

      <p className="mt-2 text-[13px] text-charcoal/55">
        You set the first password and hand it over. After that they change it themselves
        at <span className="font-semibold text-ink">/shop</span> — you will not be able to see it.
      </p>

      {adding === "shop" && (
        <AddShopManager
          onDone={(name) => { setAdding(null); say(`${name} added — give them the ID and first password`); load(); }}
          onCancel={() => setAdding(null)}
        />
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ink text-left text-[10px] tracking-[0.15em] text-ivory/70 uppercase">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">User ID</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((u) => (
              <tr key={u.id} className={`border-b border-black/5 last:border-0 hover:bg-paper/60 ${!u.active ? "opacity-45" : ""}`}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{u.name}</p>
                  <p className="text-xs text-charcoal/45">{u.active ? "Active" : "Switched off"}</p>
                </td>
                <td className="px-4 py-3 font-mono text-charcoal/70">{u.userId}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setDialog({ kind: "password", user: u })}
                    className="rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-gold">
                    Set new password
                  </button>
                  <button onClick={() => toggleActive(u)}
                    className="ml-2 rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-st-cancel">
                    {u.active ? "Switch off" : "Switch on"}
                  </button>
                </td>
              </tr>
            ))}
            {managers.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-charcoal/45">
                No one runs the online shop yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- clients ---------- */}
      <ClientResets onSend={sendClientReset} />

      {dialog?.kind === "code" && (
        <CodeDialog
          user={dialog.user}
          isSelf={dialog.user.id === meId}
          onClose={(m) => { setDialog(null); if (m) { say(m); load(); } }}
        />
      )}
      {dialog?.kind === "password" && (
        <PasswordDialog
          user={dialog.user}
          onClose={(m) => { setDialog(null); if (m) { say(m); load(); } }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ClientResets({ onSend }: { onSend: (id: string, name: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string | null; name: string; email?: string | null }[]>([]);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    const res = await fetch(`/api/users/clients?q=${encodeURIComponent(q.trim())}`);
    setSearched(true);
    setHits(res.ok ? await res.json() : []);
  };

  return (
    <section className="mt-8">
      <h2 className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">
        Clients · password resets
      </h2>
      <p className="mt-2 max-w-2xl text-[13px] text-charcoal/55">
        You can send a client a reset link, but the link goes to their inbox — nobody here
        sets a client&rsquo;s password. They can also do this themselves from the sign-in
        screen.
      </p>

      <div className="mt-3 flex max-w-md gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Find a client by name, email or ID"
          className="flex-1 rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button onClick={search} className="rounded-full border border-black/15 bg-white px-5 text-sm font-bold hover:border-gold">
          Search
        </button>
      </div>

      {searched && hits.length === 0 && (
        <p className="mt-3 text-sm text-charcoal/45">Nobody by that name.</p>
      )}
      {hits.length > 0 && (
        <div className="mt-3 max-w-2xl overflow-hidden rounded-2xl border border-black/8 bg-white">
          {hits.map((c) => (
            <div key={c.id ?? c.name} className="flex items-center gap-4 border-b border-black/5 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{c.name}</p>
                <p className="truncate text-xs text-charcoal/45">{c.email ?? "no email on file"}</p>
              </div>
              <button
                onClick={() => c.id && onSend(c.id, c.name)}
                disabled={!c.id || !c.email}
                title={!c.id ? "Walk-in — no account" : !c.email ? "No email on file" : undefined}
                className="ml-auto shrink-0 rounded-full border border-black/12 px-3 py-1 text-xs font-bold hover:border-gold disabled:opacity-35 disabled:hover:border-black/12"
              >
                Send reset link
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

const field = "w-full rounded-xl border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-wider text-charcoal/50 uppercase">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-charcoal/40">{hint}</p>}
    </label>
  );
}

function AddStaff({ onDone, onCancel }: { onDone: (name: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: "", role: "barber", branchId: "b1", title: "", code: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/users/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name, role: f.role, branchId: f.branchId,
        title: f.title || undefined, code: f.code,
      }),
    });
    setBusy(false);
    if (res.ok) return onDone(f.name);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not add them");
  };

  return (
    <div className="animate-fade-up mt-3 rounded-2xl border border-gold/40 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name" />
        </Field>
        <Field label="Role">
          <select className={field} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="barber">Barber</option>
            <option value="admin">Reception</option>
          </select>
        </Field>
        <Field label="Branch">
          <select className={field} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.area}</option>)}
          </select>
        </Field>
        <Field label="Title" hint="Shown on the calendar, optional">
          <input className={field} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Barber" />
        </Field>
        <Field label="Keypad code" hint="4 digits — write it down, you cannot read it back">
          <input
            className={field} value={f.code} inputMode="numeric" maxLength={4}
            onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            placeholder="0000"
          />
        </Field>
      </div>
      {err && <p className="mt-3 text-sm text-st-cancel">{err}</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={onCancel} className="rounded-full border border-black/15 px-6 py-2 text-sm font-semibold text-charcoal/70">
          Cancel
        </button>
        <button onClick={submit} disabled={busy} className="btn-gold rounded-full px-8 py-2 text-sm font-bold disabled:opacity-50">
          {busy ? "Adding…" : "Add to the team"}
        </button>
      </div>
    </div>
  );
}

function AddShopManager({ onDone, onCancel }: { onDone: (name: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: "", userId: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/users/shop-manager", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(f),
    });
    setBusy(false);
    if (res.ok) return onDone(f.name);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not add them");
  };

  return (
    <div className="animate-fade-up mt-3 rounded-2xl border border-gold/40 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">
          <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name" />
        </Field>
        <Field label="User ID" hint="What they type to sign in">
          <input
            className={field} value={f.userId} autoCapitalize="none"
            onChange={(e) => setF({ ...f, userId: e.target.value.replace(/[^a-zA-Z0-9_.-]/g, "").toLowerCase() })}
            placeholder="e.g. shop"
          />
        </Field>
        <Field label="First password" hint="At least 8 characters — they change it after signing in">
          <input className={field} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Temporary password" />
        </Field>
      </div>
      {err && <p className="mt-3 text-sm text-st-cancel">{err}</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={onCancel} className="rounded-full border border-black/15 px-6 py-2 text-sm font-semibold text-charcoal/70">
          Cancel
        </button>
        <button onClick={submit} disabled={busy} className="btn-gold rounded-full px-8 py-2 text-sm font-bold disabled:opacity-50">
          {busy ? "Adding…" : "Create the account"}
        </button>
      </div>
    </div>
  );
}

function CodeDialog({ user, isSelf, onClose }: {
  user: User; isSelf: boolean; onClose: (msg: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (code.length !== 4) { setErr("The code must be 4 digits"); return; }
    setBusy(true);
    /* changing your own code goes through the self-service route, so the
       server can be sure you are the one standing there */
    const res = isSelf
      ? await fetch("/api/auth/team/change-code", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        })
      : await fetch(`/api/users/${user.id}/code`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
    setBusy(false);
    if (res.ok) return onClose(isSelf ? "Your code is changed" : `${user.name}'s code is changed — tell them the new one`);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not change it");
  };

  return (
    <Modal title={isSelf ? "Change your code" : `New code for ${user.name}`}
           subtitle="Four digits. Nobody can read the old one — it is only ever stored scrambled.">
      <input
        value={code} inputMode="numeric" maxLength={4} autoFocus
        onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 4)); setErr(null); }}
        placeholder="0000"
        className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-gold"
      />
      {err && <p className="mt-2 text-sm text-st-cancel">{err}</p>}
      <Actions onCancel={() => onClose(null)} onSubmit={submit} busy={busy} label="Set the code" />
    </Modal>
  );
}

function PasswordDialog({ user, onClose }: { user: User; onClose: (msg: string | null) => void }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setErr("At least 8 characters"); return; }
    setBusy(true);
    const res = await fetch(`/api/users/${user.id}/shop-password`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) return onClose(`New password set for ${user.name} — hand it over and ask them to change it`);
    const d = await res.json().catch(() => ({}));
    setErr(d.error ?? "Could not change it");
  };

  return (
    <Modal title={`New password for ${user.name}`}
           subtitle="Use this only if they are locked out. Give it to them and ask them to change it at /shop.">
      <input
        value={password} autoFocus
        onChange={(e) => { setPassword(e.target.value); setErr(null); }}
        placeholder="Temporary password"
        className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-gold"
      />
      {err && <p className="mt-2 text-sm text-st-cancel">{err}</p>}
      <Actions onCancel={() => onClose(null)} onSubmit={submit} busy={busy} label="Set the password" />
    </Modal>
  );
}

function Modal({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-charcoal/55">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function Actions({ onCancel, onSubmit, busy, label }: {
  onCancel: () => void; onSubmit: () => void; busy: boolean; label: string;
}) {
  return (
    <div className="mt-4 flex gap-3">
      <button onClick={onCancel} className="flex-1 rounded-full border border-black/15 py-2.5 text-sm font-semibold text-charcoal/70">
        Cancel
      </button>
      <button onClick={onSubmit} disabled={busy} className="btn-gold flex-1 rounded-full py-2.5 text-sm font-bold disabled:opacity-50">
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}
