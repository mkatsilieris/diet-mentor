import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from './days.js';
import { KCAL_PER_KG_FAT } from './energy.js';
import { aggregate, buildSummary, buildTimeline, dietStats, streaks, type Diet, type Inputs } from './summary.js';

const TODAY = '2026-11-13'; // a Friday
// male, 36, 180 cm, 85 kg, sedentary: BMR 1800, maintenance 2160
const profile = { sex: 'male', birth_date: '1990-06-01', height_cm: 180, activity: 'sedentary' } as const;
const MAINTENANCE = 2160;

const eat = (day: string, kcal: number, carbs_g: number | null = null) => ({ day, kcal, carbs_g, entries: 1 });
const diet = (over: Partial<Diet> = {}): Diet => ({
  id: 1,
  name: 'Φθινόπωρο',
  started_on: addDays(TODAY, -10),
  ended_on: null,
  planned_days: 30,
  rate_kg_week: 0.5,
  start_weight_kg: 85,
  goal_weight_kg: 80,
  end_weight_kg: null,
  ...over,
});
const base = (over: Partial<Inputs> = {}): Inputs => ({
  profile,
  weights: [{ day: addDays(TODAY, -20), kg: 85 }],
  intakes: [],
  diets: [],
  today: TODAY,
  ...over,
});

test('not ready without a profile or a weight', () => {
  assert.deepEqual(buildSummary(base({ profile: null })), { ready: false, today: TODAY, missing: ['profile'] });
  assert.deepEqual(buildSummary(base({ weights: [] })), { ready: false, today: TODAY, missing: ['weight'] });
});

test('maintenance and the plans come from the latest weigh-in', () => {
  const s = buildSummary(base());
  assert.ok(s.ready);
  assert.equal(Math.round(s.body.bmr), 1800);
  assert.equal(Math.round(s.body.maintenance), MAINTENANCE);
  assert.equal(s.body.plans[1].intake, MAINTENANCE - 550);
  assert.equal(s.day.target, s.body.maintenance); // no diet: eat at maintenance
});

test('a day without entries is unknown, not a day of fasting', () => {
  const rows = buildTimeline(base({ intakes: [eat(addDays(TODAY, -3), 1660), eat(addDays(TODAY, -1), 1660)] }));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.counted), [true, false, true, false]);
  assert.equal(rows[1].deficit, 0);
  assert.equal(aggregate(rows, rows[0].day, TODAY).deficit, 1000);
});

test('today is shown but stays out of the sums until it is over', () => {
  const s = buildSummary(base({ intakes: [eat(addDays(TODAY, -1), 1660), eat(TODAY, 400)] }));
  assert.ok(s.ready);
  assert.equal(s.day.intake, 400);
  assert.equal(Math.round(s.day.remaining), MAINTENANCE - 400);
  assert.equal(s.periods.week.loggedDays, 1);
  assert.equal(Math.round(s.periods.week.deficit), 500);
});

test('weeks run Monday to Sunday and months by the calendar', () => {
  const intakes = [];
  for (let i = 20; i >= 1; i--) intakes.push(eat(addDays(TODAY, -i), 1660)); // 24 Oct .. 12 Nov
  const s = buildSummary(base({ intakes }));
  assert.ok(s.ready);
  assert.equal(s.weeks[0].from, '2026-11-09');
  assert.equal(s.weeks[0].loggedDays, 4); // Mon-Thu
  assert.equal(s.weeks[1].loggedDays, 7);
  assert.equal(Math.round(s.weeks[1].deficit), 3500);
  assert.equal(s.months[0].loggedDays, 12); // 1-12 November
  assert.equal(s.months[1].from, '2026-10-01');
  assert.equal(s.months[1].to, '2026-10-31');
  assert.equal(s.months[1].loggedDays, 8);
});

test('glycogen: part of the first deficit is not fat, and energy is conserved', () => {
  const intakes = [];
  for (let i = 10; i >= 1; i--) intakes.push(eat(addDays(TODAY, -i), 1560)); // 600 kcal under, ten days
  const rows = buildTimeline(base({ intakes }));
  const total = aggregate(rows, rows[0].day, TODAY);
  assert.equal(Math.round(total.deficit), 6000);
  // the store settles around 64% and the scale shows that as roughly -0.7 kg of glycogen and water
  assert.ok(total.glycogenKg < -0.5 && total.glycogenKg > -1, `got ${total.glycogenKg}`);
  // fat is less than deficit / 7700, by exactly the calories the glycogen gave
  const glycogenGrams = (-total.glycogenKg * 1000) / 4;
  assert.ok(Math.abs(total.fatKg * KCAL_PER_KG_FAT + glycogenGrams * 4 - 6000) < 1e-6);
  assert.ok(total.fatKg < 6000 / KCAL_PER_KG_FAT);
  // the first day loses more glycogen than the last
  assert.ok(rows[0].glycogenDeltaG < rows[9].glycogenDeltaG && rows[9].glycogenDeltaG < 0);
  // expected change on the scale = glycogen - fat
  assert.ok(Math.abs(total.scaleKg - (total.glycogenKg - total.fatKg)) < 1e-9);
});

