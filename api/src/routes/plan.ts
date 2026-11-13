import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { badRequest } from '../errors.js';
import { isTime } from '../lib/nudges.js';
import { DEFAULT_PLAN, MAX_MEALS, planProblem, type MealPlan } from '../lib/pace.js';
import { loadPlan, savePlan } from '../plan.js';

/** The meal plan of the signed-in person: which share of the day's calories is due by which hour. */
export const planRouter = Router();
planRouter.use(requireAuth);

const body = z
  .object({
    meals: z
      .array(
        z.object({
          time: z.string().refine(isTime, 'Η ώρα γράφεται ΩΩ:ΛΛ'),
          name: z.string().trim().min(1, 'Κάθε γεύμα θέλει όνομα').max(40),
          pct: z.number().int().min(1, 'Το ποσοστό είναι από 1 ως 100').max(100, 'Το ποσοστό είναι από 1 ως 100'),
        }),
      )
      .max(MAX_MEALS),
    grace_min: z.number().int().min(0).max(180),
    tolerance_pct: z.number().int().min(0).max(25),
    notify: z.boolean(),
  })
  .partial();

planRouter.get('/', async (req, res) => {
  res.json({ plan: await loadPlan(req.user.id), defaults: DEFAULT_PLAN });
});

planRouter.put('/', async (req, res) => {
  const change = body.parse(req.body);
  const current = await loadPlan(req.user.id);
  const next: MealPlan = { ...current, ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) };
  const problem = planProblem(next.meals);
  if (problem) throw badRequest(problem);
  const plan = await savePlan(req.user.id, next);
  req.log.info({ user: req.user.id, meals: plan.meals.length, grace: plan.grace_min, notify: plan.notify }, 'meal plan saved');
  res.json({ plan, defaults: DEFAULT_PLAN });
});
