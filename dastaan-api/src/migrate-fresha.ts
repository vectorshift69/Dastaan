/* ------------------------------------------------------------------ */
/* One-off migration: brings the salon's real Fresha data into Dastaan. */
/*                                                                      */
/* Source: fresha_migration_data.md (scraped from the live Fresha       */
/* workspace on 2026-09-10) — branch/location, staff, services and the  */
/* full 75-line product list.                                           */
/*                                                                      */
/* Client records are deliberately NOT included. That file only carries */
/* aggregate stats for the 4,783 clients (counts by gender, referral    */
/* source, etc.) — no actual names, phones or emails. Fabricating that  */
/* many plausible-looking client rows would plant fake people in a real */
/* business's customer database, so this script does nothing with      */
/* clients until it is pointed at the real export (Fresha Admin →       */
/* Business Setup → Clients List → Export CSV) via CLIENTS_CSV below.   */
/*                                                                      */
/* Safe to run more than once: every insert targets a deterministic id  */
/* and uses ON CONFLICT DO NOTHING, so a second run changes nothing.    */
/* Existing rows (including the demo seed's) are never touched or       */
/* wiped — this only adds rows that aren't there yet.                   */
/* ------------------------------------------------------------------ */

import "./load-env.js"; // MUST be first
import { readFileSync, existsSync } from "node:fs";
import { db, migrate, now, closeDb } from "./db.js";
import { hmacCode } from "./security.js";

await migrate();

const BRANCH_ID = "b1";

/* Point this at the real per-client Fresha export if/when you have it —
   see the note above. Left unset, client migration is skipped entirely. */
const CLIENTS_CSV = process.env.CLIENTS_CSV ?? "";

/* ---------------- id helpers ---------------- */

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const seenIds = new Set<string>();
const uniqueId = (prefix: string, ...parts: (string | number)[]): string => {
  const base = `${prefix}-${slugify(parts.join("-"))}`;
  let id = base;
  let n = 2;
  while (seenIds.has(id)) id = `${base}-${n++}`;
  seenIds.add(id);
  return id;
};

/* ------------------------------------------------------------------ */
/* Services — 83 rows, transcribed from fresha_migration_data.md §4.    */
/* A "30–45 min" range in the source becomes the upper bound, so the    */
/* booking wizard never under-times a slot.                             */
/* ------------------------------------------------------------------ */

type ServiceRow = { name: string; minutes: number; price: number; category: string };

