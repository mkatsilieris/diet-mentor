import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, ageOn, diffDays, isDay, monthEnd, todayIn, weekStart } from './days.js';
import {
  bmr,
  glycogenCapacityG,
  glycogenEquilibrium,
  glycogenRatio,
  lossPlans,
  stepGlycogen,
  targetIntake,
  tdee,
} from './energy.js';

test('days: arithmetic crosses months, years and daylight saving', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // clocks change in Athens on the 29th
  assert.equal(diffDays('2026-03-30', '2026-03-28'), 2);
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
});

test('days: weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-13'), '2026-11-09'); // a Friday
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday
});

test('days: validation and age', () => {
  assert.ok(isDay('2026-11-13'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('13/11/2026'));
  assert.equal(ageOn('1990-11-14', '2026-11-13'), 35);
  assert.equal(ageOn('1990-11-13', '2026-11-13'), 36);
});

test('days: today follows the time zone, not UTC', () => {
  const lateEvening = new Date('2026-11-13T22:30:00Z'); // 00:30 next day in Athens
  assert.equal(todayIn('Europe/Athens', lateEvening), '2026-11-14');
  assert.equal(todayIn('UTC', lateEvening), '2026-11-13');
});

test('bmr: Mifflin-St Jeor reference values', () => {
  assert.equal(bmr('male', 80, 180, 30), 1780);
  assert.equal(bmr('female', 60, 165, 30), 1320.25);
  assert.equal(Math.round(tdee(1780, 'sedentary')), 2136);
});

test('loss plans: 0.5 kg a week is 550 kcal a day, and the minimum intake is respected', () => {
  const plans = lossPlans(2500, 'male');
  assert.deepEqual(plans.map((p) => p.dailyDeficit), [275, 550, 825, 1100]);
  assert.deepEqual(plans.map((p) => p.intake), [2225, 1950, 1675, 1500]);
  assert.deepEqual(plans.map((p) => p.tooLow), [false, false, false, true]);
  assert.deepEqual(targetIntake(1500, 0.5, 'female'), { target: 1200, floored: true });
});

test('glycogen: a full store is about half a kilo for a 75 kg man', () => {
  const cap = glycogenCapacityG('male', 75, 178);
  assert.ok(cap > 450 && cap < 600, `got ${cap}`);
});

test('glycogen: full at maintenance, lower in a deficit, never under 30%', () => {
  assert.equal(glycogenEquilibrium(1), 1);
  assert.equal(glycogenEquilibrium(1.4), 1);
  assert.ok(Math.abs(glycogenEquilibrium(0.75) - 0.675) < 1e-9);
  assert.equal(glycogenEquilibrium(0.1), 0.3);
});

test('glycogen: known carbs decide instead of calories', () => {
  // maintenance 2000 kcal -> a typical day has 225 g of carbs
  assert.ok(Math.abs(glycogenRatio(2000, 225, 2000) - 1) < 1e-9);
  assert.ok(Math.abs(glycogenRatio(2000, 45, 2000) - 0.2) < 1e-9); // low carb at maintenance still empties the store
  assert.equal(glycogenRatio(1500, null, 2000), 0.75);
});

test('glycogen: empties over a few days and refills faster', () => {
  let level = 1;
  for (let i = 0; i < 4; i++) level = stepGlycogen(level, 0.6);
  assert.ok(level > 0.6 && level < 0.65, `got ${level}`);
  const refilled = stepGlycogen(level, 1);
  assert.ok(refilled > 0.85, `got ${refilled}`);
});
