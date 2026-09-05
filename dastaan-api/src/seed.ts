/* ------------------------------------------------------------------ */
/* Demo seed — run once: npm run seed                                   */
/*                                                                      */
/* This builds a salon that looks like it has actually been trading:    */
/* six weeks of completed visits with invoices, loyalty balances that   */
/* add up, ratings on every barber, stock that has moved (and two       */
/* lines that need reordering), store orders in every state, and        */
/* archived timeline days. Every screen in the console has something    */
/* real to show — nothing is an empty state.                            */
/*                                                                      */
/* It also writes a forward diary: today in full, then thirty days of   */
/* upcoming appointments that thin out with distance. Those are only    */
/* ever Booked or Confirmed and carry no money — a future visit has not */
/* happened yet — and no barber is double-booked, so every row is one   */
/* the API itself would have accepted.                                  */
/*                                                                      */
/* Deterministic for a given day: re-running it on the same date gives  */
/* identical figures, so a demo can be rehearsed. Run it on a different */
/* date and the totals shift a little, because the weekend pattern      */
/* moves with the calendar.                                             */
/*                                                                      */
/* Written in ~110 database round trips, not ~1,500: the rows are       */
/* collected in memory and inserted in bulk. One-at-a-time inserts are  */
/* all network latency against a hosted database and take minutes.      */
/* ------------------------------------------------------------------ */

import "./load-env.js"; // MUST be first
import { randomBytes } from "node:crypto";
import { db, migrate, uid, now, nextCounter, bulkInsert, APP_TABLES, closeDb } from "./db.js";
import { hmacCode, hashPassword } from "./security.js";
import { snapshotDay } from "./routes/reports.js";

await migrate();

/* ---------------- deterministic randomness ---------------- */

