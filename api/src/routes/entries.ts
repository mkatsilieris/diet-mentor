import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { addDays, isDay } from '../lib/days.js';
import { today } from '../tracker.js';

/** The food diary: what was eaten, how many calories, on which day and at what time. */
export const entriesRouter = Router();
export const foodsRouter = Router();
entriesRouter.use(requireAuth);
foodsRouter.use(requireAuth);

interface EntryRow {
  id: number;
  day: string;
  time: string;
  name: string;
  kcal: number;
  carbs_g: number | null;
}

const COLUMNS = `id, day, to_char(eaten_time, 'HH24:MI') AS time, name, kcal, carbs_g`;

const day = z.string().refine(isDay, 'Μη έγκυρη ημερομηνία');
const entryBody = z.object({
  day,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Η ώρα γράφεται ΩΩ:ΛΛ'),
  name: z.string().trim().min(1, 'Γράψε τι έφαγες').max(120),
  kcal: z.number().int('Οι θερμίδες είναι ακέραιος αριθμός').min(0).max(10000, 'Πάνω από 10.000 kcal σε μία καταχώριση;'),
  carbs_g: z.number().min(0).max(2000).nullable().optional(),
});

function checkDay(d: string): void {
  // one day of slack: the phone may be in a time zone ahead of the server's
  if (d > addDays(today(), 1)) throw badRequest('Δεν γράφουμε φαγητό για μέρες που δεν ήρθαν ακόμη');
  if (d < addDays(today(), -1500)) throw badRequest('Η μέρα είναι πολύ παλιά');
}

entriesRouter.get('/', async (req, res) => {
  const d = day.parse(req.query.day ?? today());
  const { rows } = await pool.query<EntryRow>(
    `SELECT ${COLUMNS} FROM food_entries WHERE user_id = $1 AND day = $2 ORDER BY eaten_time, id`,
    [req.user.id, d],
  );
  res.json({ day: d, entries: rows, total_kcal: rows.reduce((s, r) => s + r.kcal, 0) });
});

entriesRouter.post('/', async (req, res) => {
  const body = entryBody.parse(req.body);
  checkDay(body.day);
  const { rows } = await pool.query<EntryRow>(
    `INSERT INTO food_entries (user_id, day, eaten_time, name, kcal, carbs_g) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [req.user.id, body.day, body.time, body.name, body.kcal, body.carbs_g ?? null],
  );
  req.log.info({ user: req.user.id, day: body.day, kcal: body.kcal }, 'food entry added');
  res.status(201).json({ entry: rows[0] });
});

entriesRouter.put('/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = entryBody.parse(req.body);
  checkDay(body.day);
  const { rows } = await pool.query<EntryRow>(
    `UPDATE food_entries SET day = $3, eaten_time = $4, name = $5, kcal = $6, carbs_g = $7
      WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, req.user.id, body.day, body.time, body.name, body.kcal, body.carbs_g ?? null],
  );
  if (!rows[0]) throw notFound('Η καταχώριση δεν βρέθηκε');
  res.json({ entry: rows[0] });
});

entriesRouter.delete('/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM food_entries WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rowCount) throw notFound('Η καταχώριση δεν βρέθηκε');
  res.status(204).end();
});

/**
 * The person's own foods, most used first, to fill the form with one tap: each name with the
 * calories (and carbs) it was last written with.
 */
foodsRouter.get('/', async (req, res) => {
  const q = z.string().trim().max(120).default('').parse(req.query.q);
  const { rows } = await pool.query(
    `SELECT name, kcal, carbs_g, uses FROM (
       SELECT DISTINCT ON (lower(name)) name, kcal, carbs_g, created_at,
              (COUNT(*) OVER (PARTITION BY lower(name)))::int AS uses
         FROM food_entries
        WHERE user_id = $1 AND ($2 = '' OR position(lower($2) in lower(name)) > 0)
        ORDER BY lower(name), created_at DESC
     ) latest
     ORDER BY uses DESC, created_at DESC
     LIMIT 40`,
    [req.user.id, q],
  );
  res.json({ foods: rows });
});
