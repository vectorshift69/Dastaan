/* ------------------------------------------------------------------ */
/* Salon time.                                                         */
/*                                                                     */
/* The salon is in Dubai. Everything the app calls "today" or "now"    */
/* means today and now *in Dubai*, not on whatever device happens to   */
/* be looking at the screen. A receptionist in Deira and a developer   */
/* in Mumbai must see the same diary and the same red line.            */
/*                                                                     */
/* Appointment times are stored as naive local strings                 */
/* ("2026-08-19T10:15:00"), so these helpers stay in that frame too —  */
/* no UTC conversion anywhere.                                         */
/* ------------------------------------------------------------------ */

export const SALON_TZ = "Asia/Dubai";

const dateParts = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // en-CA gives YYYY-MM-DD

const timeParts = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: SALON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
};

/** Today in the salon's timezone, as YYYY-MM-DD. */
export const salonToday = (): string => dateParts(new Date());

/** A date N days from today in salon time, as YYYY-MM-DD. */
export const salonDayOffset = (n: number): string => {
  const [y, m, d] = salonToday().split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return shifted.toISOString().slice(0, 10); // safe: constructed at UTC midnight
};

/** Minutes since midnight, right now, in the salon's timezone. */
export const salonNowMinutes = (): number => {
  const { hour, minute } = timeParts(new Date());
  return hour * 60 + minute;
};

/** "14:30" → "2:30 pm" */
export const pretty = (hhmm: string): string => {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? "pm" : "am"}`;
};

/** A YYYY-MM-DD in salon terms, written for people. */
export const prettyDate = (iso: string, opts: Intl.DateTimeFormatOptions = {}): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AE", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    timeZone: "UTC", // the string is already a salon-local calendar date
    ...opts,
  });

/** "Today" / "Tomorrow" / "Yesterday", else a written date. */
export const relativeDay = (iso: string): string => {
  if (iso === salonToday()) return "Today";
  if (iso === salonDayOffset(1)) return "Tomorrow";
  if (iso === salonDayOffset(-1)) return "Yesterday";
  return prettyDate(iso, { weekday: undefined, year: undefined });
};

/** Days in a month, and the weekday its 1st falls on (0 = Sunday). */
export const monthGrid = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { firstWeekday: first.getUTCDay(), days, year: y, month: m };
};

export const addMonth = (month: string, n: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
