"use client";

/* Feature flags from the API. The payments switch decides whether the UI
   ever offers to charge a card — with it off, the app is a complete
   booking/salon system and money is taken at the desk. */

import { useEffect, useState } from "react";

export type AppConfig = {
  payments: { enabled: boolean; online: boolean; terminal: boolean; currency: string };
};

const FALLBACK: AppConfig = {
  payments: { enabled: false, online: false, terminal: false, currency: "AED" },
};

let cached: AppConfig | null = null;

export function useConfig(): AppConfig {
  const [cfg, setCfg] = useState<AppConfig>(cached ?? FALLBACK);

  useEffect(() => {
    if (cached) return;
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .then((c: AppConfig) => { cached = c; setCfg(c); })
      .catch(() => setCfg(FALLBACK)); // safest default: never imply we can charge
  }, []);

  return cfg;
}
