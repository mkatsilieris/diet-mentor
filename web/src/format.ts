import type { Activity, Day } from './types';

const num0 = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.234 */
export const int = (n: number): string => num0.format(Math.round(n));
/** '1.850 kcal' */
export const kcal = (n: number): string => `${int(n)} kcal`;
/** '+550 kcal' / '−120 kcal' (a real minus sign, so that the columns line up) */
export const signedKcal = (n: number): string => `${Math.round(n) < 0 ? '−' : '+'}${int(Math.abs(n))} kcal`;
/** '82,4 kg' */
export const kg = (n: number): string => `${num1.format(n)} kg`;
/** '−1,25 kg' / '+0,40 kg' */
export const signedKg = (n: number): string => `${n < -0.004 ? '−' : n > 0.004 ? '+' : ''}${num2.format(Math.abs(n))} kg`;
/** fat or glycogen amounts: grams under a kilo, kilos above */
export const mass = (kgValue: number): string => (Math.abs(kgValue) < 1 ? `${int(Math.abs(kgValue) * 1000)} g` : `${num2.format(Math.abs(kgValue))} kg`);
export const pct = (n: number): string => `${int(n)}%`;

/** Days are plain dates: parse at noon so that no time zone moves them. */
const asDate = (d: Day): Date => new Date(`${d}T12:00:00`);

const shortFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
const fullFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'numeric', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('el-GR', { month: 'short', year: 'numeric' });

/** '13/11' */
export const dayShort = (d: Day): string => shortFmt.format(asDate(d));
/** 'Παρασκευή 13 Νοεμβρίου' */
export const dayLong = (d: Day): string => weekdayFmt.format(asDate(d));
/** '13/11/2026' */
export const dayFull = (d: Day): string => fullFmt.format(asDate(d));
/** 'Νοε 2026' */
export const monthLabel = (d: Day): string => {
  const s = monthFmt.format(asDate(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function addDays(d: Day, n: number): Day {
  const t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n));
  return t.toISOString().slice(0, 10);
}

/** The wall clock now, 'HH:MM'. */
export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Text of a number field -> number; accepts the Greek decimal comma. NaN when empty or not a number. */
export const parseNumber = (s: string): number => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

export const days = (n: number): string => `${n} ${n === 1 ? 'μέρα' : 'μέρες'}`;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const ACTIVITY_LABEL: Record<Activity, { label: string; hint: string }> = {
  sedentary: { label: 'Καθιστική', hint: 'γραφείο, σχεδόν καθόλου άσκηση' },
  light: { label: 'Ελαφριά', hint: 'άσκηση 1-3 φορές την εβδομάδα' },
  moderate: { label: 'Μέτρια', hint: 'άσκηση 3-5 φορές την εβδομάδα' },
  active: { label: 'Έντονη', hint: 'άσκηση 6-7 φορές την εβδομάδα' },
  very_active: { label: 'Πολύ έντονη', hint: 'σωματική δουλειά ή δύο προπονήσεις τη μέρα' },
};
