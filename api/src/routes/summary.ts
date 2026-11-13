import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { paceAt } from '../lib/pace.js';
import { buildSummary } from '../lib/summary.js';
import { loadPlan } from '../plan.js';
import { timeIn } from '../reminders.js';
import { loadInputs } from '../tracker.js';

/** Calorie needs, today, deficits per week and month, glycogen, the running diet, the mentor's remarks, the pace of the day. */
export const summaryRouter = Router();
summaryRouter.use(requireAuth);

summaryRouter.get('/', async (req, res) => {
  const [inputs, plan] = await Promise.all([loadInputs(req.user.id), loadPlan(req.user.id)]);
  const summary = buildSummary(inputs);
  if (!summary.ready) {
    res.json(summary);
    return;
  }
  res.json({ ...summary, pace: paceAt(timeIn(config.timeZone), plan, summary.day.target, summary.day.intake) });
});
