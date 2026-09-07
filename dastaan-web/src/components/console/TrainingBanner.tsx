"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TrainingVideo = {
  id: string;
  title: string;
  deadline: string;
  completed: boolean;
  overdue: boolean;
};

/** Fetches training status for the logged-in staff member and shows a banner
 *  if any videos are overdue. Polling is intentionally omitted — staff must
 *  navigate to /training/:id to watch, then the banner goes away on return. */
export function TrainingBanner() {
  const [overdueVideos, setOverdueVideos] = useState<TrainingVideo[]>([]);

  useEffect(() => {
    fetch("/api/training")
      .then((r) => r.ok ? r.json() : [])
      .then((list: TrainingVideo[]) => setOverdueVideos(list.filter((v) => v.overdue)))
      .catch(() => {});
  }, []);

  if (overdueVideos.length === 0) return null;

  return (
    <div className="border-b border-red-900/40 bg-red-950/60 px-4 py-3">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <span className="text-base">⚠</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-300">
            {overdueVideos.length === 1
              ? "You have an overdue training video"
              : `You have ${overdueVideos.length} overdue training videos`}
          </p>
          <p className="text-xs text-red-400/70">
            New bookings are paused until you complete{" "}
            {overdueVideos.length === 1 ? "it" : "them"}.
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-col gap-1">
          {overdueVideos.map((v) => (
            <Link
              key={v.id}
              href={`/training/${v.id}`}
              className="rounded-lg border border-red-700/50 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-900/40"
            >
              Watch: {v.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
