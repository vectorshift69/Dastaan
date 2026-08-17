/* ------------------------------------------------------------------ */
/*  Dastaan — mock data layer (replaced by the API in Phase 1 backend) */
/* ------------------------------------------------------------------ */

export type Branch = {
  id: string;
  name: string;
  area: string;
  address: string;
  hours: string;
  phone: string;
};

export type Service = {
  id: string;
  name: string;
  minutes: number;
  price: number; // AED
  category: "Hair" | "Beard" | "Combos" | "Grooming";
};

export type Barber = {
  id: string;
  name: string;
  title: string;
  rating: number;
  initials: string;
  tone: string; // avatar bg
  branchId: string;
};

export type BookingStatus =
  | "Booked"
  | "Confirmed"
  | "Arrived"
  | "Started"
  | "No Show"
  | "Cancelled";

export type Appointment = {
  id: string;
  barberId: string;
  client: string;
  phone: string;
  serviceIds: string[];
  start: string; // "HH:MM"
  minutes: number;
  status: BookingStatus;
  online: boolean; // true = client self-booked (⟳), false = booked with barber (✓)
  paid: boolean;
  loyalty?: { tier: "Gold" | "Silver" | "Member"; points: number };
  cancelReason?: string;
};

export const CURRENCY = "AED";

export const branches: Branch[] = [
  {
    id: "b1",
    name: "Dastaan — Marina Walk",
    area: "Dubai Marina",
    address: "Marina Walk, Tower 4, Ground Floor",
    hours: "Daily 10:00 – 23:00",
    phone: "+971 4 000 0001",
  },
  {
    id: "b2",
    name: "Dastaan — City Centre",
    area: "Deira",
    address: "City Centre Boulevard, Unit 12",
    hours: "Daily 10:00 – 22:00",
    phone: "+971 4 000 0002",
  },
];

export const services: Service[] = [
  { id: "s1", name: "Skin Fade & Beard", minutes: 75, price: 268, category: "Combos" },
  { id: "s2", name: "Classic Haircut", minutes: 45, price: 150, category: "Hair" },
  { id: "s3", name: "Skin Fade / Taper Fade", minutes: 50, price: 180, category: "Hair" },
  { id: "s4", name: "Beard Trim & Line Up", minutes: 30, price: 95, category: "Beard" },
  { id: "s5", name: "Hot Towel Shave", minutes: 40, price: 120, category: "Beard" },
  { id: "s6", name: "Haircut & Hot Towel Shave", minutes: 80, price: 240, category: "Combos" },
  { id: "s7", name: "Kids Cut (under 12)", minutes: 30, price: 90, category: "Hair" },
  { id: "s8", name: "Black Mask Facial", minutes: 35, price: 110, category: "Grooming" },
  { id: "s9", name: "Head Massage", minutes: 20, price: 70, category: "Grooming" },
  { id: "s10", name: "Full Grooming Ritual", minutes: 120, price: 420, category: "Combos" },
  { id: "s11", name: "Beard Colour", minutes: 40, price: 130, category: "Beard" },
  { id: "s12", name: "Head Shave (razor finish)", minutes: 35, price: 110, category: "Hair" },
];

export const barbers: Barber[] = [
  { id: "br1", name: "Aqib Khan", title: "Master Barber", rating: 4.9, initials: "AK", tone: "#5b4a2f", branchId: "b1" },
  { id: "br3", name: "Mouawia Majzoub", title: "Master Barber", rating: 5.0, initials: "MM", tone: "#4a3f5b", branchId: "b1" },
  { id: "br2", name: "Ali Raza", title: "Senior Barber", rating: 4.8, initials: "AR", tone: "#3f4a5b", branchId: "b1" },
  { id: "br7", name: "Bilal Ahmed", title: "Senior Barber", rating: 4.9, initials: "BA", tone: "#3f5b57", branchId: "b1" },
  { id: "br4", name: "Azeem Aslam", title: "Barber", rating: 4.7, initials: "AA", tone: "#2f5b4a", branchId: "b1" },
  { id: "br8", name: "Tariq Mehmood", title: "Barber", rating: 4.7, initials: "TM", tone: "#54463f", branchId: "b1" },
  { id: "br5", name: "Yousuf Mirza", title: "Senior Barber", rating: 4.8, initials: "YM", tone: "#5b2f39", branchId: "b2" },
  { id: "br6", name: "Hassan Adel", title: "Barber", rating: 4.6, initials: "HA", tone: "#39505b", branchId: "b2" },
  { id: "br9", name: "Imran Sheikh", title: "Master Barber", rating: 4.9, initials: "IS", tone: "#5b3f54", branchId: "b2" },
];

