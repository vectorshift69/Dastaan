"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Nav from "@/components/Nav";
import { useCart } from "@/lib/cart";
import { CURRENCY } from "@/lib/data";

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  available: number;
};

const placeholderFor = (name: string) =>
  `https://placehold.co/600x600/1a1a1a/c9a227?text=${encodeURIComponent(name.split(" ").slice(0, 2).join("+"))}`;

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const cart = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!productId) return;
    fetch(`/api/store/products/${productId}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return; }
        if (!r.ok) throw new Error();
        setProduct(await r.json());
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [productId]);

  const addToCart = () => {
    if (!product) return;
    cart.add({
      productId: product.id,
      name: product.name,
      price: product.price,
      image_url: product.imageUrl ?? placeholderFor(product.name),
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };

  const inCart = cart.lines.find((l) => l.productId === productId);
  const soldOut = product ? product.available <= 0 : false;
  const atLimit = inCart ? inCart.qty >= (product?.available ?? 0) : false;

  return (
    <div className="grain min-h-screen bg-ink text-ivory">
      <Nav />
      <main className="mx-auto max-w-5xl px-6 pt-32 pb-24 lg:px-10">
        <Link href="/store" className="text-sm text-ivory/45 hover:text-gold-2 transition-colors">
          ← Back to store
        </Link>

        {loading && (
          <p className="mt-12 text-sm text-ivory/45">Loading…</p>
        )}

        {notFound && (
          <div className="mt-12 rounded-2xl border border-ivory/10 bg-coal p-10 text-center">
            <p className="text-sm text-ivory/55">Product not found.</p>
            <Link href="/store" className="btn-gold mt-6 inline-block rounded-full px-8 py-3 text-sm tracking-widest uppercase">
              Back to store
            </Link>
          </div>
        )}

        {product && (
          <div className="mt-10 grid gap-12 lg:grid-cols-2">
            {/* image */}
            <div className="flex items-center justify-center overflow-hidden rounded-2xl border border-ivory/10 bg-coal p-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.imageUrl ?? placeholderFor(product.name)}
                alt={product.name}
                className="h-72 w-72 object-contain"
              />
            </div>

            {/* details */}
            <div className="flex flex-col">
              <p className="text-[11px] tracking-[0.28em] text-gold uppercase">{product.category}</p>
              <h1 className="font-display mt-3 text-4xl font-medium text-ivory">{product.name}</h1>
              <p className="mt-4 text-2xl font-semibold text-gold-2">{CURRENCY} {product.price}</p>

              {product.description && (
                <p className="mt-6 text-sm leading-relaxed text-ivory/60">{product.description}</p>
              )}

              <div className="mt-6 text-xs text-ivory/35">
                {soldOut
                  ? "Out of stock"
                  : product.available <= 3
                    ? `Only ${product.available} left`
                    : "In stock"}
              </div>

              <div className="mt-8 flex flex-col gap-3">
                {soldOut ? (
                  <p className="rounded-full border border-ivory/15 py-3.5 text-center text-sm text-ivory/40">
                    Back in stock soon
                  </p>
                ) : inCart ? (
                  <div className="flex items-center justify-between rounded-full border border-gold/50 bg-gold/10 px-4 py-3">
                    <button
                      onClick={() => cart.setQty(product.id, inCart.qty - 1)}
                      aria-label="Decrease"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gold-2 hover:bg-gold hover:text-ink transition-colors"
                    >
                      −
                    </button>
                    <span className="text-sm font-bold text-gold-2">{inCart.qty} in cart</span>
                    <button
                      onClick={() => !atLimit && cart.setQty(product.id, inCart.qty + 1)}
                      disabled={atLimit}
                      aria-label="Increase"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gold-2 hover:bg-gold hover:text-ink transition-colors disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={addToCart}
                    className="btn-gold rounded-full py-3.5 text-sm tracking-widest uppercase"
                  >
                    {justAdded ? "Added ✓" : "Add to cart"}
                  </button>
                )}

                <Link href="/store" className="btn-ghost rounded-full py-3.5 text-center text-sm tracking-wide">
                  Continue shopping
                </Link>
              </div>

              <p className="mt-8 text-[11px] tracking-wider text-ivory/25">
                Price includes 5% VAT · Delivered anywhere in the UAE
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
