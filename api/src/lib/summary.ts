import { addDays, ageOn, diffDays, monthEnd, monthStart, weekStart, type Day } from './days.js';
import {
  KCAL_PER_G_GLYCOGEN,
  KCAL_PER_KG_FAT,
  MIN_INTAKE,
  bmi,
  bmr,
  deficitForRate,
  glycogenCapacityG,
  glycogenEquilibrium,
  glycogenRatio,
  glycogenScaleKg,
  leanMassKg,
  lossPlans,
  stepGlycogen,
  targetIntake,
  tdee,
  type Activity,
  type LossPlan,
  type Sex,
} from './energy.js';

/**
 * Everything the app shows is derived here from four lists (profile, weigh-ins, calories per day,
 * diets) and today's date. No database, no clock: the same input always gives the same numbers.
 */

export interface Profile {
  sex: Sex;
  birth_date: Day;
  height_cm: number;
  activity: Activity;
}

export interface WeighIn {
  day: Day;
  kg: number;
}

/** The food entries of one day, added up. `carbs_g` is null unless every entry of the day has carbs. */
export interface DayIntake {
  day: Day;
  kcal: number;
  carbs_g: number | null;
  entries: number;
}

export interface Diet {
  id: number;
  name: string;
  started_on: Day;
  ended_on: Day | null;
  planned_days: number | null;
  rate_kg_week: number;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  end_weight_kg: number | null;
}

export interface Inputs {
  profile: Profile | null;
  /** oldest first */
  weights: WeighIn[];
  /** oldest first */
  intakes: DayIntake[];
  diets: Diet[];
  today: Day;
}

/** Eating up to this many kcal over the target still counts as a day on target. */
export const TARGET_TOLERANCE = 50;
/** The timeline never reaches further back than this many days. */
const MAX_HISTORY_DAYS = 1500;

export interface DayRow {
  day: Day;
  /** something was eaten and written down that day */
  logged: boolean;
  /** logged and over: only these days enter the sums (today is still open) */
  counted: boolean;
  intake: number;
  carbs: number | null;
  /** the weight the calories of the day were computed with (latest weigh-in up to that day) */
  weightKg: number;
  /** the weigh-in of that very day, if there was one */
  weighedKg: number | null;
  maintenance: number;
  /** calories to eat that day: maintenance, or less while a diet runs */
  target: number;
  dietId: number | null;
  /** maintenance - intake on counted days, otherwise 0 */
  deficit: number;
  onTarget: boolean;
  /** how full the glycogen store is at the end of the day, 0..1 */
  glycogenLevel: number;
  glycogenG: number;
  glycogenDeltaG: number;
  /** fat lost that day in kg (negative = gained): the deficit minus what glycogen covered */
  fatKg: number;
  /** running sums since the first day of the timeline, for "expected weight" between any two days */
  fatCumKg: number;
  glycogenCumKg: number;
}

export const isReady = (input: Inputs): input is Inputs & { profile: Profile } =>
  input.profile !== null && input.weights.length > 0;

/** The diet a day belongs to, if any. */
export const dietOn = (diets: Diet[], day: Day): Diet | undefined =>
  diets.find((d) => d.started_on <= day && (d.ended_on === null || day <= d.ended_on));

