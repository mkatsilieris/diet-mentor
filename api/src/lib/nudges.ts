import { weekStart, type Day } from './days.js';
import { TARGET_TOLERANCE, type Summary } from './summary.js';

/**
 * What the app says by push notification, decided by plain rules:
 *   - meal reminders at the times the person chose, only when nothing was written since the previous one
 *   - once a day, a word about yesterday; new milestones; steps of the running diet
 *   - on Mondays, the week that ended
 * Every nudge has a `dedupe` key; the scheduler sends each key to a person at most once.
 */

export type ReadySummary = Extract<Summary, { ready: true }>;

export interface NotificationSettings {
  reminders: boolean;
  /** 'HH:MM', sorted */
  reminder_times: string[];
  motivation: boolean;
  motivation_time: string;
  weekly: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  reminders: true,
  reminder_times: ['10:00', '14:30', '21:00'],
  motivation: true,
  motivation_time: '09:00',
  weekly: true,
};

export interface Nudge {
  dedupe: string;
  kind: 'reminder' | 'daily' | 'milestone' | 'diet' | 'weekly';
  title: string;
  body: string;
  /** page opened by a tap */
  url: string;
}

/** A slot stays due for this long, so that a restart or a slow minute does not skip it. */
export const WINDOW_MIN = 20;

export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The latest of the times that started within the last WINDOW_MIN minutes, or null. */
export function dueSlot(times: string[], now: string, windowMin = WINDOW_MIN): string | null {
  const n = minutes(now);
  const due = times.filter((t) => minutes(t) <= n && n < minutes(t) + windowMin).sort();
  return due.length ? due[due.length - 1] : null;
}

const kcal = (n: number): string => `${Math.round(Math.abs(n)).toLocaleString('el-GR')} kcal`;
const kg1 = (n: number): string => `${Math.abs(n).toFixed(1).replace('.', ',')} kg`;

function mealName(slot: string): string {
  const m = minutes(slot);
  if (m < 11 * 60 + 30) return 'πρωινό';
  if (m < 16 * 60 + 30) return 'μεσημεριανό';
  if (m < 19 * 60) return 'απόγευμα';
  return 'βραδινό';
}

/**
 * The reminder of a slot, or null when it is not needed: something was already written with a time
 * after the previous slot (for the first slot: anything today).
 */
export function mealReminder(slot: string, times: string[], entryTimes: string[], s: ReadySummary): Nudge | null {
  const sorted = [...times].sort();
  const previous = sorted.filter((t) => t < slot).at(-1) ?? '00:00';
  if (entryTimes.some((t) => t >= previous)) return null;

  const { day, motivation } = s;
  const last = sorted[sorted.length - 1] === slot;
  let title = slot < '11:30' ? 'Τι έφαγες για πρωινό;' : `Τι έφαγες για ${mealName(slot)};`;
  if (mealName(slot) === 'απόγευμα') title = 'Έφαγες κάτι το απόγευμα;';
  let body: string;
  if (day.entries === 0 && last && motivation.streaks.log >= 2) {
    title = 'Η σημερινή μέρα είναι ακόμη άδεια';
    body = `Δύο λεπτά αρκούν για να μη σπάσει το σερί των ${motivation.streaks.log} ημερών.`;
  } else if (day.entries === 0) {
    body = `Ο στόχος σήμερα είναι ${kcal(day.target)}. Γράψε το τώρα που το θυμάσαι.`;
  } else if (day.remaining >= 0) {
    body = `Έχεις γράψει ${kcal(day.intake)}, σου μένουν ${kcal(day.remaining)} για σήμερα.`;
  } else {
    body = `Έχεις γράψει ${kcal(day.intake)}, ${kcal(day.remaining)} πάνω από τον στόχο. Γράψε και ό,τι άλλο έφαγες, για να είναι σωστή η εικόνα.`;
  }
  return { dedupe: `reminder/${day.day}/${slot}`, kind: 'reminder', title, body, url: '/' };
}

