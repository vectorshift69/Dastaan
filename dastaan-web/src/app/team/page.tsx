"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function TeamLogin() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [welcome, setWelcome] = useState<string | null>(null);
  const checking = useRef(false);

  /* lockout countdown */
  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setInterval(() => setLockedFor((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [lockedFor > 0]);

  const press = useCallback(
    (d: string) => {
      if (lockedFor > 0 || checking.current || welcome) return;
      setError(false);
      setDigits((prev) => (prev.length >= 4 ? prev : [...prev, d]));
    },
    [lockedFor, welcome]
  );

  const backspace = useCallback(() => {
    if (lockedFor > 0 || checking.current) return;
    setDigits((prev) => prev.slice(0, -1));
  }, [lockedFor]);

  /* auto-submit on 4th digit — the code alone identifies the staff member.
     Verification is entirely server-side (hashed codes, rate limits, lockout). */
  useEffect(() => {
    if (digits.length !== 4) return;
    checking.current = true;
    const code = digits.join("");
    (async () => {
      try {
        const res = await fetch("/api/auth/team", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const roleLabel =
            data.role === "super_admin" ? "Super Admin" : data.role === "admin" ? "Admin" : "Barber";
          setWelcome(`${data.name} · ${roleLabel}`);
          setTimeout(() => router.push("/console"), 900);
          return;
        }
        if (res.status === 429 && data.retryAfter) setLockedFor(data.retryAfter);
        setError(true);
        setDigits([]);
      } catch {
        setError(true);
        setDigits([]);
      } finally {
        checking.current = false;
      }
    })();
  }, [digits, router]);

  /* physical keyboard support */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") backspace();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, backspace]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="grain flex min-h-svh flex-col items-center justify-center bg-ink px-6">
      <div className="pointer-events-none fixed top-[-25%] left-1/2 h-[55vh] w-[60vw] -translate-x-1/2 rounded-full bg-gold/5 blur-[110px]" />

      <div className="animate-fade-in flex w-full max-w-xs flex-col items-center">
        <span className="font-display text-3xl font-semibold tracking-[0.28em] text-ivory">DASTAAN</span>
        <div className="gold-rule mt-4 w-20" />
        <p className="mt-4 text-[11px] tracking-[0.35em] text-ivory/40 uppercase">Team entrance</p>

        {/* status line */}
        <div className="mt-10 h-6 text-center">
          {welcome ? (
            <p className="animate-fade-in text-sm font-medium text-gold-2">Welcome, {welcome}</p>
          ) : lockedFor > 0 ? (
            <p className="text-sm text-[#e08a80]">Too many attempts — locked for {lockedFor}s</p>
          ) : error ? (
            <p className="text-sm text-[#e08a80]">Code not recognised</p>
          ) : (
            <p className="text-sm text-ivory/40">Enter your 4-digit code</p>
          )}
        </div>

        {/* code dots */}
        <div className={`mt-6 flex gap-5 ${error ? "animate-shake" : ""}`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border transition-all duration-200 ${
                welcome
                  ? "border-gold bg-gold shadow-[0_0_18px_-2px_rgba(201,162,39,0.8)]"
                  : digits.length > i
                    ? "border-gold-2 bg-gold-2 scale-110"
                    : "border-ivory/25 bg-transparent"
              }`}
            />
          ))}
        </div>

        {/* keypad */}
        <div className={`mt-10 grid w-full grid-cols-3 gap-3 ${lockedFor > 0 ? "pointer-events-none opacity-30" : ""}`}>
          {keys.map((k) => (
            <Key key={k} label={k} onPress={() => press(k)} />
          ))}
          <div />
          <Key label="0" onPress={() => press("0")} />
          <button
            onClick={backspace}
            aria-label="Delete"
            className="flex aspect-square items-center justify-center rounded-2xl text-ivory/50 transition-all hover:text-gold-2 active:scale-95"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M9 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H9l-7-8 7-8z" />
              <path d="M13 9.5l5 5M18 9.5l-5 5" />
            </svg>
          </button>
        </div>

        <p className="mt-12 text-center text-[10px] leading-relaxed tracking-wider text-ivory/25">
          Authorised staff only. All access is logged.
          <br />
          Demo codes — 1111 reception · 2222 barber · 9999 owner (see API README)
        </p>
      </div>
    </div>
  );
}

function Key({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      className="aspect-square rounded-2xl border border-ivory/12 bg-coal/60 text-2xl font-light text-ivory transition-all duration-150 hover:border-gold/60 hover:bg-coal-2 hover:text-gold-2 active:scale-95 active:bg-gold/15"
    >
      {label}
    </button>
  );
}
