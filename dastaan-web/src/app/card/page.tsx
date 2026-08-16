"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Card = {
  tier: "Member" | "Silver" | "Gold";
  points: number;
  lifetimePoints: number;
  qrPayload: string;
  nextTier: { name: string; at: number } | null;
};

const TIER_STYLE: Record<Card["tier"], { grad: string; label: string }> = {
  Member: { grad: "linear-gradient(135deg, #2a2a2a 0%, #141414 100%)", label: "text-ivory/70" },
  Silver: { grad: "linear-gradient(135deg, #4a4a48 0%, #1c1c1c 100%)", label: "text-[#c8c8c4]" },
  Gold: { grad: "linear-gradient(135deg, #3a2f10 0%, #141414 55%, #2c230a 100%)", label: "text-gold-2" },
};

export default function LoyaltyCard() {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/loyalty/me")
      .then(async (r) => {
        if (r.status === 401) throw new Error("signin");
        if (!r.ok) throw new Error("api");
        setCard(await r.json());
      })
      .catch((e) => setErr(e.message === "signin" ? "signin" : "api"));
  }, []);

  const addToWallet = async () => {
    setWalletMsg(null);
    const r = await fetch("/api/loyalty/me/wallet.pkpass");
    if (r.ok) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dastaan-loyalty.pkpass";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const d = await r.json().catch(() => ({}));
      setWalletMsg(d.error ?? "Wallet pass unavailable right now.");
    }
  };

  return (
    <div className="grain flex min-h-svh flex-col items-center bg-ink px-6 py-12">
      <div className="pointer-events-none fixed top-[-20%] left-1/2 h-[55vh] w-[65vw] -translate-x-1/2 rounded-full bg-gold/6 blur-[120px]" />

      <Link href="/" className="font-display text-2xl font-semibold tracking-[0.25em] text-ivory">
        DASTAAN
      </Link>
      <p className="eyebrow mt-3">Loyalty card</p>

      {err === "signin" && (
        <div className="animate-fade-up mt-16 text-center">
          <p className="text-sm text-ivory/55">Sign in to see your loyalty card.</p>
          <Link href="/login" className="btn-gold mt-6 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
            Sign in
          </Link>
        </div>
      )}
      {err === "api" && <p className="mt-16 text-sm text-ivory/55">Can&apos;t reach the server. Is the API running?</p>}

      {card && (
        <div className="animate-fade-up mt-10 w-full max-w-sm">
          {/* the card */}
          <div
            className="relative overflow-hidden rounded-3xl border border-gold/30 p-6 shadow-panel"
            style={{ background: TIER_STYLE[card.tier].grad }}
          >
            <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gold/10 blur-2xl" />
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display text-lg tracking-[0.2em] text-ivory">DASTAAN</p>
                <p className={`mt-0.5 text-[11px] font-bold tracking-[0.3em] uppercase ${TIER_STYLE[card.tier].label}`}>
                  ◆ {card.tier}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl text-gold-2">{card.points.toLocaleString()}</p>
                <p className="text-[10px] tracking-[0.25em] text-ivory/45 uppercase">points</p>
              </div>
            </div>

            {/* QR — served by the API as SVG; bright panel so webcams read it off this screen */}
            <div className="mt-6 flex justify-center rounded-2xl bg-[#f7f5f0] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/loyalty/me/qr.svg" alt="Your loyalty QR code" className="h-44 w-44" />
            </div>
            <p className="mt-3 text-center text-[10px] tracking-wider text-ivory/40 uppercase">
              Show this at the desk — we scan it straight from your screen
            </p>
          </div>

          {/* progress to next tier */}
          {card.nextTier && (
            <div className="mt-6">
              <div className="flex justify-between text-[11px] tracking-wider text-ivory/45 uppercase">
                <span>{card.lifetimePoints.toLocaleString()} lifetime</span>
                <span>{card.nextTier.name} at {card.nextTier.at.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ivory/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-dim to-gold-2"
                  style={{ width: `${Math.min(100, (card.lifetimePoints / card.nextTier.at) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={addToWallet}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-black py-3.5 text-sm font-semibold text-white ring-1 ring-ivory/25 transition-all hover:ring-gold"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8.98-.2 1.92-.89 3.16-.8 1.79.14 3.04.86 3.86 2.15-3.28 1.99-2.76 6.02.71 7.38-.65 1.29-1.51 2.58-2.81 3.44zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            Add to Apple Wallet
          </button>
          {walletMsg && (
            <p className="mt-3 rounded-lg border border-gold/30 bg-gold/8 px-4 py-2.5 text-xs leading-relaxed text-gold-2">
              {walletMsg}
            </p>
          )}

          <p className="mt-6 text-center text-[11px] leading-relaxed text-ivory/35">
            Earn 1 point for every AED spent on services.
            <br />Silver at 2,000 · Gold at 5,000 lifetime points.
          </p>
        </div>
      )}
    </div>
  );
}
