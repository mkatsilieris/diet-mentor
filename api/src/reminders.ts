import { config } from './config.js';
import { pool } from './db.js';
import { log } from './log.js';
import { todayIn } from './lib/days.js';
import { buildSummary } from './lib/summary.js';
import { paceAt, paceKey, paceNudge } from './lib/pace.js';
import { loadPlan } from './plan.js';
import {
  DEFAULT_SETTINGS,
  SETTINGS_COLUMNS,
  baselineKeys,
  dueSlot,
  energyGap,
  energyNudge,
  mealReminder,
  motivationNudges,
  type NotificationSettings,
  type Nudge,
} from './lib/nudges.js';
import { sendPushToUser } from './notify.js';
import { loadInputs } from './tracker.js';

/**
 * The notification scheduler. Once a minute it looks at the clock (in DISPLAY_TZ) and, for every
 * person with a device that accepts push, sends the meal reminder or the daily motivation whose
 * time has come, and the "eat something" call when the last meal is too far back. What to say is decided in lib/nudges.ts; here is only the clock, the database and
 * the sending. Every message is written to `notifications` first, under a key that is unique per
 * person, so nothing is sent twice - not after a restart, not with two ticks in the same window.
 */

/** 'HH:MM' right now in the given time zone. */
export function timeIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** The person's notification settings, created with the defaults the first time they are asked for. */
export async function loadNotificationSettings(userId: number): Promise<NotificationSettings> {
  const d = DEFAULT_SETTINGS;
  const { rows } = await pool.query<NotificationSettings>(
    `INSERT INTO notification_settings (user_id, reminders, reminder_times, motivation, motivation_time, weekly)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${SETTINGS_COLUMNS}`,
    [userId, d.reminders, d.reminder_times, d.motivation, d.motivation_time, d.weekly],
  );
  return rows[0];
}

/** Takes the key for this person. False when it was taken before: that message is done. */
async function claim(userId: number, dedupe: string, kind: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO notifications (user_id, dedupe, kind) VALUES ($1, $2, $3) ON CONFLICT (user_id, dedupe) DO NOTHING`,
    [userId, dedupe, kind],
  );
  return Boolean(rowCount);
}

async function deliver(userId: number, nudge: Nudge): Promise<void> {
  const result = await sendPushToUser(userId, { title: nudge.title, body: nudge.body, tag: nudge.kind, url: nudge.url });
  await pool.query('UPDATE notifications SET title = $3, body = $4, sent = $5 WHERE user_id = $1 AND dedupe = $2', [
    userId,
    nudge.dedupe,
    nudge.title,
    nudge.body,
    result.sent,
  ]);
  log.info({ user: userId, nudge: nudge.dedupe, sent: result.sent, failed: result.failed }, 'notification');
}

type SettingsRow = NotificationSettings & { user_id: number };

/** The entries of the day as the diary has them. */
async function entriesOf(userId: number, day: string): Promise<{ time: string; kcal: number }[]> {
  const { rows } = await pool.query<{ time: string; kcal: number }>(
    `SELECT to_char(eaten_time, 'HH24:MI') AS time, kcal FROM food_entries WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  return rows;
}

const suppress = (userId: number, dedupe: string, why: string) =>
  pool.query('UPDATE notifications SET suppressed = $3 WHERE user_id = $1 AND dedupe = $2', [userId, dedupe, why]);

