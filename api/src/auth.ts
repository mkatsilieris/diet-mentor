import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';
import { RateLimiter } from './lib/ratelimit.js';
import { hashToken, looksLikeToken, scopeAllows, type TokenScope } from './lib/tokens.js';

export interface AuthUser {
  id: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
      /** Set when the request was signed with a personal access token instead of a login session. */
      apiToken?: { id: number; scope: TokenScope };
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id), email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** The value of the `x-api-key` header: a personal access token by itself, no "Bearer". */
export function apiKey(req: Request): string | null {
  const raw = req.headers['x-api-key'];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return key || null;
}

/**
 * The credential of a request: `x-api-key: <personal token>` (what programs such as Claude send)
 * or `Authorization: Bearer <token>` (what the web app sends; a personal token works there too).
 * When both are present, Authorization is the one that counts.
 */
export function requestToken(req: Request): string | null {
  return bearerToken(req) ?? apiKey(req);
}

/** Wrong personal access tokens per client address: 10 in 15 minutes, then the address waits. */
const badTokens = new RateLimiter(10, 15 * 60_000);

interface TokenRow {
  id: number;
  scope: TokenScope;
  user_id: number;
  email: string;
}

/**
 * Who is calling? Either a login session (the JWT the web app holds, in Authorization) or a personal
 * access token (`dmt_...`, made in Profile > Claude; in x-api-key, or in Authorization as Bearer). Answers 401 / 429 itself and returns false when nobody is.
 */
async function identify(req: Request, res: Response): Promise<boolean> {
  const token = requestToken(req);
  // x-api-key carries personal tokens only; a login session travels in Authorization
  const keyOnly = bearerToken(req) === null;
  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    return false;
  }

  if (looksLikeToken(token)) {
    const ip = req.ip ?? 'unknown';
    if (badTokens.blocked(ip)) {
      res.setHeader('Retry-After', String(badTokens.retryAfter(ip)));
      res.status(429).json({ error: 'Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά αργότερα.' });
      return false;
    }
    const { rows } = await pool.query<TokenRow>(
      `SELECT t.id, t.scope, u.id AS user_id, u.email
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.expires_at > now()`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) {
      badTokens.hit(ip);
      req.log.warn({ ip }, 'personal access token rejected');
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res.status(401).json({ error: 'Το token δεν είναι έγκυρο, έχει λήξει ή έχει ανακληθεί' });
      return false;
    }
    // "last used" is for the person's eyes; once a minute is precise enough and spares the writes
    void pool
      .query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [row.id])
      .catch((err) => req.log.warn({ err }, 'could not note the use of a token'));
    req.user = { id: row.user_id, email: row.email };
    req.apiToken = { id: row.id, scope: row.scope };
    return true;
  }

  if (keyOnly) {
    res.status(401).json({ error: 'Το x-api-key θέλει προσωπικό token (dmt_...), χωρίς «Bearer»' });
    return false;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    req.user = { id: Number(payload.sub), email: String(payload.email) };
    return true;
  } catch {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    res.status(401).json({ error: 'Η σύνδεση έληξε, συνδεθείτε ξανά' });
    return false;
  }
}

/** Every route of the app: a login session, or a personal access token whose scope allows the method. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await identify(req, res))) return;
  if (req.apiToken && !scopeAllows(req.apiToken.scope, req.method)) {
    res.status(403).json({ error: 'Αυτό το token είναι μόνο για ανάγνωση' });
    return;
  }
  next();
}

/**
 * The MCP endpoint: only personal access tokens, with either scope (every MCP call is a POST;
 * what a read token may do is decided per tool, and again by requireAuth on the route it reaches).
 */
export async function requireApiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await identify(req, res))) return;
  if (!req.apiToken) {
    res.status(403).json({ error: 'Εδώ χρειάζεται προσωπικό token (Προφίλ → Σύνδεση με Claude)' });
    return;
  }
  next();
}

/**
 * Things only the person themselves may do, in the app: make and revoke tokens, change the
 * password. A token must never be able to mint another token or lock its owner out.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await identify(req, res))) return;
  if (req.apiToken) {
    res.status(403).json({ error: 'Αυτή η ενέργεια γίνεται μόνο μέσα από την εφαρμογή' });
    return;
  }
  next();
}
