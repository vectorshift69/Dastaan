"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import CartDrawer from "@/components/store/CartDrawer";
import { useCart } from "@/lib/cart";
import { CURRENCY } from "@/lib/data";

type Product = {
  id: string; name: string; category: string; price: number;
  /* what the warehouse can actually ship — the storefront must respect it,
     otherwise a client fills a cart and only finds out at checkout */
  available: number;
};

/* Deterministic bottle art per product — no image assets needed */
const TONES = ["#3a2f10", "#2f3a35", "#3a2a2a", "#2a2f3a", "#332a3a", "#3a352a"];
const toneFor = (id: string) => TONES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];

export default function StorePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const cart = useCart();

  useEffect(() => {
    fetch("/api/store/products")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );
  const shown = category === "All" ? products : products.filter((p) => p.category === category);

  const addToCart = (p: Product) => {
    cart.add({ productId: p.id, name: p.name, price: p.price });
    setJustAdded(p.id);
    setTimeout(() => setJustAdded((v) => (v === p.id ? null : v)), 1200);
  };

  return (
    <div className="grain min-h-screen bg-ink text-ivory">
      <Nav />

      {/* floating cart button */}
      <button
        onClick={() => setCartOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-3 rounded-full bg-gold px-5 py-3.5 font-bold text-ink shadow-panel transition-all hover:bg-gold-2 md:right-8 md:bottom-8"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6h15l-1.5 9h-12L5 3H2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />
        </svg>
        {cart.count > 0 ? `${cart.count} · ${CURRENCY} ${cart.subtotal.toFixed(0)}` : "Cart"}
      </button>

      <main className="mx-auto max-w-7xl px-6 pt-32 pb-24 lg:px-10">
        <p className="eyebrow">Take it home</p>
        <h1 className="font-display mt-4 text-5xl font-medium md:text-7xl">The Dastaan Store</h1>
        <p className="mt-5 max-w-md text-sm leading-relaxed font-light text-ivory/55">
          The same products our barbers reach for — beard care, styling and
          shaving, curated in-house.
        </p>

        {/* category filter */}
        <div className="mt-10 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-4 py-1.5 text-[13px] tracking-wide transition-all ${
                category === c
                  ? "bg-gold font-bold text-ink"
                  : "border border-ivory/15 text-ivory/60 hover:border-gold/60 hover:text-gold-2"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* grid */}
        {loading ? (
          <p className="mt-16 text-sm text-ivory/45">Loading the shelf…</p>
        ) : shown.length === 0 ? (
          <div className="mt-16 rounded-2xl border border-ivory/10 bg-coal p-10 text-center">
            <p className="text-sm text-ivory/55">
              Nothing in the shop just yet — come back soon.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((p) => {
              const inCart = cart.lines.find((l) => l.productId === p.id);
              const soldOut = p.available <= 0;
              /* the last few, worth saying out loud — it is the honest nudge,
                 and it stops a client asking for six when there are two */
              const scarce = !soldOut && p.available <= 3;
              const atLimit = !!inCart && inCart.qty >= p.available;
              return (
                <article
                  key={p.id}
                  className={`group flex flex-col overflow-hidden rounded-2xl border bg-coal transition-all ${
                    soldOut ? "border-ivory/8 opacity-55" : "border-ivory/10 hover:border-gold/40"
                  }`}
                >
                  {/* bottle */}
                  <div className="relative flex h-44 items-end justify-center overflow-hidden bg-gradient-to-b from-coal-2 to-ink">
                    <div className="absolute -top-10 h-32 w-32 rounded-full bg-gold/5 blur-2xl transition-all group-hover:bg-gold/10" />
                    {soldOut && (
                      <span className="absolute top-3 right-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-bold tracking-wider text-ivory/70 uppercase">
                        Sold out
                      </span>
                    )}
                    {scarce && (
                      <span className="absolute top-3 right-3 rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-gold-2 uppercase">
                        {p.available} left
                      </span>
                    )}
                    <div
                      className="relative mb-6 h-28 w-14 rounded-t-md rounded-b-lg ring-1 ring-gold/30 transition-transform duration-500 group-hover:-translate-y-1"
                      style={{ background: `linear-gradient(160deg, ${toneFor(p.id)} 0%, #101010 85%)` }}
                    >
                      <div className="mx-auto mt-3 h-6 w-8 rounded-sm bg-gold/25" />
                      <div className="mx-auto mt-8 h-px w-8 bg-gold/40" />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <span className="text-[10px] tracking-[0.25em] text-ivory/35 uppercase">{p.category}</span>
                    <h3 className="font-display mt-1.5 text-lg leading-tight text-ivory">{p.name}</h3>
                    <p className="mt-1 font-semibold text-gold">{CURRENCY} {p.price}</p>

                    <div className="mt-auto pt-4">
                      {soldOut ? (
                        <p className="rounded-full border border-ivory/10 py-2.5 text-center text-[13px] text-ivory/40">
                          Back in stock soon
                        </p>
                      ) : inCart ? (
                        <>
                          <div className="flex items-center justify-between rounded-full border border-gold/50 bg-gold/10 px-2 py-1.5">
                            <QtyBtn onClick={() => cart.setQty(p.id, inCart.qty - 1)} label="Decrease">−</QtyBtn>
                            <span className="text-sm font-bold text-gold-2">{inCart.qty} in cart</span>
                            {/* never let the cart exceed what can be shipped */}
                            <QtyBtn
                              onClick={() => !atLimit && cart.setQty(p.id, inCart.qty + 1)}
                              label="Increase"
                              disabled={atLimit}
                            >
                              +
                            </QtyBtn>
                          </div>
                          {atLimit && (
                            <p className="mt-2 text-center text-[11px] text-ivory/35">
                              That&rsquo;s all we have right now
                            </p>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => addToCart(p)}
                          className="btn-gold w-full rounded-full py-2.5 text-[13px] tracking-wide"
                        >
                          {justAdded === p.id ? "Added ✓" : "Add to cart"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-14 text-center text-xs text-ivory/35">
          Prices include 5% VAT · Delivered anywhere in the UAE ·{" "}
          <Link href="/orders" className="text-gold-2 hover:text-gold">My orders</Link>
        </p>
      </main>

      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
    </div>
  );
}

function QtyBtn({ children, onClick, label, disabled }: {
  children: React.ReactNode; onClick: () => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-full text-lg text-gold-2 transition-colors hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gold-2"
    >
      {children}
    </button>
  );
}
