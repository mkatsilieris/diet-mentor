import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireSession } from '../auth.js';
import { HttpError, notFound } from '../errors.js';
import { DEFAULT_TOKEN_LIFETIME, MAX_TOKENS_PER_USER, TOKEN_LIFETIMES, generateToken } from '../lib/tokens.js';

/**
 * Personal access tokens of the signed-in person (Profile > Claude). Only a login session may
 * come here: a token cannot list, make or revoke tokens.
 */
export const tokensRouter = Router();
tokensRouter.use(requireSession);

const COLUMNS = 'id, name, hint, scope, created_at, expires_at, last_used_at';

tokensRouter.get('/', async (req, res) => {
  // expired tokens are of no use to anyone; clear them out when the person looks at the list
  await pool.query('DELETE FROM api_tokens WHERE user_id = $1 AND expires_at <= now()', [req.user.id]);
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]);
  res.json({ tokens: rows, lifetimes: TOKEN_LIFETIMES, max: MAX_TOKENS_PER_USER });
});

tokensRouter.post('/', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1, 'Δώσε ένα όνομα, π.χ. «Claude στο laptop»').max(60),
      scope: z.enum(['read', 'write']).default('write'),
      days: z
        .number()
        .int()
        .refine((d) => (TOKEN_LIFETIMES as readonly number[]).includes(d), `Η διάρκεια είναι ${TOKEN_LIFETIMES.join(', ')} ημέρες`)
        .default(DEFAULT_TOKEN_LIFETIME),
    })
    .parse(req.body);

  const count = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM api_tokens WHERE user_id = $1 AND expires_at > now()', [req.user.id]);
  if (count.rows[0].n >= MAX_TOKENS_PER_USER) throw new HttpError(409, `Ως ${MAX_TOKENS_PER_USER} tokens. Ανακάλεσε κάποιο που δεν χρειάζεσαι.`);

  const fresh = generateToken();
  const { rows } = await pool.query(
    `INSERT INTO api_tokens (user_id, name, token_hash, hint, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     RETURNING ${COLUMNS}`,
    [req.user.id, body.name, fresh.hash, fresh.hint, body.scope, body.days],
  );
  req.log.info({ user: req.user.id, tokenId: rows[0].id, scope: body.scope, days: body.days }, 'personal access token created');
  // the only time the token itself leaves the server
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ token: fresh.token, info: rows[0] });
});

tokensRouter.delete('/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rowCount) throw notFound('Το token δεν βρέθηκε');
  req.log.info({ user: req.user.id, tokenId: id }, 'personal access token revoked');
  res.status(204).end();
});
