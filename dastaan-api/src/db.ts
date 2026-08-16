/* ------------------------------------------------------------------ */
/* Data layer — node:sqlite with prepared statements ONLY.             */
/* Every query is parameterized: no string interpolation of user input */
/* ever reaches SQL. To move to Postgres in production, this file is   */
/* the single swap point (same function signatures, pg client inside). */
/* ------------------------------------------------------------------ */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/dastaan.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

export function migrate() {
  db.exec(`
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
    user_id TEXT UNIQUE,               -- client login id (null for staff)
    name TEXT NOT NULL,
    phone TEXT,
    title TEXT,
    branch_id TEXT REFERENCES branches(id),
    password_hash TEXT,                -- clients (bcrypt)
    code_hmac TEXT UNIQUE,             -- staff 4-digit code (HMAC-SHA256 + server pepper)
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
    service_ids TEXT NOT NULL,         -- JSON array (validated by zod before insert)
    starts_at TEXT NOT NULL,           -- ISO datetime
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
    kind TEXT NOT NULL CHECK (kind IN ('retail','supply')), -- retail = sellable, supply = in-salon use
    price REAL NOT NULL DEFAULT 0,     -- retail price (VAT-inclusive); 0 for supplies
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_levels (
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    qty INTEGER NOT NULL DEFAULT 0,
    reorder_at INTEGER NOT NULL DEFAULT 5, -- low-stock alert threshold
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
    code TEXT NOT NULL UNIQUE,         -- stored uppercase
    type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
    value REAL NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('services','products','both')),
    min_amount REAL NOT NULL DEFAULT 0,
    max_uses INTEGER,                  -- null = unlimited
    uses INTEGER NOT NULL DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL REFERENCES coupons(id),
    context TEXT NOT NULL,             -- invoice:<id> or order:<id>
    amount_saved REAL NOT NULL,
    client_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,     -- ORD-<year>-#####
    client_id TEXT NOT NULL REFERENCES users(id),
    items TEXT NOT NULL,               -- JSON [{productId, name, qty, price}]
    subtotal REAL NOT NULL,            -- VAT-inclusive, before discount
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
    token TEXT NOT NULL UNIQUE,        -- single-use link sent in the feedback SMS
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    submitted_at TEXT,                 -- null until the client responds
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_barber ON reviews (barber_id, submitted_at);

  CREATE TABLE IF NOT EXISTS day_snapshots (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,                -- YYYY-MM-DD
    branch_id TEXT NOT NULL REFERENCES branches(id),
    data TEXT NOT NULL,                -- JSON: full booking state for that day
    created_at TEXT NOT NULL,
    UNIQUE (date, branch_id)
  );

  CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    qr_token TEXT NOT NULL UNIQUE,     -- random 128-bit; the QR payload
    points INTEGER NOT NULL DEFAULT 0, -- spendable balance
    lifetime_points INTEGER NOT NULL DEFAULT 0, -- drives tier
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
    invoice_no TEXT NOT NULL UNIQUE,   -- e.g. INV-2026-00042 (sequential per year)
    booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    client_name TEXT NOT NULL,
    client_phone TEXT,
    items TEXT NOT NULL,               -- JSON [{name, price}]
    gross REAL NOT NULL,               -- service total after discount (VAT-inclusive)
    discount REAL NOT NULL DEFAULT 0,
    tip REAL NOT NULL DEFAULT 0,
    vat REAL NOT NULL,                 -- 5% UAE VAT contained in gross
    total REAL NOT NULL,               -- gross + tip = amount paid
    payment_method TEXT NOT NULL,
    issued_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices (branch_id, created_at);

  CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY,              -- e.g. invoice:2026
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    booking_id TEXT REFERENCES bookings(id),
    to_phone TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('confirmation','reminder','feedback','cancellation','invoice')),
    body TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,        -- ISO; send at/after this time
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
    key TEXT PRIMARY KEY,              -- e.g. team:<ip> or client:<ip>:<userId>
    count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
  );
  `);

  // idempotent column additions for databases created before these features
  safeAlter("ALTER TABLE invoices ADD COLUMN coupon_code TEXT");
}

function safeAlter(sql: string) {
  try {
    db.exec(sql);
  } catch {
    /* column already exists */
  }
}

/* ---------------- lockout helpers (persistent, per key) ------------- */

const LOCK_BASE_SECONDS = 60;
const MAX_FREE_ATTEMPTS = 5;

export function checkLock(key: string): number {
  const row = db
    .prepare("SELECT locked_until FROM login_attempts WHERE key = ?")
    .get(key) as { locked_until: string | null } | undefined;
  if (!row?.locked_until) return 0;
  const remaining = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function recordFailure(key: string): number {
  const row = db
    .prepare("SELECT count FROM login_attempts WHERE key = ?")
    .get(key) as { count: number } | undefined;
  const count = (row?.count ?? 0) + 1;
  let lockedUntil: string | null = null;
  if (count >= MAX_FREE_ATTEMPTS) {
    // escalating lockout: 60s, 120s, 240s ... capped at 15 min
    const factor = Math.min(2 ** (count - MAX_FREE_ATTEMPTS), 15);
    lockedUntil = new Date(Date.now() + LOCK_BASE_SECONDS * factor * 1000).toISOString();
  }
  db.prepare(
    `INSERT INTO login_attempts (key, count, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until`
  ).run(key, count, lockedUntil);
  return lockedUntil ? checkLock(key) : 0;
}

export function clearFailures(key: string) {
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}

/* atomic sequential counter (invoice numbers) */
export function nextCounter(key: string): number {
  db.prepare(
    "INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1"
  ).run(key);
  return (db.prepare("SELECT value FROM counters WHERE key = ?").get(key) as { value: number }).value;
}
