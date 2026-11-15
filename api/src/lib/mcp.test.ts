import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, type McpContext } from '../mcp/protocol.js';
import { ToolError, tools, type ApiCall } from '../mcp/tools.js';

type Call = { method: string; path: string; body: unknown };
function ctx(scope: 'read' | 'write', answer: (c: Call) => unknown = () => ({})): McpContext & { calls: Call[] } {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    return answer({ method, path, body });
  };
  return { scope, api, calls };
}
const rpc = (method: string, params?: unknown, id: number | undefined = 1) => ({ jsonrpc: '2.0', id, method, params });
const result = (r: any) => r.result;

test('initialize answers with a protocol version the client knows, and tools only', async () => {
  const r = result(await handleMessage(rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} }), ctx('write')));
  assert.equal(r.protocolVersion, '2025-03-26');
  assert.deepEqual(Object.keys(r.capabilities), ['tools']);
  assert.equal(r.serverInfo.name, 'diet-mentor');
  const unknown = result(await handleMessage(rpc('initialize', { protocolVersion: '1999-01-01' }), ctx('write')));
  assert.equal(unknown.protocolVersion, '2025-06-18');
});

test('notifications get no answer; bad messages and unknown methods get JSON-RPC errors', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx('write')), null);
  assert.equal(((await handleMessage({ hello: 1 }, ctx('write'))) as any).error.code, -32600);
  assert.equal(((await handleMessage(rpc('resources/list'), ctx('write'))) as any).error.code, -32601);
  assert.deepEqual(result(await handleMessage(rpc('ping'), ctx('write'))), {});
});

test('every tool has a unique name, an object schema, and says whether it changes data', async () => {
  const list = result(await handleMessage(rpc('tools/list'), ctx('write'))).tools;
  assert.equal(list.length, tools.length);
  assert.equal(new Set(list.map((t: any) => t.name)).size, list.length);
  for (const t of list) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
  }
  assert.ok(list.find((t: any) => t.name === 'delete_food_entry').annotations.destructiveHint);
});

test('a read-only token sees and can call only the tools that look', async () => {
  const c = ctx('read');
  const list = result(await handleMessage(rpc('tools/list'), c)).tools;
  assert.ok(list.length > 0);
  assert.ok(list.every((t: any) => t.annotations.readOnlyHint));
  const r = result(await handleMessage(rpc('tools/call', { name: 'add_food_entry', arguments: { name: 'x', kcal: 1 } }), c));
  assert.ok(r.isError);
  assert.match(r.content[0].text, /read-only/);
  assert.equal(c.calls.length, 0);
});

test('add_food_entry fills in today and now, and goes through the entries route', async () => {
  const c = ctx('write', () => ({ entry: { id: 7 } }));
  const r = result(await handleMessage(rpc('tools/call', { name: 'add_food_entry', arguments: { name: 'Γιαούρτι', kcal: 150 } }), c));
  assert.ok(!r.isError);
  assert.deepEqual(JSON.parse(r.content[0].text), { entry: { id: 7 } });
  assert.equal(c.calls.length, 1);
  const { method, path, body } = c.calls[0] as { method: string; path: string; body: any };
  assert.deepEqual([method, path], ['POST', '/entries']);
  assert.match(body.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(body.time, /^\d{2}:\d{2}$/);
  assert.deepEqual([body.name, body.kcal, body.carbs_g], ['Γιαούρτι', 150, null]);
});

test('wrong or unknown arguments come back as a tool error and reach no route', async () => {
  const c = ctx('write');
  for (const args of [{ name: 'x', kcal: -5 }, { name: 'x', kcal: 100, colour: 'red' }, { name: 'x', kcal: 100, day: '2026-02-31' }, {}]) {
    const r = result(await handleMessage(rpc('tools/call', { name: 'add_food_entry', arguments: args }), c));
    assert.ok(r.isError, JSON.stringify(args));
    assert.match(r.content[0].text, /Invalid arguments/);
  }
  assert.equal(c.calls.length, 0);
  assert.ok(result(await handleMessage(rpc('tools/call', { name: 'nope' }), c)).isError);
});

test('a refusal of the route is passed on as the tool error; a crash is an internal error without details', async () => {
  const refuse = ctx('write', () => {
    throw new ToolError('Τρέχει ήδη μια δίαιτα');
  });
  const r = result(await handleMessage(rpc('tools/call', { name: 'start_diet', arguments: { rate_kg_week: 0.5 } }), refuse));
  assert.ok(r.isError);
  assert.equal(r.content[0].text, 'Τρέχει ήδη μια δίαιτα');

  const crash = ctx('write', () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
  });
  const e = (await handleMessage(rpc('tools/call', { name: 'list_diets', arguments: {} }), crash)) as any;
  assert.deepEqual(e.error, { code: -32603, message: 'Internal error' });
});

test('update_profile merges the change into the saved profile, and asks for what is missing the first time', async () => {
  const saved = { sex: 'male', birth_date: '1990-05-01', height_cm: 180, activity: 'light' };
  const c = ctx('write', ({ method }) => (method === 'GET' ? { profile: saved } : { profile: {} }));
  await handleMessage(rpc('tools/call', { name: 'update_profile', arguments: { activity: 'active' } }), c);
  assert.deepEqual(c.calls[1], { method: 'PUT', path: '/profile', body: { ...saved, activity: 'active' } });

  const empty = ctx('write', () => ({ profile: null }));
  const r = result(await handleMessage(rpc('tools/call', { name: 'update_profile', arguments: { sex: 'female' } }), empty));
  assert.ok(r.isError);
  assert.match(r.content[0].text, /birth_date, height_cm, activity/);
  assert.equal(empty.calls.length, 1);
});

test('get_summary leaves the long per-day rows out unless asked for', async () => {
  const days = Array.from({ length: 50 }, (_, i) => ({ day: i }));
  const c = ctx('write', () => ({ ready: true, days: [...days] }));
  const none = JSON.parse(result(await handleMessage(rpc('tools/call', { name: 'get_summary', arguments: {} }), c)).content[0].text);
  assert.equal(none.days, undefined);
  const five = JSON.parse(result(await handleMessage(rpc('tools/call', { name: 'get_summary', arguments: { last_days: 5 } }), c)).content[0].text);
  assert.deepEqual(five.days.map((d: any) => d.day), [45, 46, 47, 48, 49]);
});