/** One row per calendar day, from the first day anything is known until today. */
export function buildTimeline(input: Inputs): DayRow[] {
  if (!isReady(input)) return [];
  const { profile, weights, intakes, diets, today } = input;

  const starts = [intakes[0]?.day, ...diets.map((d) => d.started_on)].filter((d): d is Day => Boolean(d)).sort();
  let first = starts[0] ?? today;
  if (first > today) first = today;
  if (diffDays(today, first) > MAX_HISTORY_DAYS) first = addDays(today, -MAX_HISTORY_DAYS);

  const byDay = new Map(intakes.map((i) => [i.day, i]));
  const rows: DayRow[] = [];
  let wi = 0; // the weigh-in in force (the first one also covers the days before it)
  let level = 1; // the store starts full
  let fatCumKg = 0;
  let glycogenCumKg = 0;

  for (let day = first; day <= today; day = addDays(day, 1)) {
    while (wi + 1 < weights.length && weights[wi + 1].day <= day) wi++;
    const weightKg = weights[wi].kg;
    const maintenance = tdee(bmr(profile.sex, weightKg, profile.height_cm, ageOn(profile.birth_date, day)), profile.activity);
    const capacity = glycogenCapacityG(profile.sex, weightKg, profile.height_cm);
    const diet = dietOn(diets, day);
    const target = diet ? targetIntake(maintenance, diet.rate_kg_week, profile.sex).target : maintenance;

    const eaten = byDay.get(day);
    const logged = Boolean(eaten && eaten.entries > 0);
    const counted = logged && day < today;
    const intake = eaten?.kcal ?? 0;
    const carbs = eaten?.carbs_g ?? null;

    let deficit = 0;
    let glycogenDeltaG = 0;
    let fatKg = 0;
    if (counted) {
      deficit = maintenance - intake;
      const next = stepGlycogen(level, glycogenEquilibrium(glycogenRatio(intake, carbs, maintenance)));
      glycogenDeltaG = (next - level) * capacity;
      level = next;
      // energy balance: the deficit is paid by fat and by glycogen; what glycogen gave is not fat
      fatKg = (deficit + KCAL_PER_G_GLYCOGEN * glycogenDeltaG) / KCAL_PER_KG_FAT;
      fatCumKg += fatKg;
      glycogenCumKg += glycogenScaleKg(glycogenDeltaG);
    }

    rows.push({
      day,
      logged,
      counted,
      intake,
      carbs,
      weightKg,
      weighedKg: weights[wi].day === day ? weightKg : null,
      maintenance,
      target,
      dietId: diet?.id ?? null,
      deficit,
      onTarget: counted && intake <= target + TARGET_TOLERANCE,
      glycogenLevel: level,
      glycogenG: level * capacity,
      glycogenDeltaG,
      fatKg,
      fatCumKg,
      glycogenCumKg,
    });
  }
  return rows;
}

export interface Aggregate {
  from: Day;
  to: Day;
  /** days with food written down (and over) */
  loggedDays: number;
  intake: number;
  /** maintenance calories of the logged days */
  burned: number;
  deficit: number;
  avgDeficit: number;
  /** the deficit the diet asked for on those days (0 outside a diet) */
  plannedDeficit: number;
  /** fat lost in kg, after taking out what glycogen covered */
  fatKg: number;
  /** change on the scale that is glycogen and its water (negative = lighter) */
  glycogenKg: number;
  /** what the scale should show as change: -fat + glycogen */
  scaleKg: number;
  onTargetDays: number;
}

/** Sums over the counted days between two days (inclusive). */
export function aggregate(rows: DayRow[], from: Day, to: Day): Aggregate {
  const a: Aggregate = {
    from,
    to,
    loggedDays: 0,
    intake: 0,
    burned: 0,
    deficit: 0,
    avgDeficit: 0,
    plannedDeficit: 0,
    fatKg: 0,
    glycogenKg: 0,
    scaleKg: 0,
    onTargetDays: 0,
  };
  for (const r of rows) {
    if (!r.counted || r.day < from || r.day > to) continue;
    a.loggedDays++;
    a.intake += r.intake;
    a.burned += r.maintenance;
    a.deficit += r.deficit;
    a.plannedDeficit += r.maintenance - r.target;
    a.fatKg += r.fatKg;
    a.glycogenKg += glycogenScaleKg(r.glycogenDeltaG);
    if (r.onTarget) a.onTargetDays++;
  }
  a.avgDeficit = a.loggedDays ? a.deficit / a.loggedDays : 0;
  a.scaleKg = a.glycogenKg - a.fatKg;
  return a;
}