export const dayAppointments: Appointment[] = [
  { id: "a1", barberId: "br1", client: "Sumit Verma", phone: "+971 50 002 1226", serviceIds: ["s1"], start: "10:15", minutes: 75, status: "Arrived", online: false, paid: false, loyalty: { tier: "Gold", points: 5800 } },
  { id: "a2", barberId: "br1", client: "Alberto Bustani", phone: "+971 55 133 8721", serviceIds: ["s2", "s4"], start: "12:00", minutes: 75, status: "Confirmed", online: true, paid: true, loyalty: { tier: "Member", points: 320 } },
  { id: "a3", barberId: "br1", client: "Mikel Simmonds", phone: "+971 52 774 0913", serviceIds: ["s5"], start: "16:30", minutes: 40, status: "Booked", online: true, paid: false },
  { id: "a4", barberId: "br2", client: "Ish Guleri", phone: "+971 54 660 2284", serviceIds: ["s3"], start: "10:30", minutes: 50, status: "Started", online: false, paid: true, loyalty: { tier: "Silver", points: 1450 } },
  { id: "a5", barberId: "br2", client: "S. S. Radwan", phone: "+971 50 918 5567", serviceIds: ["s3"], start: "13:30", minutes: 50, status: "Booked", online: false, paid: false },
  { id: "a6", barberId: "br2", client: "Lutfar Hawlader", phone: "+971 56 401 7789", serviceIds: ["s6"], start: "15:00", minutes: 80, status: "Confirmed", online: true, paid: true },
  { id: "a7", barberId: "br3", client: "Majid Akram", phone: "+971 50 552 6614", serviceIds: ["s1"], start: "11:00", minutes: 75, status: "Confirmed", online: false, paid: false, loyalty: { tier: "Gold", points: 7200 } },
  { id: "a8", barberId: "br3", client: "Faizan Qureshi", phone: "+971 55 209 4432", serviceIds: ["s3", "s9"], start: "14:15", minutes: 70, status: "Booked", online: true, paid: false },
  { id: "a9", barberId: "br3", client: "Kamal Hussain", phone: "+971 52 883 2245", serviceIds: ["s4"], start: "17:40", minutes: 30, status: "Booked", online: false, paid: true },
  { id: "a10", barberId: "br4", client: "Marwan Adel", phone: "+971 50 776 9911", serviceIds: ["s8", "s9"], start: "10:45", minutes: 55, status: "No Show", online: true, paid: false },
  { id: "a11", barberId: "br4", client: "Yasser Zaman", phone: "+971 54 332 8080", serviceIds: ["s2"], start: "13:00", minutes: 45, status: "Confirmed", online: false, paid: false },
  { id: "a12", barberId: "br4", client: "Omar Al-Farsi", phone: "+971 55 660 1188", serviceIds: ["s10"], start: "16:00", minutes: 120, status: "Booked", online: true, paid: true, loyalty: { tier: "Silver", points: 2100 } },
  { id: "a13", barberId: "br7", client: "Hamza Sheikh", phone: "+971 50 441 7789", serviceIds: ["s2", "s4"], start: "11:30", minutes: 75, status: "Confirmed", online: true, paid: true, loyalty: { tier: "Gold", points: 6400 } },
  { id: "a14", barberId: "br7", client: "Bilal Rahman", phone: "+971 55 782 3310", serviceIds: ["s10"], start: "15:00", minutes: 120, status: "Booked", online: false, paid: false },
  { id: "a15", barberId: "br8", client: "Zaid Al-Marri", phone: "+971 52 990 4471", serviceIds: ["s11"], start: "10:30", minutes: 40, status: "Arrived", online: true, paid: false, loyalty: { tier: "Silver", points: 1900 } },
  { id: "a16", barberId: "br8", client: "Rashid Nasser", phone: "+971 54 118 6620", serviceIds: ["s12"], start: "14:00", minutes: 35, status: "Booked", online: true, paid: true },
];

/* time helpers */
export const DAY_START = 10 * 60; // 10:00
export const DAY_END = 21 * 60; // 21:00

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export const toLabel = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
};

export const svcById = (id: string) => services.find((s) => s.id === id)!;

export const apptTotal = (a: Appointment) =>
  a.serviceIds.reduce((sum, id) => sum + svcById(id).price, 0);

export const STATUS_COLOR: Record<BookingStatus, string> = {
  Booked: "var(--color-st-booked)",
  Confirmed: "var(--color-st-confirmed)",
  Arrived: "var(--color-st-arrived)",
  Started: "var(--color-st-started)",
  "No Show": "var(--color-st-noshow)",
  Cancelled: "var(--color-st-cancel)",
};

/* demo staff codes for /team (mock auth — real impl hashes + rate-limits server-side) */
export const STAFF_CODES: Record<
  string,
  { name: string; role: "Admin" | "Barber" | "Super Admin"; branchId: string }
> = {
  "1111": { name: "Aisha Rahman", role: "Admin", branchId: "b1" },
  "2222": { name: "Aqib Khan", role: "Barber", branchId: "b1" },
  "9999": { name: "Owner", role: "Super Admin", branchId: "b1" },
};