const services: ServiceRow[] = [
  // Combo Hair & Beard
  { name: "Skin Fade & Beard", minutes: 75, price: 268, category: "Combo Hair & Beard" },
  { name: "Classic Haircut & Beard", minutes: 60, price: 248, category: "Combo Hair & Beard" },
  { name: "Haircut & Royal Shave", minutes: 75, price: 348, category: "Combo Hair & Beard" },
  // Packages
  { name: "Haircut and Hair Colour", minutes: 60, price: 388, category: "Packages" },
  { name: "Signature Service", minutes: 80, price: 288, category: "Packages" },
  { name: "Dastaan Express", minutes: 35, price: 128, category: "Packages" },
  { name: "Ultimate Dastaan Grooming", minutes: 185, price: 658, category: "Packages" },
  { name: "Dastaan Package", minutes: 120, price: 478, category: "Packages" },
  { name: "Dastaan Bundle", minutes: 80, price: 288, category: "Packages" },
  // Hair Services
  { name: "classic haircut", minutes: 45, price: 148, category: "Hair Services" },
  { name: "Skin Fade / Taper Fade", minutes: 45, price: 168, category: "Hair Services" },
  { name: "Long Haircut", minutes: 45, price: 178, category: "Hair Services" },
  { name: "Executive Makeover (Hair restyle)", minutes: 60, price: 250, category: "Hair Services" },
  { name: "Buzz Cut Or Head Shave", minutes: 45, price: 108, category: "Hair Services" },
  { name: "Kids Hair Cut (Below 11 y/o)", minutes: 45, price: 108, category: "Hair Services" },
  { name: "Washing and Styling", minutes: 20, price: 88, category: "Hair Services" },
  { name: "Neck Clean Up", minutes: 15, price: 48, category: "Hair Services" },
  { name: "Hairline Shape-Up", minutes: 15, price: 48, category: "Hair Services" },
  // Beard Service
  { name: "Traditional Shave", minutes: 30, price: 148, category: "Beard Service" },
  { name: "Dastaan Royal Shave", minutes: 45, price: 208, category: "Beard Service" },
  { name: "Traditional Shave and Beard Colour", minutes: 75, price: 248, category: "Beard Service" },
  { name: "Beard Trim (no fade no blade)", minutes: 30, price: 105, category: "Beard Service" },
  { name: "Beard Trim And Line Up", minutes: 30, price: 88, category: "Beard Service" },
  // Braiding
  { name: "Braids Full Hair", minutes: 90, price: 508, category: "Braiding" },
  { name: "Braids Full Hair (with extension)", minutes: 120, price: 700, category: "Braiding" },
  { name: "Braids Half Hair", minutes: 60, price: 350, category: "Braiding" },
  { name: "Braid Half Hair (with extension)", minutes: 90, price: 500, category: "Braiding" },
  // Coloring
  { name: "Bleaching Color", minutes: 60, price: 800, category: "Coloring" },
  { name: "Highlight", minutes: 60, price: 318, category: "Coloring" },
  { name: "Hair Colour", minutes: 45, price: 288, category: "Coloring" },
  { name: "Beard Colour", minutes: 45, price: 108, category: "Coloring" },
  { name: "Moustache Colour", minutes: 15, price: 58, category: "Coloring" },
  { name: "Eyebrow Color", minutes: 15, price: 58, category: "Coloring" },
  // Massage
  { name: "Head Massage", minutes: 60, price: 148, category: "Massage" },
  { name: "Head Massage", minutes: 20, price: 98, category: "Massage" },
  { name: "Full Body Massage", minutes: 60, price: 298, category: "Massage" },
  { name: "Back/Shoulder Massage", minutes: 60, price: 178, category: "Massage" },
  { name: "Back/Shoulder Massage", minutes: 30, price: 148, category: "Massage" },
  { name: "Back/Shoulder Massage", minutes: 20, price: 118, category: "Massage" },
  { name: "Arms Massage", minutes: 30, price: 88, category: "Massage" },
  { name: "Legs Massage", minutes: 60, price: 178, category: "Massage" },
  { name: "Legs Massage", minutes: 30, price: 108, category: "Massage" },
  { name: "Legs Massage", minutes: 20, price: 88, category: "Massage" },
  // Manicure and Pedicure
  { name: "Manicure", minutes: 30, price: 105, category: "Manicure and Pedicure" },
  { name: "Pedicure", minutes: 45, price: 130, category: "Manicure and Pedicure" },
  { name: "Manicure and Pedicure", minutes: 80, price: 210, category: "Manicure and Pedicure" },
  { name: "Express Manicure", minutes: 15, price: 68, category: "Manicure and Pedicure" },
  { name: "Express Pedicure", minutes: 20, price: 88, category: "Manicure and Pedicure" },
  { name: "Express Manicure & Pedicure", minutes: 30, price: 158, category: "Manicure and Pedicure" },
  { name: "Junior Pedicure", minutes: 25, price: 78, category: "Manicure and Pedicure" },
  { name: "Junior Manicure", minutes: 20, price: 58, category: "Manicure and Pedicure" },
  // Facial
  { name: "Peel-Off Collagen Mask", minutes: 20, price: 128, category: "Facial" },
  { name: "Golden Mask", minutes: 15, price: 100, category: "Facial" },
  { name: "Gold Mask with Express Facial", minutes: 30, price: 238, category: "Facial" },
  { name: "Express Facial", minutes: 15, price: 138, category: "Facial" },
  { name: "Cleansing Facial", minutes: 30, price: 258, category: "Facial" },
  { name: "Antiage Facial", minutes: 45, price: 525, category: "Facial" },
  // Treatment
  { name: "ISON Protein Treatment – Short Hair", minutes: 75, price: 558, category: "Treatment" },
  { name: "Scalp Treatment", minutes: 25, price: 248, category: "Treatment" },
  { name: "Ultimate Hair Treatment", minutes: 30, price: 158, category: "Treatment" },
  { name: "ISON Protein Treatment – Long Hair", minutes: 90, price: 800, category: "Treatment" },
  { name: "Keratin – Long Hair", minutes: 75, price: 800, category: "Treatment" },
  { name: "Keratin – Short Hair", minutes: 60, price: 558, category: "Treatment" },
  { name: "Paraffin (Hands)", minutes: 30, price: 138, category: "Treatment" },
  { name: "Paraffin (Feet)", minutes: 30, price: 148, category: "Treatment" },
  // Machine Shaving – Body
  { name: "Full Body Clipper", minutes: 60, price: 368, category: "Machine Shaving – Body" },
  { name: "Legs Clipper", minutes: 30, price: 128, category: "Machine Shaving – Body" },
  { name: "Hands Clipper", minutes: 30, price: 108, category: "Machine Shaving – Body" },
  { name: "Back Clipper", minutes: 30, price: 138, category: "Machine Shaving – Body" },
  { name: "Chest Clipper", minutes: 30, price: 138, category: "Machine Shaving – Body" },
  { name: "Under Arms Clipper", minutes: 15, price: 88, category: "Machine Shaving – Body" },
  // Wax
  { name: "Nose Wax", minutes: 5, price: 28, category: "Wax" },
  { name: "Ear Wax", minutes: 5, price: 28, category: "Wax" },
  { name: "Face Wax", minutes: 15, price: 78, category: "Wax" },
  { name: "Nose and Ear Wax", minutes: 5, price: 48, category: "Wax" },
  { name: "Nose, Ear, Face Wax", minutes: 10, price: 108, category: "Wax" },
  { name: "Eyebrow Shaping", minutes: 15, price: 38, category: "Wax" },
  { name: "Full Legs Wax", minutes: 60, price: 198, category: "Wax" },
  { name: "Full Hands Wax", minutes: 60, price: 168, category: "Wax" },
  { name: "Half Hands Wax", minutes: 30, price: 108, category: "Wax" },
  { name: "Back Wax", minutes: 30, price: 168, category: "Wax" },
  { name: "Chest Wax", minutes: 30, price: 168, category: "Wax" },
  { name: "Full Body Wax", minutes: 90, price: 488, category: "Wax" },
];

