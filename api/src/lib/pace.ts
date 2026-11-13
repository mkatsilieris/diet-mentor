import type { Day } from './days.js';
import type { Nudge } from './nudges.js';

/**
 * The pace of the day: how many of the day's calories should be eaten by each hour.
 *
 * The person has a meal plan: meals with a time and a share of the day's target (the shares add up
 * to 100). The calories that are due rise in steps, one step at the time of each meal:
 *   due(t) = target x (sum of the shares of the meals whose time is <= t)
 * Nobody eats on the minute, so two more lines are drawn around it with the grace period G:
 *   required(t) = target x shares of the meals with time + G <= t    eaten below it  -> behind
 *   allowed(t)  = target x shares of the meals with time - G <= t    eaten above it  -> ahead
 * and both get a tolerance (a percentage of the target), so that a few calories do not change the verdict.
 */

export interface PlanMeal {
  /** 'HH:MM' */
  time: string;
  name: string;
  /** share of the day's target, whole percent */
  pct: number;
}

export interface MealPlan {
  meals: PlanMeal[];
  /** minutes around the time of a meal in which eating it is "on time" */
  grace_min: number;
  /** percent of the day's target that does not count as a difference */
  tolerance_pct: number;
  /** send a notification when behind */
  notify: boolean;
}

export const DEFAULT_PLAN: MealPlan = {
  meals: [
    { time: '08:00', name: 'Πρωινό', pct: 25 },
    { time: '11:00', name: 'Δεκατιανό', pct: 10 },
    { time: '14:00', name: 'Μεσημεριανό', pct: 35 },
    { time: '17:30', name: 'Απογευματινό', pct: 10 },
    { time: '20:30', name: 'Βραδινό', pct: 20 },
  ],
  grace_min: 45,
  tolerance_pct: 5,
  notify: true,
};

export const MAX_MEALS = 8;

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** What is wrong with a list of meals, in the words shown to the person; null when it is fine. */
export function planProblem(meals: PlanMeal[]): string | null {
  if (meals.length === 0) return 'Το πλάνο θέλει τουλάχιστον ένα γεύμα';
  if (meals.length > MAX_MEALS) return `Ως ${MAX_MEALS} γεύματα τη μέρα`;
  if (new Set(meals.map((m) => m.time)).size !== meals.length) return 'Δύο γεύματα έχουν την ίδια ώρα';
  const sum = meals.reduce((s, m) => s + m.pct, 0);
  if (sum !== 100) return `Τα ποσοστά πρέπει να κάνουν 100% (τώρα ${sum}%)`;
  return null;
}

export const sortMeals = (meals: PlanMeal[]): PlanMeal[] => [...meals].sort((a, b) => a.time.localeCompare(b.time));

export interface PaceStep extends PlanMeal {
  kcal: number;
  cumPct: number;
  cumKcal: number;
  /** covered: eaten reaches it; late: not covered and the grace is over; due: its time came; upcoming */
  state: 'covered' | 'late' | 'due' | 'upcoming';
}

export interface Pace {
  /** 'HH:MM' the pace was worked out for */
  now: string;
  target: number;
  eaten: number;
  /** kcal of the meals whose time has come */
  due: number;
  /** below this (less the tolerance) the person is behind */
  required: number;
  /** above this (plus the tolerance) the person is ahead */
  allowed: number;
  toleranceKcal: number;
  status: 'behind' | 'on' | 'ahead';
  /** eaten - due */
  diff: number;
  /** kcal missing to reach `required`, 0 unless behind */
  shortBy: number;
  /** the last meal whose grace is over, null early in the day */
  lateMeal: PlanMeal | null;
  next: PaceStep | null;
  steps: PaceStep[];
}

export function paceAt(now: string, plan: MealPlan, target: number, eaten: number): Pace {
  const n = minutes(now);
  const toleranceKcal = Math.round((target * plan.tolerance_pct) / 100);
  const meals = sortMeals(plan.meals);
  let cumPct = 0;
  let due = 0;
  let required = 0;
  let allowed = 0;
  let lateMeal: PlanMeal | null = null;
  const steps: PaceStep[] = meals.map((m) => {
    const before = Math.round((target * cumPct) / 100);
    cumPct += m.pct;
    const cumKcal = Math.round((target * cumPct) / 100);
    const t = minutes(m.time);
    if (t <= n) due = cumKcal;
    if (t - plan.grace_min <= n) allowed = cumKcal;
    const graceOver = t + plan.grace_min <= n;
    if (graceOver) {
      required = cumKcal;
      lateMeal = { time: m.time, name: m.name, pct: m.pct };
    }
    const covered = eaten >= cumKcal - toleranceKcal && (eaten > 0 || cumKcal === 0);
    const state: PaceStep['state'] = covered ? 'covered' : graceOver ? 'late' : t <= n ? 'due' : 'upcoming';
    return { ...m, kcal: cumKcal - before, cumPct, cumKcal, state };
  });
  const status: Pace['status'] = eaten < required - toleranceKcal ? 'behind' : eaten > allowed + toleranceKcal ? 'ahead' : 'on';
  return {
    now,
    target,
    eaten,
    due,
    required,
    allowed,
    toleranceKcal,
    status,
    diff: eaten - due,
    shortBy: status === 'behind' ? required - eaten : 0,
    lateMeal,
    next: steps.find((s) => minutes(s.time) > n) ?? null,
    steps,
  };
}

/** One key per step of the plan and day: each step is judged once, when its grace ends. */
export const paceKey = (day: Day, pace: Pace): string | null => (pace.lateMeal ? `pace/${day}/${pace.lateMeal.time}` : null);

const kcal = (v: number): string => `${Math.round(Math.abs(v)).toLocaleString('el-GR')} kcal`;

/** The notification of a step that was missed, or null when the person keeps up. */
export function paceNudge(day: Day, pace: Pace): Nudge | null {
  const key = paceKey(day, pace);
  if (!key || !pace.lateMeal || pace.status !== 'behind') return null;
  const next = pace.next ? ` Επόμενο: ${pace.next.name} στις ${pace.next.time}.` : '';
  return {
    dedupe: key,
    kind: 'pace',
    title: `Είσαι ${kcal(pace.shortBy)} πίσω από το πλάνο`,
    body: `Ως τις ${pace.lateMeal.time} (${pace.lateMeal.name}) το πλάνο θέλει ${kcal(pace.required)}, έχεις γράψει ${kcal(pace.eaten)}. Φάε τώρα, πριν μαζευτεί η πείνα για αργότερα. Αν έφαγες ήδη, γράψε το.${next}`,
    url: '/',
  };
}
