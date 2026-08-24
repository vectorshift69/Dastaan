/* ------------------------------------------------------------------ */
/* Data layer.                                                         */
/*                                                                     */
/* Same Postgres as the main API — one salon, one set of books — but    */
/* this service owns the two tables below and is the only writer to     */
/* them. What it does NOT share is the Stripe key, which is the point   */
/* of keeping it a separate deployable.                                 */
/* ------------------------------------------------------------------ */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;

/* Same shape as the main API: real Postgres when DATABASE_URL is set,
   embedded Postgres otherwise so this can be run and tested without a
   server. Money code especially wants to be runnable on a laptop. */
interface Driver {
  query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
  begin(): Promise<Tx>;
  close(): Promise<void>;
}
export interface Tx {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/* `?` placeholders, same convention as the main API */
const toPg = (sql: string) => {
  let i = 0, out = "", inSingle = false;
  for (const ch of sql) {
    if (ch === "'") inSingle = !inSingle;
    out += ch === "?" && !inSingle ? `$${++i}` : ch;
  }
  return out;
};

let driver: Driver | null = null;

async function makeDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: url,
      ssl: url.includes("localhost") || url.includes("127.0.0.1")
        ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    return {
      async query(sql, params) {
        const r = await pool.query(toPg(sql), params);
        return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 };
      },
      async exec(sql) { await pool.query(sql); },
      async begin() {
        const c = await pool.connect();
        await c.query("BEGIN");
        return {
          async query(sql, params = []) {
            const r = await c.query(toPg(sql), params);
            return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 };
          },
          async commit() { await c.query("COMMIT"); c.release(); },
          async rollback() { await c.query("ROLLBACK").catch(() => {}); c.release(); },
        };
      },
      async close() { await pool.end(); },
    };
  }

  const dir = process.env.PGLITE_DIR ?? "./data/pg";
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = await PGlite.create(dir);
  const run = async (sql: string, params: unknown[] = []) => {
    const r = await lite.query(toPg(sql), params as unknown[]);
    return { rows: (r.rows ?? []) as Row[], rowCount: r.affectedRows ?? (r.rows?.length ?? 0) };
  };
  return {
    query: (sql, params) => run(sql, params),
    async exec(sql) { await lite.exec(sql); },
    async begin() {
      await lite.exec("BEGIN");
      return {
        query: (sql, params = []) => run(sql, params),
        async commit() { await lite.exec("COMMIT"); },
        async rollback() { await lite.exec("ROLLBACK").catch(() => {}); },
      };
    },
    async close() { await lite.close(); },
  };
}

const conn = async (): Promise<Driver> => (driver ??= await makeDriver());

export const db = {
  prepare(sql: string) {
    return {
      async get<T = Row>(...p: unknown[]): Promise<T | undefined> {
        return (await (await conn()).query(sql, p)).rows[0] as T | undefined;
      },
      async all<T = Row>(...p: unknown[]): Promise<T[]> {
        return (await (await conn()).query(sql, p)).rows as T[];
      },
      async run(...p: unknown[]): Promise<{ changes: number }> {
        return { changes: (await (await conn()).query(sql, p)).rowCount };
      },
    };
  },
  async exec(sql: string) { await (await conn()).exec(sql); },
  /** Money work runs in a transaction or not at all. */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = await (await conn()).begin();
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },
  async close() { if (driver) await driver.close(); },
};

export async function migrate() {
  await db.exec(`
  /* Every intent we ever create, and how it ended. This is the ledger the
     salon's accountant would reconcile against their Stripe dashboard, so
     nothing is deleted and nothing is overwritten in place except status. */
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE,          -- Stripe PaymentIntent id
    /* the three things a client can pay for:
         order   — a store order
         booking — the whole appointment, paid up front at booking time
         invoice — an unpaid bill settled after the visit, from the app     */
    kind TEXT NOT NULL CHECK (kind IN ('order','booking','invoice')),
    order_id TEXT,                            -- exactly one of these three
    booking_id TEXT,
    invoice_id TEXT,
    client_id TEXT,
    amount REAL NOT NULL,                     -- dirhams, as charged
    currency TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('requires_payment','succeeded','failed','cancelled','refunded')),
    refunded_amount REAL NOT NULL DEFAULT 0,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (CASE WHEN order_id   IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN booking_id IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END) = 1
    )
  );
  CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
  CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id);
  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);

  /* Stripe delivers webhooks at least once, and will retry for days if we
     ever answer slowly. Recording the event id before acting is what stops
     a retry marking the same order paid twice or refunding twice. */
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,                      -- Stripe's event id
    type TEXT NOT NULL,
    payment_intent TEXT,
    received_at TEXT NOT NULL
  );

  /* Whether the client already paid online sits on the booking itself, so
     the front desk can see it at the chair even if this service is asleep.
       unpaid  — nothing taken; settle at the desk or in the app afterwards
       prepaid — paid in full when they booked                              */
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prepaid_amount REAL NOT NULL DEFAULT 0;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

  /* A bill the client is going to settle later needs to stay open. Existing
     invoices were all taken at the desk, so they default to settled. */
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settled INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settled_at TEXT;
  `);
}