/* ------------------------------------------------------------------ */
/* Staff — the 22 real, active team members from §3. Two rows are      */
/* deliberately excluded: "Angie" (invitation expired, never signed    */
/* on) and "admin admin" (Fresha's own workspace-owner system account, */
/* not a person). 4-digit login codes are newly assigned here — Fresha */
/* has no equivalent, so these are fresh Dastaan credentials, not      */
/* migrated data. They print at the end for handing out to staff.      */
/* ------------------------------------------------------------------ */

type StaffRow = { name: string; title: string | null; role: "super_admin" | "admin" | "barber"; phone: string; code: string };

const staff: StaffRow[] = [
  { name: "Abbas Maqbool", title: "Owner", role: "super_admin", phone: "+971 54 777 9615", code: "8001" },
  { name: "Zaher", title: "Manager / Master Barber", role: "admin", phone: "+971 54 491 7497", code: "8002" },
  { name: "Dastaan Life", title: "Reception", role: "admin", phone: "+971 54 491 7497", code: "8003" },
  { name: "Hussam Ghameria", title: null, role: "admin", phone: "+971 56 609 2001", code: "8004" },
  { name: "Nauman Ali", title: "Accountant", role: "admin", phone: "+971 50 967 1512", code: "8005" },
  { name: "Zeeshan Khalid", title: null, role: "admin", phone: "+971 54 719 6833", code: "8006" },
  { name: "Mohamad Awais", title: "Accountant", role: "admin", phone: "+971 55 795 4852", code: "8007" },
  { name: "Ali Shabbir", title: "Master Barber", role: "barber", phone: "+971 56 355 9168", code: "8008" },
  { name: "Mouhssen Majdoub", title: "Master Barber", role: "barber", phone: "+971 50 719 5163", code: "8009" },
  { name: "Ayman Intabli", title: "Master Barber", role: "barber", phone: "+971 52 270 5566", code: "8010" },
  { name: "Luka Elgndy", title: "Master Barber", role: "barber", phone: "+971 50 700 0261", code: "8011" },
  { name: "Mohamad Fathi", title: "Lead Barber", role: "barber", phone: "+971 56 167 9102", code: "8012" },
  { name: "Yahya", title: "Senior Barber", role: "barber", phone: "+971 55 621 2476", code: "8013" },
  { name: "Azeem", title: "Barber", role: "barber", phone: "+971 55 481 5155", code: "8014" },
  { name: "Aqib", title: "Barber", role: "barber", phone: "+971 56 750 8683", code: "8015" },
  { name: "Maricel Soringa", title: "Head Nail Artist", role: "barber", phone: "+971 56 357 6189", code: "8016" },
  { name: "Arlene", title: "Senior Nail Technician", role: "barber", phone: "+971 56 192 2685", code: "8017" },
  { name: "Loraine Belgar", title: "Senior Nail Technician", role: "barber", phone: "+971 54 785 3845", code: "8018" },
  { name: "Princess", title: "Nail Artist", role: "barber", phone: "+971 56 872 2465", code: "8019" },
  { name: "Wissal", title: "Receptionist", role: "admin", phone: "+971 52 852 4989", code: "8020" },
  { name: "Angelica Caparos", title: "Receptionist", role: "admin", phone: "+971 50 961 5322", code: "8021" },
  { name: "Rv Apostol", title: "Receptionist", role: "admin", phone: "+971 54 231 4743", code: "8022" },
];

