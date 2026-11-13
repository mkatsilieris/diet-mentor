import { pool } from './db.js';
import { DEFAULT_PLAN, sortMeals, type MealPlan } from './lib/pace.js';

/** The person's meal plan; the default one until they save their own. */
export async function loadPlan(userId: number): Promise<MealPlan> {
  const { rows } = await pool.query<MealPlan>('SELECT meals, grace_min, tolerance_pct, notify FROM meal_plans WHERE user_id = $1', [userId]);
  return rows[0] ?? DEFAULT_PLAN;
}

export async function savePlan(userId: number, plan: MealPlan): Promise<MealPlan> {
  const { rows } = await pool.query<MealPlan>(
    `INSERT INTO meal_plans (user_id, meals, grace_min, tolerance_pct, notify) VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET meals = EXCLUDED.meals, grace_min = EXCLUDED.grace_min,
       tolerance_pct = EXCLUDED.tolerance_pct, notify = EXCLUDED.notify, updated_at = now()
     RETURNING meals, grace_min, tolerance_pct, notify`,
    [userId, JSON.stringify(sortMeals(plan.meals)), plan.grace_min, plan.tolerance_pct, plan.notify],
  );
  return rows[0];
}
