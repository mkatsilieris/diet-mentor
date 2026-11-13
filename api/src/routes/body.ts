import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { addDays, ageOn, isDay } from '../lib/days.js';
import type { Profile, WeighIn } from '../lib/summary.js';
import { today } from '../tracker.js';

/** The body the calories are computed from: sex, age, height, activity, and the weight over time. */
export const profileRouter = Router();
export const weightsRouter = Router();
profileRouter.use(requireAuth);
weightsRouter.use(requireAuth);

const day = z.string().refine(isDay, 'Μη έγκυρη ημερομηνία');
const kg = z.number().min(30, 'Το βάρος πρέπει να είναι τουλάχιστον 30 kg').max(300, 'Το βάρος πρέπει να είναι ως 300 kg');

const profileBody = z.object({
  sex: z.enum(['male', 'female']),
  birth_date: day,
  height_cm: z.number().min(120, 'Το ύψος πρέπει να είναι τουλάχιστον 120 cm').max(230, 'Το ύψος πρέπει να είναι ως 230 cm'),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  /** saved as today's weigh-in, so that the first form is enough to get going */
  weight_kg: kg.optional(),
});

async function upsertWeight(userId: number, d: string, value: number): Promise<void> {
  await pool.query(
    `INSERT INTO weigh_ins (user_id, day, kg) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, day) DO UPDATE SET kg = EXCLUDED.kg`,
    [userId, d, value],
  );
}

profileRouter.get('/', async (req, res) => {
  const { rows } = await pool.query<Profile>('SELECT sex, birth_date, height_cm, activity FROM profiles WHERE user_id = $1', [req.user.id]);
  res.json({ profile: rows[0] ?? null });
});

profileRouter.put('/', async (req, res) => {
  const body = profileBody.parse(req.body);
  const age = ageOn(body.birth_date, today());
  if (age < 18) throw badRequest('Οι υπολογισμοί ισχύουν για ενήλικες (18 ετών και άνω)');
  if (age > 100) throw badRequest('Ελέγξτε την ημερομηνία γέννησης');

  const { rows } = await pool.query<Profile>(
    `INSERT INTO profiles (user_id, sex, birth_date, height_cm, activity) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET sex = EXCLUDED.sex, birth_date = EXCLUDED.birth_date,
       height_cm = EXCLUDED.height_cm, activity = EXCLUDED.activity, updated_at = now()
     RETURNING sex, birth_date, height_cm, activity`,
    [req.user.id, body.sex, body.birth_date, body.height_cm, body.activity],
  );
  if (body.weight_kg !== undefined) await upsertWeight(req.user.id, today(), body.weight_kg);
  req.log.info({ user: req.user.id }, 'profile saved');
  res.json({ profile: rows[0] });
});

weightsRouter.get('/', async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(1000).default(120).parse(req.query.limit);
  const { rows } = await pool.query<WeighIn>('SELECT day, kg FROM weigh_ins WHERE user_id = $1 ORDER BY day DESC LIMIT $2', [req.user.id, limit]);
  res.json({ weights: rows });
});

weightsRouter.post('/', async (req, res) => {
  const body = z.object({ day: day.optional(), kg }).parse(req.body);
  const d = body.day ?? today();
  // one day of slack: the phone may be in a time zone ahead of the server's
  if (d > addDays(today(), 1)) throw badRequest('Η ζύγιση δεν μπορεί να είναι στο μέλλον');
  await upsertWeight(req.user.id, d, body.kg);
  req.log.info({ user: req.user.id, day: d }, 'weigh-in saved');
  res.status(201).json({ weight: { day: d, kg: body.kg } });
});

weightsRouter.delete('/:day', async (req, res) => {
  const d = day.parse(req.params.day);
  const { rowCount } = await pool.query('DELETE FROM weigh_ins WHERE user_id = $1 AND day = $2', [req.user.id, d]);
  if (!rowCount) throw notFound('Δεν υπάρχει ζύγιση αυτή τη μέρα');
  res.status(204).end();
});
