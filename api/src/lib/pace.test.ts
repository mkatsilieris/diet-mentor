import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, paceAt, paceKey, paceNudge, planProblem } from './pace.js';

const DAY = '2026-11-13';
const P = DEFAULT_PLAN; // 08:00 25, 11:00 10, 14:00 35, 17:30 10, 20:30 20; grace 45 min, tolerance 5%
const T = 2000; // cumulative 500, 700, 1400, 1600, 2000; tolerance 100

test('plan: the shares must make 100 and the times differ', () => {
  assert.equal(planProblem(P.meals), null);
  assert.match(planProblem([{ time: '08:00', name: 'A', pct: 60 }]) ?? '', /100%.*60%/);
  assert.match(planProblem([{ time: '08:00', name: 'A', pct: 50 }, { time: '08:00', name: 'B', pct: 50 }]) ?? '', /ίδια ώρα/);
  assert.ok(planProblem([]));
});

test('pace: what is due rises in steps at the time of each meal', () => {
  assert.equal(paceAt('07:59', P, T, 0).due, 0);
  assert.equal(paceAt('08:00', P, T, 0).due, 500);
  assert.equal(paceAt('13:59', P, T, 0).due, 700);
  assert.equal(paceAt('14:00', P, T, 0).due, 1400);
  assert.equal(paceAt('23:00', P, T, 0).due, 2000);
  const p = paceAt('12:00', P, T, 650);
  assert.deepEqual(p.steps.map((s) => s.cumKcal), [500, 700, 1400, 1600, 2000]);
  assert.deepEqual(p.steps.map((s) => s.kcal), [500, 200, 700, 200, 400]);
  assert.equal(p.diff, -50);
  assert.equal(p.next?.name, 'Μεσημεριανό');
});

test('pace: behind only after the grace, ahead only before it, with the tolerance', () => {
  assert.equal(paceAt('08:30', P, T, 0).status, 'on'); // breakfast is due but the grace runs
  const late = paceAt('08:45', P, T, 0);
  assert.equal(late.status, 'behind');
  assert.equal(late.shortBy, 500);
  assert.equal(late.lateMeal?.name, 'Πρωινό');
  assert.equal(paceAt('08:45', P, T, 400).status, 'on'); // 100 short is inside the tolerance
  assert.equal(paceAt('08:45', P, T, 399).status, 'behind');
  assert.equal(paceAt('09:00', P, T, 601).status, 'ahead'); // more than breakfast plus tolerance
  assert.equal(paceAt('10:15', P, T, 700).status, 'on'); // the snack may come 45 minutes early
  assert.equal(paceAt('14:45', P, T, 700).status, 'behind');
  assert.equal(paceAt('22:00', P, T, 2400).status, 'ahead');
});

test('pace: the state of each step', () => {
  const p = paceAt('14:10', P, T, 450);
  assert.deepEqual(p.steps.map((s) => s.state), ['covered', 'late', 'due', 'upcoming', 'upcoming']);
  assert.equal(paceAt('09:00', P, T, 0).steps[0].state, 'late');
});

test('nudge: one per missed step, nothing when keeping up', () => {
  assert.equal(paceKey(DAY, paceAt('08:10', P, T, 0)), null);
  assert.equal(paceNudge(DAY, paceAt('14:45', P, T, 1350)), null);
  const n = paceNudge(DAY, paceAt('14:45', P, T, 600));
  assert.equal(n?.dedupe, `pace/${DAY}/14:00`);
  assert.equal(n?.title, 'Είσαι 800 kcal πίσω από το πλάνο');
  assert.match(n?.body ?? '', /Ως τις 14:00 \(Μεσημεριανό\).*1\.400 kcal.*600 kcal.*Απογευματινό στις 17:30/);
});
