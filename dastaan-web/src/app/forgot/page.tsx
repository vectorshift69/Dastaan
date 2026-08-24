"use client";

/* ------------------------------------------------------------------ */
/* Forgot password.                                                    */
/*                                                                     */
/* The confirmation is deliberately non-committal: it says a link is   */
/* on its way "if that email is on an account", and says exactly that  */
/* whether or not the account exists. Anything more helpful would turn */
/* this form into a way of finding out who has an account at a men's   */
/* salon, which is nobody's business but theirs.                       */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter the email address on your account");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true); // same outcome either way, on purpose
    } catch {
      setError("Can't reach the server — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grain grid min-h-svh place-items-center bg-ink px-6 text-ivory">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center text-ivory">
          <Logo stacked markClass="h-12 w-auto" wordClass="h-6 w-auto" />
        </Link>

        {sent ? (
          <div className="animate-fade-up mt-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold bg-gold/10">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e3c25e" strokeWidth="1.8">
                <path d="M4 6h16v12H4z" strokeLinejoin="round" />
                <path d="M4 7l8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="font-display mt-6 text-2xl">Check your email</h1>
            <p className="mt-3 text-sm leading-relaxed text-ivory/55">
              If that email is on an account, a reset link is on its way. It works once and
              expires in an hour.
            </p>
            <p className="mt-4 text-xs text-ivory/35">
              Nothing arrived? Check your spam folder, or try another address.
            </p>
            <Link href="/login" className="btn-gold mt-8 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display mt-8 text-center text-3xl">Forgot your password?</h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-ivory/55">
              Give us the email on your account and we&rsquo;ll send you a link to set a new one.
            </p>

            <form onSubmit={submit} className="mt-7">
              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Email</span>
                <input
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  type="email" autoComplete="email" autoFocus
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-xl border border-ivory/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-ivory/25 focus:border-gold"
                />
              </label>
              {error && <p className="mt-3 text-sm text-[#e08a80]">{error}</p>}
              <button
                type="submit" disabled={busy}
                className="btn-gold mt-5 w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send the link"}
              </button>
            </form>

            <p className="mt-7 text-center text-[13px]">
              <Link href="/login" className="text-ivory/45 transition-colors hover:text-gold-2">
                Back to sign in
              </Link>
            </p>

            <p className="mt-8 text-center text-[11px] leading-relaxed tracking-wider text-ivory/25">
              Salon staff use a keypad code at <Link href="/team" className="hover:text-ivory/50">/team</Link> —
              ask the owner to set you a new one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