export interface DietStats {
  diet: Diet;
  active: boolean;
  /** 1 on the day it started */
  dayNumber: number;
  daysLeft: number | null;
  timePct: number | null;
  /** running, and past the days it was planned for */
  overdue: boolean;
  dailyDeficitTarget: number;
  totals: Aggregate;
  adherencePct: number | null;
  startKg: number | null;
  /** latest weigh-in inside the diet (the end weight once it is over) */
  currentKg: number | null;
  weightChangeKg: number | null;
  goalKg: number | null;
  goalPct: number | null;
  /** when the goal weight is reached at the average deficit so far; null when unknown */
  projectedGoalDay: Day | null;
}

export function dietStats(diet: Diet, rows: DayRow[], weights: WeighIn[], today: Day): DietStats {
  const active = diet.ended_on === null;
  const end = diet.ended_on ?? today;
  const dayNumber = diffDays(end, diet.started_on) + 1;
  const totals = aggregate(rows, diet.started_on, end);

  const inside = weights.filter((w) => w.day >= diet.started_on && w.day <= end);
  const startKg = diet.start_weight_kg ?? inside[0]?.kg ?? null;
  const currentKg = (active ? null : diet.end_weight_kg) ?? inside.at(-1)?.kg ?? null;
  const weightChangeKg = startKg !== null && currentKg !== null ? currentKg - startKg : null;

  const goalKg = diet.goal_weight_kg;
  let goalPct: number | null = null;
  let projectedGoalDay: Day | null = null;
  if (goalKg !== null && startKg !== null && currentKg !== null && startKg > goalKg) {
    goalPct = Math.min(100, Math.max(0, ((startKg - currentKg) / (startKg - goalKg)) * 100));
    const remainingKg = currentKg - goalKg;
    if (active && remainingKg > 0 && totals.loggedDays >= 3 && totals.avgDeficit > 50) {
      const days = Math.ceil((remainingKg * KCAL_PER_KG_FAT) / totals.avgDeficit);
      if (days <= 1095) projectedGoalDay = addDays(today, days);
    }
  }

  return {
    diet,
    active,
    dayNumber,
    daysLeft: diet.planned_days !== null ? Math.max(0, diet.planned_days - dayNumber) : null,
    timePct: diet.planned_days !== null ? Math.min(100, (dayNumber / diet.planned_days) * 100) : null,
    overdue: active && diet.planned_days !== null && dayNumber > diet.planned_days,
    dailyDeficitTarget: deficitForRate(diet.rate_kg_week),
    totals,
    adherencePct: totals.loggedDays ? (totals.onTargetDays / totals.loggedDays) * 100 : null,
    startKg,
    currentKg,
    weightChangeKg,
    goalKg,
    goalPct,
    projectedGoalDay,
  };
}

export interface Streaks {
  log: number;
  bestLog: number;
  target: number;
  bestTarget: number;
}

/**
 * Days in a row. The logging streak may end today or yesterday (today is not lost until it is over);
 * the on-target streak only looks at finished days, and a day without entries breaks both.
 */
export function streaks(rows: DayRow[]): Streaks {
  let bestLog = 0;
  let bestTarget = 0;
  let runLog = 0;
  let runTarget = 0;
  for (const r of rows) {
    runLog = r.logged ? runLog + 1 : 0;
    bestLog = Math.max(bestLog, runLog);
    if (r.counted) {
      runTarget = r.onTarget ? runTarget + 1 : 0;
      bestTarget = Math.max(bestTarget, runTarget);
    } else if (!r.logged) {
      runTarget = 0;
    }
  }
  let log = 0;
  let i = rows.length - 1;
  if (i >= 0 && !rows[i].logged) i--; // nothing today yet: count up to yesterday
  for (; i >= 0 && rows[i].logged; i--) log++;

  let target = 0;
  let j = rows.length - 1;
  if (j >= 0 && !rows[j].counted) j--; // today is open
  for (; j >= 0 && rows[j].counted && rows[j].onTarget; j--) target++;

  return { log, bestLog, target, bestTarget };
}

export interface Milestone {
  key: string;
  label: string;
  done: boolean;
}

export interface Message {
  tone: 'good' | 'info' | 'warn';
  text: string;
}