/** Whether a call to eat (meal reminder, pace, energy) went out in the last 45 minutes: the next one waits. */
async function calledRecently(userId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM notifications
      WHERE user_id = $1 AND kind IN ('reminder', 'pace', 'energy') AND title IS NOT NULL AND created_at > now() - interval '45 minutes'`,
    [userId],
  );
  return Boolean(rowCount);
}

/**
 * Behind the meal plan: every step of the plan is judged once, when its grace ends. What was eaten
 * only grows during a day, so a step that was kept needs no second look.
 */
async function runPace(s: SettingsRow, day: string, now: string): Promise<void> {
  const plan = await loadPlan(s.user_id);
  if (!plan.notify) return;
  const key = paceKey(day, paceAt(now, plan, 0, 0)); // the step that is judged depends on the clock only
  if (!key) return;
  const taken = await pool.query('SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe = $2', [s.user_id, key]);
  if (taken.rowCount) return;
  if (await calledRecently(s.user_id)) return;
  if (!(await claim(s.user_id, key, 'pace'))) return;

  const summary = buildSummary(await loadInputs(s.user_id));
  const nudge = summary.ready ? paceNudge(day, paceAt(now, plan, summary.day.target, summary.day.intake)) : null;
  if (nudge) await deliver(s.user_id, nudge);
  else await suppress(s.user_id, key, summary.ready ? 'on pace' : 'no profile');
}

/** "Eat something": looked at every minute, because it depends on when the last meal was written. */
async function runEnergy(s: SettingsRow, day: string, now: string): Promise<void> {
  if (!s.energy || now < s.energy_from || now > s.energy_until) return;
  const gap = energyGap(now, day, await entriesOf(s.user_id, day), s);
  if (!gap) return;
  // a call to eat that just went out says enough; the gap is looked at again after it
  if (await calledRecently(s.user_id)) return;
  if (!(await claim(s.user_id, gap.dedupe, 'energy'))) return;

  const summary = buildSummary(await loadInputs(s.user_id));
  const nudge = summary.ready ? energyNudge(gap, summary) : null;
  if (nudge) await deliver(s.user_id, nudge);
  else await suppress(s.user_id, gap.dedupe, summary.ready ? 'no room' : 'no profile');
}

async function runFor(s: SettingsRow, day: string, now: string): Promise<void> {
  const slot = s.reminders ? dueSlot(s.reminder_times, now) : null;
  const dailyDue = (s.motivation || s.weekly) && dueSlot([s.motivation_time], now) !== null;

  // take the keys before any work: most ticks inside a window end here
  const doReminder = slot !== null && (await claim(s.user_id, `reminder/${day}/${slot}`, 'reminder'));
  const doDaily = dailyDue && (await claim(s.user_id, `run/${day}`, 'run'));

  if (doReminder || doDaily) {
    const summary = buildSummary(await loadInputs(s.user_id));
    if (!summary.ready) return; // no profile yet: nothing to remind about, now or below

    if (doReminder && slot) {
      const entries = await entriesOf(s.user_id, day);
      const nudge = mealReminder(slot, s.reminder_times, entries.map((r) => r.time), summary);
      if (nudge) await deliver(s.user_id, nudge);
      else await suppress(s.user_id, `reminder/${day}/${slot}`, 'logged');
    }

    if (doDaily) {
      // the first run for a person only notes what is already achieved
      if (await claim(s.user_id, 'baseline', 'run')) {
        for (const key of baselineKeys(summary)) await claim(s.user_id, key, 'baseline');
      }
      for (const nudge of motivationNudges(summary, s)) {
        if (await claim(s.user_id, nudge.dedupe, nudge.kind)) await deliver(s.user_id, nudge);
      }
    }
  }

  await runPace(s, day, now);
  await runEnergy(s, day, now);
}

let running = false;

export async function tick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const day = todayIn(config.timeZone, now);
    const time = timeIn(config.timeZone, now);
    const { rows } = await pool.query<SettingsRow>(
      `SELECT s.user_id, ${SETTINGS_COLUMNS}
         FROM notification_settings s
        WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)`,
    );
    for (const s of rows) {
      try {
        await runFor(s, day, time);
      } catch (err) {
        log.error({ err, user: s.user_id }, 'notification run failed');
      }
    }
  } catch (err) {
    log.error({ err }, 'notification tick failed');
  } finally {
    running = false;
  }
}

export function startReminders(): void {
  setInterval(() => void tick(), 60_000).unref();
  log.info({ timeZone: config.timeZone }, 'notification scheduler started');
}
