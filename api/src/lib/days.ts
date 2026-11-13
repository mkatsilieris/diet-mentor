/**
 * Calendar days as 'YYYY-MM-DD' strings. They sort and compare as text, and arithmetic goes through
 * UTC midnight so that no time zone or daylight saving change can move a day.
 */
export type Day = string;

const MS_PER_DAY = 86_400_000;

const toUtc = (d: Day): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromUtc = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

/** True for a real calendar day written as YYYY-MM-DD ('2026-02-30' is not one). */
export function isDay(s: unknown): s is Day {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export const addDays = (d: Day, n: number): Day => fromUtc(toUtc(d) + n * MS_PER_DAY);

/** a - b in days. */
export const diffDays = (a: Day, b: Day): number => Math.round((toUtc(a) - toUtc(b)) / MS_PER_DAY);

/** The Monday of the week the day is in. */
export function weekStart(d: Day): Day {
  const sinceMonday = (new Date(toUtc(d)).getUTCDay() + 6) % 7;
  return addDays(d, -sinceMonday);
}

export const monthStart = (d: Day): Day => `${d.slice(0, 7)}-01`;

export function monthEnd(d: Day): Day {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return fromUtc(Date.UTC(y, m, 0)); // day 0 of the next month
}

/** The calendar day it is right now in the given IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): Day {
  // en-CA writes dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole years between the birth date and the day. */
export function ageOn(birth: Day, day: Day): number {
  const years = Number(day.slice(0, 4)) - Number(birth.slice(0, 4));
  return day.slice(5) < birth.slice(5) ? years - 1 : years;
}