export interface Body {
  weightKg: number;
  weightDay: Day;
  age: number;
  bmi: number;
  bmr: number;
  maintenance: number;
  leanKg: number;
  glycogenCapacityG: number;
  minIntake: number;
  plans: LossPlan[];
}

export interface TodayBlock {
  day: Day;
  intake: number;
  entries: number;
  maintenance: number;
  target: number;
  remaining: number;
}

export interface GlycogenBlock {
  levelPct: number;
  storeG: number;
  capacityG: number;
  /** what the scale shows less than with a full store, kg (0 or negative) */
  scaleKg: number;
}

export interface Motivation {
  streaks: Streaks;
  loggedDays: number;
  totalDeficit: number;
  totalFatKg: number;
  /** the fat lost, in 250 g packs of butter */
  butterPacks: number;
  dietsCompleted: number;
  milestones: Milestone[];
  messages: Message[];
}

export type Summary =
  | { ready: false; today: Day; missing: ('profile' | 'weight')[] }
  | {
      ready: true;
      today: Day;
      body: Body;
      day: TodayBlock;
      periods: { week: Aggregate; prevWeek: Aggregate; month: Aggregate; prevMonth: Aggregate; last7: Aggregate; last30: Aggregate };
      /** newest first */
      weeks: Aggregate[];
      months: Aggregate[];
      /** the last 90 days, oldest first */
      days: DayRow[];
      glycogen: GlycogenBlock;
      diet: DietStats | null;
      motivation: Motivation;
    };

const WEEKS_SHOWN = 8;
const MONTHS_SHOWN = 6;
const DAYS_SHOWN = 90;

export function buildSummary(input: Inputs): Summary {
  const { today } = input;
  if (!isReady(input)) {
    const missing: ('profile' | 'weight')[] = [];
    if (!input.profile) missing.push('profile');
    if (input.weights.length === 0) missing.push('weight');
    return { ready: false, today, missing };
  }
  const { profile, weights, diets } = input;
  const rows = buildTimeline(input);
  const now = rows[rows.length - 1];

  const latest = weights[weights.length - 1];
  const age = ageOn(profile.birth_date, today);
  const basal = bmr(profile.sex, latest.kg, profile.height_cm, age);
  const maintenance = tdee(basal, profile.activity);
  const capacityG = glycogenCapacityG(profile.sex, latest.kg, profile.height_cm);
  const body: Body = {
    weightKg: latest.kg,
    weightDay: latest.day,
    age,
    bmi: bmi(latest.kg, profile.height_cm),
    bmr: basal,
    maintenance,
    leanKg: leanMassKg(profile.sex, latest.kg, profile.height_cm),
    glycogenCapacityG: capacityG,
    minIntake: MIN_INTAKE[profile.sex],
    plans: lossPlans(maintenance, profile.sex),
  };

  const day: TodayBlock = {
    day: today,
    intake: now.intake,
    entries: input.intakes.find((i) => i.day === today)?.entries ?? 0,
    maintenance: now.maintenance,
    target: now.target,
    remaining: now.target - now.intake,
  };

  const thisWeek = weekStart(today);
  const thisMonth = monthStart(today);
  const weeks: Aggregate[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const from = addDays(thisWeek, -7 * i);
    weeks.push(aggregate(rows, from, addDays(from, 6)));
  }
  const months: Aggregate[] = [];
  for (let i = 0, from = thisMonth; i < MONTHS_SHOWN; i++, from = monthStart(addDays(from, -1))) {
    months.push(aggregate(rows, from, monthEnd(from)));
  }

  const activeDiet = diets.find((d) => d.ended_on === null && d.started_on <= today);
  const diet = activeDiet ? dietStats(activeDiet, rows, weights, today) : null;

  const glycogen: GlycogenBlock = {
    levelPct: now.glycogenLevel * 100,
    storeG: now.glycogenLevel * capacityG,
    capacityG,
    scaleKg: glycogenScaleKg((now.glycogenLevel - 1) * capacityG),
  };

  const lifetime = aggregate(rows, rows[0].day, today);
  const run = streaks(rows);
  const dietsCompleted = diets.filter((d) => d.ended_on !== null).length;
  const periods = {
    week: weeks[0],
    prevWeek: weeks[1],
    month: months[0],
    prevMonth: months[1],
    last7: aggregate(rows, addDays(today, -7), addDays(today, -1)),
    last30: aggregate(rows, addDays(today, -30), addDays(today, -1)),
  };

  const motivation: Motivation = {
    streaks: run,
    loggedDays: lifetime.loggedDays,
    totalDeficit: lifetime.deficit,
    totalFatKg: lifetime.fatKg,
    butterPacks: Math.max(0, lifetime.fatKg) / 0.25,
    dietsCompleted,
    milestones: milestones(lifetime, run, dietsCompleted),
    messages: mentor({ rows, body, day, week: periods.week, diet, glycogen, run, sex: profile.sex, today }),
  };

  return { ready: true, today, body, day, periods, weeks, months, days: rows.slice(-DAYS_SHOWN), glycogen, diet, motivation };
}

