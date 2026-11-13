import { config } from './config.js';
import { pool, type Queryable } from './db.js';
import { todayIn, type Day } from './lib/days.js';
import type { Diet, Inputs, Profile, WeighIn, DayIntake } from './lib/summary.js';

/** The calendar day it is now for the people using this installation. */
export const today = (): Day => todayIn(config.timeZone);

export const DIET_COLUMNS =
  'id, name, started_on, ended_on, planned_days, rate_kg_week, start_weight_kg, goal_weight_kg, end_weight_kg';

/** Everything lib/summary.ts needs about one person. */
export async function loadInputs(userId: number, db: Queryable = pool): Promise<Inputs> {
  const [profile, weights, intakes, diets] = await Promise.all([
    db.query<Profile>('SELECT sex, birth_date, height_cm, activity FROM profiles WHERE user_id = $1', [userId]),
    db.query<WeighIn>('SELECT day, kg FROM weigh_ins WHERE user_id = $1 ORDER BY day', [userId]),
    db.query<DayIntake>(
      `SELECT day, SUM(kcal)::int AS kcal, COUNT(*)::int AS entries,
              CASE WHEN COUNT(carbs_g) = COUNT(*) THEN SUM(carbs_g)::float8 END AS carbs_g
         FROM food_entries WHERE user_id = $1 GROUP BY day ORDER BY day`,
      [userId],
    ),
    db.query<Diet>(`SELECT ${DIET_COLUMNS} FROM diets WHERE user_id = $1 ORDER BY started_on`, [userId]),
  ]);
  return {
    profile: profile.rows[0] ?? null,
    weights: weights.rows,
    intakes: intakes.rows,
    diets: diets.rows,
    today: today(),
  };
}
