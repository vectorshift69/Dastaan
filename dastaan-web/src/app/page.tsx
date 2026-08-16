import dynamic from "next/dynamic";
import Link from "next/link";
import Nav from "@/components/Nav";
import { services, barbers, branches, CURRENCY } from "@/lib/data";

const Hero3D = dynamic(() => import("@/components/Hero3D"));

export default function Home() {
  return (
    <div className="grain min-h-screen bg-ink text-ivory">
      <Nav />

      {/* fixed 3D layer — choreographed to scroll, glides between sections */}
      <Hero3D />

      {/* ---------------- HERO (slide 0: tools right) ---------------- */}
      <section className="relative flex min-h-svh items-center overflow-hidden">
        {/* readability gradient behind the headline */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_50%,#0c0c0cbb_0%,transparent_45%)] md:bg-[linear-gradient(90deg,#0c0c0c_18%,transparent_55%)]" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-6 lg:px-10">
          <div className="max-w-2xl">
            <p className="eyebrow animate-fade-up">Est. MMXXVI · Unisex Salon · Dubai</p>
            <h1
              className="font-display animate-fade-up mt-6 text-6xl leading-[0.95] font-medium md:text-8xl"
              style={{ animationDelay: "120ms" }}
            >
              Every cut
              <br />
              tells a <span className="text-gold-2 italic">story.</span>
            </h1>
            <p
              className="animate-fade-up mt-8 max-w-md text-[15px] leading-relaxed font-light text-ivory/65"
              style={{ animationDelay: "240ms" }}
            >
              Master stylists for him and for her — precision cuts, colour,
              grooming, and a chair that remembers you. Dastaan is self-care as
              it was always meant to be: unhurried, precise, personal.
            </p>
            <div
              className="animate-fade-up mt-10 flex flex-wrap items-center gap-4"
              style={{ animationDelay: "360ms" }}
            >
              <Link href="/book" className="btn-gold rounded-full px-8 py-3.5 text-sm tracking-wide">
                Book an appointment
              </Link>
              <Link href="/#services" className="btn-ghost rounded-full px-8 py-3.5 text-sm tracking-wide">
                Explore services
              </Link>
            </div>
            <div
              className="animate-fade-up mt-14 flex items-center gap-8 text-xs tracking-widest text-ivory/40 uppercase"
              style={{ animationDelay: "480ms" }}
            >
              <span>For him &amp; for her</span>
              <span className="h-1 w-1 rounded-full bg-gold" />
              <span>2 branches</span>
              <span className="h-1 w-1 rounded-full bg-gold" />
              <span>4.9 ★ rated</span>
            </div>
          </div>
        </div>

        {/* scroll cue */}
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
          <div className="h-12 w-px animate-pulse-dot bg-gradient-to-b from-gold to-transparent" />
        </div>
      </section>

      {/* ---------------- SERVICES (slide 1: tools sweep left) ---------------- */}
      <section id="services" className="relative z-10 py-28">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:pl-[30%]">
            <div>
              <p className="eyebrow">The craft</p>
              <h2 className="font-display mt-4 text-4xl font-medium md:text-6xl">Services</h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed font-light text-ivory/50">
              One menu, every guest — cuts, colour, grooming, and nails. Priced
              honestly, timed generously.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-ivory/10 bg-ivory/10 sm:grid-cols-2 lg:grid-cols-3 md:ml-[26%]">
            {services.slice(0, 9).map((s, i) => (
              <Link
                key={s.id}
                href="/book"
                className="group relative bg-ink p-8 transition-colors duration-300 hover:bg-coal-2"
              >
                <span className="text-[11px] tracking-[0.3em] text-ivory/35 uppercase">
                  {String(i + 1).padStart(2, "0")} · {s.category}
                </span>
                <h3 className="font-display mt-4 text-2xl font-medium text-ivory transition-colors group-hover:text-gold-2">
                  {s.name}
                </h3>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="text-ivory/45">{s.minutes} min</span>
                  <span className="font-semibold text-gold">
                    {CURRENCY} {s.price}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- STYLISTS (slide 2: tools cross right) ---------------- */}
      <section id="stylists" className="relative z-10 py-28">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="md:max-w-[62%]">
            <p className="eyebrow">The hands</p>
            <h2 className="font-display mt-4 text-4xl font-medium md:text-6xl">Master stylists</h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed font-light text-ivory/50">
              Barbers and stylists, one team — pick your favourite chair on
              either side of the salon.
            </p>

            <div className="mt-14 grid grid-cols-2 gap-6 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
              {barbers.slice(0, 4).map((b) => (
                <div key={b.id} className="group text-center">
                  <div
                    className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-ivory/15 text-2xl font-light tracking-wider text-ivory/90 transition-all duration-300 group-hover:border-gold group-hover:shadow-[0_0_40px_-10px_rgba(201,162,39,0.5)] md:h-32 md:w-32"
                    style={{ background: `radial-gradient(circle at 35% 30%, ${b.tone}, #141414 75%)` }}
                  >
                    <span className="font-display">{b.initials}</span>
                  </div>
                  <h3 className="font-display mt-5 text-lg font-medium">{b.name}</h3>
                  <p className="mt-1 text-[11px] tracking-[0.2em] text-ivory/40 uppercase">{b.title}</p>
                  <p className="mt-1.5 text-sm text-gold">★ {b.rating.toFixed(1)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- BRANCHES (slide 3: tools bow out) ---------------- */}
      <section id="branches" className="relative z-10 bg-ink py-28">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <p className="eyebrow">Find us</p>
          <h2 className="font-display mt-4 text-4xl font-medium md:text-6xl">Branches</h2>

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {branches.map((br) => (
              <div
                key={br.id}
                className="group relative overflow-hidden rounded-2xl border border-ivory/10 bg-coal p-10 transition-colors hover:border-gold/40"
              >
                <div className="absolute -top-20 -right-20 h-52 w-52 rounded-full bg-gold/5 blur-2xl transition-all group-hover:bg-gold/10" />
                <p className="text-[11px] tracking-[0.3em] text-gold uppercase">{br.area}</p>
                <h3 className="font-display mt-3 text-3xl font-medium">{br.name}</h3>
                <p className="mt-4 text-sm leading-relaxed text-ivory/55">{br.address}</p>
                <div className="mt-8 flex flex-wrap items-center gap-6 text-xs tracking-wider text-ivory/45">
                  <span>{br.hours}</span>
                  <span>{br.phone}</span>
                </div>
                <Link href="/book" className="mt-8 inline-block text-sm font-semibold text-gold-2 transition-colors hover:text-gold">
                  Book at this branch →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- STORE TEASER ---------------- */}
      <section id="store" className="relative z-10 bg-coal py-28">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 text-center">
          <p className="eyebrow">Take it home</p>
          <h2 className="font-display mt-4 text-4xl font-medium md:text-6xl">The Dastaan Store</h2>
          <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed font-light text-ivory/55">
            Hair care, beard oils, styling tools, and salon-grade colour care —
            curated in-house for him and for her.
          </p>
          <Link href="/store" className="btn-gold mt-8 inline-block rounded-full px-8 py-3.5 text-sm tracking-wide">
            Shop the store
          </Link>
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-4">
            {["Argan Repair Serum", "Matte Clay Pomade", "Straight Razor Kit"].map((p) => (
              <Link key={p} href="/store" className="group rounded-xl border border-ivory/10 bg-ink p-6 transition-colors hover:border-gold/40 md:p-8">
                <div className="mx-auto h-20 w-14 rounded-md bg-gradient-to-b from-coal-2 to-ink ring-1 ring-gold/30 transition-transform group-hover:-translate-y-1 md:h-24 md:w-16" />
                <p className="font-display mt-5 text-sm text-ivory/85 md:text-base">{p}</p>
                <p className="mt-1 text-[11px] tracking-[0.25em] text-gold uppercase">In stock</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- FOOTER ---------------- */}
      <footer className="relative z-10 border-t border-ivory/10 bg-ink py-14">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 lg:px-10">
          <span className="font-display text-xl tracking-[0.25em]">DASTAAN</span>
          <div className="gold-rule w-40" />
          <p className="text-xs tracking-wider text-ivory/35">
            © MMXXVI Dastaan Salon L.L.C. · Dubai, U.A.E. · All rights reserved
          </p>
        </div>
      </footer>
    </div>
  );
}
