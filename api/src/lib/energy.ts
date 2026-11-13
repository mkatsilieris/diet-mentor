/**
 * The physiology the app rests on, as plain functions.
 *
 * Calories: basal metabolic rate from the Mifflin-St Jeor equation, times an activity factor, gives
 * the calories that keep the weight where it is. A kilogram of body fat is taken as 7700 kcal.
 *
 * Glycogen: the body keeps roughly half a kilogram of carbohydrate in muscle and liver, and every
 * gram is stored with about three grams of water. Eating below maintenance empties part of that
 * store within a few days, eating at maintenance fills it again. On the scale this looks like a fast
 * loss in the first days of a diet and a jump after a big meal; neither is fat. The model below
 * estimates the store day by day, so that the part of a deficit that came out of glycogen is not
 * counted as fat, and the scale can be explained. It is an estimate, not a measurement.
 */

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const KCAL_PER_KG_FAT = 7700;
export const KCAL_PER_G_GLYCOGEN = 4;
/** Grams of water held by each gram of glycogen. */
export const WATER_PER_G_GLYCOGEN = 3;
/** Grams of glycogen a full store holds per kilogram of lean mass (about 500 g for a 70 kg man). */
export const GLYCOGEN_G_PER_KG_LEAN = 9;
/** Share of the calories that carbohydrates give in an ordinary mixed diet. */
export const TYPICAL_CARB_SHARE = 0.45;
/** Intakes below these are not offered as a target (usual guidance without medical supervision). */
export const MIN_INTAKE: Record<Sex, number> = { female: 1200, male: 1500 };
/** The paces a diet can ask for, in kg per week. */
export const RATES = [0.25, 0.5, 0.75, 1] as const;
export const MAX_RATE = 1;

/** Basal metabolic rate in kcal/day (Mifflin-St Jeor). */
export function bmr(sex: Sex, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
}

/** Calories per day that keep the weight steady. */
export const tdee = (basal: number, activity: Activity): number => basal * ACTIVITY_FACTOR[activity];

/** Lean body mass in kg (Boer formula), kept inside a plausible share of the body weight. */
export function leanMassKg(sex: Sex, kg: number, cm: number): number {
  const boer = sex === 'male' ? 0.407 * kg + 0.267 * cm - 19.2 : 0.252 * kg + 0.473 * cm - 48.3;
  return Math.min(0.95 * kg, Math.max(0.5 * kg, boer));
}

export const glycogenCapacityG = (sex: Sex, kg: number, cm: number): number =>
  GLYCOGEN_G_PER_KG_LEAN * leanMassKg(sex, kg, cm);

export const bmi = (kg: number, cm: number): number => kg / (cm / 100) ** 2;

/** Daily deficit that loses `rate` kg of fat per week. */
export const deficitForRate = (rateKgWeek: number): number => (rateKgWeek * KCAL_PER_KG_FAT) / 7;

/** The calories to eat for a pace, never below the minimum intake. `floored` tells that the pace was too fast for this body. */
export function targetIntake(maintenance: number, rateKgWeek: number, sex: Sex): { target: number; floored: boolean } {
  const wanted = maintenance - deficitForRate(rateKgWeek);
  const floor = Math.min(MIN_INTAKE[sex], maintenance);
  return wanted < floor ? { target: floor, floored: true } : { target: wanted, floored: false };
}

export interface LossPlan {
  rateKgWeek: number;
  dailyDeficit: number;
  intake: number;
  /** the pace would need fewer calories than the minimum intake */
  tooLow: boolean;
}

/** What to eat per day for each pace. */
export function lossPlans(maintenance: number, sex: Sex): LossPlan[] {
  return RATES.map((rateKgWeek) => {
    const { target, floored } = targetIntake(maintenance, rateKgWeek, sex);
    return { rateKgWeek, dailyDeficit: Math.round(deficitForRate(rateKgWeek)), intake: Math.round(target), tooLow: floored };
  });
}

/**
 * How full (0..1) the glycogen store settles when a day's eating is repeated.
 * `ratio` is what was eaten against what keeps the store full: carbs against the typical carbs of a
 * maintenance day when the carbs are known, otherwise calories against maintenance.
 * At ratio 1 or more the store is full; a 25% shortfall settles around two thirds; it never goes
 * below 30%, the part the body defends.
 */
export function glycogenEquilibrium(ratio: number): number {
  return Math.min(1, Math.max(0.3, 1 - 1.3 * (1 - ratio)));
}

/** Calories-or-carbs ratio of a day for glycogenEquilibrium. */
export function glycogenRatio(kcal: number, carbsG: number | null, maintenance: number): number {
  if (carbsG !== null) return carbsG / ((TYPICAL_CARB_SHARE * maintenance) / KCAL_PER_G_GLYCOGEN);
  return kcal / maintenance;
}

/** One day later: the store moves most of the way to its equilibrium (filling is faster than emptying). */
export function stepGlycogen(level: number, equilibrium: number): number {
  const speed = equilibrium > level ? 0.7 : 0.5;
  return level + speed * (equilibrium - level);
}

/** Scale weight (kg) of an amount of glycogen together with the water it holds. */
export const glycogenScaleKg = (grams: number): number => (grams * (1 + WATER_PER_G_GLYCOGEN)) / 1000;
