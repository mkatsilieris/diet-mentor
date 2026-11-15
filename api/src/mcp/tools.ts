import { z } from 'zod';
import { config } from '../config.js';
import { isDay } from '../lib/days.js';
import { isTime } from '../lib/nudges.js';
import { timeIn } from '../reminders.js';
import { today } from '../tracker.js';

/**
 * The tools Claude sees. Each one is a thin wrapper over a route of this API, called with the
 * person's own token: the checks, the limits and the "only your own data" rule are the ones the
 * web app goes through, written once, in the routes.
 */

/** Calls a route of this API as the person. Throws ToolError with the route's message on 4xx/5xx. */
export type ApiCall = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

/** A failure the model should read and act on (wrong input, not found, not allowed). */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  title: string;
  description: string;
  /** changes data: hidden from read-only tokens */
  write: boolean;
  /** removes data that cannot be brought back */
  destructive?: boolean;
  input: z.ZodObject<z.ZodRawShape>;
  run: (args: any, api: ApiCall) => Promise<unknown>;
}

const day = z.string().refine(isDay, 'Expected a calendar day, YYYY-MM-DD');
const time = z.string().refine(isTime, 'Expected a time of day, HH:MM (24h)');
const optionalDay = day.optional().describe('Calendar day YYYY-MM-DD. Default: today in the app time zone.');
const kg = z.number().min(30).max(300);
const id = z.number().int().positive();
const none = z.object({});
const q = (params: Record<string, string | number | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : '';
};
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const meal = z.object({
  time: time.describe('When the meal is due, HH:MM'),
  name: z.string().min(1).max(40),
  pct: z.number().int().min(1).max(100).describe('Share of the daily calorie target, whole percent'),
});

