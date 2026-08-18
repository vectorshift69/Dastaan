"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Logo from "@/components/Logo";

export default function ClientLoginPage() {
  return (
    <Suspense fallback={null}>
      <ClientLogin />
    </Suspense>
  );
}

function ClientLogin() {
  const router = useRouter();
  const params = useSearchParams();
  /* where to go after signing in — the booking page sends people here and
     expects them back. Relative paths only, so this can't be used to bounce
     someone off to another site. */
  const raw = params.get("next") ?? "/book";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/book";

  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!userId.trim() || !password) {
      setError("Enter your user ID and password.");
      return;
    }
    if (mode === "register" && name.trim().length < 2) {
      setError("Please tell us your name.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        mode === "signin" ? "/api/auth/client/login" : "/api/auth/client/register",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            mode === "signin"
              ? { userId: userId.trim(), password }
              : { userId: userId.trim(), password, name: name.trim(), phone: phone.trim() || undefined }
          ),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(next);
        return;
      }
      setBusy(false);
      setError(data.error ?? (mode === "signin" ? "Sign-in failed — try again." : "Could not create that account."));
    } catch {
      setBusy(false);
      setError("Can't reach the server. Is the API running?");
    }
  };

  return (
    <div className="grain flex min-h-svh items-center justify-center bg-ink px-6 py-16">
      {/* ambient gold glow */}
      <div className="pointer-events-none fixed top-[-20%] left-1/2 h-[60vh] w-[70vw] -translate-x-1/2 rounded-full bg-gold/6 blur-[120px]" />

      <div className="animate-fade-up w-full max-w-md">
        <Link href="/" aria-label="Dastaan — home" className="flex justify-center text-ivory">
          <Logo stacked markClass="h-16 w-auto" wordClass="h-7 w-auto" />
        </Link>
        <div className="gold-rule mx-auto mt-5 w-24" />
        <p className="mt-5 text-center text-sm font-light text-ivory/50">
          {mode === "signin" ? "Welcome back. Your chair is waiting." : "Create an account and your visits start counting."}
        </p>

        {/* sign in / register */}
        <div className="mx-auto mt-7 flex w-full max-w-xs overflow-hidden rounded-full border border-ivory/15">
          {(["signin", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); }}
              className={`flex-1 py-2 text-[13px] font-semibold transition-colors ${
                mode === m ? "bg-gold text-ink" : "text-ivory/55 hover:text-ivory"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form
          onSubmit={submit}
          className="mt-10 rounded-2xl border border-ivory/10 bg-coal/80 p-8 shadow-panel backdrop-blur-sm"
        >
          {mode === "register" && (
            <>
              <label className="mb-5 block">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="e.g. Omar Al-Farsi"
                  className="mt-2 w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-[15px] text-ivory placeholder:text-ivory/25 outline-none transition-colors focus:border-gold"
                />
              </label>
              <label className="mb-5 block">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">
                  Mobile <span className="normal-case tracking-normal text-ivory/30">— for your confirmation</span>
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="+971 50 000 0000"
                  className="mt-2 w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-[15px] text-ivory placeholder:text-ivory/25 outline-none transition-colors focus:border-gold"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">
              {mode === "signin" ? "User ID" : "Choose a user ID"}
            </span>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoComplete="username"
              placeholder="your user ID"
              className="mt-2 w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-[15px] text-ivory placeholder:text-ivory/25 outline-none transition-colors focus:border-gold"
            />
          </label>

          <label className="mt-5 block">
            <span className="text-[11px] font-semibold tracking-[0.2em] text-ivory/50 uppercase">Password</span>
            <div className="relative mt-2">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 pr-14 text-[15px] text-ivory placeholder:text-ivory/25 outline-none transition-colors focus:border-gold"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] font-semibold tracking-wider text-ivory/40 uppercase hover:text-gold-2"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {error && (
            <p className="animate-shake mt-4 rounded-lg border border-st-cancel/40 bg-st-cancel/10 px-4 py-2.5 text-sm text-[#e08a80]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-gold mt-7 w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:opacity-60"
          >
            {busy ? (mode === "signin" ? "Signing in…" : "Creating…") : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-ivory/10" />
            <span className="text-[11px] tracking-widest text-ivory/35 uppercase">or</span>
            <div className="h-px flex-1 bg-ivory/10" />
          </div>

          <button
            type="button"
            className="btn-ghost flex w-full items-center justify-center gap-3 rounded-full py-3 text-sm"
          >
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 35.4 44 30.1 44 24c0-1.3-.1-2.6-.4-3.9z"/>
            </svg>
            Sign in with Google
          </button>

          <div className="mt-7 flex items-center justify-between text-[13px]">
            <Link href="#" className="text-ivory/45 transition-colors hover:text-gold-2">
              Forgot password?
            </Link>
            <button
              type="button"
              onClick={() => { setMode(mode === "signin" ? "register" : "signin"); setError(""); }}
              className="font-semibold text-gold-2 transition-colors hover:text-gold"
            >
              {mode === "signin" ? "Create new account" : "I already have an account"}
            </button>
          </div>
        </form>

        <p className="mt-8 text-center text-[11px] tracking-wider text-ivory/25">
          Demo build — sign in with <span className="text-ivory/50">demo / demo1234</span>
        </p>
      </div>
    </div>
  );
}
