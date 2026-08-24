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
  /* Runs `fn` inside a single transaction on a single pinned connection.
     Without this, every statement through the pool auto-commits on whatever
     connection it happens to get — so a long write (the seed) is neither
     atomic nor fast, and an interruption leaves the database half-written. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
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
    /* While a transaction is open, every query must ride the same
       connection — otherwise BEGIN lands on one and the inserts on others. */
    let pinned: import("pg").PoolClient | null = null;

    return {
      async query(sql, params) {
        const r = await (pinned ?? pool).query(toPgPlaceholders(sql), params);
        return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 };
      },
      async exec(sql) { await (pinned ?? pool).query(sql); },
      async close() { await pool.end(); },
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (pinned) return await fn(); // already inside one — don't nest
        const client = await pool.connect();
        pinned = client;
        try {
          await client.query("BEGIN");
          const result = await fn();
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          pinned = null;
          client.release();
        }
      },
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
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // PGlite is a single in-process connection, so plain BEGIN/COMMIT is enough
      await lite.exec("BEGIN");
      try {
        const result = await fn();
        await lite.exec("COMMIT");
        return result;
      } catch (err) {
        await lite.exec("ROLLBACK").catch(() => {});
        throw err;
      }
    },
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
  /* All-or-nothing. Used by the seed so an interrupted run leaves an empty
     database rather than a plausible-looking partial one. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await (await connect()).transaction(fn);
  },
};

/**
 * Insert many rows in as few round trips as possible.
 *
 * A hosted database is typically 150–400 ms away, so a loop of single-row
 * INSERTs is dominated entirely by network latency — 1,500 rows one at a
 * time is twenty minutes of waiting, most of it doing nothing. Folding them
 * into multi-row INSERTs turns that into a handful of round trips.
 *
 * Chunked because Postgres caps a statement at 65,535 bind parameters.
 */
export async function bulkInsert(
  tableName: string,
  columns: string[],
  rows: unknown[][],
): Promise<number> {
  if (rows.length === 0) return 0;
  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(60000 / perRow));
  const cols = columns.join(", ");
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    await db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES ${values}`).run(...chunk.flat());
  }
  return rows.length;
}

/* Every table the app owns, child-first — used by the seed's --reset. */
export const APP_TABLES = [
  "points_transactions", "loyalty_accounts", "day_snapshots", "reviews", "orders",
  "coupon_redemptions", "coupons", "online_stock_movements", "online_stock",
  "stock_movements", "stock_levels", "products",
  "invoices", "notifications", "booking_events", "bookings", "login_attempts",
  "audit_log", "counters", "password_resets", "users", "services", "branches",
] as const;

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
    email TEXT,
    /* Google's stable subject id — never the email, which people change */
    google_sub TEXT UNIQUE,
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
    client_email TEXT,
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

  /* Branch stock: the retail shelf and the back bar at each location. The
     online shop's stock is a different table entirely — see online_stock. */
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
    reason TEXT NOT NULL,
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

  /* ---- additive migrations ----
     CREATE TABLE IF NOT EXISTS leaves an existing table untouched, so columns
     added after the first deploy need saying explicitly. IF NOT EXISTS makes
     each one safe to run on every boot. */
  await db.exec(`
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_email TEXT;

    /* ---- store fulfilment ----
       Every online order is delivered. There is no collect-from-branch:
       the branches keep their own stock for the chair and the walk-in
       shelf, and the website is a separate operation that ships. */
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE orders DROP COLUMN IF EXISTS fulfilment;
    ALTER TABLE orders DROP COLUMN IF EXISTS collect_booking_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS collect_at;

    /* ---- stock reservations ----
       Without this the shop will happily sell ten of something there are
       three of: stock only moved when an order was marked fulfilled, which
       can be days later. An order now RESERVES stock the moment it is
       placed. Available to sell = qty - reserved. Cancelling releases the
       reservation; fulfilling converts it into a real movement.

       This applies to the online warehouse below. Branch stock has no
       reservations — a sale at the desk is instant. */
    ALTER TABLE stock_levels ADD COLUMN IF NOT EXISTS reserved INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_ck;
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_ck
      CHECK (reason IN ('received','adjustment','pos_sale','online_sale','correction'));

    /* An earlier design split branch stock into a shelf pool and an online
       pool. The online shop is now a separate operation with its own stock,
       so that split is gone: fold anything it left behind back into the
       branch row. Safe on a database that never had it — the sums are of
       single rows and the delete matches nothing. Can be removed once every
       environment has booted once. */
    UPDATE stock_levels a SET qty = t.qty, reserved = t.reserved
      FROM (SELECT product_id, branch_id, SUM(qty) AS qty, SUM(reserved) AS reserved
              FROM stock_levels GROUP BY product_id, branch_id) t
     WHERE a.product_id = t.product_id AND a.branch_id = t.branch_id;
    DELETE FROM stock_levels a USING stock_levels b
     WHERE a.product_id = b.product_id AND a.branch_id = b.branch_id AND a.ctid < b.ctid;
    ALTER TABLE stock_levels DROP COLUMN IF EXISTS channel;
    ALTER TABLE stock_movements DROP COLUMN IF EXISTS channel;
    DROP INDEX IF EXISTS idx_stock_levels_key;
    ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS stock_levels_pkey;
    ALTER TABLE stock_levels ADD PRIMARY KEY (product_id, branch_id);

    /* ---- the online shop's own stock ----
       One warehouse for the whole of the UAE, with no branch against it:
       everything sold on the website is delivered from it, so asking which
       branch a jar belongs to has no meaning. It is deliberately a separate
       table rather than a column on stock_levels — different stock, different
       people, different login. A barber using the last bottle of oil at
       Marina Walk cannot affect what the website is selling, and vice versa. */
    CREATE TABLE IF NOT EXISTS online_stock (
      product_id TEXT PRIMARY KEY REFERENCES products(id),
      qty INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,     -- held by orders not yet shipped
      reorder_at INTEGER NOT NULL DEFAULT 5,
      updated_at TEXT
    );

    /* Its own ledger too, for the same reason. */
    CREATE TABLE IF NOT EXISTS online_stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL
        CHECK (reason IN ('received','adjustment','online_sale','correction','returned')),
      note TEXT,
      actor_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_online_movements ON online_stock_movements (created_at);

    /* The online shop is run by someone who is not salon staff and does not
       have a chair, so they get their own role and their own login rather
       than a keypad code. */
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_ck;
    ALTER TABLE users ADD CONSTRAINT users_role_ck
      CHECK (role IN ('super_admin','admin','barber','client','shop_manager'));

    /* ---- password resets ----
       Only the HASH of the token is kept, exactly as with a password: if this
       table ever leaks, the rows in it cannot be used to take over an account.
       Single use and short-lived — used_at is set the moment it is spent, so
       a link forwarded or sitting in a mailbox is worth nothing twice. */
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      requested_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id);

    /* ---- the outbox carries email too ----
       It was built for SMS to a phone. A reset link has to go to an address,
       so the row now names its channel and its destination. Everything that
       existed was an SMS, hence the defaults. */
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS to_email TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject TEXT;
    ALTER TABLE notifications ALTER COLUMN to_phone DROP NOT NULL;
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_ck;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_ck
      CHECK (kind IN ('confirmation','reminder','feedback','cancellation','invoice','password_reset'));
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_ck;
    ALTER TABLE notifications ADD CONSTRAINT notifications_channel_ck
      CHECK (channel IN ('sms','email'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));
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
