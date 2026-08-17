/* ------------------------------------------------------------------ */
/* Data layer — PostgreSQL.                                            */
/*                                                                     */
/*   production  DATABASE_URL set  → Supabase / any Postgres (node-pg)  */
/*   local dev   no DATABASE_URL   → PGlite, real Postgres in-process,  */
/*                                   persisted to ./data. No Docker.    */
/*                                                                     */
/* Both speak the same SQL, so what runs locally is what runs live.     */
/*                                                                     */
/* Every query is parameterised. Call sites keep writing `?` and this   */
/* layer rewrites them to $1..$n, so no SQL was rewritten by hand       */
/* during the SQLite → Postgres migration.                             */
/* ------------------------------------------------------------------ */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
interface Driver {
  query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/* ---- ? → $1..$n (leaves ?? and quoted text alone) ---- */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  let out = "";
  let inSingle = false;
  for (let c = 0; c < sql.length; c++) {
    const ch = sql[c]!;
    if (ch === "'") inSingle = !inSingle;
    if (ch === "?" && !inSingle) {
      out += `$${++i}`;
      continue;
    }
    out += ch;
  }
  return out;
}

let driver: Driver;

async function makeDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: url,
      // Supabase and most managed Postgres require TLS
      ssl: url.includes("localhost") || url.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    return {
      async query(sql, params) {
        const r = await pool.query(toPgPlaceholders(sql), params);
        return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 };
      },
      async exec(sql) { await pool.query(sql); },
      async close() { await pool.end(); },
    };
  }

  // local dev / tests — embedded Postgres, persisted to disk
  const dir = process.env.PGLITE_DIR ?? "./data/pg";
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = await PGlite.create(dir);
  return {
    async query(sql, params) {
      const r = await lite.query(toPgPlaceholders(sql), params as unknown[]);
      return { rows: (r.rows ?? []) as Row[], rowCount: r.affectedRows ?? (r.rows?.length ?? 0) };
    },
    async exec(sql) { await lite.exec(sql); },
    async close() { await lite.close(); },
  };
}

export async function connect() {
  if (!driver) driver = await makeDriver();
  return driver;
}

export async function closeDb() {
  if (driver) await driver.close();
}

/* ------------------------------------------------------------------ */
/* Query helpers — same shape the codebase already used, now async.    */
/*   db.prepare(sql).get(...)  → first row or undefined                */
/*   db.prepare(sql).all(...)  → rows                                  */
/*   db.prepare(sql).run(...)  → { changes }                           */
/* ------------------------------------------------------------------ */

export const db = {
  prepare(sql: string) {
    return {
      async get<T = Row>(...params: unknown[]): Promise<T | undefined> {
        const r = await (await connect()).query(sql, params);
        return r.rows[0] as T | undefined;
      },
      async all<T = Row>(...params: unknown[]): Promise<T[]> {
        const r = await (await connect()).query(sql, params);
        return r.rows as T[];
      },
      async run(...params: unknown[]): Promise<{ changes: number }> {
        const r = await (await connect()).query(sql, params);
        return { changes: r.rowCount };
      },
    };
  },
  async exec(sql: string) {
    await (await connect()).exec(sql);
  },
};

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export async function migrate() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    address TEXT NOT NULL,
    hours TEXT NOT NULL,
    phone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('super_admin','admin','barber','client')),
    user_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    title TEXT,
    branch_id TEXT REFERENCES branches(id),
    password_hash TEXT,
    code_hmac TEXT UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    barber_id TEXT NOT NULL REFERENCES users(id),
    client_id TEXT REFERENCES users(id),
    client_name TEXT NOT NULL,
    client_phone TEXT,
    service_ids TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Booked'
      CHECK (status IN ('Booked','Confirmed','Arrived','Started','No Show','Cancelled')),
    online INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings (branch_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_barber ON bookings (barber_id, starts_at);

  CREATE TABLE IF NOT EXISTS booking_events (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings(id),
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    category TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('retail','supply')),
    price REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_levels (
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    qty INTEGER NOT NULL DEFAULT 0,
    reorder_at INTEGER NOT NULL DEFAULT 5,
    PRIMARY KEY (product_id, branch_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('received','adjustment','pos_sale','online_sale','correction')),
    note TEXT,
    actor_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_movements ON stock_movements (branch_id, created_at);

  CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
    value REAL NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('services','products','both')),
    min_amount REAL NOT NULL DEFAULT 0,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL REFERENCES coupons(id),
    context TEXT NOT NULL,
    amount_saved REAL NOT NULL,
    client_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES users(id),
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    coupon_code TEXT,
    vat REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'placed'
      CHECK (status IN ('placed','paid','fulfilled','cancelled')),
    fulfil_branch_id TEXT REFERENCES branches(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
    barber_id TEXT NOT NULL REFERENCES users(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    client_id TEXT REFERENCES users(id),
    client_name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    submitted_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_barber ON reviews (barber_id, submitted_at);

  CREATE TABLE IF NOT EXISTS day_snapshots (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (date, branch_id)
  );

  CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    qr_token TEXT NOT NULL UNIQUE,
    points INTEGER NOT NULL DEFAULT 0,
    lifetime_points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS points_transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES loyalty_accounts(id),
    booking_id TEXT REFERENCES bookings(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_points_account ON points_transactions (account_id, created_at);

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL UNIQUE,
    booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    client_name TEXT NOT NULL,
    client_phone TEXT,
    items TEXT NOT NULL,
    gross REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    tip REAL NOT NULL DEFAULT 0,
    vat REAL NOT NULL,
    total REAL NOT NULL,
    payment_method TEXT NOT NULL,
    issued_by TEXT REFERENCES users(id),
    coupon_code TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices (branch_id, created_at);

  CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    booking_id TEXT REFERENCES bookings(id),
    to_phone TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('confirmation','reminder','feedback','cancellation','invoice')),
    body TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','sent','failed','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications (status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_booking ON notifications (booking_id);

  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
  );
  `);
}

/* ---------------- lockout helpers (persistent, per key) ------------- */

const LOCK_BASE_SECONDS = 60;
const MAX_FREE_ATTEMPTS = 5;

export async function checkLock(key: string): Promise<number> {
  const row = await db
    .prepare("SELECT locked_until FROM login_attempts WHERE key = ?")
    .get<{ locked_until: string | null }>(key);
  if (!row?.locked_until) return 0;
  const remaining = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export async function recordFailure(key: string): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM login_attempts WHERE key = ?")
    .get<{ count: number }>(key);
  const count = Number(row?.count ?? 0) + 1;
  let lockedUntil: string | null = null;
  if (count >= MAX_FREE_ATTEMPTS) {
    // escalating lockout: 60s, 120s, 240s ... capped at 15 min
    const factor = Math.min(2 ** (count - MAX_FREE_ATTEMPTS), 15);
    lockedUntil = new Date(Date.now() + LOCK_BASE_SECONDS * factor * 1000).toISOString();
  }
  await db.prepare(
    `INSERT INTO login_attempts (key, count, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = EXCLUDED.count, locked_until = EXCLUDED.locked_until`
  ).run(key, count, lockedUntil);
  return lockedUntil ? checkLock(key) : 0;
}

export async function clearFailures(key: string) {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}

/* atomic sequential counter (invoice / order numbers) */
export async function nextCounter(key: string): Promise<number> {
  const row = await db.prepare(
    `INSERT INTO counters (key, value) VALUES (?, 1)
     ON CONFLICT(key) DO UPDATE SET value = counters.value + 1
     RETURNING value`
  ).get<{ value: number }>(key);
  return Number(row!.value);
}