export const tools: Tool[] = [
  // ---------------------------------------------------------------- overview
  {
    name: 'get_summary',
    title: 'Σύνοψη',
    description:
      'The overview the app shows: body numbers (BMR, maintenance calories, BMI), today (eaten / target / remaining kcal), pace of the day against the meal plan, ' +
      'deficits per week and month, glycogen estimate, the running diet with its statistics, streaks, milestones and the mentor\'s remarks. ' +
      'Start here for any question about progress. If it answers {ready:false}, the profile or a first weigh-in is missing (see `missing`).',
    write: false,
    input: z.object({
      last_days: z.number().int().min(0).max(120).default(0).describe('How many of the latest per-day rows to include (0 = none; they are long).'),
    }),
    run: async ({ last_days }, api) => {
      const s = await api('GET', '/summary');
      if (Array.isArray(s.days)) s.days = last_days > 0 ? s.days.slice(-last_days) : undefined;
      return s;
    },
  },
  {
    name: 'get_account',
    title: 'Λογαριασμός',
    description: 'Name and e-mail of the person this token belongs to, the app time zone, and the current date and time there.',
    write: false,
    input: none,
    run: async (_a, api) => ({ ...(await api('GET', '/auth/me')), time_zone: config.timeZone, today: today(), now: timeIn(config.timeZone) }),
  },
  {
    name: 'update_account_name',
    title: 'Αλλαγή ονόματος',
    description: 'Changes the display name of the account.',
    write: true,
    input: z.object({ name: z.string().min(1).max(100) }),
    run: ({ name }, api) => api('PATCH', '/auth/me', { name }),
  },

  // ---------------------------------------------------------------- food diary
  {
    name: 'list_food_entries',
    title: 'Ημερολόγιο φαγητού',
    description: 'The food diary of one day: every entry (id, time, name, kcal, carbs) and the total calories.',
    write: false,
    input: z.object({ day: optionalDay }),
    run: (a, api) => api('GET', `/entries${q({ day: a.day })}`),
  },
  {
    name: 'search_foods',
    title: 'Τα φαγητά μου',
    description:
      'Foods the person has logged before, most used first, each with the calories (and carbs) it was last written with. ' +
      'Use it before add_food_entry so that a known food keeps the calories the person gave it.',
    write: false,
    input: z.object({ query: z.string().max(120).optional().describe('Part of the name. Empty = the most used foods.') }),
    run: (a, api) => api('GET', `/foods${q({ q: a.query })}`),
  },
  {
    name: 'add_food_entry',
    title: 'Καταχώριση φαγητού',
    description:
      'Writes something the person ate into the food diary. Calories are a whole number of kcal for the portion eaten; ' +
      'if the person did not give them, estimate, and say that it is an estimate.',
    write: true,
    input: z.object({
      name: z.string().min(1).max(120).describe('What was eaten, as the person would write it'),
      kcal: z.number().int().min(0).max(10000),
      day: optionalDay,
      time: time.optional().describe('HH:MM (24h). Default: now in the app time zone.'),
      carbs_g: z.number().min(0).max(2000).optional().describe('Carbohydrates in grams, if known'),
    }),
    run: (a, api) =>
      api('POST', '/entries', { name: a.name, kcal: a.kcal, day: a.day ?? today(), time: a.time ?? timeIn(config.timeZone), carbs_g: a.carbs_g ?? null }),
  },
  {
    name: 'update_food_entry',
    title: 'Διόρθωση καταχώρισης',
    description: 'Replaces a food diary entry. Every field is written again, so read the entry first (list_food_entries) and send back what should stay.',
    write: true,
    input: z.object({
      id: id.describe('Entry id from list_food_entries'),
      name: z.string().min(1).max(120),
      kcal: z.number().int().min(0).max(10000),
      day,
      time,
      carbs_g: z.number().min(0).max(2000).nullable().optional(),
    }),
    run: ({ id: entryId, ...rest }, api) => api('PUT', `/entries/${entryId}`, { ...rest, carbs_g: rest.carbs_g ?? null }),
  },
  {
    name: 'delete_food_entry',
    title: 'Διαγραφή καταχώρισης',
    description: 'Deletes a food diary entry for good. Confirm with the person which entry before calling.',
    write: true,
    destructive: true,
    input: z.object({ id: id.describe('Entry id from list_food_entries') }),
    run: (a, api) => api('DELETE', `/entries/${a.id}`),
  },

  // ---------------------------------------------------------------- body
  {
    name: 'get_profile',
    title: 'Στοιχεία σώματος',
    description: 'Sex, birth date, height and activity level the calorie needs are computed from. null when not filled in yet.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/profile'),
  },
  {
    name: 'update_profile',
    title: 'Αλλαγή στοιχείων σώματος',
    description:
      'Sets the body data. Send only what changes; the first time all four of sex, birth_date, height_cm and activity are needed. ' +
      'weight_kg, when given, is saved as today\'s weigh-in. Adults only (18+).',
    write: true,
    input: z.object({
      sex: z.enum(['male', 'female']).optional(),
      birth_date: day.optional(),
      height_cm: z.number().min(120).max(230).optional(),
      activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
      weight_kg: kg.optional(),
    }),
    run: async (a, api) => {
      const { profile } = await api('GET', '/profile');
      const next = { ...(profile ?? {}), ...defined(a) };
      const missing = ['sex', 'birth_date', 'height_cm', 'activity'].filter((k) => next[k] === undefined);
      if (missing.length) throw new ToolError(`The profile is not filled in yet; also needed: ${missing.join(', ')}`);
      return api('PUT', '/profile', next);
    },
  },
  {
    name: 'list_weights',
    title: 'Ζυγίσεις',
    description: 'Weigh-ins, newest first (one per calendar day).',
    write: false,
    input: z.object({ limit: z.number().int().min(1).max(1000).default(30) }),
    run: (a, api) => api('GET', `/weights${q({ limit: a.limit })}`),
  },
  {
    name: 'log_weight',
    title: 'Νέα ζύγιση',
    description: 'Saves a weigh-in. A day has one weight: writing again on the same day replaces it.',
    write: true,
    input: z.object({ kg, day: optionalDay }),
    run: (a, api) => api('POST', '/weights', defined({ kg: a.kg, day: a.day })),
  },
  {
    name: 'delete_weight',
    title: 'Διαγραφή ζύγισης',
    description: 'Deletes the weigh-in of a day for good. Confirm with the person before calling.',
    write: true,
    destructive: true,
    input: z.object({ day }),
    run: (a, api) => api('DELETE', `/weights/${a.day}`),
  },

  // ---------------------------------------------------------------- diets
  {
    name: 'list_diets',
    title: 'Δίαιτες',
    description: 'Every diet session, newest first, with its statistics (days, deficit, fat lost, adherence, weight change, projected goal day). The running one has active:true.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/diets'),
  },
  {
    name: 'start_diet',
    title: 'Έναρξη δίαιτας',
    description:
      'Starts a diet session. Only one can run at a time, and the profile with a weigh-in must exist. ' +
      'While it runs, the daily target is maintenance minus the deficit of the chosen pace (never under 1200 kcal for women / 1500 kcal for men).',
    write: true,
    input: z.object({
      rate_kg_week: z.number().min(0.1).max(1).describe('Pace: kg to lose per week (0.1 to 1)'),
      name: z.string().max(80).optional(),
      started_on: day.optional().describe('Default: today. Not in the future, at most a year back.'),
      planned_days: z.number().int().min(1).max(730).optional().describe('Planned length in days'),
      goal_weight_kg: kg.optional().describe('Goal weight; must be under the current weight'),
    }),
    run: (a, api) => api('POST', '/diets', defined(a)),
  },
  {
    name: 'update_diet',
    title: 'Αλλαγή δίαιτας',
    description: 'Changes the name, pace, planned length or goal weight of a diet. Send only what changes; null clears planned_days or goal_weight_kg.',
    write: true,
    input: z.object({
      id: id.describe('Diet id from list_diets'),
      name: z.string().min(1).max(80).optional(),
      rate_kg_week: z.number().min(0.1).max(1).optional(),
      planned_days: z.number().int().min(1).max(730).nullable().optional(),
      goal_weight_kg: kg.nullable().optional(),
    }),
    run: ({ id: dietId, ...rest }, api) => api('PATCH', `/diets/${dietId}`, defined(rest)),
  },
  {
    name: 'end_diet',
    title: 'Τέλος δίαιτας',
    description: 'Ends the running diet; it stays in the history with what was achieved. A weight given here is also saved as the weigh-in of that day.',
    write: true,
    input: z.object({
      id: id.describe('Diet id from list_diets'),
      ended_on: day.optional().describe('Default: today'),
      end_weight_kg: kg.optional(),
    }),
    run: ({ id: dietId, ...rest }, api) => api('POST', `/diets/${dietId}/end`, defined(rest)),
  },
  {
    name: 'delete_diet',
    title: 'Διαγραφή δίαιτας',
    description: 'Removes a diet session for good (the food diary and the weigh-ins of those days stay). Confirm with the person before calling.',
    write: true,
    destructive: true,
    input: z.object({ id: id.describe('Diet id from list_diets') }),
    run: (a, api) => api('DELETE', `/diets/${a.id}`),
  },

  // ---------------------------------------------------------------- meal plan
  {
    name: 'get_meal_plan',
    title: 'Πλάνο γευμάτων',
    description: 'The meal plan behind the "pace of the day": meals with their hour and share of the daily target, the grace minutes, the tolerance, and the defaults.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/plan'),
  },
  {
    name: 'update_meal_plan',
    title: 'Αλλαγή πλάνου γευμάτων',
    description: 'Changes the meal plan. Send only what changes. `meals` replaces the whole list: the shares must add up to 100 and the hours must differ.',
    write: true,
    input: z.object({
      meals: z.array(meal).max(8).optional(),
      grace_min: z.number().int().min(0).max(180).optional().describe('Minutes after a meal time before the person counts as behind'),
      tolerance_pct: z.number().int().min(0).max(25).optional().describe('How far behind is still fine, percent of the daily target'),
      notify: z.boolean().optional().describe('Send a push notification when behind'),
    }),
    run: (a, api) => api('PUT', '/plan', defined(a)),
  },

  // ---------------------------------------------------------------- notifications
  {
    name: 'get_notification_settings',
    title: 'Ρυθμίσεις ειδοποιήσεων',
    description: 'What push notifications the person gets and when, and on how many devices.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/notifications'),
  },
  {
    name: 'update_notification_settings',
    title: 'Αλλαγή ειδοποιήσεων',
    description:
      'Changes the push notification settings. Send only what changes. Times are HH:MM in the app time zone. ' +
      '(Turning push on for a phone or browser is done in the app on that device; it cannot be done from here.)',
    write: true,
    input: z.object({
      reminders: z.boolean().optional().describe('Meal reminders at reminder_times'),
      reminder_times: z.array(time).max(8).optional(),
      motivation: z.boolean().optional().describe('Once a day how yesterday went, plus milestones'),
      motivation_time: time.optional(),
      weekly: z.boolean().optional().describe('Summary of the week, every Monday'),
      energy: z.boolean().optional().describe('"Eat something" when the last meal is too far back'),
      energy_gap_min: z.number().int().min(120).max(480).optional(),
      energy_from: time.optional(),
      energy_until: time.optional(),
    }),
    run: (a, api) => api('PUT', '/notifications', defined(a)),
  },
  {
    name: 'list_notification_history',
    title: 'Ιστορικό ειδοποιήσεων',
    description: 'The latest 30 notifications that were sent, newest first.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/notifications/history'),
  },
  {
    name: 'send_test_notification',
    title: 'Δοκιμαστική ειδοποίηση',
    description: 'Sends a test push notification to every device of the person. Answers how many were sent.',
    write: true,
    input: none,
    run: (_a, api) => api('POST', '/push/test'),
  },
];
