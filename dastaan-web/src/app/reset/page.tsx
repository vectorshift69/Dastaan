"use client";

/* ------------------------------------------------------------------ */
/* Set a new password from an emailed link.                            */
/*                                                                     */
/* The link is checked before the form is shown, so someone opening an */
/* expired or already-used link is told immediately rather than after  */
/* typing a password twice.                                            */
/* ------------------------------------------------------------------ */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Shell><p className="mt-10 text-center text-sm text-ivory/40">Checking your link…</p></Shell>}>
      <ResetPassword />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain grid min-h-svh place-items-center bg-ink px-6 text-ivory">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center text-ivory">
          <Logo stacked markClass="h-12 w-auto" wordClass="h-6 w-auto" />
        </Link>
        {children}
      </div>
    </div>
  );
}

function ResetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"checking" | "ready" | "bad" | "done">("checking");
  const [linkError, setLinkError] = useState("That link is not valid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState("bad"); return; }
    fetch(`/api/auth/reset/check?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setState("ready");
        else { setLinkError(d.error ?? "That link is not valid"); setState("bad"); }
      })
      .catch(() => { setLinkError("Can't reach the server"); setState("bad"); });
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("At least 8 characters"); return; }
    if (password !== confirm) { setError("Those two don't match"); return; }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (res.ok) { setState("done"); return; }
    const d = await res.json().catch(() => ({}));
    setError(d.error ?? "Could not set that password");
  };

  if (state === "checking")
    return <Shell><p className="mt-10 text-center text-sm text-ivory/40">Checking your link…</p></Shell>;

  if (state === "bad")
    return (
      <Shell>
        <div className="animate-fade-up mt-10 text-center">
          <h1 className="font-display text-2xl">{linkError}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ivory/55">
            Reset links work once and expire after an hour. Ask for a fresh one and it will
            be waiting in your inbox.
          </p>
          <Link href="/forgot" className="btn-gold mt-8 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
            Send a new link
          </Link>
        </div>
      </Shell>
    );

  if (state === "done")
    return (
      <Shell>
        <div className="animate-fade-up mt-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold bg-gold/10">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e3c25e" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="font-display mt-6 text-2xl">Password changed</h1>
          <p className="mt-3 text-sm text-ivory/55">You can sign in with it now.</p>
          <Link href="/login" className="btn-gold mt-8 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
            Sign in
          </Link>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <h1 className="font-display mt-8 text-center text-3xl">Set a new password</h1>
      <p className="mt-3 text-center text-sm text-ivory/55">Pick something you haven&rsquo;t used before.</p>

      <form onSubmit={submit} className="mt-7 space-y-3">
        <label className="block">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">New password</span>
          <input
            value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }}
            type="password" autoComplete="new-password" autoFocus
            className="mt-2 w-full rounded-xl border border-ivory/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Again</span>
          <input
            value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(""); }}
            type="password" autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-ivory/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-gold"
          />
        </label>
        {error && <p className="text-sm text-[#e08a80]">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="btn-gold w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save the password"}
        </button>
      </form>
    </Shell>
  );
}
