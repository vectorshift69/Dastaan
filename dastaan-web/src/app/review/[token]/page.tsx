"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Logo from "@/components/Logo";

type Invite = {
  clientName: string;
  barberName: string;
  branchName: string;
  rating: number | null;
  submittedAt: string | null;
};

const GOOGLE_REVIEW_URL = "https://g.page/r/dastaan/review";

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reviews/${token}`)
      .then(async (r) => {
        if (!r.ok) { setInvalid(true); return; }
        const data: Invite = await r.json();
        setInvite(data);
        if (data.submittedAt) { setDone(true); setRating(data.rating ?? 0); }
      })
      .catch(() => setInvalid(true));
  }, [token]);

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, rating, comment: comment.trim() || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok || res.status === 409) setDone(true);
    else setError(d.error ?? "Could not save your rating");
  };

  return (
    <div className="grain flex min-h-svh items-center justify-center bg-ink px-6 py-16">
      <div className="pointer-events-none fixed top-[-20%] left-1/2 h-[55vh] w-[65vw] -translate-x-1/2 rounded-full bg-gold/6 blur-[120px]" />

      <div className="animate-fade-up w-full max-w-md text-center">
        <Link href="/" aria-label="Dastaan — home" className="flex justify-center text-ivory">
          <Logo stacked markClass="h-14 w-auto" wordClass="h-6 w-auto" />
        </Link>
        <div className="gold-rule mx-auto mt-5 w-24" />

        {invalid && <p className="mt-12 text-sm text-ivory/55">This review link isn&apos;t valid or has expired.</p>}

        {invite && !done && (
          <>
            <p className="mt-8 text-sm text-ivory/55">
              Hi {invite.clientName.split(" ")[0]} — how was your visit with{" "}
              <span className="text-ivory">{invite.barberName}</span> at {invite.branchName}?
            </p>

            <div className="mt-8 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  className={`text-4xl transition-all ${
                    (hover || rating) >= n ? "scale-110 text-gold-2" : "text-ivory/20 hover:text-ivory/40"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Anything you'd like us to know? (optional)"
              className="mt-8 w-full rounded-2xl border border-ivory/15 bg-coal px-5 py-4 text-sm text-ivory outline-none placeholder:text-ivory/25 focus:border-gold"
            />

            {error && <p className="mt-3 text-sm text-[#e08a80]">{error}</p>}

            <button
              onClick={submit}
              disabled={!rating || busy}
              className="btn-gold mt-6 w-full rounded-full py-3.5 text-sm tracking-widest uppercase disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </>
        )}

        {done && (
          <div className="animate-fade-up mt-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-gold bg-gold/10">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e3c25e" strokeWidth="2"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="font-display mt-6 text-3xl text-ivory">Thank you</h1>
            <p className="mt-3 text-sm text-ivory/55">
              {rating >= 4
                ? "So glad we got it right — would you share it with others?"
                : "We'll pass this to the team and do better next time."}
            </p>
            {rating >= 4 && (
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-gold mt-7 inline-block rounded-full px-8 py-3.5 text-sm tracking-widest uppercase"
              >
                Leave a Google review
              </a>
            )}
            <div>
              <Link href="/book" className="mt-6 inline-block text-sm text-gold-2 hover:text-gold">
                Book your next visit →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
