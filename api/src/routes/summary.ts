import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { buildSummary } from '../lib/summary.js';
import { loadInputs } from '../tracker.js';

/** Calorie needs, today, deficits per week and month, glycogen, the running diet, the mentor's remarks. */
export const summaryRouter = Router();
summaryRouter.use(requireAuth);

summaryRouter.get('/', async (req, res) => {
  res.json(buildSummary(await loadInputs(req.user.id)));
});
