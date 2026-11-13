import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from './days.js';
import { buildSummary, type Diet, type Inputs } from './summary.js';
import { DEFAULT_SETTINGS, baselineKeys, dailyNudge, dietNudges, dueSlot, energyGap, energyNudge, isTime, mealReminder, motivationNudges, weeklyNudge, type ReadySummary } from './nudges.js';

const FRIDAY = '2026-11-13';
const MONDAY = '2026-11-16';
const profile = { sex: 'male', birth_date: '1990-06-01', height_cm: 180, activity: 'sedentary' } as const; // maintenance 2160 at 85 kg
const eat = (day: string, kcal: number) => ({ day, kcal, carbs_g: null, entries: 1 });
const diet = (today: string, over: Partial<Diet> = {}): Diet => ({
  id: 7,
  name: 'Φθινόπωρο',
  started_on: addDays(today, -10),
  ended_on: null,
  planned_days: 30,
  rate_kg_week: 0.5,
  start_weight_kg: 85,
  goal_weight_kg: 80,
  end_weight_kg: null,
  ...over,
});
function summary(over: Partial<Inputs> = {}, today = FRIDAY): ReadySummary {
  const s = buildSummary({ profile, weights: [{ day: addDays(today, -30), kg: 85 }], intakes: [], diets: [], today, ...over });
  assert.ok(s.ready);
  return s;
}
const TIMES = DEFAULT_SETTINGS.reminder_times; // 10:00, 14:30, 21:00

test('times: validation and the slot that is due', () => {
  assert.ok(isTime('09:05') && isTime('23:59'));
  assert.ok(!isTime('24:00') && !isTime('9:05') && !isTime(''));
  assert.equal(dueSlot(TIMES, '09:59'), null);
  assert.equal(dueSlot(TIMES, '10:00'), '10:00');
  assert.equal(dueSlot(TIMES, '10:19'), '10:00');
  assert.equal(dueSlot(TIMES, '10:20'), null);
  assert.equal(dueSlot(['10:00', '10:10'], '10:15'), '10:10');
});

test('reminder: sent when nothing was written since the previous slot, with what is left', () => {
  const s = summary({ intakes: [eat(FRIDAY, 400)] });
  const r = mealReminder('14:30', TIMES, ['08:15'], s);
  assert.ok(r);
  assert.equal(r.dedupe, `reminder/${FRIDAY}/14:30`);
  assert.match(r.title, /μεσημεριανό/);
  assert.match(r.body, /400 kcal.*1\.760 kcal/);
});

test('reminder: not needed when the meal is already in the diary', () => {
  const s = summary({ intakes: [eat(FRIDAY, 900)] });
  assert.equal(mealReminder('10:00', TIMES, ['08:15'], s), null); // breakfast is there
  assert.equal(mealReminder('14:30', TIMES, ['08:15', '13:40'], s), null); // lunch too
  assert.ok(mealReminder('21:00', TIMES, ['08:15', '13:40'], s)); // nothing since 14:30
});

test('reminder: an empty day at the last slot talks about the streak', () => {
  const intakes = [-3, -2, -1].map((n) => eat(addDays(FRIDAY, n), 1600));
  const r = mealReminder('21:00', TIMES, [], summary({ intakes }));
  assert.ok(r);
  assert.match(r.body, /σερί των 3 ημερών/);
  const first = mealReminder('10:00', TIMES, [], summary({ intakes }));
  assert.match(first?.body ?? '', /στόχος σήμερα/);
});

test('daily: praise on target, calm when over, a nudge after an empty day', () => {
  const good = dailyNudge(summary({ intakes: [eat(addDays(FRIDAY, -2), 1600), eat(addDays(FRIDAY, -1), 1600)], diets: [diet(FRIDAY)] }));
  assert.match(good?.title ?? '', /μέσα στον στόχο/);
  assert.match(good?.body ?? '', /Έλλειμμα 560 kcal\. 2 μέρες στη σειρά\. Μέρα 11 από 30/);
  const over = dailyNudge(summary({ intakes: [eat(addDays(FRIDAY, -2), 1200), eat(addDays(FRIDAY, -1), 2500)], diets: [diet(FRIDAY)] }));
  assert.match(over?.title ?? '', /890 kcal πάνω/);
  assert.match(over?.body ?? '', /εβδομάδα είναι ακόμη/);
  const empty = dailyNudge(summary({ intakes: [eat(addDays(FRIDAY, -3), 1600)] }));
  assert.match(empty?.title ?? '', /κενό/);
  assert.equal(dailyNudge(summary()), null); // never used the diary: nothing to say
});

