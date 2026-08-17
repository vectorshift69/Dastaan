"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
          <Link href="/login" className="btn-ghost rounded-full px-5 py-2 text-[13px] tracking-wide">
            Log in
          </Link>
          <Link href="/book" className="btn-gold rounded-full px-5 py-2 text-[13px] tracking-wide">
            Book now
          </Link>
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
            <Link href="/login" className="btn-ghost flex-1 rounded-full px-5 py-2.5 text-center text-sm">
              Log in
            </Link>
            <Link href="/book" className="btn-gold flex-1 rounded-full px-5 py-2.5 text-center text-sm">
              Book now
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