/* ------------------------------------------------------------------ */
/* Products — all 75 rows from §5, in source order. Fresha's "Brand"   */
/* column is blank for most lines (only Supplier is filled in), so     */
/* brand falls back to supplier when brand itself is "—"; category     */
/* falls back to "Uncategorised" rather than a guess. Cost and pack    */
/* size aren't kept — there is no column for them and nothing in the   */
/* app reads them. Negative stock counts become 0: a shelf cannot hold */
/* fewer than nothing, and the negative figure only ever meant Fresha's */
/* count had drifted from reality.                                     */
/* ------------------------------------------------------------------ */

type ProductRow = { name: string; sku: string | null; category: string; brand: string | null; price: number; qty: number };

const products: ProductRow[] = [
  { name: "Hair Rejuvenation Spray", sku: null, category: "Uncategorised", brand: "Dastaan", price: 248, qty: 14 },
  { name: "Grooming Spray", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 45 },
  { name: "Fortifying Pump Shampoo", sku: null, category: "Uncategorised", brand: "Dastaan", price: 198, qty: 19 },
  { name: "Volume Powder", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 15 },
  { name: "Clay", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 98 },
  { name: "Matte Cream", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 23 },
  { name: "Pomade", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 9 },
  { name: "Finishing Paste", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 59 },
  { name: "Beard Wash", sku: null, category: "Uncategorised", brand: "Dastaan", price: 138, qty: 6 },
  { name: "Beard Softener", sku: null, category: "Uncategorised", brand: "Dastaan", price: 138, qty: 25 },
  { name: "Golden Hemp Beard Oil – Sandalwood", sku: null, category: "Uncategorised", brand: "Dastaan", price: 158, qty: 15 },
  { name: "Golden Hemp Beard Oil – Fresh Haze", sku: null, category: "Uncategorised", brand: "Dastaan", price: 158, qty: 15 },
  { name: "Face Wash", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 71 },
  { name: "Moisturiser", sku: null, category: "Uncategorised", brand: "Dastaan", price: 128, qty: 44 },
  { name: "Eau De Parfum – Bare", sku: null, category: "Uncategorised", brand: "Dastaan", price: 480, qty: 15 },
  { name: "Eau De Parfum – Beyond", sku: null, category: "Uncategorised", brand: "Dastaan", price: 480, qty: 15 },
  { name: "Eau De Parfum – Black", sku: null, category: "Uncategorised", brand: "Dastaan", price: 480, qty: 29 },
  { name: "Eau De Parfum – Platinum", sku: null, category: "Uncategorised", brand: "Dastaan", price: 480, qty: 2 },
  { name: "Shaving Brush", sku: null, category: "Beard", brand: "DASTAAN", price: 298, qty: 0 },
  { name: "Fungal Force", sku: "6009879739275", category: "Uncategorised", brand: null, price: 148, qty: 0 },
  { name: "Skin Buff", sku: "641628002559", category: "Facial", brand: "ELEMIS", price: 225, qty: 3 },
  { name: "Herbal Lavender Repair Mask", sku: "64162850130", category: "Facial", brand: "ELEMIS", price: 203, qty: 4 },
  { name: "Facial Pads", sku: "64162860153", category: "Facial", brand: "ELEMIS", price: 234, qty: 5 },
  { name: "Marine Moisture Essence", sku: "64162800158", category: "Facial", brand: "ELEMIS", price: 236, qty: 2 },
  { name: "Marine Cream SPF 30", sku: "64162850140", category: "Facial", brand: "ELEMIS", price: 556, qty: 0 },
  { name: "Instant Refreshing Gel", sku: "64162850828", category: "Facial", brand: "Elemis", price: 218, qty: 2 },
  { name: "Ice Cool Foaming Shave Gel", sku: "64162860213", category: "Facial", brand: "Elemis", price: 168, qty: 0 },
  { name: "Deep Cleanse Facial Wash", sku: "64162850210", category: "Facial", brand: "Elemis", price: 139, qty: 0 },
  { name: "Daily Eye Boost", sku: "64162840148", category: "Facial", brand: "ELEMIS", price: 288, qty: 4 },
  { name: "Daily Moisture Boost", sku: "64162860220", category: "Facial", brand: "ELEMIS", price: 208, qty: 4 },
  { name: "Marine Cream for Men", sku: "64162850205", category: "Facial", brand: "ELEMIS", price: 238, qty: 2 },
  { name: "Dastaan Set", sku: null, category: "Uncategorised", brand: null, price: 600, qty: 47 },
  { name: "Shaving Cream", sku: null, category: "Uncategorised", brand: null, price: 128, qty: 33 },
  { name: "Beard Set", sku: null, category: "Beard", brand: "Dastaan", price: 600, qty: 0 },
  { name: "Dastaan Brush", sku: null, category: "Uncategorised", brand: null, price: 248, qty: 0 },
  { name: "Pro Collagen Marine SPF 30 (small)", sku: null, category: "Uncategorised", brand: null, price: 328, qty: 0 },
  { name: "Hair Spray", sku: null, category: "Hair", brand: null, price: 70, qty: 0 },
  { name: "Elim (cuticle oil)", sku: null, category: "Uncategorised", brand: null, price: 88, qty: 0 },
  { name: "Pro Collagen Moisture Essence", sku: null, category: "Facial", brand: null, price: 268, qty: 0 },
  { name: "Round Beard Brush (Small)", sku: null, category: "Beard", brand: null, price: 148, qty: 0 },
  { name: "Dastaan Cape", sku: null, category: "Hair", brand: null, price: 200, qty: 0 },
  { name: "Black Comb", sku: null, category: "Uncategorised", brand: null, price: 70, qty: 0 },
  { name: "Keratin Shampoo", sku: null, category: "Hair", brand: null, price: 179, qty: 0 },
  { name: "Keratin Conditioner", sku: null, category: "Hair", brand: null, price: 179, qty: 0 },
  { name: "Beard Brush (Medium)", sku: null, category: "Beard", brand: null, price: 248, qty: 0 },
  { name: "Beard Brush (Large)", sku: null, category: "Uncategorised", brand: null, price: 278, qty: 0 },
  { name: "Horn Comb (Small)", sku: null, category: "Beard", brand: null, price: 178, qty: 0 },
  { name: "Horn Comb (Large)", sku: null, category: "Beard", brand: null, price: 278, qty: 0 },
  { name: "Wood Comb", sku: null, category: "Beard", brand: null, price: 148, qty: 0 },
  { name: "Ison Shampoo", sku: null, category: "Uncategorised", brand: "Ison", price: 178, qty: 5 },
  { name: "Ison Conditioner", sku: null, category: "Uncategorised", brand: null, price: 178, qty: 4 },
  { name: "Pro Collagen Renewal Serum (Elemis)", sku: null, category: "Uncategorised", brand: null, price: 560, qty: 0 },
  { name: "Dynamic Facial Wash (Elemis)", sku: null, category: "Facial", brand: null, price: 220, qty: 0 },
  { name: "Dry Oil", sku: null, category: "Uncategorised", brand: null, price: 120, qty: 0 },
  { name: "Davroe Volume Senses – Amplifying Conditioner", sku: null, category: "Hair", brand: "Davroe", price: 140, qty: 0 },
  { name: "Davroe Scalp Remedy – Conditioner", sku: null, category: "Hair", brand: "Davroe", price: 150, qty: 0 },
  { name: "DAVROE Revitalising Shampoo", sku: "DAV-20969", category: "Hair", brand: "Davroe", price: 140, qty: 0 },
  { name: "DAVROE Revitalising Conditioner", sku: null, category: "Hair", brand: "Davroe", price: 140, qty: 1 },
  { name: "Davroe Volume Senses – Amplifying Shampoo", sku: null, category: "Uncategorised", brand: "Davroe", price: 140, qty: 1 },
  { name: "Davroe Scalp Remedy – Shampoo", sku: null, category: "Hair", brand: "Davroe", price: 150, qty: 1 },
  { name: "Davroe Scalp Remedy – Scrub", sku: null, category: "Uncategorised", brand: "Davroe", price: 150, qty: 1 },
  { name: "Tonic", sku: null, category: "Uncategorised", brand: null, price: 105, qty: 0 },
  { name: "Wide Comb", sku: null, category: "Hair", brand: null, price: 75, qty: 0 },
  { name: "Scalp Remedy Spa Pack", sku: null, category: "Uncategorised", brand: "Davroe", price: 540, qty: 0 },
  { name: "Comb w/ Handle", sku: null, category: "Uncategorised", brand: null, price: 178, qty: 0 },
  { name: "Big Wood Comb", sku: null, category: "Uncategorised", brand: null, price: 216, qty: 0 },
  { name: "Big Beard Brush w/ Handle", sku: null, category: "Uncategorised", brand: null, price: 315, qty: 0 },
  { name: "Davroe Lotion Spray", sku: null, category: "Uncategorised", brand: "Davroe", price: 140, qty: 0 },
  { name: "Davroe Leave in Masque", sku: null, category: "Uncategorised", brand: "Davroe", price: 58, qty: 0 },
  { name: "Davroe Micellar Cleansing Oil", sku: null, category: "Uncategorised", brand: "Davroe", price: 149, qty: 0 },
  { name: "Davroe Scalp Remedy Brush", sku: null, category: "Uncategorised", brand: "Davroe", price: 98, qty: 2 },
  { name: "Davroe Overnight Serum", sku: null, category: "Uncategorised", brand: "Davroe", price: 158, qty: 0 },
  { name: "Dastaan Briefcase", sku: null, category: "Uncategorised", brand: null, price: 2500, qty: 0 },
  { name: "Argan Oil", sku: null, category: "Uncategorised", brand: null, price: 158, qty: 1 },
  { name: "Bowl", sku: null, category: "Uncategorised", brand: null, price: 100, qty: 0 },
];