test('weekly: only on Mondays, about the week that ended', () => {
  const intakes = [];
  for (let i = 7; i >= 1; i--) intakes.push(eat(addDays(MONDAY, -i), 1660));
  const s = summary({ intakes }, MONDAY);
  const w = weeklyNudge(s, MONDAY);
  assert.equal(w?.dedupe, 'weekly/2026-11-09');
  assert.match(w?.body ?? '', /7 μέρες καταγραφής, έλλειμμα 3\.500 kcal/);
  assert.equal(weeklyNudge(summary({ intakes: intakes.slice(0, 4) }), FRIDAY), null);
});

test('diet steps: half way, planned days, goal weight', () => {
  const keys = (s: ReadySummary) => dietNudges(s).map((n) => n.dedupe);
  assert.deepEqual(keys(summary({ diets: [diet(FRIDAY)] })), []); // day 11 of 30
  assert.deepEqual(keys(summary({ diets: [diet(FRIDAY, { started_on: addDays(FRIDAY, -15) })] })), ['diet/7/half']); // day 16
  assert.deepEqual(keys(summary({ diets: [diet(FRIDAY, { started_on: addDays(FRIDAY, -29) })] })), ['diet/7/planned']);
  const reached = summary({ diets: [diet(FRIDAY)], weights: [{ day: addDays(FRIDAY, -30), kg: 85 }, { day: addDays(FRIDAY, -1), kg: 79.8 }] });
  assert.deepEqual(keys(reached), ['diet/7/goal']);
});

test('settings decide what the daily run sends; old achievements form the baseline', () => {
  const intakes = [];
  for (let i = 8; i >= 1; i--) intakes.push(eat(addDays(MONDAY, -i), 1660));
  const s = summary({ intakes }, MONDAY);
  const all = motivationNudges(s, DEFAULT_SETTINGS).map((n) => n.kind);
  assert.ok(all.includes('daily') && all.includes('milestone') && all.includes('weekly'));
  assert.deepEqual(motivationNudges(s, { ...DEFAULT_SETTINGS, motivation: false }).map((n) => n.kind), ['weekly']);
  assert.deepEqual(motivationNudges(s, { ...DEFAULT_SETTINGS, motivation: false, weekly: false }), []);
  assert.ok(baselineKeys(s).includes('milestone/streak-7'));
  assert.ok(!baselineKeys(s).some((k) => k.startsWith('daily/')));
});

test('energy: speaks when the last meal is too far back, twice per gap at most', () => {
  const S = DEFAULT_SETTINGS; // 4 hours, 08:00 - 21:30
  const meals = [
    { time: '09:00', kcal: 400 },
    { time: '11:00', kcal: 5 }, // a coffee does not count
  ];
  assert.equal(energyGap('12:59', FRIDAY, meals, S), null);
  const first = energyGap('13:00', FRIDAY, meals, S);
  assert.ok(first);
  assert.equal(first.dedupe, `energy/${FRIDAY}/09:00/0`);
  assert.equal(energyGap('14:29', FRIDAY, meals, S)?.dedupe, first.dedupe);
  assert.equal(energyGap('14:30', FRIDAY, meals, S)?.dedupe, `energy/${FRIDAY}/09:00/1`);
  assert.equal(energyGap('18:00', FRIDAY, meals, S)?.dedupe, `energy/${FRIDAY}/09:00/1`); // nothing new after the repeat
  assert.equal(energyGap('14:30', FRIDAY, [...meals, { time: '13:30', kcal: 600 }], S), null); // a meal restarts the count
  assert.equal(energyGap('22:00', FRIDAY, meals, S), null); // outside the chosen part of the day
  assert.equal(energyGap('13:00', FRIDAY, meals, { ...S, energy: false }), null);
  assert.equal(energyGap('11:59', FRIDAY, [], S), null); // an empty day counts from 08:00
  const empty = energyGap('12:00', FRIDAY, [], S);
  assert.ok(empty);
  assert.equal(empty.dedupe, `energy/${FRIDAY}/none/0`);

  const n = energyNudge(first, summary({ intakes: [eat(FRIDAY, 400)] }));
  assert.equal(n?.title, '4 ώρες χωρίς φαγητό');
  assert.match(n?.body ?? '', /Τελευταίο γεύμα στις 09:00.*1\.760 kcal/);
  assert.match(energyNudge(empty, summary())?.title ?? '', /τίποτα σήμερα/);
  assert.equal(energyNudge(first, summary({ intakes: [eat(FRIDAY, 2100)] })), null); // the day is full
});
