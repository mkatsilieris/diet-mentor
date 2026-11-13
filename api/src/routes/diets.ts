import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { addDays, isDay } from '../lib/days.js';
import { MAX_RATE } from '../lib/energy.js';
import { buildTimeline, dietStats, isReady, type Diet } from '../lib/summary.js';
import { DIET_COLUMNS, loadInputs, today } from '../tracker.js';

/** Diet sessions: started on a day, ended on a later one, with a pace and optionally a length and a goal weight. */
export const dietsRouter = Router();
dietsRouter.use(requireAuth);

const day = z.string().refine(isDay, 'Μη έγκυρη ημερομηνία');
const kg = z.number().min(30).max(300);
const rate = z.number().min(0.1, 'Ο ρυθμός είναι τουλάχιστον 0,1 kg την εβδομάδα').max(MAX_RATE, `Ο ρυθμός είναι το πολύ ${MAX_RATE} kg την εβδομάδα`);
const plannedDays = z.number().int().min(1).max(730).nullable();
const id = z.coerce.number().int().positive();

dietsRouter.get('/', async (req, res) => {
  const input = await loadInputs(req.user.id);
  const rows = buildTimeline(input);
  const diets = [...input.diets].reverse().map((d) => dietStats(d, rows, input.weights, input.today));
  res.json({ diets });
});

dietsRouter.post('/', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().max(80).optional(),
      started_on: day.optional(),
      planned_days: plannedDays.optional(),
      rate_kg_week: rate,
      goal_weight_kg: kg.nullable().optional(),
    })
    .parse(req.body);

  const input = await loadInputs(req.user.id);
  if (!isReady(input)) throw badRequest('Συμπλήρωσε πρώτα τα στοιχεία σου (φύλο, ηλικία, ύψος, βάρος)');
  if (input.diets.some((d) => d.ended_on === null)) throw new HttpError(409, 'Τρέχει ήδη μια δίαιτα. Τελείωσέ την πριν ξεκινήσεις άλλη.');

  const start = body.started_on ?? input.today;
  if (start > input.today) throw badRequest('Η δίαιτα δεν μπορεί να ξεκινά στο μέλλον');
  if (start < addDays(input.today, -365)) throw badRequest('Η έναρξη είναι πάνω από έναν χρόνο πίσω');
  const lastEnd = input.diets.map((d) => d.ended_on as string).sort().at(-1);
  if (lastEnd && start <= lastEnd) throw badRequest('Η έναρξη πέφτει μέσα σε προηγούμενη δίαιτα');

  // the weight on the day it starts: the latest weigh-in up to then, or the first one after
  const before = input.weights.filter((w) => w.day <= start).at(-1);
  const startKg = (before ?? input.weights[0]).kg;
  if (body.goal_weight_kg != null && body.goal_weight_kg >= startKg) {
    throw badRequest('Το βάρος-στόχος πρέπει να είναι κάτω από το τωρινό');
  }

  const name = body.name || `Δίαιτα ${start.slice(8)}/${start.slice(5, 7)}/${start.slice(0, 4)}`;
  const { rows } = await pool.query<Diet>(
    `INSERT INTO diets (user_id, name, started_on, planned_days, rate_kg_week, start_weight_kg, goal_weight_kg)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${DIET_COLUMNS}`,
    [req.user.id, name, start, body.planned_days ?? null, body.rate_kg_week, startKg, body.goal_weight_kg ?? null],
  );
  req.log.info({ user: req.user.id, diet: rows[0].id, start, rate: body.rate_kg_week }, 'diet started');
  res.status(201).json({ diet: rows[0] });
});

async function ownDiet(userId: number, dietId: number): Promise<Diet> {
  const { rows } = await pool.query<Diet>(`SELECT ${DIET_COLUMNS} FROM diets WHERE id = $1 AND user_id = $2`, [dietId, userId]);
  if (!rows[0]) throw notFound('Η δίαιτα δεν βρέθηκε');
  return rows[0];
}

/** Ends the diet (today unless another day is given). A weight given here is also saved as the weigh-in of that day. */
dietsRouter.post('/:id/end', async (req, res) => {
  const body = z.object({ ended_on: day.optional(), end_weight_kg: kg.nullable().optional() }).parse(req.body ?? {});
  const diet = await ownDiet(req.user.id, id.parse(req.params.id));
  if (diet.ended_on !== null) throw new HttpError(409, 'Η δίαιτα έχει ήδη τελειώσει');

  const end = body.ended_on ?? today();
  if (end > today()) throw badRequest('Η λήξη δεν μπορεί να είναι στο μέλλον');
  if (end < diet.started_on) throw badRequest('Η λήξη δεν μπορεί να είναι πριν από την έναρξη');

  let endKg = body.end_weight_kg ?? null;
  if (endKg !== null) {
    await pool.query(
      `INSERT INTO weigh_ins (user_id, day, kg) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, day) DO UPDATE SET kg = EXCLUDED.kg`,
      [req.user.id, end, endKg],
    );
  } else {
    const last = await pool.query<{ kg: number }>(
      'SELECT kg FROM weigh_ins WHERE user_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day DESC LIMIT 1',
      [req.user.id, diet.started_on, end],
    );
    endKg = last.rows[0]?.kg ?? null;
  }
  const { rows } = await pool.query<Diet>(
    `UPDATE diets SET ended_on = $2, end_weight_kg = $3 WHERE id = $1 RETURNING ${DIET_COLUMNS}`,
    [diet.id, end, endKg],
  );
  req.log.info({ user: req.user.id, diet: diet.id, end }, 'diet ended');
  res.json({ diet: rows[0] });
});

dietsRouter.patch('/:id', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(80),
      planned_days: plannedDays,
      rate_kg_week: rate,
      goal_weight_kg: kg.nullable(),
    })
    .partial()
    .parse(req.body);
  const diet = await ownDiet(req.user.id, id.parse(req.params.id));
  const next = { ...diet, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as Diet;
  const { rows } = await pool.query<Diet>(
    `UPDATE diets SET name = $2, planned_days = $3, rate_kg_week = $4, goal_weight_kg = $5 WHERE id = $1 RETURNING ${DIET_COLUMNS}`,
    [diet.id, next.name, next.planned_days, next.rate_kg_week, next.goal_weight_kg],
  );
  res.json({ diet: rows[0] });
});

/** Removes the session only; the food diary and the weigh-ins of those days stay. */
dietsRouter.delete('/:id', async (req, res) => {
  const diet = await ownDiet(req.user.id, id.parse(req.params.id));
  await pool.query('DELETE FROM diets WHERE id = $1', [diet.id]);
  req.log.info({ user: req.user.id, diet: diet.id }, 'diet deleted');
  res.status(204).end();
});