/* ------------------------------------------------------------------ */
/* Optional real client import — see CLIENTS_CSV above. Expects a CSV  */
/* with a header row containing at least name/full_name, mobile_number */
/* or phone, and optionally email — the same shape as a Fresha client  */
/* export. Anything else in the export (address, DOB, tags, ...) is    */
/* ignored; the app's client record only has name/phone/email.         */
/* ------------------------------------------------------------------ */

type ClientRow = { name: string; phone: string | null; email: string | null };

function parseClientsCsv(path: string): ClientRow[] {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const nameIdx = col(["full_name", "name"]);
  const firstIdx = col(["first_name"]);
  const lastIdx = col(["last_name"]);
  const phoneIdx = col(["mobile_number", "phone", "telephone"]);
  const emailIdx = col(["email"]);

  const splitCsvLine = (line: string): string[] =>
    (line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? []).map((f) => f.replace(/^"|"$/g, "").trim());

  const rows: ClientRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = nameIdx >= 0 ? cells[nameIdx] : [cells[firstIdx], cells[lastIdx]].filter(Boolean).join(" ");
    if (!name || name.trim().length < 2) continue;
    const phone = phoneIdx >= 0 ? (cells[phoneIdx]?.replace(/[^\d+]/g, "") || null) : null;
    const email = emailIdx >= 0 ? (cells[emailIdx]?.trim() || null) : null;
    rows.push({ name: name.trim(), phone, email });
  }
  return rows;
}

