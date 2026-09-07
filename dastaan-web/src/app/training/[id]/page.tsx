"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type VideoDetails = {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  deadline: string;
  progressSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  completedAt: string | null;
  overdue: boolean;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatDeadline(iso: string) {
  return new Date(iso).toLocaleDateString("en-AE", {
    day: "numeric", month: "long", year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/* Progress bar (read-only except for rewind)                         */
/* ------------------------------------------------------------------ */

function ProgressBar({
  current,
  maxReached,
  duration,
  onSeek,
}: {
  current: number;
  maxReached: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent) {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const target = ratio * duration;
    // Only allow seeking to positions already watched
    onSeek(Math.min(target, maxReached));
  }

  const pctCurrent = duration > 0 ? (current / duration) * 100 : 0;
  const pctMax = duration > 0 ? (maxReached / duration) * 100 : 0;

  return (
    <div
      ref={barRef}
      onClick={handleClick}
      className="relative h-1.5 w-full cursor-pointer rounded-full bg-ivory/10"
      title="Click to seek (watched sections only)"
    >
      {/* watched range — lighter, seekable */}
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-ivory/25"
        style={{ width: `${pctMax}%` }}
      />
      {/* current position */}
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-gold transition-[width]"
        style={{ width: `${pctCurrent}%` }}
      />
      {/* scrubber handle */}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-gold bg-ink shadow"
        style={{ left: `calc(${pctCurrent}% - 7px)` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                          */
/* ------------------------------------------------------------------ */

export default function TrainingVideoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);

  /* furthest second the user has legitimately reached — no skipping past this */
  const maxReachedRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- fetch video details ---- */
  useEffect(() => {
    fetch("/api/training")
      .then((r) => r.json())
      .then((list: VideoDetails[]) => {
        const found = list.find((v) => v.id === id);
        if (!found) { router.push("/console"); return; }
        setVideo(found);
        setCompleted(found.completed);
        maxReachedRef.current = found.progressSeconds;
        setCurrentTime(found.progressSeconds);
      })
      .catch(() => router.push("/console"))
      .finally(() => setLoading(false));
  }, [id, router]);

  /* ---- resume saved position once video metadata loads ---- */
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    if (maxReachedRef.current > 0) {
      v.currentTime = maxReachedRef.current;
    }
  }, []);

  /* ---- track current position and update maxReached ---- */
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setCurrentTime(t);
    if (t > maxReachedRef.current) maxReachedRef.current = t;
  }, []);

  /* ---- prevent skipping forward ---- */
  const handleSeeking = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Allow a 1s buffer for natural playback overshoot
    if (v.currentTime > maxReachedRef.current + 1) {
      v.currentTime = maxReachedRef.current;
    }
  }, []);

  /* ---- auto-save progress every 10 seconds while playing ---- */
  useEffect(() => {
    if (!playing || completed) return;
    saveTimerRef.current = setInterval(() => saveProgress(), 10_000);
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, [playing, completed]);

  async function saveProgress() {
    const v = videoRef.current;
    if (!v || !id) return;
    setSaving(true);
    await fetch(`/api/training/${id}/progress`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressSeconds: Math.floor(maxReachedRef.current),
        durationSeconds: Math.floor(v.duration) || undefined,
      }),
    }).catch(() => {});
    setSaving(false);
  }

  /* ---- mark complete when video ends ---- */
  const handleEnded = useCallback(async () => {
    setPlaying(false);
    if (completed) return;
    await saveProgress();
    await fetch(`/api/training/${id}/complete`, { method: "POST" }).catch(() => {});
    setCompleted(true);
  }, [completed, id]);

  function handleSeek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); saveProgress(); }
  }

  if (loading) {
    return (
      <div className="grid min-h-svh place-items-center bg-ink">
        <p className="text-sm text-ivory/40">Loading…</p>
      </div>
    );
  }

  if (!video) return null;

  return (
    <div className="min-h-svh bg-ink text-ivory">
      {/* header */}
      <div className="flex items-center gap-4 border-b border-ivory/8 px-6 py-4">
        <button
          onClick={() => { saveProgress(); router.push("/console"); }}
          className="rounded-lg p-1.5 text-ivory/40 transition hover:text-ivory/80"
          title="Back to console"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg text-ivory">{video.title}</h1>
          <p className="text-xs text-ivory/40">
            {video.overdue ? "⚠ Overdue — " : ""}Due {formatDeadline(video.deadline)}
          </p>
        </div>
        {saving && <span className="text-xs text-ivory/30">Saving…</span>}
        {completed && (
          <span className="rounded-full bg-green-900/40 px-3 py-1 text-xs text-green-400">
            ✓ Completed
          </span>
        )}
      </div>

      {/* no-skip notice */}
      <div className="mx-auto max-w-3xl px-6 pt-4">
        <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-2.5 text-xs text-gold/80">
          This training video must be watched in full. Fast-forwarding is disabled. You can pause
          and resume at any time — your progress is saved automatically.
        </div>
      </div>

      {/* player */}
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="overflow-hidden rounded-2xl border border-ivory/10 bg-coal shadow-xl">
          {/* video element */}
          <div className="relative bg-black">
            <video
              ref={videoRef}
              src={video.videoUrl}
              className="w-full"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onSeeking={handleSeeking}
              onEnded={handleEnded}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              controlsList="nodownload nofullscreen"
              disablePictureInPicture
            />
            {/* big play overlay when paused */}
            {!playing && (
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ivory/60 bg-ink/60">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </div>
              </button>
            )}
          </div>

          {/* controls bar */}
          <div className="space-y-3 p-4">
            <ProgressBar
              current={currentTime}
              maxReached={maxReachedRef.current}
              duration={duration}
              onSeek={handleSeek}
            />
            <div className="flex items-center justify-between">
              <button
                onClick={togglePlay}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-ivory/10 text-ivory transition hover:bg-ivory/20"
              >
                {playing ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>
              <span className="text-xs tabular-nums text-ivory/50">
                {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "--:--"}
              </span>
            </div>
          </div>
        </div>

        {/* description */}
        {video.description && (
          <p className="mt-6 text-sm leading-relaxed text-ivory/60">{video.description}</p>
        )}

        {/* completion state */}
        {completed ? (
          <div className="mt-8 rounded-2xl border border-green-800/40 bg-green-900/20 p-6 text-center">
            <p className="text-lg font-medium text-green-400">Training complete ✓</p>
            <p className="mt-1 text-sm text-ivory/50">
              Completed {video.completedAt ? new Date(video.completedAt).toLocaleDateString("en-AE") : "just now"}
            </p>
            <button
              onClick={() => router.push("/console")}
              className="mt-4 rounded-xl bg-green-800/40 px-6 py-2.5 text-sm text-green-300 transition hover:bg-green-800/60"
            >
              Back to console
            </button>
          </div>
        ) : (
          <p className="mt-6 text-center text-xs text-ivory/30">
            Watch the full video to complete this training.
          </p>
        )}
      </div>
    </div>
  );
}
