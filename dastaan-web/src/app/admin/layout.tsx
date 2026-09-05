"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && (d.role === "admin" || d.role === "owner" || d.role === "staff")) {
          setAllowed(true);
        } else {
          router.replace("/login?returnTo=/admin");
        }
      })
      .catch(() => router.replace("/login?returnTo=/admin"))
      .finally(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="grain flex min-h-svh items-center justify-center bg-ink">
        <p className="text-sm text-ivory/45">Checking access…</p>
      </div>
    );
  }

  if (!allowed) return null;

  const navLinks = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/orders", label: "Online Orders" },
  ];

  return (
    <div className="grain min-h-svh bg-ink text-ivory">
      <header className="border-b border-ivory/10 bg-coal/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-ivory transition-opacity hover:opacity-80">
              <Logo markClass="h-7 w-auto" wordClass="h-[18px] w-auto" />
            </Link>
            <span className="text-[11px] tracking-[0.28em] text-gold uppercase">Admin</span>
          </div>
          <nav className="flex items-center gap-4">
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[13px] text-ivory/60 hover:text-ivory transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">{children}</main>
    </div>
  );
}
