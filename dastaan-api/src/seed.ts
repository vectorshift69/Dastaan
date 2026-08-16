/* Demo seed — run once: npm run seed */
import { db, migrate, uid, now } from "./db.js";
import { hmacCode, hashPassword } from "./security.js";

migrate();

const branches = [
  ["b1", "Dastaan — Marina Walk", "Dubai Marina", "Marina Walk, Tower 4, Ground Floor", "Daily 10:00 – 23:00", "+971 4 000 0001"],
  ["b2", "Dastaan — City Centre", "Deira", "City Centre Boulevard, Unit 12", "Daily 10:00 – 22:00", "+971 4 000 0002"],
];

const services: [string, string, number, number, string][] = [
  ["s1", "Skin Fade & Beard", 75, 268, "Combos"],
  ["s2", "Classic Haircut", 45, 150, "Hair"],
  ["s11", "Ladies' Cut & Style", 60, 220, "Ladies"],
  ["s3", "Skin Fade / Taper Fade", 50, 180, "Hair"],
  ["s12", "Blow Dry & Styling", 45, 140, "Ladies"],
  ["s4", "Beard Trim & Line Up", 30, 95, "Beard"],
  ["s13", "Full Hair Colour", 90, 380, "Colour"],
  ["s5", "Hot Towel Shave", 40, 120, "Beard"],
  ["s14", "Manicure & Pedicure", 60, 180, "Nails"],
  ["s6", "Haircut & Hot Towel Shave", 80, 240, "Combos"],
  ["s15", "Keratin Treatment", 120, 550, "Ladies"],
  ["s7", "Kids Cut (under 12)", 30, 90, "Hair"],
  ["s8", "Black Mask Facial", 35, 110, "Grooming"],
  ["s9", "Head Massage", 20, 70, "Grooming"],
  ["s10", "Full Grooming Ritual", 120, 420, "Combos"],
];

// [id, name, title, branch, code]
const staff: [string, string, string, string, string, string][] = [
  ["st1", "Aisha Rahman", "Receptionist", "b1", "1111", "admin"],
  ["br1", "Aqib Khan", "Master Barber", "b1", "2222", "barber"],
  ["br7", "Leonora Filipe", "Senior Stylist", "b1", "3333", "barber"],
  ["br3", "Mouawia Majzoub", "Master Barber", "b1", "4444", "barber"],
  ["br8", "Amira Hadid", "Colour Specialist", "b1", "5555", "barber"],
  ["br2", "Ali Raza", "Senior Barber", "b1", "6666", "barber"],
  ["br4", "Azeem Aslam", "Barber & Stylist", "b1", "7777", "barber"],
  ["br5", "Yousuf Mirza", "Senior Barber", "b2", "6161", "barber"],
  ["br9", "Rania Aziz", "Ladies' Stylist", "b2", "6262", "barber"],
  ["br6", "Hassan Adel", "Barber", "b2", "6363", "barber"],
  ["own1", "Owner", "Super Admin", "b1", "9999", "super_admin"],
];

const today = new Date().toISOString().slice(0, 10);
const at = (t: string) => `${today}T${t}:00`;

// [barber, client, phone, services, start, minutes, status, online, paid]
const bookings: [string, string, string, string[], string, number, string, number, number][] = [
  ["br1", "Sumit Verma", "+971 50 002 1226", ["s1"], "10:15", 75, "Arrived", 0, 0],
  ["br1", "Alberto Bustani", "+971 55 133 8721", ["s2", "s4"], "12:00", 75, "Confirmed", 1, 1],
  ["br1", "Mikel Simmonds", "+971 52 774 0913", ["s5"], "16:30", 40, "Booked", 1, 0],
  ["br2", "Ish Guleri", "+971 54 660 2284", ["s3"], "10:30", 50, "Started", 0, 1],
  ["br2", "S. S. Radwan", "+971 50 918 5567", ["s3"], "13:30", 50, "Booked", 0, 0],
  ["br2", "Lutfar Hawlader", "+971 56 401 7789", ["s6"], "15:00", 80, "Confirmed", 1, 1],
  ["br3", "Majid Akram", "+971 50 552 6614", ["s1"], "11:00", 75, "Confirmed", 0, 0],
  ["br3", "Faizan Qureshi", "+971 55 209 4432", ["s3", "s9"], "14:15", 70, "Booked", 1, 0],
  ["br3", "Kamal Hussain", "+971 52 883 2245", ["s4"], "17:40", 30, "Booked", 0, 1],
  ["br4", "Marwan Adel", "+971 50 776 9911", ["s8", "s9"], "10:45", 55, "No Show", 1, 0],
  ["br4", "Yasser Zaman", "+971 54 332 8080", ["s2"], "13:00", 45, "Confirmed", 0, 0],
  ["br4", "Omar Al-Farsi", "+971 55 660 1188", ["s10"], "16:00", 120, "Booked", 1, 1],
  ["br7", "Fatima Al-Nuaimi", "+971 50 441 7789", ["s11", "s12"], "11:30", 105, "Confirmed", 1, 1],
  ["br7", "Sara Mansour", "+971 55 782 3310", ["s15"], "15:00", 120, "Booked", 0, 0],
  ["br8", "Reem Khalifa", "+971 52 990 4471", ["s13"], "10:30", 90, "Arrived", 1, 0],
  ["br8", "Noor Haddad", "+971 54 118 6620", ["s14"], "14:00", 60, "Booked", 1, 1],
];

