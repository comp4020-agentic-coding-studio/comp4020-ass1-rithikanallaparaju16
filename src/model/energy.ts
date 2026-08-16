// The weight-trend model.
//
// Resting energy expenditure is the Mifflin-St Jeor equation, which is the one
// the Academy of Nutrition and Dietetics recommends for non-obese and obese
// adults because it predicts measured REE more accurately than Harris-Benedict:
//
//   men:   BMR = 10·kg + 6.25·cm − 5·age + 5
//   women: BMR = 10·kg + 6.25·cm − 5·age − 161
//
//   Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. "A new
//   predictive equation for resting energy expenditure in healthy individuals."
//   Am J Clin Nutr 1990;51(2):241-7.
//
// Total daily expenditure is BMR × a physical-activity level multiplier, the
// long-standing FAO/WHO/UNU convention.
//
// Converting an energy balance into kilos uses 7,700 kcal per kg of body
// tissue (the metric form of Wishnofsky's 3,500 kcal per pound). This rule is
// a linear approximation and it overestimates long-run loss, because
// expenditure falls as body mass falls. The model therefore projects one week
// only, and says so on the page.

import type { Nutrients } from "./glucose";

export type Sex = "male" | "female" | "unspecified";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";
export type Goal = "lose" | "maintain" | "gain";

export const ACTIVITY_LEVELS: {
  id: ActivityLevel;
  label: string;
  multiplier: number;
  blurb: string;
}[] = [
  { id: "sedentary", label: "Sedentary", multiplier: 1.2, blurb: "Desk job, little deliberate exercise" },
  { id: "light", label: "Lightly active", multiplier: 1.375, blurb: "Light exercise 1-3 days a week" },
  { id: "moderate", label: "Moderately active", multiplier: 1.55, blurb: "Moderate exercise 3-5 days a week" },
  { id: "very", label: "Very active", multiplier: 1.725, blurb: "Hard exercise 6-7 days a week" },
  { id: "extra", label: "Extremely active", multiplier: 1.9, blurb: "Physical job, or twice-daily training" },
];

export const GOALS: { id: Goal; label: string }[] = [
  { id: "lose", label: "Lose fat" },
  { id: "maintain", label: "Stay the same" },
  { id: "gain", label: "Build muscle" },
];

/** kcal in a kilogram of body tissue. */
export const KCAL_PER_KG = 7700;

/** Daily surplus or deficit smaller than this reads as "steady", not a trend. */
export const STEADY_BAND_KCAL = 150;

/** Australian adult fibre target, g/day (NHMRC adequate intake, 25-30 g). */
export const FIBRE_TARGET_G = 30;

export type Profile = {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  /** How many meals like the one on the plate the visitor eats in a day. */
  mealsPerDay: number;
  goal: Goal;
};

export type Trend = {
  bmrKcal: number;
  tdeeKcal: number;
  projectedIntakeKcal: number;
  balanceKcal: number;
  kgPerWeek: number;
  verdict: "gain" | "steady" | "lose";
  headline: string;
  /** g of protein a day for this weight and goal. */
  proteinTargetG: number;
  proteinOnPlateG: number;
  fibreTargetPerMealG: number;
  fibreOnPlateG: number;
};

/**
 * The sex constant. "unspecified" uses the midpoint of the two, which keeps the
 * estimate usable for anyone who would rather not answer; it is an average, and
 * the page says as much rather than pretending otherwise.
 */
function sexConstant(sex: Sex): number {
  if (sex === "male") return 5;
  if (sex === "female") return -161;
  return -78;
}

export function basalMetabolicRate(profile: Profile): number {
  return (
    10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears + sexConstant(profile.sex)
  );
}

export function totalDailyEnergy(profile: Profile): number {
  const level = ACTIVITY_LEVELS.find((l) => l.id === profile.activityLevel) ?? ACTIVITY_LEVELS[0];
  return basalMetabolicRate(profile) * level.multiplier;
}

/** g of protein per kg of body weight, by goal. Higher in a deficit, to hold lean mass. */
function proteinPerKg(goal: Goal): number {
  if (goal === "gain") return 1.6;
  if (goal === "lose") return 1.8;
  return 1.2;
}

