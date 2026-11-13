export interface User {
  id: number;
  email: string;
  name: string;
}

/** A calendar day, 'YYYY-MM-DD'. */
export type Day = string;
export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

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

export interface Entry {
  id: number;
  day: Day;
  /** 'HH:MM' */
  time: string;
  name: string;
  kcal: number;
  carbs_g: number | null;
}

export interface EntriesResponse {
  day: Day;
  entries: Entry[];
  total_kcal: number;
}

/** One of the person's own foods, with the calories it was last written with. */
export interface Food {
  name: string;
  kcal: number;
  carbs_g: number | null;
  uses: number;
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

export interface LossPlan {
  rateKgWeek: number;
  dailyDeficit: number;
  intake: number;
  tooLow: boolean;
}

export interface DayRow {
  day: Day;
  logged: boolean;
  /** logged and over: only these days enter the sums */
  counted: boolean;
  intake: number;
  carbs: number | null;
  weightKg: number;
  weighedKg: number | null;
  maintenance: number;
  target: number;
  dietId: number | null;
  deficit: number;
  onTarget: boolean;
  glycogenLevel: number;
  glycogenG: number;
  glycogenDeltaG: number;
  fatKg: number;
  fatCumKg: number;
  glycogenCumKg: number;
}

export interface Aggregate {
  from: Day;
  to: Day;
  loggedDays: number;
  intake: number;
  burned: number;
  deficit: number;
  avgDeficit: number;
  plannedDeficit: number;
  fatKg: number;
  glycogenKg: number;
  scaleKg: number;
  onTargetDays: number;
}

export interface DietStats {
  diet: Diet;
  active: boolean;
  dayNumber: number;
  daysLeft: number | null;
  timePct: number | null;
  overdue: boolean;
  dailyDeficitTarget: number;
  totals: Aggregate;
  adherencePct: number | null;
  startKg: number | null;
  currentKg: number | null;
  weightChangeKg: number | null;
  goalKg: number | null;
  goalPct: number | null;
  projectedGoalDay: Day | null;
}

export interface Message {
  tone: 'good' | 'info' | 'warn';
  text: string;
}

export interface Milestone {
  key: string;
  label: string;
  done: boolean;
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

export interface PlanMeal {
  /** 'HH:MM' */
  time: string;
  name: string;
  /** share of the day's target, whole percent */
  pct: number;
}

export interface MealPlan {
  meals: PlanMeal[];
  grace_min: number;
  tolerance_pct: number;
  notify: boolean;
}

export interface PaceStep extends PlanMeal {
  kcal: number;
  cumPct: number;
  cumKcal: number;
  state: 'covered' | 'late' | 'due' | 'upcoming';
}

/** Calories eaten against the calories the meal plan wants by this hour. */
export interface Pace {
  now: string;
  target: number;
  eaten: number;
  due: number;
  required: number;
  allowed: number;
  toleranceKcal: number;
  status: 'behind' | 'on' | 'ahead';
  diff: number;
  shortBy: number;
  lateMeal: PlanMeal | null;
  next: PaceStep | null;
  steps: PaceStep[];
}

export interface ReadySummary {
  ready: true;
  today: Day;
  pace: Pace;
  body: Body;
  day: { day: Day; intake: number; entries: number; maintenance: number; target: number; remaining: number };
  periods: { week: Aggregate; prevWeek: Aggregate; month: Aggregate; prevMonth: Aggregate; last7: Aggregate; last30: Aggregate };
  weeks: Aggregate[];
  months: Aggregate[];
  days: DayRow[];
  glycogen: { levelPct: number; storeG: number; capacityG: number; scaleKg: number };
  diet: DietStats | null;
  motivation: {
    streaks: { log: number; bestLog: number; target: number; bestTarget: number };
    loggedDays: number;
    totalDeficit: number;
    totalFatKg: number;
    butterPacks: number;
    dietsCompleted: number;
    milestones: Milestone[];
    messages: Message[];
  };
}

export type Summary = ReadySummary | { ready: false; today: Day; missing: ('profile' | 'weight')[] };