/* ------------------------------------------------------------------ */

const run = async () => {
  /* ---- 1. branch / location ---- */
  const inserted = { branch: 0, services: 0, staff: 0, products: 0, stock: 0, clients: 0 };

  const branchResult = await db.prepare(
    `INSERT INTO branches (id, name, area, address, hours, phone)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(
    BRANCH_ID,
    "Dastaan — Dubai Mall",
    "Downtown Dubai",
    "Shop SF-042, Dastaan Barbers & Beyond, Dubai Mall, Zabeel 2, Dubai, UAE",
    "Daily 10:00 – 23:00",
    "+971 4 325 1036"
  );
  inserted.branch = branchResult.changes ?? 0;

  /* ---- 2. services ---- */
  for (const s of services) {
    const id = uniqueId("fr-svc", s.name, s.minutes);
    const r = await db.prepare(
      `INSERT INTO services (id, name, minutes, price, category)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, s.name, s.minutes, s.price, s.category);
    inserted.services += r.changes ?? 0;
  }

  /* ---- 3. staff ---- */
  const printableCodes: { name: string; title: string | null; code: string }[] = [];
  for (const st of staff) {
    const id = uniqueId("fr-staff", st.name);
    const r = await db.prepare(
      `INSERT INTO users (id, role, name, title, phone, branch_id, code_hmac, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, st.role, st.name, st.title, st.phone, BRANCH_ID, hmacCode(st.code), now());
    if (r.changes) {
      inserted.staff += r.changes;
      printableCodes.push({ name: st.name, title: st.title, code: st.code });
    }
  }

  /* ---- 4. products + branch shelf stock ---- */
  for (const p of products) {
    const id = uniqueId("fr-prod", p.name);
    const pr = await db.prepare(
      `INSERT INTO products (id, name, sku, category, kind, price, brand, created_at)
       VALUES (?, ?, ?, ?, 'retail', ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, p.name, p.sku, p.category, p.price, p.brand, now());
    inserted.products += pr.changes ?? 0;

    const qty = Math.max(0, p.qty); // negative Fresha counts → 0, never negative shelf stock
    const sr = await db.prepare(
      `INSERT INTO stock_levels (product_id, branch_id, qty)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, BRANCH_ID, qty);
    inserted.stock += sr.changes ?? 0;
  }

  /* ---- 5. clients (only if a real export was supplied) ---- */
  if (CLIENTS_CSV) {
    if (!existsSync(CLIENTS_CSV)) {
      console.warn(`CLIENTS_CSV was set to "${CLIENTS_CSV}" but that file does not exist — skipping clients.`);
    } else {
      const rows = parseClientsCsv(CLIENTS_CSV);
      for (const c of rows) {
        const id = uniqueId("fr-client", c.name, c.phone ?? "");
        const r = await db.prepare(
          `INSERT INTO users (id, role, name, phone, email, created_at)
           VALUES (?, 'client', ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`
        ).run(id, c.name, c.phone, c.email, now());
        inserted.clients += r.changes ?? 0;
      }
    }
  } else {
    console.log(
      "No CLIENTS_CSV set — skipping client migration. The 4,783 clients in " +
      "fresha_migration_data.md are aggregate stats only (no names/phones/emails), " +
      "so nothing was invented for them. Export the real client list from Fresha " +
      "(Admin → Business Setup → Clients List → Export CSV) and re-run with " +
      "CLIENTS_CSV=/path/to/export.csv npm run migrate:fresha"
    );
  }

  console.log(
    `\nFresha migration complete:\n` +
    `  Branch: ${inserted.branch === 0 ? "already existed, left untouched" : "created"}\n` +
    `  Services added: ${inserted.services} (of ${services.length} in the source)\n` +
    `  Staff added: ${inserted.staff} (of ${staff.length} eligible)\n` +
    `  Products added: ${inserted.products} · shelf stock rows added: ${inserted.stock} (of ${products.length})\n` +
    `  Clients added: ${inserted.clients}${CLIENTS_CSV ? "" : " (skipped — see note above)"}\n`
  );

  if (printableCodes.length) {
    console.log("New staff login codes (team keypad, /team):");
    for (const p of printableCodes) console.log(`  ${p.code} — ${p.name}${p.title ? ` (${p.title})` : ""}`);
    console.log("");
  }
};

try {
  await db.transaction(run);
} catch (err) {
  console.error("\nMigration failed — nothing was written, the database is exactly as you found it.\n");
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
}
await closeDb().catch(() => {});
