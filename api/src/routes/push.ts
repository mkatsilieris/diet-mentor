import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { badRequest } from '../errors.js';
import { SETTINGS_COLUMNS, isTime, type NotificationSettings } from '../lib/nudges.js';
import { pushPublicKey, sendPushToUser } from '../notify.js';
import { loadNotificationSettings } from '../reminders.js';

/** Web Push subscriptions of the signed-in person's devices, and what they want to be told. */
export const pushRouter = Router();
export const notificationsRouter = Router();
pushRouter.use(requireAuth);
notificationsRouter.use(requireAuth);

pushRouter.get('/key', (_req, res) => {
  res.json({ key: pushPublicKey() });
});

const subscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
});

pushRouter.post('/subscribe', async (req, res) => {
  const body = subscription.parse(req.body);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, failures = 0`,
    [req.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, (req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  await loadNotificationSettings(req.user.id); // the scheduler only looks at people who have settings
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
  req.log.info({ user: req.user.id, devices: rows[0].n }, 'push subscription saved');
  res.status(201).json({ ok: true, devices: rows[0].n });
});

pushRouter.delete('/subscribe', async (req, res) => {
  const body = z.object({ endpoint: z.string().min(1) }).parse(req.body);
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, body.endpoint]);
  res.status(204).end();
});

/** Sends a test notification to every device of the person, so they can see it works. */
pushRouter.post('/test', async (req, res) => {
  const result = await sendPushToUser(req.user.id, {
    title: 'Δοκιμαστική ειδοποίηση',
    body: 'Έτσι θα έρχονται οι υπενθυμίσεις και τα νέα της προόδου σου.',
    tag: 'test',
    url: '/',
  });
  res.json(result);
});

const time = z.string().refine(isTime, 'Η ώρα γράφεται ΩΩ:ΛΛ');
const settingsBody = z
  .object({
    reminders: z.boolean(),
    reminder_times: z.array(time).max(8, 'Ως 8 υπενθυμίσεις τη μέρα'),
    motivation: z.boolean(),
    motivation_time: time,
    weekly: z.boolean(),
    energy: z.boolean(),
    energy_gap_min: z.number().int().min(120, 'Τουλάχιστον 2 ώρες').max(480, 'Ως 8 ώρες'),
    energy_from: time,
    energy_until: time,
  })
  .partial();

async function envelope(userId: number, settings: NotificationSettings) {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [userId]);
  return { settings, devices: rows[0].n };
}

notificationsRouter.get('/', async (req, res) => {
  res.json(await envelope(req.user.id, await loadNotificationSettings(req.user.id)));
});

notificationsRouter.put('/', async (req, res) => {
  const body = settingsBody.parse(req.body);
  const current = await loadNotificationSettings(req.user.id);
  const next: NotificationSettings = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
  next.reminder_times = [...new Set(next.reminder_times)].sort();
  if (next.reminders && next.reminder_times.length === 0) throw badRequest('Βάλε τουλάχιστον μία ώρα υπενθύμισης, ή κλείσε τις υπενθυμίσεις');
  if (next.energy_from >= next.energy_until) throw badRequest('Η ώρα «από» πρέπει να είναι πριν από την ώρα «ως»');

  const { rows } = await pool.query<NotificationSettings>(
    `UPDATE notification_settings SET reminders = $2, reminder_times = $3, motivation = $4, motivation_time = $5, weekly = $6,
       energy = $7, energy_gap_min = $8, energy_from = $9, energy_until = $10, updated_at = now()
      WHERE user_id = $1 RETURNING ${SETTINGS_COLUMNS}`,
    [
      req.user.id,
      next.reminders,
      next.reminder_times,
      next.motivation,
      next.motivation_time,
      next.weekly,
      next.energy,
      next.energy_gap_min,
      next.energy_from,
      next.energy_until,
    ],
  );
  req.log.info({ user: req.user.id, reminders: next.reminders ? next.reminder_times : [], motivation: next.motivation }, 'notification settings saved');
  res.json(await envelope(req.user.id, rows[0]));
});

/** The latest notifications that were sent, newest first. */
notificationsRouter.get('/history', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, kind, title, body, sent, created_at FROM notifications
      WHERE user_id = $1 AND title IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
    [req.user.id],
  );
  res.json({ notifications: rows });
});