const run = async () => {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM branches").get() as { n: number };
  if (existing.n > 0) {
    console.log("Already seeded — delete data/dastaan.db to reseed.");
    return;
  }

  for (const b of branches)
    db.prepare("INSERT INTO branches (id,name,area,address,hours,phone) VALUES (?,?,?,?,?,?)").run(...b);
  for (const s of services)
    db.prepare("INSERT INTO services (id,name,minutes,price,category) VALUES (?,?,?,?,?)").run(...s);
  for (const [id, name, title, branch, code, role] of staff)
    db.prepare("INSERT INTO users (id,role,name,title,branch_id,code_hmac,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, role, name, title, branch, hmacCode(code), now());

  const demoId = uid();
  db.prepare("INSERT INTO users (id,role,user_id,name,phone,password_hash,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(demoId, "client", "demo", "Demo Client", "+971 50 000 0000", await hashPassword("demo1234"), now());
  // demo loyalty: Gold tier with history
  const accId = uid();
  db.prepare("INSERT INTO loyalty_accounts (id, client_id, qr_token, points, lifetime_points, created_at) VALUES (?,?,?,?,?,?)")
    .run(accId, demoId, "demotoken00000000000000000000000", 5800, 5800, now());
  db.prepare("INSERT INTO points_transactions (id, account_id, delta, reason, created_at) VALUES (?,?,?,?,?)")
    .run(uid(), accId, 5800, "migration_from_fresha", now());

  for (const [barber, client, phone, svc, start, minutes, status, online, paid] of bookings) {
    const branch = (db.prepare("SELECT branch_id FROM users WHERE id = ?").get(barber) as { branch_id: string }).branch_id;
    db.prepare(
      `INSERT INTO bookings (id,branch_id,barber_id,client_name,client_phone,service_ids,starts_at,minutes,status,online,paid,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uid(), branch, barber, client, phone, JSON.stringify(svc), at(start), minutes, status, online, paid, now(), now());
  }

  // products: retail (sellable online + POS) and in-salon supplies
  const products: [string, string, string, string, "retail" | "supply", number][] = [
    ["p1", "Argan Repair Serum", "DST-ARG-01", "Hair care", "retail", 120],
    ["p2", "Matte Clay Pomade", "DST-POM-01", "Styling", "retail", 85],
    ["p3", "Beard Elixir No. 4", "DST-BRD-04", "Beard care", "retail", 95],
    ["p4", "Silk Colour-Care Shampoo", "DST-SHP-02", "Hair care", "retail", 70],
    ["p5", "Straight Razor Kit", "DST-RZR-01", "Tools", "retail", 240],
    ["p6", "Keratin Home Mask", "DST-KRT-01", "Treatments", "retail", 150],
    ["p7", "Barbicide Concentrate", null as unknown as string, "Sanitation", "supply", 0],
    ["p8", "Neck Strips (box)", null as unknown as string, "Consumables", "supply", 0],
    ["p9", "Colour Developer 6%", null as unknown as string, "Colour bar", "supply", 0],
  ];
  for (const [id, name, sku, category, kind, price] of products)
    db.prepare("INSERT INTO products (id,name,sku,category,kind,price,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, name, sku, category, kind, price, now());
  for (const [id] of products)
    for (const b of ["b1", "b2"])
      db.prepare("INSERT INTO stock_levels (product_id, branch_id, qty, reorder_at) VALUES (?,?,?,?)")
        .run(id, b, 12, 5);

  // starter coupon: 10% off anything, max 100 uses
  db.prepare(
    "INSERT INTO coupons (id, code, type, value, scope, min_amount, max_uses, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(uid(), "WELCOME10", "percent", 10, "both", 50, 100, now());

  console.log("Seeded. Staff codes: 1111 reception · 2222 Aqib · 9999 owner (all listed in README). Client: demo / demo1234. Coupon: WELCOME10");
};

await run();
