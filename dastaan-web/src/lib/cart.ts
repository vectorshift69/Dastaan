"use client";

/* Cart state — kept in the browser and mirrored to localStorage so it
   survives a refresh. Prices here are for display only; the API re-prices
   every line from the catalog when the order is placed. */

import { useCallback, useEffect, useState } from "react";

export type CartLine = { productId: string; name: string; price: number; qty: number; image_url?: string };

const KEY = "dastaan.cart.v1";
const EVENT = "dastaan-cart-changed";

const read = (): CartLine[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
};

const write = (lines: CartLine[]) => {
  window.localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT)); // keep every mounted cart in sync
};

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(read());
    const sync = () => setLines(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // other tabs
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((item: Omit<CartLine, "qty">, qty = 1) => {
    const next = read();
    const found = next.find((l) => l.productId === item.productId);
    if (found) found.qty = Math.min(50, found.qty + qty);
    else next.push({ ...item, qty });
    write(next);
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    const next = read()
      .map((l) => (l.productId === productId ? { ...l, qty: Math.max(0, Math.min(50, qty)) } : l))
      .filter((l) => l.qty > 0); // qty 0 removes the line
    write(next);
  }, []);

  const remove = useCallback((productId: string) => {
    write(read().filter((l) => l.productId !== productId));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;

  return { lines, add, setQty, remove, clear, count, subtotal };
}
