/* ------------------------------------------------------------------ */
/* Salon time, server side.                                            */
/*                                                                     */
/* Render runs in UTC, Supabase is in Frankfurt, the developer is in   */
/* India and the salon is in Dubai. "Today" has to mean one thing, and */
/* that thing is the salon's calendar day — otherwise reports roll over*/
/* at the wrong hour and reminders go out on the wrong day.            */
/*                                                                     */
/* Set SALON_TZ in the environment if the salon ever moves.            */
/* ------------------------------------------------------------------ */

export const SALON_TZ = process.env.SALON_TZ ?? "Asia/Dubai";

/** Today in salon time, as YYYY-MM-DD. */
export const salonToday = (d = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

/** Now in salon time, as a naive local timestamp: YYYY-MM-DDTHH:MM:SS. */
export const salonNow = (d = new Date()): string => {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: SALON_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${salonToday(d)}T${get("hour")}:${get("minute")}:${get("second")}`;
};

/** Minutes since midnight in salon time. */
export const salonNowMinutes = (d = new Date()): number => {
  const t = salonNow(d);
  return Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
};

/** A salon calendar date N days from today. */
export const salonDayOffset = (n: number): string => {
  const [y, m, dd] = salonToday().split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const isMonth = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
