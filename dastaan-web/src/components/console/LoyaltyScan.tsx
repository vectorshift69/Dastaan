"use client";

import { useEffect, useRef, useState } from "react";

/* Webcam loyalty scan (PRD 6): front desk points the POS webcam at the
   client's phone screen. Uses the browser BarcodeDetector where available
   (Chrome/Edge — typical POS machines), with manual entry as fallback. */

type ScanResult = {
  clientName: string;
  clientPhone: string | null;
  tier: string;
  points: number;
  lifetimePoints: number;
  recent: { delta: number; reason: string; createdAt: string }[];
};

export default function LoyaltyScan({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "unavailable">("starting");
  const [manual, setManual] = useState("");
  const stopped = useRef(false);

  const lookup = async (token: string) => {
    const res = await fetch("/api/loyalty/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      setResult(await res.json());
      setError(null);
      return true;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error ?? "Scan failed");
    return false;
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    (async () => {
      try {
        // BarcodeDetector: Chromium-only, which suits a fixed POS machine
        const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamera("on");
        if (!Detector) return; // camera preview still useful; manual entry available
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (stopped.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => c.rawValue?.startsWith("DSTN:"));
            if (hit && (await lookup(hit.rawValue))) return; // stop polling on success
          } catch { /* frame not ready */ }
          raf = window.setTimeout(tick, 350) as unknown as number;
        };
        tick();
      } catch {
        setCamera("unavailable");
      }
    })();
    return () => {
      stopped.current = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-md rounded-2xl bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">Scan loyalty card</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-charcoal/40 hover:bg-black/5 hover:text-ink" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
          </button>
        </div>

        {!result && (
          <>
            <div className="mt-4 overflow-hidden rounded-xl bg-ink">
              {camera === "unavailable" ? (
                <p className="px-6 py-10 text-center text-sm text-ivory/60">
                  No camera available — enter the code from the client&apos;s card below.
                </p>
              ) : (
                <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
              )}
            </div>
            <p className="mt-3 text-center text-xs text-charcoal/50">
              Point the camera at the QR on the client&apos;s phone screen.
            </p>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => { e.preventDefault(); if (manual.trim()) lookup(manual.trim()); }}
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="…or type the card code"
                className="flex-1 rounded-full border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-gold"
              />
              <button type="submit" className="btn-gold rounded-full px-5 py-2.5 text-sm">Find</button>
            </form>
            {error && <p className="mt-3 rounded-lg bg-st-cancel/10 px-4 py-2 text-sm text-st-cancel">{error}</p>}
          </>
        )}

        {result && (
          <div className="animate-fade-up mt-5">
            <div className="flex items-center gap-4 rounded-xl bg-paper px-5 py-4">
              <div className="font-display flex h-12 w-12 items-center justify-center rounded-full bg-ink text-lg text-gold-2">
                {result.clientName[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-ink">{result.clientName}</p>
                <p className="text-xs text-charcoal/55">{result.clientPhone ?? "no phone on file"}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl text-ink">{result.points.toLocaleString()}</p>
                <p className="text-[10px] font-bold tracking-wider text-gold-dim uppercase">◆ {result.tier}</p>
              </div>
            </div>
            {result.recent.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold tracking-[0.18em] text-charcoal/45 uppercase">Recent activity</p>
                <div className="mt-2 space-y-1.5">
                  {result.recent.map((t, i) => (
                    <div key={i} className="flex justify-between text-sm text-charcoal/70">
                      <span>{t.reason.replaceAll("_", " ")}</span>
                      <span className="font-semibold text-st-started">+{t.delta}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onClose} className="btn-gold mt-6 w-full rounded-full py-3 text-sm tracking-widest uppercase">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