function milestones(lifetime: Aggregate, run: Streaks, dietsCompleted: number): Milestone[] {
  const deficit = lifetime.deficit;
  return [
    { key: 'first-day', label: 'Πρώτη μέρα καταγραφής', done: lifetime.loggedDays >= 1 },
    { key: 'streak-7', label: '7 μέρες καταγραφής στη σειρά', done: run.bestLog >= 7 },
    { key: 'streak-30', label: '30 μέρες καταγραφής στη σειρά', done: run.bestLog >= 30 },
    { key: 'target-7', label: '7 μέρες στη σειρά μέσα στον στόχο', done: run.bestTarget >= 7 },
    { key: 'deficit-3850', label: 'Έλλειμμα 3.850 kcal: μισό κιλό λίπους', done: deficit >= 3850 },
    { key: 'deficit-7700', label: 'Έλλειμμα 7.700 kcal: ένα κιλό λίπους', done: deficit >= 7700 },
    { key: 'deficit-23100', label: 'Έλλειμμα 23.100 kcal: τρία κιλά λίπους', done: deficit >= 23100 },
    { key: 'deficit-38500', label: 'Έλλειμμα 38.500 kcal: πέντε κιλά λίπους', done: deficit >= 38500 },
    { key: 'diet-done', label: 'Ολοκληρωμένη δίαιτα', done: dietsCompleted >= 1 },
  ];
}

const kcal = (n: number): string => `${Math.round(Math.abs(n)).toLocaleString('el-GR')} kcal`;
const kg1 = (n: number): string => `${Math.abs(n).toFixed(1).replace('.', ',')} kg`;
const grams = (kgValue: number): string => `${Math.round(Math.abs(kgValue) * 1000).toLocaleString('el-GR')} g`;

interface MentorInput {
  rows: DayRow[];
  body: Body;
  day: TodayBlock;
  week: Aggregate;
  diet: DietStats | null;
  glycogen: GlycogenBlock;
  run: Streaks;
  sex: Sex;
  today: Day;
}

