import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { requestToken } from '../auth.js';

const req = (headers: Record<string, string | string[]>) => ({ headers }) as unknown as Request;

test('the token is read from x-api-key or from Authorization', () => {
  assert.equal(requestToken(req({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(requestToken(req({ 'x-api-key': ' key ' })), 'key');
  assert.equal(requestToken(req({ 'x-api-key': ['first', 'second'] })), 'first');
  assert.equal(requestToken(req({ authorization: 'Bearer abc', 'x-api-key': 'key' })), 'abc', 'Authorization wins');
  assert.equal(requestToken(req({ authorization: 'Basic abc', 'x-api-key': 'key' })), 'key');
  assert.equal(requestToken(req({ 'x-api-key': '   ' })), null);
  assert.equal(requestToken(req({})), null);
});
