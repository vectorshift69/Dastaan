"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

type Me = { name: string; role: string } | null;

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d && d.role === "client" ? d : null))
      .catch(() => setMe(null));
  }, [pathname]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const logout = async () => {
    setDropOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  };

  const initials = me?.name
    ? me.name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : "";

  const links = [
    { href: "/#services", label: "Services" },
    { href: "/#barbers", label: "Barbers" },
    { href: "/#branches", label: "Branches" },
    { href: "/store", label: "Store" },
    { href: "/card", label: "Loyalty" },
  ];

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-500 ${
        scrolled ? "bg-ink/85 backdrop-blur-md border-b border-ivory/10" : ""
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <Link href="/" aria-label="Dastaan — home" className="text-ivory transition-opacity hover:opacity-80">
          <Logo markClass="h-8 w-auto" wordClass="h-[21px] w-auto" />
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13px] font-medium tracking-[0.14em] text-ivory/70 uppercase transition-colors hover:text-gold-2"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {me ? (
            <div ref={dropRef} className="relative">
              <button
                onClick={() => setDropOpen((v) => !v)}
                aria-label="Account menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/20 border border-gold/40 text-[13px] font-bold text-gold-2 transition-all hover:bg-gold/30"
              >
                {initials}
              </button>
              {dropOpen && (
                <div className="absolute right-0 top-11 z-50 min-w-[180px] rounded-2xl border border-ivory/12 bg-coal shadow-panel">
                  <div className="border-b border-ivory/10 px-4 py-3">
                    <p className="text-[13px] font-semibold text-ivory truncate">{me.name}</p>
                  </div>
                  <nav className="py-2">
                    {[
                      { href: "/book", label: "Book appointment" },
                      { href: "/orders", label: "My orders" },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDropOpen(false)}
                        className="block px-4 py-2.5 text-[13px] text-ivory/70 hover:text-gold-2 hover:bg-white/5 transition-colors"
                      >
                        {item.label}
                      </Link>
                    ))}
                    <button
                      onClick={logout}
                      className="block w-full px-4 py-2.5 text-left text-[13px] text-ivory/70 hover:text-[#e08a80] hover:bg-white/5 transition-colors"
                    >
                      Log out
                    </button>
                  </nav>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href={`/login?returnTo=${encodeURIComponent(pathname)}`} className="btn-ghost rounded-full px-5 py-2 text-[13px] tracking-wide">
                Log in
              </Link>
              <Link href="/book" className="btn-gold rounded-full px-5 py-2 text-[13px] tracking-wide">
                Book now
              </Link>
            </>
          )}
        </div>

        {/* mobile */}
        <button
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span className={`h-px w-6 bg-ivory transition-all ${open ? "translate-y-1 rotate-45" : ""}`} />
          <span className={`h-px w-6 bg-ivory transition-all ${open ? "-translate-y-0.5 -rotate-45" : ""}`} />
        </button>
      </nav>

      {open && (
        <div className="border-t border-ivory/10 bg-ink/95 px-6 pt-4 pb-8 backdrop-blur-md md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-3 text-sm tracking-[0.14em] text-ivory/80 uppercase"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-4 flex gap-3">
            {me ? (
              <>
                <Link href="/orders" onClick={() => setOpen(false)} className="btn-ghost flex-1 rounded-full px-5 py-2.5 text-center text-sm">
                  My orders
                </Link>
                <button onClick={() => { setOpen(false); logout(); }} className="btn-ghost flex-1 rounded-full px-5 py-2.5 text-center text-sm text-[#e08a80]">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href={`/login?returnTo=${encodeURIComponent(pathname)}`} onClick={() => setOpen(false)} className="btn-ghost flex-1 rounded-full px-5 py-2.5 text-center text-sm">
                  Log in
                </Link>
                <Link href="/book" onClick={() => setOpen(false)} className="btn-gold flex-1 rounded-full px-5 py-2.5 text-center text-sm">
                  Book now
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