export function estimateTrend(profile: Profile, plate: Nutrients): Trend {
  const bmrKcal = basalMetabolicRate(profile);
  const tdeeKcal = totalDailyEnergy(profile);
  const projectedIntakeKcal = plate.kcal * profile.mealsPerDay;
  const balanceKcal = projectedIntakeKcal - tdeeKcal;
  const kgPerWeek = (balanceKcal * 7) / KCAL_PER_KG;

  const verdict = Math.abs(balanceKcal) < STEADY_BAND_KCAL ? "steady" : balanceKcal > 0 ? "gain" : "lose";

  const kg = Math.abs(kgPerWeek).toFixed(2);
  const headline =
    verdict === "steady"
      ? "Eating like this holds your weight roughly where it is."
      : verdict === "gain"
        ? `Eating like this every day trends towards gaining about ${kg} kg a week.`
        : `Eating like this every day trends towards losing about ${kg} kg a week.`;

  return {
    bmrKcal,
    tdeeKcal,
    projectedIntakeKcal,
    balanceKcal,
    kgPerWeek,
    verdict,
    headline,
    proteinTargetG: proteinPerKg(profile.goal) * profile.weightKg,
    proteinOnPlateG: plate.proteinG,
    fibreTargetPerMealG: FIBRE_TARGET_G / Math.max(1, profile.mealsPerDay),
    fibreOnPlateG: plate.fibreG,
  };
}

export type Advice = { kind: "good" | "tweak"; text: string };

/**
 * Advice on the plate in front of the visitor, in the direction of their stated
 * goal. Deliberately about composition rather than restriction: every line
 * either points at something to add, or at a swap.
 */
export function adviceFor(profile: Profile, plate: Nutrients, trend: Trend): Advice[] {
  const advice: Advice[] = [];
  const proteinPerMeal = trend.proteinTargetG / Math.max(1, profile.mealsPerDay);

  if (plate.grams === 0) return advice;

  if (plate.proteinG < proteinPerMeal * 0.8) {
    advice.push({
      kind: "tweak",
      text: `This plate has ${plate.proteinG.toFixed(0)} g of protein; for your goal you want nearer ${proteinPerMeal.toFixed(0)} g a meal. Protein is also the thing that makes eating order work at all.`,
    });
  } else {
    advice.push({
      kind: "good",
      text: `${plate.proteinG.toFixed(0)} g of protein hits the mark for a ${profile.goal === "gain" ? "muscle-building" : profile.goal === "lose" ? "fat-loss" : "maintenance"} meal.`,
    });
  }

  if (plate.fibreG < trend.fibreTargetPerMealG) {
    advice.push({
      kind: "tweak",
      text: `Only ${plate.fibreG.toFixed(0)} g of fibre against a ${trend.fibreTargetPerMealG.toFixed(0)} g share of the daily 30 g. Lentils, beans or a bowl of greens are the cheapest fix, and they flatten the curve as a side effect.`,
    });
  } else {
    advice.push({
      kind: "good",
      text: `${plate.fibreG.toFixed(0)} g of fibre — enough to physically slow this meal down.`,
    });
  }

  if (plate.glycaemicLoad > 40) {
    advice.push({
      kind: "tweak",
      text: `A glycaemic load of ${plate.glycaemicLoad.toFixed(0)} is a big single hit. Swapping one high-GI item for its low-GI twin — basmati for white rice, sourdough for white bread, al dente pasta for mash — cuts the load without cutting the grams.`,
    });
  }

  if (profile.goal === "lose" && trend.balanceKcal > 0) {
    advice.push({
      kind: "tweak",
      text: `You want to lose fat, but this pattern runs a ${Math.round(trend.balanceKcal)} kcal daily surplus. A 300-500 kcal deficit is the usual sustainable range — that is roughly ${Math.round((trend.balanceKcal + 400) / Math.max(1, profile.mealsPerDay))} kcal off each meal.`,
    });
  }
  if (profile.goal === "gain" && trend.balanceKcal < 0) {
    advice.push({
      kind: "tweak",
      text: `You want to build muscle, but this pattern runs a ${Math.abs(Math.round(trend.balanceKcal))} kcal daily deficit. Muscle needs a small surplus — around 200-300 kcal a day — plus the protein target above.`,
    });
  }
  if (profile.goal === "maintain" && trend.verdict !== "steady") {
    advice.push({
      kind: "tweak",
      text: `To hold steady you want the daily balance inside ±${STEADY_BAND_KCAL} kcal; this pattern is ${Math.round(trend.balanceKcal)} kcal.`,
    });
  }

  if (plate.fatG > 0 && plate.availableCarbsG > 0) {
    advice.push({
      kind: "good",
      text: "There is fat on this plate, which flattens the curve by slowing your stomach — but it does not remove the carbohydrate, it just spreads it over more time.",
    });
  }

  return advice;
}
