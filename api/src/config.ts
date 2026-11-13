const env = process.env;

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(env.PORT, 4000),
  nodeEnv: env.NODE_ENV ?? 'development',
  logLevel: env.LOG_LEVEL ?? 'info',
  databaseUrl: env.DATABASE_URL ?? 'postgres://diet:diet@localhost:5432/diet',
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
  appUrl: (env.APP_URL ?? 'http://localhost:8082').replace(/\/$/, ''),
  /** IANA time zone that decides which calendar day "today" is (the server itself runs in UTC). */
  timeZone: env.DISPLAY_TZ ?? 'Europe/Athens',
  // Cloudflare Access single sign-on. Both empty = disabled (plain e-mail/password login only).
  access: {
    teamDomain: (env.ACCESS_TEAM_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    aud: env.ACCESS_AUD ?? '',
  },
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: num(env.SMTP_PORT, 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? 'Diet Mentor <no-reply@example.com>',
  },
  /** Web Push keys. Leave empty: a pair is generated on first start and kept in the database. */
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
    subject: env.VAPID_SUBJECT ?? 'mailto:no-reply@example.com',
  },
};