test('glycogen: a day at maintenance refills the store and the scale goes up without fat', () => {
  const intakes = [];
  for (let i = 6; i >= 2; i--) intakes.push(eat(addDays(TODAY, -i), 1400));
  intakes.push(eat(addDays(TODAY, -1), 2160));
  const rows = buildTimeline(base({ intakes }));
  const refeed = rows[rows.length - 2];
  assert.equal(Math.round(refeed.deficit), 0);
  assert.ok(refeed.glycogenDeltaG > 100, `got ${refeed.glycogenDeltaG}`);
  const s = buildSummary(base({ intakes }));
  assert.ok(s.ready);
  assert.ok(s.motivation.messages.some((m) => m.text.includes('γλυκογόνο')));
});

test('a new weigh-in changes the calories from that day on', () => {
  const rows = buildTimeline(
    base({
      weights: [
        { day: addDays(TODAY, -20), kg: 85 },
        { day: addDays(TODAY, -2), kg: 80 },
      ],
      intakes: [eat(addDays(TODAY, -4), 2000)],
    }),
  );
  assert.equal(Math.round(rows[0].maintenance), 2160);
  assert.equal(Math.round(rows[2].maintenance), 2100); // 50 kcal of BMR less, times 1.2
  assert.equal(rows[2].weighedKg, 80);
  assert.equal(rows[1].weighedKg, null);
});

test('diet: target, day count, adherence and progress to the goal', () => {
  const intakes = [];
  for (let i = 10; i >= 1; i--) intakes.push(eat(addDays(TODAY, -i), i === 5 ? 2600 : 1600));
  const input = base({
    intakes,
    diets: [diet()],
    weights: [
      { day: addDays(TODAY, -20), kg: 85 },
      { day: addDays(TODAY, -1), kg: 83 },
    ],
  });
  const s = buildSummary(input);
  assert.ok(s.ready && s.diet);
  assert.equal(s.diet.dayNumber, 11);
  assert.equal(s.diet.daysLeft, 19);
  assert.equal(s.diet.totals.loggedDays, 10);
  assert.equal(s.diet.totals.onTargetDays, 9);
  assert.equal(Math.round(s.diet.adherencePct ?? 0), 90);
  assert.equal(s.diet.weightChangeKg, -2);
  assert.equal(Math.round(s.diet.goalPct ?? 0), 40);
  assert.ok(s.diet.projectedGoalDay && s.diet.projectedGoalDay > TODAY);
  // while the diet runs the day's target is maintenance minus 550 (at the weight of that day)
  assert.equal(Math.round(s.day.maintenance - s.day.target), 550);
  // days before the diet started aim at maintenance
  const rows = buildTimeline({ ...input, intakes: [eat(addDays(TODAY, -15), 2000), ...intakes] });
  assert.equal(rows[0].target, rows[0].maintenance);
  assert.equal(rows[0].dietId, null);
});

test('diet: a finished one keeps its own totals', () => {
  const done = diet({ started_on: addDays(TODAY, -12), ended_on: addDays(TODAY, -6), end_weight_kg: 84 });
  const intakes = [];
  for (let i = 12; i >= 1; i--) intakes.push(eat(addDays(TODAY, -i), 1660));
  const input = base({ intakes, diets: [done] });
  const stats = dietStats(done, buildTimeline(input), input.weights, TODAY);
  assert.equal(stats.active, false);
  assert.equal(stats.dayNumber, 7);
  assert.equal(stats.totals.loggedDays, 7);
  assert.equal(Math.round(stats.totals.deficit), 3500);
  assert.equal(stats.weightChangeKg, -1);
  const s = buildSummary(input);
  assert.ok(s.ready);
  assert.equal(s.diet, null);
  assert.ok(s.motivation.milestones.find((m) => m.key === 'diet-done')?.done);
});

test('streaks: logging may end today or yesterday, a gap breaks it', () => {
  const days = [-6, -5, -3, -2, -1].map((n) => eat(addDays(TODAY, n), 1600));
  const rows = buildTimeline(base({ intakes: days, diets: [diet()] }));
  const s = streaks(rows);
  assert.equal(s.log, 3);
  assert.equal(s.bestLog, 3);
  assert.equal(s.target, 3);
  const withToday = streaks(buildTimeline(base({ intakes: [...days, eat(TODAY, 300)], diets: [diet()] })));
  assert.equal(withToday.log, 4);
  assert.equal(withToday.target, 3); // today is still open
});

test('mentor: warns when eating far too little for days', () => {
  const intakes = [-3, -2, -1].map((n) => eat(addDays(TODAY, n), 900));
  const s = buildSummary(base({ intakes }));
  assert.ok(s.ready);
  assert.equal(s.motivation.messages[0].tone, 'warn');
  assert.ok(s.motivation.messages.length <= 4);
});