let _seed = 20260818;
const rnd = () => ((_seed = (_seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ---------------- dates ---------------- */

const TODAY = new Date();
/* Local calendar date, deliberately NOT toISOString().slice(0,10).
   Booking times are stored as naive local strings ("2026-08-18T10:15:00") and
   the console asks for the operator's local date, so the seed has to think in
   the same frame. Using UTC meant a seed run after 20:00 Dubai / 05:30 IST
   landed the whole dataset on the previous day — today's board showed up as
   yesterday and the calendar looked nearly empty. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOffset = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00`;
const addMinutes = (date: string, hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const t = new Date(Date.UTC(2000, 0, 1, h, m + mins));
  return at(date, `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`);
};

const HISTORY_DAYS = 42; // six trading weeks behind us

/* Where the demo client's password-reset link should land. Set DEMO_EMAIL in
   dastaan-api/.env to a real inbox you can open during a walkthrough; left
   unset it stays on the reserved .test domain and cannot reach anyone. */
const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@dastaan.test";

/* ---------------- reference data ---------------- */

const branches = [
  ["b1", "Dastaan — Marina Walk", "Dubai Marina", "Marina Walk, Tower 4, Ground Floor", "Daily 10:00 – 23:00", "+971 4 000 0001"],
  ["b2", "Dastaan — City Centre", "Deira", "City Centre Boulevard, Unit 12", "Daily 10:00 – 22:00", "+971 4 000 0002"],
];

const services: [string, string, number, number, string][] = [
  ["s1", "Skin Fade & Beard", 75, 268, "Combos"],
  ["s2", "Classic Haircut", 45, 150, "Hair"],
  ["s3", "Skin Fade / Taper Fade", 50, 180, "Hair"],
  ["s4", "Beard Trim & Line Up", 30, 95, "Beard"],
  ["s5", "Hot Towel Shave", 40, 120, "Beard"],
  ["s6", "Haircut & Hot Towel Shave", 80, 240, "Combos"],
  ["s7", "Kids Cut (under 12)", 30, 90, "Hair"],
  ["s8", "Black Mask Facial", 35, 110, "Grooming"],
  ["s9", "Head Massage", 20, 70, "Grooming"],
  ["s10", "Full Grooming Ritual", 120, 420, "Combos"],
  ["s11", "Beard Colour", 40, 130, "Beard"],
  ["s12", "Head Shave (razor finish)", 35, 110, "Hair"],
];
const servicePrice = new Map(services.map((s) => [s[0], s[3]]));
const serviceMinutes = new Map(services.map((s) => [s[0], s[2]]));

/* [id, name, title, branch, 4-digit code, role] */
const staff: [string, string, string, string, string, string][] = [
  ["own1", "Imtiaz Dastaan", "Owner", "b1", "9999", "super_admin"],
  ["st1", "Aisha Rahman", "Receptionist", "b1", "1111", "admin"],
  ["st2", "Noor Siddiqui", "Receptionist", "b2", "1212", "admin"],
  ["br1", "Aqib Khan", "Barber", "b1", "2222", "barber"],
  ["br7", "Bilal Ahmed", "Barber", "b1", "3333", "barber"],
  ["br3", "Mouawia Majzoub", "Barber", "b1", "4444", "barber"],
  ["br8", "Tariq Mehmood", "Barber", "b1", "5555", "barber"],
  ["br2", "Ali Raza", "Barber", "b1", "6666", "barber"],
  ["br4", "Azeem Aslam", "Barber", "b1", "7777", "barber"],
  ["br5", "Yousuf Mirza", "Barber", "b2", "6161", "barber"],
  ["br9", "Imran Sheikh", "Barber", "b2", "6262", "barber"],
  ["br6", "Hassan Adel", "Barber", "b2", "6363", "barber"],
];
const barbersOf: Record<"b1" | "b2", string[]> = {
  b1: ["br1", "br7", "br3", "br8", "br2", "br4"],
  b2: ["br5", "br9", "br6"],
};

/* Registered clients — these are the ones with logins, loyalty cards and
   a visit history, so the Clients screen and the loyalty card look real.
   Every one of them signs in with the password `demo1234`.              */
const clients: [string, string, string][] = [
  ["demo", "Rayyan Habib", "+971 50 000 0000"], // the account we hand out in the demo
  ["omar.f", "Omar Al-Farsi", "+971 55 660 1188"],
  ["zaid.m", "Zaid Al-Marri", "+971 52 990 4471"],
  ["hamza.s", "Hamza Sheikh", "+971 50 441 7789"],
  ["faizan.q", "Faizan Qureshi", "+971 55 209 4432"],
  ["marwan.a", "Marwan Adel", "+971 50 776 9911"],
  ["yasser.z", "Yasser Zaman", "+971 54 332 8080"],
  ["rashid.n", "Rashid Nasser", "+971 54 118 6620"],
  ["kamal.h", "Kamal Hussain", "+971 52 883 2245"],
];

/* Walk-ins — no login, but reception still books them by name. A salon
   this size sees a few hundred different faces in six weeks, so the names
   are generated from a fixed pool: enough variety that the Clients screen
   looks like a real book, with regulars who recur and one-timers who don't. */
const FIRST = ["Omar", "Zaid", "Hamza", "Faizan", "Marwan", "Yasser", "Rashid", "Kamal",
  "Sumit", "Alberto", "Mikel", "Ish", "Lutfar", "Majid", "Bilal", "Danish", "Karim",
  "Nabil", "Tom", "Adnan", "Saif", "Rami", "Junaid", "Fahad", "Tariq", "Waleed",
  "Sameer", "Nadeem", "Arjun", "Rohit", "Vikram", "Daniel", "James", "Marco", "Youssef",
  "Bassam", "Salman", "Hisham", "Ravi", "Anand", "Ayman", "Firas", "Jamal", "Nasir",
  "Osman", "Peter", "Sanjay", "Talal", "Usman", "Zubair"];
const LAST = ["Al-Farsi", "Al-Marri", "Sheikh", "Qureshi", "Adel", "Zaman", "Nasser",
  "Hussain", "Verma", "Bustani", "Simmonds", "Guleri", "Hawlader", "Akram", "Rahman",
  "Iqbal", "Benali", "Haddad", "Whitfield", "Siddiqui", "Chaudhry", "Mansour", "Nair",
  "Khalil", "Farooq", "Baig", "Rizvi", "Saleh", "Dominguez", "Okafor"];

const phoneFor = (i: number) =>
  `+971 5${[0, 2, 4, 5, 6][i % 5]} ${String(100 + ((i * 37) % 900))} ${String(1000 + ((i * 613) % 9000))}`;

/* 180 distinct people; the first third are regulars (they come back). */
const walkIns: [string, string][] = Array.from({ length: 180 }, (_, i) => [
  `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 11) % LAST.length]}`,
  phoneFor(i),
] as [string, string]).filter(([n], i, arr) => arr.findIndex(([m]) => m === n) === i);

/* Service mixes, weighted the way a gents salon actually sells. */
const baskets: string[][] = [
  ["s2"], ["s2"], ["s2"], ["s3"], ["s3"], ["s3"], ["s1"], ["s1"],
  ["s4"], ["s4"], ["s5"], ["s6"], ["s2", "s4"], ["s3", "s4"],
  ["s2", "s9"], ["s7"], ["s8"], ["s11"], ["s12"], ["s10"],
];

const SLOTS = ["10:00", "10:45", "11:30", "12:15", "13:00", "13:45", "14:30",
  "15:15", "16:00", "16:45", "17:30", "18:15", "19:00", "19:45", "20:30", "21:15"];

const REVIEW_COMMENTS = [
  "Best fade in Marina, hands down.",
  "Took his time and got the beard line exactly right.",
  "Very clean shop, hot towel shave was worth it.",
  "Booked online in 30 seconds, in and out on time.",
  "Great cut, though I waited about ten minutes past my slot.",
  "Second visit, asked for the same and got the same. That's the whole thing.",
  "Friendly team, good coffee, will bring my son next time.",
  "Solid haircut. A bit pricey but the finish is worth it.",
  null, null, null, null, // plenty of ratings arrive with no comment
];

const PAY_METHODS = ["card", "card", "card", "cash", "cash", "wallet"];

/* ---------------- products ---------------- */

const products: [string, string, string | null, string, "retail" | "supply", number][] = [
  ["p1", "Argan Repair Serum", "DST-ARG-01", "Hair care", "retail", 120],
  ["p2", "Matte Clay Pomade", "DST-POM-01", "Styling", "retail", 85],
  ["p3", "Beard Elixir No. 4", "DST-BRD-04", "Beard care", "retail", 95],
  ["p4", "Charcoal Daily Shampoo", "DST-SHP-02", "Hair care", "retail", 70],
  ["p5", "Straight Razor Kit", "DST-RZR-01", "Tools", "retail", 240],
  ["p6", "Pre-Shave Oil & Balm Set", "DST-SHV-01", "Shaving", "retail", 150],
  ["p7", "Barbicide Concentrate", null, "Sanitation", "supply", 0],
  ["p8", "Neck Strips (box)", null, "Consumables", "supply", 0],
  ["p9", "Clipper Blade Oil", null, "Tools", "supply", 0],
];
const retail = products.filter((p) => p[4] === "retail");
const productPrice = new Map(products.map((p) => [p[0], p[5]]));
const productName = new Map(products.map((p) => [p[0], p[1]]));

/* opening stock per branch — p4 at Marina and p8 at City Centre sit below
   their reorder point, so the Inventory screen has a real warning on it  */
const openingStock: [string, string, number, number][] = [
  ["p1", "b1", 18, 6], ["p1", "b2", 11, 6],
  ["p2", "b1", 24, 8], ["p2", "b2", 15, 8],
  ["p3", "b1", 16, 6], ["p3", "b2", 9, 6],
  ["p4", "b1", 3, 8], ["p4", "b2", 12, 8],
  ["p5", "b1", 5, 2], ["p5", "b2", 4, 2],
  ["p6", "b1", 10, 4], ["p6", "b2", 7, 4],
  ["p7", "b1", 14, 4], ["p7", "b2", 10, 4],
  ["p8", "b1", 9, 5], ["p8", "b2", 2, 5],
  ["p9", "b1", 12, 4], ["p9", "b2", 8, 4],
];

/* ------------------------------------------------------------------ */

const RESET = process.argv.includes("--reset") || process.env.SEED_RESET === "1";

const run = async () => {
  if (RESET) {
    /* Same transaction as the insert below, so a wipe can never survive on
       its own — either you end up with a full demo salon or with what you
       started with. */
    await db.exec(`TRUNCATE TABLE ${APP_TABLES.join(", ")} CASCADE`);
    console.log("Reset: cleared all app tables.");
  }

  const existing = await db.prepare("SELECT COUNT(*) AS n FROM branches").get() as { n: number };
  if (Number(existing.n) > 0) {
    console.log(
      "Already seeded — this database already has data.\n" +
      "  To rebuild it from scratch:  npm run seed:reset"
    );
    return;
  }

  /* ---------- reference data ---------- */

  await bulkInsert("branches", ["id", "name", "area", "address", "hours", "phone"], branches);
  await bulkInsert("services", ["id", "name", "minutes", "price", "category"], services.map((x) => [...x]));
  await bulkInsert("users", ["id", "role", "name", "title", "branch_id", "code_hmac", "created_at"],
    staff.map(([id, name, title, branch, code, role]) => [id, role, name, title, branch, hmacCode(code), now()]));
  await bulkInsert("products", ["id", "name", "sku", "category", "kind", "price", "created_at"],
    products.map(([id, name, sku, category, kind, price]) => [id, name, sku, category, kind, price, now()]));
  /* Branch stock: what was counted on the shelf at each location. The online
     shop's warehouse is seeded separately below — different stock entirely. */
  await bulkInsert("stock_levels", ["product_id", "branch_id", "qty", "reorder_at"],
    openingStock.map((x) => [...x]));
  await bulkInsert("stock_movements",
    ["id", "product_id", "branch_id", "delta", "reason", "note", "actor_id", "created_at"],
    openingStock.map(([pid, bid, qty]) =>
      [uid(), pid, bid, qty, "received", "Opening stock count", "own1", at(dayOffset(-HISTORY_DAYS), "09:00")]));

  /* ---------- coupons ---------- */

  const couponIds = { welcome: uid(), ramadan: uid(), lapsed: uid() };
  await bulkInsert("coupons",
    ["id", "code", "type", "value", "scope", "min_amount", "max_uses", "valid_to", "active", "created_at"], [
    [couponIds.welcome, "WELCOME10", "percent", 10, "both", 50, 200, null, 1, now()],
    [couponIds.ramadan, "GROOM25", "fixed", 25, "services", 150, 500, null, 1, now()],
    [couponIds.lapsed, "SUMMER15", "percent", 15, "both", 0, 100, `${dayOffset(-30)}T23:59:59`, 0, now()],
  ]);
  const couponUses = { welcome: 0, ramadan: 0 };

  /* ---------- clients + loyalty accounts ---------- */

  const clientIds = new Map<string, string>();   // userId  -> row id
  const accountIds = new Map<string, string>();  // clientId -> loyalty account id
  const pwd = await hashPassword("demo1234");    // hashed once — bcrypt is deliberately slow

  const clientRows: unknown[][] = [];
  const accountRows: unknown[][] = [];
  for (const [userId, name, phone] of clients) {
    const id = uid();
    clientIds.set(userId, id);
    /* Every demo client has an email, because without one they cannot be
       sent a password reset — and "reset a client's password" is the first
       thing an owner tries. .test is reserved by the IETF for exactly this,
       so none of these can ever reach a real inbox by accident.

       The one exception is the `demo` account, which takes DEMO_EMAIL when it
       is set, so that during a walkthrough the reset link actually lands in a
       real inbox you can open in front of the client. It comes from the
       environment rather than being written here because this repository is
       public, and a personal address committed to a public repo is a spam
       magnet within days. Put it in dastaan-api/.env, which is gitignored. */
    clientRows.push([id, "client", userId, name,
      userId === "demo" ? DEMO_EMAIL : `${userId}@dastaan.test`, phone, pwd,
      at(dayOffset(-HISTORY_DAYS - int(10, 240)), "12:00")]);
    const accId = uid();
    accountIds.set(id, accId);
    accountRows.push([accId, id,
      userId === "demo" ? "demotoken00000000000000000000000" : randomBytes(16).toString("hex"),
      0, 0, at(dayOffset(-HISTORY_DAYS), "12:00")]);
  }
  await bulkInsert("users", ["id", "role", "user_id", "name", "email", "phone", "password_hash", "created_at"], clientRows);
  await bulkInsert("loyalty_accounts", ["id", "client_id", "qr_token", "points", "lifetime_points", "created_at"], accountRows);

  /* Whoever runs the online shop. Not salon staff: no branch, no chair, no
     keypad code — an id and a password, and a warehouse to look after. */
  await db.prepare(
    "INSERT INTO users (id, role, user_id, name, title, password_hash, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run("shop1", "shop_manager", "shop", "Sana Iqbal", "Online shop manager",
    await hashPassword("shop1234"), at(dayOffset(-HISTORY_DAYS), "09:00"));

  /* Balances carried over from Fresha, so the loyalty screen shows a
     spread of tiers on day one rather than nine identical zeroes.       */
  const carriedOver: [string, number][] = [
    ["demo", 4200],      // Gold — the account we hand out in the demo
    ["omar.f", 3100],
    ["hamza.s", 1650],   // Silver
    ["zaid.m", 1400],
    ["faizan.q", 600],
    ["yasser.z", 250],
  ];
  const points = new Map<string, number>();
  await bulkInsert("points_transactions", ["id", "account_id", "delta", "reason", "created_at"],
    carriedOver.map(([userId, opening]) => {
      const accId = accountIds.get(clientIds.get(userId)!)!;
      points.set(accId, opening);
      return [uid(), accId, opening, "migration_from_fresha", at(dayOffset(-HISTORY_DAYS), "12:05")];
    }));

  /* ---------- who walks through the door, and how often ----------
     Dealing visits out of a shuffled pool keeps the visit counts honest:
     a registered client comes back two or three times in six weeks, the
     regulars a little more, and plenty of people come exactly once.      */
  type Visitor = { clientRowId: string | null; name: string; phone: string | null };
  const visitPool: Visitor[] = [];
  for (const [userId, name, phone] of clients)
    for (let k = 0; k < 3; k++) visitPool.push({ clientRowId: clientIds.get(userId)!, name, phone });
  walkIns.forEach(([name, phone], i) => {
    const times = i < 55 ? 4 : i < 110 ? 3 : 2; // the front of the pool are the regulars
    for (let k = 0; k < times; k++) visitPool.push({ clientRowId: null, name, phone });
  });
  for (let i = visitPool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [visitPool[i], visitPool[j]] = [visitPool[j]!, visitPool[i]!];
  }
  let poolAt = 0;
  const nextVisitor = (): Visitor => visitPool[poolAt++ % visitPool.length]!;

  /* ---------- six weeks of trading history ---------- */

  const year = new Date().getFullYear();
  let invoiceCount = 0;

  /* Rows are collected here and written in a handful of multi-row INSERTs at
     the end. Inserting them one at a time means ~1,500 round trips, which is
     twenty minutes of pure network latency against a database in Frankfurt. */
  const rowsBookings: unknown[][] = [];
  const rowsInvoices: unknown[][] = [];
  const rowsReviews: unknown[][] = [];
  const rowsNotifications: unknown[][] = [];
  const rowsPoints: unknown[][] = [];
  const rowsRedemptions: unknown[][] = [];
  const rowsMovements: unknown[][] = [];
  let invoiceSeq = 0;
  let reviewCount = 0;
  const stockSold = new Map<string, number>(); // `${pid}:${bid}` -> qty

  process.stdout.write(`Writing ${HISTORY_DAYS} days of history `);
  for (let back = HISTORY_DAYS; back >= 1; back--) {
    process.stdout.write("·"); // so a slow connection doesn't look like a hang
    const date = dayOffset(-back);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
    const busy = weekday === 5 || weekday === 6 || weekday === 0; // Fri–Sun in the UAE

    for (const branchId of ["b1", "b2"] as const) {
      const capacity = branchId === "b1" ? (busy ? 9 : 6) : (busy ? 6 : 4);
      const slots = [...SLOTS].sort(() => rnd() - 0.5).slice(0, capacity);

      for (const slot of slots) {
        const barberId = pick(barbersOf[branchId]);
        const basket = pick(baskets);
        const minutes = basket.reduce((m, s) => m + (serviceMinutes.get(s) ?? 45), 0);
        const listPrice = r2(basket.reduce((p, s) => p + (servicePrice.get(s) ?? 0), 0));

        const { clientRowId, name: clientName, phone: clientPhone } = nextVisitor();

        /* 90% of past bookings were served; the rest are the no-shows and
           cancellations any salon has, so the reports aren't unrealistically clean */
        const roll = rnd();
        const served = roll < 0.9;
        const status = served ? "Started" : roll < 0.95 ? "No Show" : "Cancelled";
        const online = chance(0.45) ? 1 : 0;
        const bookingId = uid();
        const createdAt = at(dayOffset(-back - int(1, 6)), "18:00");

        rowsBookings.push([bookingId, branchId, barberId, clientRowId, clientName, clientPhone,
          JSON.stringify(basket), at(date, slot), minutes, status, online, served ? 1 : 0,
          status === "Cancelled" ? "Client rescheduled" : null, createdAt, at(date, slot)]);

        if (!served) continue;

        /* ---- invoice (this is exactly what checkout would have written) ---- */
        const items = basket.map((s) => ({
          name: services.find((x) => x[0] === s)![1],
          price: servicePrice.get(s)!,
        }));

        /* a retail add-on gets sold with roughly one visit in five */
        let productTotal = 0;
        if (chance(0.2)) {
          const p = pick(retail);
          const qty = chance(0.15) ? 2 : 1;
          const line = r2(productPrice.get(p[0])! * qty);
          productTotal += line;
          items.push({ name: qty > 1 ? `${qty}× ${p[1]}` : p[1], price: line });
          const key = `${p[0]}:${branchId}`;
          stockSold.set(key, (stockSold.get(key) ?? 0) + qty);
          rowsMovements.push([uid(), p[0], branchId, -qty, "pos_sale", "Sold at checkout", barberId, addMinutes(date, slot, minutes)]);
        }

        /* manual discount is rare and small; coupons are the usual route */
        const manualDiscount = chance(0.06) ? int(1, 4) * 10 : 0;
        let couponCode: string | null = null;
        let couponDiscount = 0;
        if (chance(0.12) && listPrice >= 150) {
          if (chance(0.5)) { couponCode = "WELCOME10"; couponDiscount = r2((listPrice + productTotal) * 0.1); couponUses.welcome++; }
          else { couponCode = "GROOM25"; couponDiscount = 25; couponUses.ramadan++; }
        }

        const discount = r2(manualDiscount + couponDiscount);
        const gross = r2(Math.max(0, listPrice + productTotal - discount));
        const vat = r2((gross * 0.05) / 1.05);
        const tip = chance(0.35) ? int(1, 6) * 5 : 0;
        const total = r2(gross + tip);
        const method = pick(PAY_METHODS);
        const issuedAt = addMinutes(date, slot, minutes);
        const invoiceNo = `INV-${year}-${String(++invoiceSeq).padStart(5, "0")}`;
        invoiceCount++;

        rowsInvoices.push([uid(), invoiceNo, bookingId, branchId, clientName, clientPhone,
          JSON.stringify(items), gross, discount, tip, vat, total, method,
          branchId === "b1" ? "st1" : "st2", couponCode, issuedAt]);

        if (couponCode) {
          rowsRedemptions.push([uid(), couponCode === "WELCOME10" ? couponIds.welcome : couponIds.ramadan,
            `booking:${bookingId}`, couponDiscount, clientRowId, issuedAt]);
        }

        /* ---- loyalty: 1 point per dirham spent, same rule as checkout ---- */
        if (clientRowId) {
          const accId = accountIds.get(clientRowId)!;
          const pts = Math.floor(gross);
          points.set(accId, (points.get(accId) ?? 0) + pts);
          rowsPoints.push([uid(), accId, bookingId, pts, "service_checkout", issuedAt]);
        }

        /* ---- feedback: an invite goes out for every visit, ~55% come back ---- */
        const answered = chance(0.55);
        const rating = answered ? (rnd() < 0.62 ? 5 : rnd() < 0.75 ? 4 : rnd() < 0.85 ? 3 : int(1, 2)) : null;
        rowsReviews.push([uid(), bookingId, barberId, branchId, clientRowId, clientName,
          randomBytes(12).toString("hex"), rating,
          answered && rating! >= 3 ? pick(REVIEW_COMMENTS) : answered ? "Cut was rushed, not what I asked for." : null,
          answered ? addMinutes(date, slot, minutes + int(30, 600)) : null,
          issuedAt]);
        if (answered) reviewCount++;

        /* ---- notification trail for the last week only (keeps the outbox readable) ---- */
        if (back <= 7) {
          for (const [kind, offset] of [["confirmation", -1440], ["reminder", -120], ["feedback", minutes + 15]] as const) {
            rowsNotifications.push([uid(), bookingId, clientPhone,
              kind,
              kind === "confirmation" ? `Dastaan: your booking with ${staff.find((s) => s[0] === barberId)![1]} is confirmed for ${slot}.`
                : kind === "reminder" ? `Dastaan: see you at ${slot} today.`
                : `Dastaan: thanks for visiting. How did we do?`,
              addMinutes(date, slot, offset), "sent", 1,
              addMinutes(date, slot, offset), createdAt]);
          }
        }
      }
    }
  }

  process.stdout.write(" done\n");

  /* ---------- write it all, in a handful of round trips ---------- */
  process.stdout.write("Writing to the database ");
  const flush = async (label: string, tableName: string, cols: string[], rows: unknown[][]) => {
    await bulkInsert(tableName, cols, rows);
    process.stdout.write("·");
    return `${rows.length} ${label}`;
  };

  const written: string[] = [];
  written.push(await flush("appointments", "bookings",
    ["id", "branch_id", "barber_id", "client_id", "client_name", "client_phone", "service_ids",
     "starts_at", "minutes", "status", "online", "paid", "cancel_reason", "created_at", "updated_at"],
    rowsBookings));
  written.push(await flush("invoices", "invoices",
    ["id", "invoice_no", "booking_id", "branch_id", "client_name", "client_phone", "items",
     "gross", "discount", "tip", "vat", "total", "payment_method", "issued_by", "coupon_code", "created_at"],
    rowsInvoices));
  written.push(await flush("feedback invites", "reviews",
    ["id", "booking_id", "barber_id", "branch_id", "client_id", "client_name", "token",
     "rating", "comment", "submitted_at", "created_at"],
    rowsReviews));
  written.push(await flush("messages", "notifications",
    ["id", "booking_id", "to_phone", "kind", "body", "scheduled_at", "status", "attempts", "sent_at", "created_at"],
    rowsNotifications));
  written.push(await flush("points entries", "points_transactions",
    ["id", "account_id", "booking_id", "delta", "reason", "created_at"],
    rowsPoints));
  written.push(await flush("code redemptions", "coupon_redemptions",
    ["id", "coupon_id", "context", "amount_saved", "client_id", "created_at"],
    rowsRedemptions));
  written.push(await flush("stock movements", "stock_movements",
    ["id", "product_id", "branch_id", "delta", "reason", "note", "actor_id", "created_at"],
    rowsMovements));
  process.stdout.write(" done\n");

  /* the invoice counter has to end up where the numbering left off, so the
     next real checkout carries on from INV-<year>-00446 rather than 00001 */
  await db.prepare(
    `INSERT INTO counters (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`invoice:${year}`, invoiceSeq);

  /* apply the six weeks of retail sales to the stock on hand */
  const stockUpdates: [string, string, number][] = [];
  for (const [key, qty] of stockSold) {
    const [pid, bid] = key.split(":") as [string, string];
    const opening = openingStock.find((s) => s[0] === pid && s[1] === bid)?.[2] ?? 0;
    stockUpdates.push([pid, bid, Math.max(0, opening - qty + int(6, 20))]);
  }
  if (stockUpdates.length > 0) {
    /* one UPDATE ... FROM (VALUES ...) rather than one round trip per line */
    const tuples = stockUpdates.map(() => "(?,?,?)").join(",");
    /* the casts matter: parameters inside VALUES arrive untyped, and Postgres
       then infers text, which will not assign to an integer column */
    await db.prepare(
      `UPDATE stock_levels AS sl SET qty = v.qty::int
       FROM (VALUES ${tuples}) AS v(product_id, branch_id, qty)
       WHERE sl.product_id = v.product_id::text AND sl.branch_id = v.branch_id::text`
    ).run(...stockUpdates.flat());
  }
  /* …but keep the two deliberately-low lines low, so the reorder warning shows */
  await db.prepare("UPDATE stock_levels SET qty = 3 WHERE product_id = 'p4' AND branch_id = 'b1'").run();
  await db.prepare("UPDATE stock_levels SET qty = 2 WHERE product_id = 'p8' AND branch_id = 'b2'").run();

  /* ---------- the online shop's warehouse ----------
     Its own stock, bought in its own right — not carved out of any branch.
     Deeper than a shelf because it serves the whole country from one place,
     and one line (p8) is left low so the reorder warning has something to
     show on the shop manager's screen. */
  const onlineOpening: [string, number, number][] = [
    ["p1", 46, 12], ["p2", 60, 15], ["p3", 38, 10],
    ["p4", 28, 8], ["p5", 14, 4], ["p6", 7, 10],
  ];
  await bulkInsert("online_stock", ["product_id", "qty", "reserved", "reorder_at", "updated_at"],
    onlineOpening.map(([pid, qty, reorder]) => [pid, qty, 0, reorder, at(dayOffset(-HISTORY_DAYS), "09:30")]));
  await bulkInsert("online_stock_movements",
    ["id", "product_id", "delta", "reason", "note", "actor_id", "created_at"],
    onlineOpening.map(([pid, qty]) =>
      [uid(), pid, qty, "received", "Opening warehouse count", "shop1", at(dayOffset(-HISTORY_DAYS), "09:30")]));

  await db.prepare("UPDATE coupons SET uses = ? WHERE id = ?").run(couponUses.welcome, couponIds.welcome);
  await db.prepare("UPDATE coupons SET uses = ? WHERE id = ?").run(couponUses.ramadan, couponIds.ramadan);

  for (const [accId, pts] of points)
    await db.prepare("UPDATE loyalty_accounts SET points = ?, lifetime_points = ? WHERE id = ?").run(pts, pts, accId);

  /* ---------- today: a full, believable day on the calendar ---------- */

  const today = dayOffset(0);
  /* [barber, registered userId | null, walk-in index, services, start, status, online, paid] */
  const todays: [string, string | null, number, string[], string, string, number, number][] = [
    ["br1", null, 3, ["s1"], "10:15", "Arrived", 0, 0],
    ["br1", "omar.f", -1, ["s2", "s4"], "12:00", "Confirmed", 1, 1],
    ["br1", null, 17, ["s5"], "16:30", "Booked", 1, 0],
    ["br2", null, 26, ["s3"], "10:30", "Started", 0, 1],
    ["br2", "demo", -1, ["s3"], "13:30", "Confirmed", 1, 0],
    ["br2", null, 41, ["s6"], "15:00", "Confirmed", 1, 1],
    ["br3", null, 8, ["s1"], "11:00", "Confirmed", 0, 0],
    ["br3", "faizan.q", -1, ["s3", "s9"], "14:15", "Booked", 1, 0],
    ["br3", "kamal.h", -1, ["s4"], "17:40", "Booked", 0, 0],
    ["br4", "marwan.a", -1, ["s8", "s9"], "10:45", "No Show", 1, 0],
    ["br4", "yasser.z", -1, ["s2"], "13:00", "Confirmed", 0, 0],
    ["br4", null, 52, ["s10"], "16:00", "Booked", 1, 0],
    ["br7", "hamza.s", -1, ["s2", "s4"], "11:30", "Confirmed", 1, 1],
    ["br7", null, 12, ["s10"], "15:00", "Booked", 0, 0],
    ["br8", "zaid.m", -1, ["s11"], "10:30", "Arrived", 1, 0],
    ["br8", "rashid.n", -1, ["s12"], "14:00", "Booked", 1, 0],
    ["br5", null, 33, ["s2"], "11:15", "Confirmed", 1, 0],
    ["br5", null, 7, ["s6"], "14:45", "Booked", 1, 0],
    ["br9", null, 21, ["s1"], "12:30", "Arrived", 0, 0],
    ["br9", null, 48, ["s5"], "18:00", "Booked", 1, 0],
    ["br6", null, 15, ["s3"], "16:15", "Booked", 0, 0],
  ];

  /* plus the next three days, so tomorrow's diary isn't blank either */
  const upcoming: [number, string, string | null, number, string[], string][] = [
    [1, "br1", "demo", -1, ["s1"], "11:00"],
    [1, "br3", null, 52, ["s2"], "13:15"],
    [1, "br7", "zaid.m", -1, ["s6"], "16:00"],
    [1, "br9", null, 33, ["s3"], "12:00"],
    [2, "br2", "hamza.s", -1, ["s10"], "10:30"],
    [2, "br4", null, 4, ["s2", "s4"], "15:30"],
    [2, "br5", "omar.f", -1, ["s5"], "17:00"],
    [3, "br1", null, 8, ["s1"], "12:45"],
    [3, "br8", "yasser.z", -1, ["s3"], "18:30"],
  ];

  const todayRows: unknown[][] = [];
  const branchOfBarber = (id: string) => (barbersOf.b1.includes(id) ? "b1" : "b2");

  for (const [barberId, userId, walkIdx, basket, slot, status, online, paid] of todays) {
    const clientRowId = userId ? clientIds.get(userId)! : null;
    const name = userId ? clients.find(([u]) => u === userId)![1] : walkIns[walkIdx]![0];
    const phone = userId ? clients.find(([u]) => u === userId)![2] : walkIns[walkIdx]![1];
    const minutes = basket.reduce((m, s) => m + (serviceMinutes.get(s) ?? 45), 0);
    todayRows.push([uid(), branchOfBarber(barberId), barberId, clientRowId, name, phone,
      JSON.stringify(basket), at(today, slot), minutes, status, online, paid,
      at(dayOffset(-int(1, 5)), "19:30"), now()]);
  }

  /* ---------- the next 30 days ----------

     A forward diary, not more history. Two rules make it believable rather
     than merely present:

     1. Nothing in the future has happened yet. Future appointments are only
        ever Booked or Confirmed — never Arrived, Started, No Show or paid —
        and they carry no invoice, no review and no loyalty points. Those are
        things that happen on the day, and a seed that invents them produces
        a database the application itself could never have written.

     2. No barber is ever double-booked. The generator keeps the busy ranges
        it has already placed and applies the same overlap test the API uses,
        so every row here is a booking the API would have accepted. Without
        this a 120-minute ritual at 15:15 quietly swallows the 16:00 slot and
        the calendar draws two cards on top of each other.

     The diary also thins out with distance, because a real one does: next
     week is nearly full, the fourth week is a handful of early birds. */
  const FUTURE_DAYS = 30;
  const minuteOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  type Range = { from: number; to: number };
  const busyBy = new Map<string, Range[]>(); // `${barberId}:${date}` -> ranges
  const isFree = (key: string, from: number, minutes: number) =>
    !(busyBy.get(key) ?? []).some((b) => from < b.to && b.from < from + minutes);
  const hold = (key: string, from: number, minutes: number) => {
    const list = busyBy.get(key) ?? [];
    list.push({ from, to: from + minutes });
    busyBy.set(key, list);
  };

  /* Every registered client gets two or three appointments to look forward
     to — enough that each of them has something in their own account, and no
     more than that, because a man does not have twelve haircuts in a month.
     Nine accounts cannot fill a forward book on their own; once this pool is
     spent the rest are bookings reception took by name over the phone, which
     is what the remainder of a real diary is anyway. */
  const upcomingRegulars: Visitor[] = [];
  for (const [userId, name, phone] of clients)
    for (let k = 0; k < int(2, 3); k++)
      upcomingRegulars.push({ clientRowId: clientIds.get(userId)!, name, phone });
  for (let i = upcomingRegulars.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [upcomingRegulars[i], upcomingRegulars[j]] = [upcomingRegulars[j]!, upcomingRegulars[i]!];
  }
  let regAt = 0;
  const nextRegular = (): Visitor | null =>
    regAt < upcomingRegulars.length ? upcomingRegulars[regAt++]! : null;

  let futureCount = 0;
  process.stdout.write(`Writing ${FUTURE_DAYS} days ahead `);
  for (let ahead = 1; ahead <= FUTURE_DAYS; ahead++) {
    if (ahead % 5 === 0) process.stdout.write("·");
    const date = dayOffset(ahead);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const busy = weekday === 5 || weekday === 6 || weekday === 0; // Fri–Sun in the UAE

    /* how far ahead people have actually booked: a full week, a thinner
       second and third, and only the committed regulars beyond that */
    const reach = ahead <= 7 ? 1 : ahead <= 14 ? 0.6 : ahead <= 21 ? 0.35 : 0.18;

    for (const branchId of ["b1", "b2"] as const) {
      const base = branchId === "b1" ? (busy ? 9 : 6) : (busy ? 6 : 4);
      const capacity = Math.max(0, Math.round(base * reach));
      if (capacity === 0) continue;

      /* the last two slots are 20:30 and 21:15 — City Centre shuts at 22:00,
         so it never takes the late one */
      const openSlots = branchId === "b2" ? SLOTS.slice(0, -1) : SLOTS;
      const slots = [...openSlots].sort(() => rnd() - 0.5).slice(0, capacity);

      for (const slot of slots) {
        const barberId = pick(barbersOf[branchId]);
        const basket = pick(baskets);
        const minutes = basket.reduce((m, s) => m + (serviceMinutes.get(s) ?? 45), 0);
        const key = `${barberId}:${date}`;
        const from = minuteOf(slot);

        /* the same test the API runs before it accepts a booking */
        if (!isFree(key, from, minutes)) continue;
        /* and nobody starts a service they cannot finish before closing */
        const closes = branchId === "b1" ? 23 * 60 : 22 * 60;
        if (from + minutes > closes) continue;
        hold(key, from, minutes);

        /* Who books ahead is not who walks in. The history pool is mostly
           walk-ins, because that is who fills a salon day to day — but a
           walk-in by definition does not book three weeks out. The forward
           book leans on people with accounts, who are the ones using the
           site, plus phone bookings reception takes by name. */
        /* Who books ahead is not who walks in. The history pool is mostly
           walk-ins, because that is who fills a salon day to day — but a
           walk-in by definition does not book three weeks out. Take a
           registered client while any are left, then fall back. */
        const { clientRowId, name, phone } =
          (chance(0.45) ? nextRegular() : null) ?? nextVisitor();
        /* close in, the desk has already rung round to confirm; further out
           it is still just a booking in the book */
        const status = ahead <= 5 ? (chance(0.75) ? "Confirmed" : "Booked") : "Booked";
        /* more of the forward book comes through the site than the old
           history did — that is the point of having a website */
        const online = chance(0.55) ? 1 : 0;
        /* booked somewhere between today and a fortnight ago, never after
           the appointment itself */
        const createdAt = at(dayOffset(-int(0, Math.min(14, ahead + 3))), pick(["11:20", "14:05", "18:40", "20:10"]));

        todayRows.push([uid(), branchId, barberId, clientRowId, name, phone,
          JSON.stringify(basket), at(date, slot), minutes, status, online, 0,
          createdAt, createdAt]);
        futureCount++;
      }
    }
  }
  process.stdout.write(" done\n");

  await bulkInsert("bookings",
    ["id", "branch_id", "barber_id", "client_id", "client_name", "client_phone", "service_ids",
     "starts_at", "minutes", "status", "online", "paid", "created_at", "updated_at"], todayRows);

  /* ---------- store orders, one in each state ---------- */

  /* Every online order is delivered, so each one carries an address and
     nothing else — no branch, no collection slot. Stock comes off the
     warehouse, never a shelf. */
  const orderSpecs: [string, string, [string, number][], string, number, string | null][] = [
    ["omar.f", "Marina Gate 2, Apt 1104, Dubai Marina", [["p1", 1], ["p3", 1]], "fulfilled", -12, null],
    ["demo", "Villa 22, Al Barsha South 2, Dubai", [["p2", 2]], "fulfilled", -8, "WELCOME10"],
    ["hamza.s", "Burj Views C, Apt 906, Downtown Dubai", [["p5", 1]], "paid", -3, null],
    ["zaid.m", "Al Nahda Tower, Apt 502, Sharjah", [["p4", 1], ["p6", 1]], "placed", -1, null],
    ["faizan.q", "Reem Island, Sky Tower 1808, Abu Dhabi", [["p2", 1]], "cancelled", -5, null],
  ];
  const orderRows: unknown[][] = [];
  const orderMovementRows: unknown[][] = [];
  const onlineHolds = new Map<string, number>();
  let orderSeq = 0;
  for (const [userId, address, lines, status, back, coupon] of orderSpecs) {
    const items = lines.map(([pid, qty]) => ({
      productId: pid, name: productName.get(pid)!, qty, price: productPrice.get(pid)!,
    }));
    const subtotal = r2(items.reduce((s, i) => s + i.price * i.qty, 0));
    const discount = coupon ? r2(subtotal * 0.1) : 0;
    const total = r2(subtotal - discount);
    const vat = r2((total * 0.05) / 1.05);
    const placedAt = at(dayOffset(back), "20:10");
    orderRows.push([uid(), `ORD-${year}-${String(++orderSeq).padStart(5, "0")}`,
      clientIds.get(userId)!, JSON.stringify(items), subtotal, discount, coupon, vat, total,
      status, address, placedAt, placedAt]);

    /* shipped: stock has really left the warehouse and the ledger says so */
    if (status === "fulfilled")
      for (const [pid, qty] of lines)
        orderMovementRows.push([uid(), pid, -qty, "online_sale", "Order shipped", "shop1", placedAt]);
    /* paid or placed but not yet shipped: the stock is still there, but held */
    if (status === "paid" || status === "placed")
      for (const [pid, qty] of lines) onlineHolds.set(pid, (onlineHolds.get(pid) ?? 0) + qty);
  }

  await bulkInsert("orders",
    ["id", "order_no", "client_id", "items", "subtotal", "discount", "coupon_code", "vat", "total",
     "status", "address", "created_at", "updated_at"], orderRows);
  await bulkInsert("online_stock_movements",
    ["id", "product_id", "delta", "reason", "note", "actor_id", "created_at"], orderMovementRows);

  /* the shipped ones actually leave, and the unshipped ones stay held */
  for (const row of orderMovementRows)
    await db.prepare("UPDATE online_stock SET qty = qty + ? WHERE product_id = ?").run(row[2], row[1]);
  for (const [pid, qty] of onlineHolds)
    await db.prepare("UPDATE online_stock SET reserved = reserved + ? WHERE product_id = ?").run(qty, pid);
  await db.prepare(
    `INSERT INTO counters (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`order:${year}`, orderSeq);

  /* ---------- archive the past fortnight so the Timeline view has history ---------- */

  for (let back = 14; back >= 1; back--) await snapshotDay(dayOffset(-back));

  /* ---------- done ---------- */

  const revenue = await db.prepare("SELECT SUM(total) AS t FROM invoices").get() as { t: number };
  console.log(
    `Seeded a demo-ready salon:\n` +
    `  · ${HISTORY_DAYS} days of history · ${invoiceCount} invoices · AED ${Math.round(Number(revenue.t)).toLocaleString()} revenue\n` +
    `  · ${todays.length} appointments today · ${futureCount} booked over the next ${FUTURE_DAYS} days\n` +
    `  · ${reviewCount} ratings · ${clients.length} registered clients · 14 archived timeline days\n` +
    `  Owner 9999 · Reception 1111 (Marina) / 1212 (City Centre) · Barbers 2222 3333 4444 5555 6666 7777 6161 6262 6363\n` +
    `  Client login: demo / demo1234 (all demo clients share that password)\n` +
    `  Online shop login: shop / shop1234 (its own door at /shop — not the team keypad)\n` +
    `  Coupons: WELCOME10 (10%) · GROOM25 (AED 25 off services) · SUMMER15 (expired, for the disabled state)`
  );
};

/* One transaction for the whole thing. It writes ~1,500 rows, and over a
   hosted pooler that takes a couple of minutes — long enough for a dropped
   connection or an impatient Ctrl+C. Without a transaction each statement
   auto-commits, so an interruption leaves a half-built database that still
   looks seeded. Wrapped like this it is all-or-nothing, and materially
   faster too, since there is one commit instead of fifteen hundred. */
try {
  await db.transaction(run);
} catch (err) {
  console.error(
    "\nSeed failed — nothing was written, the database is exactly as you found it.\n" +
    "Fix the cause and run it again.\n"
  );
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
}
await closeDb().catch(() => {});