/** What a mentor would say today: a few short remarks picked by simple rules, most important first. */
export function mentor(m: MentorInput): Message[] {
  const out: Message[] = [];
  const counted = m.rows.filter((r) => r.counted);
  const yesterday = m.rows.length >= 2 ? m.rows[m.rows.length - 2] : null;

  // 1. eating far too little is the one thing worth interrupting for
  const lastThree = counted.slice(-3);
  if (lastThree.length === 3 && lastThree.every((r) => r.intake < MIN_INTAKE[m.sex]) && diffDays(m.today, lastThree[2].day) <= 2) {
    out.push({
      tone: 'warn',
      text: `Τρεις μέρες στη σειρά κάτω από ${kcal(MIN_INTAKE[m.sex])}. Τόσο μεγάλο έλλειμμα κοστίζει μυϊκή μάζα και δύσκολα κρατιέται. Ανέβασε λίγο τις θερμίδες.`,
    });
  }

  // 2. today
  if (m.day.entries === 0) {
    out.push({ tone: 'info', text: `Δεν έχεις γράψει τίποτα σήμερα. Ο στόχος της ημέρας είναι ${kcal(m.day.target)}.` });
  } else if (m.day.remaining < -TARGET_TOLERANCE) {
    const rest =
      m.week.deficit > 0
        ? ` Μία μέρα δεν χαλάει την εβδομάδα: το έλλειμμα της εβδομάδας είναι ακόμη ${kcal(m.week.deficit)}.`
        : ' Αύριο είναι καινούργια μέρα, συνέχισε από εκεί που ήσουν.';
    out.push({ tone: 'warn', text: `Σήμερα είσαι ${kcal(m.day.remaining)} πάνω από τον στόχο.${rest}` });
  }

  // 3. the diet reached its planned length
  if (m.diet?.overdue) {
    out.push({
      tone: 'info',
      text: `Η δίαιτα «${m.diet.diet.name}» πέρασε τις ${m.diet.diet.planned_days} μέρες που είχες βάλει. Κλείσε την και κάνε ένα διάλειμμα στη συντήρηση πριν από την επόμενη.`,
    });
  }

  // 4. glycogen, so that the scale does not mislead
  if (m.diet && m.diet.dayNumber <= 14 && m.diet.totals.glycogenKg <= -0.3) {
    out.push({
      tone: 'info',
      text: `Από ό,τι έχει πέσει η ζυγαριά, περίπου ${kg1(m.diet.totals.glycogenKg)} είναι γλυκογόνο και νερό, όχι λίπος. Το λίπος που έχεις κάψει είναι γύρω στα ${grams(m.diet.totals.fatKg)}. Είναι φυσιολογικό ο ρυθμός να πέσει μετά τις πρώτες μέρες.`,
    });
  } else if (yesterday?.counted && yesterday.glycogenDeltaG >= 40) {
    out.push({
      tone: 'info',
      text: `Χθες έφαγες περισσότερο από τις προηγούμενες μέρες: η ζυγαριά μπορεί να δείξει ως +${kg1(glycogenScaleKg(yesterday.glycogenDeltaG))} από γλυκογόνο και νερό. Δεν είναι λίπος.`,
    });
  }

  // 5. what is going well
  if (m.run.target >= 2) {
    out.push({ tone: 'good', text: `${m.run.target} μέρες στη σειρά μέσα στον στόχο. Έτσι χτίζεται.` });
  } else if (m.run.log >= 3) {
    out.push({ tone: 'good', text: `${m.run.log} μέρες στη σειρά που γράφεις ό,τι τρως. Η συνέπεια είναι το μισό παιχνίδι.` });
  }
  if (m.week.deficit >= 1500) {
    out.push({
      tone: 'good',
      text: `Αυτή την εβδομάδα έχεις έλλειμμα ${kcal(m.week.deficit)}, δηλαδή γύρω στα ${grams(m.week.fatKg)} λίπους.`,
    });
  }
  if (m.diet?.projectedGoalDay && m.diet.goalKg !== null) {
    const [y, mo, d] = m.diet.projectedGoalDay.split('-');
    out.push({ tone: 'info', text: `Με τον ρυθμό που πας, φτάνεις τα ${kg1(m.diet.goalKg)} γύρω στις ${d}/${mo}/${y}.` });
  }

  // 6. housekeeping
  const stale = diffDays(m.today, m.body.weightDay);
  if (stale > 10) {
    out.push({ tone: 'info', text: `Η τελευταία ζύγιση είναι πριν από ${stale} μέρες. Ζυγίσου για να υπολογίζονται σωστά οι θερμίδες σου.` });
  }
  if (!m.diet && out.length < 2) {
    out.push({
      tone: 'info',
      text: `Δεν τρέχει δίαιτα αυτή τη στιγμή. Για να μείνεις στα ίδια κιλά τρως γύρω στις ${kcal(m.body.maintenance)} τη μέρα.`,
    });
  }
  return out.slice(0, 4);
}
