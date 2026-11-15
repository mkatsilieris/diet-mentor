import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken, looksLikeToken, scopeAllows } from './tokens.js';
import { RateLimiter } from './ratelimit.js';

test('a new token has the expected shape and only its hash is kept', () => {
  const t = generateToken();
  assert.match(t.token, /^dmt_[A-Za-z0-9_-]{43}$/);
  assert.equal(t.hash, hashToken(t.token));
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.ok(!t.hash.includes(t.token.slice(4)));
  assert.equal(t.hint, t.token.slice(0, 8));
  assert.notEqual(generateToken().token, t.token);
});

test('only strings shaped like a token are looked up as one', () => {
  assert.ok(looksLikeToken(generateToken().token));
  assert.ok(!looksLikeToken('eyJhbGciOiJIUzI1NiJ9.e30.abc')); // a session JWT
  assert.ok(!looksLikeToken('dmt_short'));
  assert.ok(!looksLikeToken(`${generateToken().token}x`));
  assert.ok(!looksLikeToken(''));
});

test('a read token may only look', () => {
  assert.ok(scopeAllows('read', 'GET'));
  assert.ok(scopeAllows('read', 'HEAD'));
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(!scopeAllows('read', m), m);
    assert.ok(scopeAllows('write', m), m);
  }
});

test('the rate limiter allows max hits per window, per key, and starts again after it', () => {
  let now = 0;
  const rl = new RateLimiter(3, 1000, () => now);
  assert.ok(!rl.blocked('a'));
  assert.deepEqual([rl.hit('a'), rl.hit('a'), rl.hit('a'), rl.hit('a')], [true, true, true, false]);
  assert.ok(rl.blocked('a'));
  assert.ok(rl.hit('b'), 'another key has its own window');
  now = 400;
  assert.equal(rl.retryAfter('a'), 1);
  now = 1000;
  assert.ok(!rl.blocked('a'));
  assert.ok(rl.hit('a'));
});
