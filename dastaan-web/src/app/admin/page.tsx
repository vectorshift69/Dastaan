"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminDashboard() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  /* Admin page requires an email/password session (client login at /login),
     not the PIN session from /team. The /team session is for in-salon staff
     on the tablet; /admin is for web-based admin access. */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((me) => {
        if (!me || !["admin", "super_admin"].includes(me.role)) {
          router.replace("/login?returnTo=/admin");
        } else {
          setChecking(false);
        }
      })
      .catch(() => router.replace("/login?returnTo=/admin"));
  }, [router]);

  if (checking) {
    return (
      <div className="grid h-svh place-items-center bg-ink">
        <p className="text-sm text-ivory/40">Checking access…</p>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-ink px-8 py-12 text-ivory">
      <h1 className="font-display text-4xl font-medium">Admin Panel</h1>
      <p className="mt-2 text-sm text-ivory/50">Dastaan operations dashboard.</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: "/admin/orders", label: "Online Orders", desc: "View and manage store orders" },
          { href: "/console", label: "Booking Console", desc: "Manage today's appointments" },
          { href: "/admin/training", label: "Training Videos", desc: "Mandatory staff training with deadlines" },
          { href: "/admin/quotes", label: "Motivational Quotes", desc: "Daily quote shown to staff on login" },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-2xl border border-ivory/12 bg-coal p-7 transition-all hover:border-gold/40 hover:bg-gold/5"
          >
            <h2 className="font-display text-xl text-ivory">{card.label}</h2>
            <p className="mt-2 text-sm text-ivory/50">{card.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12 border-t border-ivory/10 pt-6">
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login");
          }}
          className="text-xs text-ivory/30 transition-colors hover:text-ivory/60"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
