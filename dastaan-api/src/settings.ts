/* ------------------------------------------------------------------ */
/* A small admin-editable key/value store for numbers that would */
/* otherwise be hardcoded constants — so tuning them is a settings    */
/* change an owner can make themselves, not a redeploy.                */
/* ------------------------------------------------------------------ */

import { db, now } from "./db.js";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now());
}

/** Falls back when unset or stored as something non-numeric/non-positive. */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
