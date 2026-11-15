import { createHash, randomBytes } from 'node:crypto';

/**
 * Personal access tokens: what a person hands to Claude (or any other program) so that it can act
 * as them without knowing their password.
 *
 *   dmt_<43 characters>   256 random bits, base64url
 *
 * The token itself is shown once, when it is made. The database keeps only its SHA-256, so a copy
 * of the database cannot be used to sign in. (A slow hash like bcrypt protects short, guessable
 * passwords; a 256-bit random value has nothing to guess.)
 */
export const TOKEN_PREFIX = 'dmt_';
const TOKEN_PATTERN = /^dmt_[A-Za-z0-9_-]{43}$/;

export type TokenScope = 'read' | 'write';

/** Lifetimes a person can choose from, in days. There is no token that lasts for ever. */
export const TOKEN_LIFETIMES = [30, 90, 365] as const;
export const DEFAULT_TOKEN_LIFETIME = 90;
export const MAX_TOKENS_PER_USER = 10;

export interface NewToken {
  /** the secret, shown to the person once */
  token: string;
  /** what the database keeps */
  hash: string;
  /** the first characters, enough to tell two tokens apart in a list */
  hint: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): NewToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), hint: token.slice(0, TOKEN_PREFIX.length + 4) };
}

/** True when the string has the shape of a personal access token (says nothing about it being valid). */
export function looksLikeToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** May a token of this scope make this HTTP request? Read tokens only look. */
export function scopeAllows(scope: TokenScope, method: string): boolean {
  return scope === 'write' || method === 'GET' || method === 'HEAD';
}
