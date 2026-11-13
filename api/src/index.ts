import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { accessEnabled } from './access.js';
import { mailConfigured } from './mail.js';
import { migrate, waitForDb } from './db.js';
import { errorHandler } from './errors.js';
import { log, requestLogger } from './log.js';
import { authRouter } from './routes/auth.js';
import { profileRouter, weightsRouter } from './routes/body.js';
import { entriesRouter, foodsRouter } from './routes/entries.js';
import { dietsRouter } from './routes/diets.js';
import { summaryRouter } from './routes/summary.js';
import { planRouter } from './routes/plan.js';
import { notificationsRouter, pushRouter } from './routes/push.js';
import { initPush } from './notify.js';
import { startReminders } from './reminders.js';

const app = express();
app.disable('x-powered-by');
// Behind nginx (and Cloudflare): take the client IP / protocol from X-Forwarded-* headers.
app.set('trust proxy', 1);
// The SPA is served from the same origin, so only APP_URL (and localhost in dev) may call the API cross-origin.
const allowedOrigins = new Set([config.appUrl, ...(config.nodeEnv === 'production' ? [] : ['http://localhost:5173'])]);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)) }));
app.use(requestLogger);
app.use(express.json({ limit: '50kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/diets', dietsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/plan', planRouter);
app.use('/api/profile', profileRouter);
app.use('/api/weights', weightsRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/foods', foodsRouter);
app.use('/api/push', pushRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(errorHandler);

async function main() {
  if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-secret-change-me') {
    log.warn('JWT_SECRET is using the default value. Set it in .env!');
  }
  await waitForDb();
  await migrate();
  await initPush();
  app.listen(config.port, () => {
    log.info({ port: config.port, env: config.nodeEnv, logLevel: config.logLevel }, 'api listening');
    // One line that answers "is it configured?" without reading .env on the server.
    log.info({ cloudflareAccessSso: accessEnabled, smtp: mailConfigured, timeZone: config.timeZone }, 'features');
    startReminders();
  });
}

main().catch((err) => {
  log.fatal({ err }, 'api failed to start');
  process.exit(1);
});

process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled promise rejection'));
process.on('SIGTERM', () => {
  log.info('shutting down');
  process.exit(0);
});
