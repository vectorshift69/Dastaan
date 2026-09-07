"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadMedia } from "@/lib/supabase";

type TrainingVideo = {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  deadline: string;
  createdAt: string;
  completedCount: number;
  totalStaff: number;
  overdue: boolean;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDeadlineInput(iso: string) {
  // Convert ISO to datetime-local value
  return iso.slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Add Video Form                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Video file picker with Supabase upload                              */
/* ------------------------------------------------------------------ */

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "done"; url: string; name: string }
  | { status: "error"; message: string };

function VideoFilePicker({
  onUrl,
}: {
  onUrl: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setState({ status: "error", message: "Please pick a video file (MP4, MOV, etc.)" });
      return;
    }
    setState({ status: "uploading", progress: 0 });
    try {
      /* uploadMedia streams directly to Supabase Storage — no size limit
         imposed here, relies on Supabase bucket policy (default 50 MB free) */
      const url = await uploadMedia(file, "videos");
      setState({ status: "done", url, name: file.name });
      onUrl(url);
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }

  function reset() {
    setState({ status: "idle" });
    onUrl("");
    if (inputRef.current) inputRef.current.value = "";
  }

  if (state.status === "done") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-700/40 bg-green-950/20 px-4 py-3">
        <svg className="h-4 w-4 flex-shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-sm text-green-300">{state.name}</span>
        <button type="button" onClick={reset} className="flex-shrink-0 text-xs text-ivory/40 hover:text-ivory/70">
          Replace
        </button>
      </div>
    );
  }

  if (state.status === "uploading") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-ivory/15 bg-ink px-4 py-3">
        <svg className="h-4 w-4 flex-shrink-0 animate-spin text-gold" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <span className="text-sm text-ivory/50">Uploading to Dastaan storage…</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-ivory/20 bg-ink px-4 py-3 text-left transition hover:border-gold/40"
      >
        <svg className="h-4 w-4 flex-shrink-0 text-ivory/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <span className="text-sm text-ivory/40">Click to upload a video file</span>
      </button>
      {state.status === "error" && (
        <p className="text-xs text-red-400">{state.message}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add Video Form                                                      */
/* ------------------------------------------------------------------ */

function AddVideoForm({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoUrl) { setError("Please upload a video first"); return; }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/training", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          videoUrl,
          deadline: new Date(deadline).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to add video"); return; }
      setTitle(""); setDescription(""); setVideoUrl(""); setDeadline("");
      onAdded();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-ivory/10 bg-coal p-6">
      <h2 className="font-display text-lg text-ivory">Add training video</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-ivory/50">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Barbering Standards Q3 2026"
            className="w-full rounded-xl border border-ivory/15 bg-ink px-4 py-2.5 text-sm text-ivory placeholder-ivory/25 focus:border-gold/50 focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-ivory/50">Deadline</label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
            className="w-full rounded-xl border border-ivory/15 bg-ink px-4 py-2.5 text-sm text-ivory focus:border-gold/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-ivory/50">Training video</label>
        <VideoFilePicker onUrl={setVideoUrl} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-ivory/50">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What staff should learn from this video…"
          className="w-full resize-none rounded-xl border border-ivory/15 bg-ink px-4 py-2.5 text-sm text-ivory placeholder-ivory/25 focus:border-gold/50 focus:outline-none"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !videoUrl}
        className="rounded-xl bg-gold px-6 py-2.5 text-sm font-medium text-ink transition hover:bg-gold-2 disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add video"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Video card                                                          */
/* ------------------------------------------------------------------ */

function VideoCard({ video, onRemove }: { video: TrainingVideo; onRemove: () => void }) {
  const pct = video.totalStaff > 0
    ? Math.round((video.completedCount / video.totalStaff) * 100)
    : 0;

  async function remove() {
    if (!confirm(`Remove "${video.title}"?`)) return;
    await fetch(`/api/admin/training/${video.id}`, { method: "DELETE" });
    onRemove();
  }

  return (
    <div className={`rounded-2xl border p-5 ${video.overdue ? "border-red-800/40 bg-red-950/20" : "border-ivory/10 bg-coal"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-ivory">{video.title}</h3>
            {video.overdue && (
              <span className="flex-shrink-0 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-400">
                Overdue
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ivory/40">
            Deadline: {formatDate(video.deadline)}
          </p>
          {video.description && (
            <p className="mt-1 text-xs text-ivory/50">{video.description}</p>
          )}
        </div>
        <button
          onClick={remove}
          className="flex-shrink-0 rounded-lg px-2 py-1 text-xs text-ivory/30 transition hover:text-red-400"
        >
          Remove
        </button>
      </div>

      {/* completion bar */}
      <div className="mt-4 space-y-1.5">
        <div className="flex justify-between text-xs text-ivory/40">
          <span>Completion</span>
          <span>{video.completedCount} / {video.totalStaff} staff ({pct}%)</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ivory/10">
          <div
            className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : video.overdue ? "bg-red-500" : "bg-gold"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AdminTrainingPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Auth guard
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((me) => {
        if (!me || !["admin", "super_admin"].includes(me.role)) {
          router.replace("/login?returnTo=/admin/training");
        }
      })
      .catch(() => router.replace("/login?returnTo=/admin/training"));
  }, [router]);

  function loadVideos() {
    setLoading(true);
    fetch("/api/admin/training")
      .then((r) => r.json())
      .then(setVideos)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadVideos(); }, []);

  return (
    <div className="min-h-svh bg-ink px-6 py-10 text-ivory">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <button
            onClick={() => router.push("/admin")}
            className="mb-4 text-xs text-ivory/40 transition hover:text-ivory/70"
          >
            ← Admin
          </button>
          <h1 className="font-display text-3xl font-medium">Training videos</h1>
          <p className="mt-1 text-sm text-ivory/50">
            Add mandatory training videos with deadlines. Staff accounts are suspended after the
            deadline until they complete the video.
          </p>
        </div>

        <AddVideoForm onAdded={loadVideos} />

        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-ivory/40">Loading…</p>
          ) : videos.length === 0 ? (
            <p className="text-sm text-ivory/40">No training videos yet.</p>
          ) : (
            videos.map((v) => (
              <VideoCard key={v.id} video={v} onRemove={loadVideos} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