/** The once-a-day word about yesterday. */
export function dailyNudge(s: ReadySummary): Nudge | null {
  const y = s.days.length >= 2 ? s.days[s.days.length - 2] : null;
  if (!y) return null;
  const base = { dedupe: `daily/${s.today}`, kind: 'daily' as const, url: '/progress' };
  const diet = s.diet ? ` Μέρα ${s.diet.dayNumber}${s.diet.diet.planned_days ? ` από ${s.diet.diet.planned_days}` : ''} της δίαιτας.` : '';

  if (y.counted && y.onTarget) {
    const run = s.motivation.streaks.target >= 2 ? ` ${s.motivation.streaks.target} μέρες στη σειρά.` : '';
    const what = y.deficit > 0 ? `Έλλειμμα ${kcal(y.deficit)}.` : `Έφαγες ${kcal(y.intake)}.`;
    return { ...base, title: 'Χθες: μέσα στον στόχο', body: `${what}${run}${diet}` };
  }
  if (y.counted) {
    const over = y.intake - y.target;
    const week = s.periods.week.deficit > 0 ? `Η εβδομάδα είναι ακόμη στο +${kcal(s.periods.week.deficit)}.` : 'Μία μέρα δεν κρίνει τίποτα.';
    return { ...base, title: `Χθες: ${kcal(over)} πάνω από τον στόχο`, body: `${week} Σήμερα συνεχίζεις κανονικά.` };
  }
  // nothing written yesterday: say it once, only to someone who does use the diary
  if (s.motivation.loggedDays === 0) return null;
  return { ...base, title: 'Χθες έμεινε κενό', body: 'Μέρες χωρίς καταγραφή δεν μετράνε στο έλλειμμα. Γράψε σήμερα από το πρώτο γεύμα.', url: '/' };
}

/** One nudge per milestone that is reached; each is sent once in a lifetime. */
export function milestoneNudges(s: ReadySummary): Nudge[] {
  return s.motivation.milestones
    .filter((m) => m.done)
    .map((m) => ({ dedupe: `milestone/${m.key}`, kind: 'milestone', title: 'Νέο ορόσημο', body: `${m.label}. Μπράβο!`, url: '/progress' }));
}

/** Steps of the running diet: half way, the planned days reached, the goal weight reached. */
export function dietNudges(s: ReadySummary): Nudge[] {
  const d = s.diet;
  if (!d) return [];
  const out: Nudge[] = [];
  const planned = d.diet.planned_days;
  const id = d.diet.id;
  if (planned !== null && planned >= 6 && d.dayNumber * 2 >= planned && d.dayNumber < planned) {
    out.push({
      dedupe: `diet/${id}/half`,
      kind: 'diet',
      title: 'Στη μέση της δίαιτας',
      body: `Μέρα ${d.dayNumber} από ${planned}. Έλλειμμα ως τώρα ${kcal(d.totals.deficit)}, γύρω στα ${kg1(Math.max(0, d.totals.fatKg))} λίπους.`,
      url: '/diets',
    });
  }
  if (planned !== null && d.dayNumber >= planned) {
    out.push({
      dedupe: `diet/${id}/planned`,
      kind: 'diet',
      title: `Έφτασες τις ${planned} μέρες`,
      body: `Η δίαιτα «${d.diet.name}» έφτασε στο τέλος που είχες βάλει. Ζυγίσου και κλείσε την για να δεις τι πέτυχες.`,
      url: '/diets',
    });
  }
  if (d.goalKg !== null && d.currentKg !== null && d.currentKg <= d.goalKg) {
    out.push({
      dedupe: `diet/${id}/goal`,
      kind: 'diet',
      title: 'Έφτασες το βάρος-στόχο!',
      body: `${kg1(d.currentKg)} στη ζυγαριά, στόχος ${kg1(d.goalKg)}. Κλείσε τη δίαιτα και πέρνα σε συντήρηση.`,
      url: '/diets',
    });
  }
  return out;
}

/** On Mondays: the week that just ended, when at least three of its days were written down. */
export function weeklyNudge(s: ReadySummary, today: Day): Nudge | null {
  if (weekStart(today) !== today) return null;
  const w = s.periods.prevWeek;
  if (w.loggedDays < 3) return null;
  const fat = w.fatKg > 0.05 ? `, γύρω στα ${kg1(w.fatKg)} λίπους` : '';
  const balance = w.deficit >= 0 ? `έλλειμμα ${kcal(w.deficit)}${fat}` : `πλεόνασμα ${kcal(w.deficit)}`;
  return {
    dedupe: `weekly/${w.from}`,
    kind: 'weekly',
    title: 'Η εβδομάδα σου',
    body: `${w.loggedDays} μέρες καταγραφής, ${balance}. ${w.onTargetDays} από ${w.loggedDays} μέσα στον στόχο.`,
    url: '/progress',
  };
}

/** Everything the daily run may send, filtered by what the person switched on. */
export function motivationNudges(s: ReadySummary, settings: NotificationSettings): Nudge[] {
  const out: Nudge[] = [];
  if (settings.motivation) {
    const daily = dailyNudge(s);
    if (daily) out.push(daily);
    out.push(...milestoneNudges(s), ...dietNudges(s));
  }
  if (settings.weekly) {
    const weekly = weeklyNudge(s, s.today);
    if (weekly) out.push(weekly);
  }
  return out;
}

/**
 * The keys that are already true the first time notifications run for a person. They are marked as
 * sent without sending, so that old achievements do not arrive as a burst.
 */
export const baselineKeys = (s: ReadySummary): string[] => [...milestoneNudges(s), ...dietNudges(s)].map((n) => n.dedupe);

export { TARGET_TOLERANCE };
