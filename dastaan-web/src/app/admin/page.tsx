"use client";

import Link from "next/link";

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="font-display text-4xl font-medium text-ivory">Admin Panel</h1>
      <p className="mt-2 text-sm text-ivory/50">Dastaan operations dashboard.</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: "/admin/orders", label: "Online Orders", desc: "View and manage store orders" },
          { href: "/console", label: "Booking Console", desc: "Manage today's appointments" },
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
    </div>
  );
}
