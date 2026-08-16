// The postprandial glucose model.
//
// This is a teaching model of a healthy, non-diabetic adult, not a clinical
// simulator. It is built to be *directionally* faithful to the literature and
// to be honest about its own limits. Every coefficient below carries the study
// it was calibrated against.
//
// Shape of the model
// ------------------
// Each item on the plate contributes one absorption pulse. The pulse is a gamma
// (Erlang-like) peak function, the standard shape for a first-order absorption
// process seen through a disposal process:
//
//     pulse(t) = A · [ (t/Tp) · e^(1 − t/Tp) ]^k
//
// which is exactly A at t = Tp, zero at t = 0, and decays smoothly after. Tp
// (time to peak) comes from the food's glycaemic index; k (sharpness) too. A
// (peak rise, mg/dL) is shared out across items from a single meal-level
// amplitude, so that the insulin response saturates for the meal as a whole
// rather than per item.
//
// Meal composition then modulates every pulse: fibre, fat and protein each
// attenuate the peak and push it later. Eating order applies a further
// attenuation on top, and only in proportion to how much protein/fibre/fat is
// actually present to act as a preload — a plate of pure sugar cannot be
// rescued by eating it in a different order, and the model says so.
//
// Calibration anchors
// -------------------
// - 75 g oral glucose in healthy young adults peaks near 180 mg/dL
//   (Sci Rep 2025, seated control arm: 181.9 ± 8.4 mg/dL).
// - A 628 kcal mixed meal (68 g carb / 55 g protein / 16 g fat) peaks near
//   120 mg/dL in a healthy adult, consistent with free-living CGM cohorts
//   (Metabolism 2023: breakfast 132 ± 17, lunch 118 ± 13, dinner 123 ± 17 mg/dL).
// - Eating protein and vegetables before the carbohydrate cuts the incremental
//   peak by roughly a third and the incremental AUC by roughly 40% in people
//   with prediabetes (Shukla 2019, Diabetes Obes Metab: peak attenuated >40%,
//   iAUC −38.8%). Shukla's 2015 type 2 diabetes pilot found a far larger 73%
//   iAUC drop; this model deliberately uses the smaller non-diabetic-leaning
//   figure rather than the headline one.
// - A 10-minute walk immediately after the load cut the peak from 182 to
//   164 mg/dL — about a fifth of the excursion (Sci Rep 2025).

import type { Category, Food } from "../data/foods";

/** Fasting glucose the curve starts and ends at, mg/dL. */
export const BASELINE_MG_DL = 90;

/**
 * Clinical hypoglycaemia threshold. A meal cannot drive a healthy person below
 * this, so the model clamps here: anything lower is an artefact, not a finding.
 */
export const HYPO_FLOOR_MG_DL = 70;

/** Above this the curve is drawn in the "spike" band. */
export const TARGET_CEILING_MG_DL = 140;

/** The x-axis. Both series must be back at baseline by the end of it. */
export const WINDOW_MIN = 180;

/** Minutes between sampled points. 180/2 + 1 = 91 points per series. */
export const SAMPLE_STEP_MIN = 2;

/**
 * Real curves undershoot baseline slightly after a big rise. Capped, because
 * baseline minus this cap is the lowest value the model can structurally
 * produce — and that has to stay clear of the 70 mg/dL floor.
 */
const MAX_REACTIVE_DIP_MG_DL = 14;

/** The excursion is tapered to exactly zero across this window. */
const TAPER_START_MIN = 150;

export type EatingOrder = "protein-fibre-first" | "carbs-sugar-first";

export const ORDERS: { id: EatingOrder; label: string; short: string; blurb: string }[] = [
  {
    id: "protein-fibre-first",
    label: "Protein & fibre first",
    short: "Protein first",
    blurb:
      "Vegetables and protein go in before a single grain of rice. They reach the gut first, so the carbohydrate arrives into a stomach that is already emptying slowly and a bloodstream already primed with insulin.",
  },
  {
    id: "carbs-sugar-first",
    label: "Carbs & sugar first",
    short: "Carbs first",
    blurb:
      "The bread, rice or drink goes in first, on an empty stomach, with nothing to slow it down. Same food, same grams, same calories — a different curve.",
  },
];

export type PlateItem = { foodId: string; units: number };

/**
 * The one and only way grams are derived. Displayed grams are always
 * `units × unitWeightG`; nothing stores a gram figure of its own.
 */
export function gramsFor(food: Food, units: number): number {
  return units * food.unitWeightG;
}

export type Nutrients = {
  grams: number;
  carbsG: number;
  fibreG: number;
  proteinG: number;
  fatG: number;
  kcal: number;
  /** Total carbohydrate less fibre — the part that can reach the blood. */
  availableCarbsG: number;
  /** GI × available carbohydrate ÷ 100. The single best predictor of the peak. */
  glycaemicLoad: number;
};

const EMPTY: Nutrients = {
  grams: 0,
  carbsG: 0,
  fibreG: 0,
  proteinG: 0,
  fatG: 0,
  kcal: 0,
  availableCarbsG: 0,
  glycaemicLoad: 0,
};

export function nutrientsFor(food: Food, units: number): Nutrients {
  const grams = gramsFor(food, units);
  const scale = grams / 100;
  const carbsG = food.per100g.carbsG * scale;
  const fibreG = food.per100g.fibreG * scale;
  const availableCarbsG = Math.max(0, carbsG - fibreG);
  return {
    grams,
    carbsG,
    fibreG,
    proteinG: food.per100g.proteinG * scale,
    fatG: food.per100g.fatG * scale,
    kcal: food.per100g.kcal * scale,
    availableCarbsG,
    glycaemicLoad: ((food.gi ?? 0) / 100) * availableCarbsG,
  };
}

export function sumNutrients(parts: Nutrients[]): Nutrients {
  return parts.reduce(
    (acc, part) => ({
      grams: acc.grams + part.grams,
      carbsG: acc.carbsG + part.carbsG,
      fibreG: acc.fibreG + part.fibreG,
      proteinG: acc.proteinG + part.proteinG,
      fatG: acc.fatG + part.fatG,
      kcal: acc.kcal + part.kcal,
      availableCarbsG: acc.availableCarbsG + part.availableCarbsG,
      glycaemicLoad: acc.glycaemicLoad + part.glycaemicLoad,
    }),
    EMPTY,
  );
}

// --------------------------------------------------------------- activities

export type Activity = {
  id: string;
  label: string;
  emoji: string;
  /** One line on what the visitor actually does. */
  blurb: string;
  /** Minutes after the first bite that the activity starts. */
  startMin: number;
  durationMin: number;
  /**
   * Fraction of the remaining glucose excursion cleared by working muscle at
   * full effect. Contracting muscle takes up glucose without needing insulin,
   * which is why timing beats volume here.
   */
  disposalEffect: number;
  /** Minutes added to time-to-peak from changed stomach emptying. */
  emptyingDelayMin: number;
  /**
   * Peak flattening from slower stomach emptying alone. This spreads the same
   * absorbed glucose over more minutes; it does not dispose of any of it, so a
   * value below 1 here lowers the peak while leaving the area barely changed.
   */
  emptyingFlatteningFactor?: number;
  /** What the number above is calibrated against. */
  evidence: string;
};

export const ACTIVITIES: Activity[] = [
  {
    id: "sit",
    label: "Just sit down",
    emoji: "🪑",
    blurb: "The control condition. Sofa, desk, or the same chair you ate in.",
    startMin: 0,
    durationMin: 120,
    disposalEffect: 0,
    emptyingDelayMin: 0,
    evidence: "The seated control arm every trial below is measured against.",
  },
  {
    id: "stand",
    label: "Stand up, don't sit",
    emoji: "🧍",
    blurb: "Upright but still. Counter, standing desk, waiting for a bus.",
    startMin: 5,
    durationMin: 60,
    disposalEffect: 0.05,
    emptyingDelayMin: 0,
    evidence:
      "Contested. Buffey 2022 found a small benefit (Δ −0.31) but a 2026 Obesity Reviews re-analysis attributes it to one non-crossover study and finds standing alone does not meaningfully lower glucose. Modelled small on purpose.",
  },
  {
    id: "walk-10",
    label: "10-minute walk",
    emoji: "🚶",
    blurb: "Around the block, starting a quarter of an hour after you finish.",
    startMin: 15,
    durationMin: 10,
    disposalEffect: 0.2,
    emptyingDelayMin: 0,
    evidence:
      "A 10-min walk after a 75 g load cut the peak from 181.9 to 164.3 mg/dL — about a fifth of the excursion (Sci Rep 2025).",
  },
  {
    id: "walk-20",
    label: "20-minute brisk walk",
    emoji: "🥾",
    blurb: "Long enough to warm up, brisk enough to notice.",
    startMin: 15,
    durationMin: 20,
    disposalEffect: 0.28,
    emptyingDelayMin: 0,
    evidence:
      "Light-intensity walking breaks attenuate postprandial glucose with a pooled Δ of −0.72 versus sitting (Buffey 2022, Sports Med).",
  },
  {
    id: "bodyweight-10",
    label: "10 min bodyweight circuit",
    emoji: "🏋️",
    blurb: "Squats, lunges, push-ups. Big muscles, no equipment.",
    startMin: 20,
    durationMin: 10,
    disposalEffect: 0.25,
    emptyingDelayMin: 0,
    evidence:
      "Squat breaks lowered post-meal glucose more than an equivalent single walk, and quadriceps/gluteal activation predicted the size of the drop (Gao 2024). One minute of stair climbing alone moved glucose −14.0 mg/dL (Moore 2024).",
  },
  {
    id: "movement-snacks",
    label: "3 min of movement every half hour",
    emoji: "⏱️",
    blurb: "Don't sit still for two hours. Get up, move, sit back down, repeat.",
    startMin: 10,
    durationMin: 110,
    disposalEffect: 0.24,
    emptyingDelayMin: 0,
    evidence:
      "Breaking up sitting with short activity bouts beat one longer walk of the same total duration (Gao 2024; Buffey 2022).",
  },
  {
    id: "chores",
    label: "Potter around the house",
    emoji: "🧹",
    blurb: "Dishes, tidying, hanging washing. Not exercise, but not sitting.",
    startMin: 10,
    durationMin: 45,
    disposalEffect: 0.12,
    emptyingDelayMin: 0,
    evidence:
      "Light-intensity activity of 15 and 40 minutes both lowered the glucose response to a carbohydrate-rich meal against two hours of seated rest.",
  },
  {
    id: "nap",
    label: "Take a nap",
    emoji: "😴",
    blurb: "Horizontal, within half an hour of eating.",
    startMin: 20,
    durationMin: 90,
    disposalEffect: 0,
    emptyingDelayMin: 10,
    emptyingFlatteningFactor: 0.87,
    evidence:
      "There is no good trial evidence that lying down disposes of glucose worse than sitting — and sitting vs standing shows posture alone barely matters. A nap costs you the walk, not the other way round; lying down does slow stomach emptying, which shifts the peak later without shrinking it.",
  },
];

export const ACTIVITIES_BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

// -------------------------------------------------------------- the maths

/**
 * Meal-level peak amplitude in mg/dL above baseline, before composition and
 * order modifiers. Saturating in glycaemic load, because insulin secretion
 * scales with the load: doubling the carbohydrate does not double the peak.
 *
 * Anchored so that GL 75 (75 g of pure glucose) gives ~82 mg/dL of rise on top
 * of a 90 mg/dL baseline, i.e. a peak near 172 — the low end of the 160-182
 * range reported for that challenge in healthy adults.
 */
function rawAmplitude(glycaemicLoad: number): number {
  return 98 * (1 - Math.exp(-glycaemicLoad / 42));
}

/**
 * Every brake in this model is measured *per gram of available carbohydrate*,
 * not in absolute grams. This matters, and the first version of the model got
 * it wrong: with absolute grams, a 2,700 kcal blowout scored a lower peak than
 * a vending-machine lunch, because its 67 g of fat attenuated a peak that its
 * 471 g of carbohydrate had already saturated. Ten grams of fat is a serious
 * brake on a 30 g-carb meal and a rounding error on a 400 g-carb one.
 *
 * The floor of 15 g stops tiny-carb plates dividing by almost nothing.
 */
function brakeRatios(n: Nutrients): { fibre: number; fat: number; protein: number } {
  const carbs = Math.max(15, n.availableCarbsG);
  return { fibre: n.fibreG / carbs, fat: n.fatG / carbs, protein: n.proteinG / carbs };
}

/**
 * Categories a visitor can physically eat *first*. This distinction is the
 * whole point of the order effect and the second thing the model got wrong: a
 * single banana was scoring a 14% benefit from "eating fibre first", which is
 * incoherent — you cannot eat a banana's fibre before its own sugar. Only
 * protein, vegetable and fat *items* can act as a preload, because only they
 * can be lifted off the plate and eaten ahead of the carbohydrate.
 */
const PRELOAD_CATEGORIES = new Set<Category>(["protein", "veggies", "fats"]);

/**
 * How much of a preload the plate's separately-eatable items can act as, 0-1.
 * Fibre is weighted heaviest gram for gram, then protein (which drives the
 * incretin and insulin response), then fat — all measured against the whole
 * plate's carbohydrate, since that is what they have to slow down.
 *
 * Shukla's meal — chicken, broccoli and salad against ~60 g of available
 * carbohydrate — scores ~0.74, which pins the order effect near the observed
 * one-third peak reduction. A cola, two slices of white bread and a donut score
 * 0, so the model refuses to pretend reordering that plate would help.
 */
function preloadStrength(items: { food: Food; units: number }[], totals: Nutrients): number {
  const preload = sumNutrients(
    items
      .filter((item) => PRELOAD_CATEGORIES.has(item.food.category))
      .map((item) => nutrientsFor(item.food, item.units)),
  );
  const carbs = Math.max(15, totals.availableCarbsG);
  const weighted = preload.proteinG + 2.5 * preload.fibreG + 0.6 * preload.fatG;
  return 1 - Math.exp(-weighted / carbs / 0.9);
}

/** Delays saturate: no combination of macros can push a peak past ~26 min late. */
function saturatingDelay(rawMinutes: number): number {
  return 26 * (1 - Math.exp(-rawMinutes / 26));
}

/**
 * Smoothly forces the excursion to zero by WINDOW_MIN. Cosine so that both
 * ends are flat: no kink at 150 min, exactly zero at 180 min.
 */
function taper(t: number): number {
  if (t <= TAPER_START_MIN) return 1;
  if (t >= WINDOW_MIN) return 0;
  const x = (t - TAPER_START_MIN) / (WINDOW_MIN - TAPER_START_MIN);
  return 0.5 * (1 + Math.cos(Math.PI * x));
}

/**
 * Working muscle clears glucose from the moment it starts contracting, and
 * keeps clearing it for hours afterwards — so the ramp rises during the bout
 * and then stays up rather than decaying back.
 */
function activityFactor(t: number, activity: Activity): number {
  if (activity.disposalEffect === 0 || t <= activity.startMin) return 1;
  const rampMin = Math.max(4, activity.durationMin * 0.6);
  const ramp = Math.min(1, (t - activity.startMin) / rampMin);
  return 1 - activity.disposalEffect * ramp;
}

/**
 * The hypoglycaemia guard. Exported and named so a test can prove it works:
 * the exhaustive sweep over every plate passes even with this deleted, because
 * the reactive dip is capped at 14 mg/dL below a 90 mg/dL baseline and so cannot
 * reach 70 by construction. That makes the clamp defence-in-depth against a
 * future change to those constants rather than something load-bearing today —
 * and it is exactly why `spec/curve.test.ts` tests both this function directly
 * and the margin the model keeps above the floor.
 */
export function clampFloor(mgdl: number): number {
  return Math.max(HYPO_FLOOR_MG_DL, mgdl);
}

/** The gamma peak function: exactly 1 at t = tp, 0 at t ≤ 0. */
function gammaPulse(t: number, tp: number, k: number): number {
  if (t <= 0) return 0;
  const x = t / tp;
  return Math.pow(x * Math.exp(1 - x), k);
}

type Pulse = { amplitude: number; peakMin: number; sharpness: number };

export type SimulationInput = {
  items: { food: Food; units: number }[];
  activityId: string;
};

export type SeriesPoint = { minutes: number; mgdl: number };

export type Series = {
  order: EatingOrder;
  points: SeriesPoint[];
  peakMgDl: number;
  peakMin: number;
  /** Incremental area under the curve above baseline, mg/dL·min. */
  iaucMgDlMin: number;
  minutesAbove140: number;
};

export type Simulation = {
  baselineMgDl: number;
  floorMgDl: number;
  windowMin: number;
  totals: Nutrients;
  activity: Activity;
  /** How much leverage eating order has on this particular plate, 0-1. */
  preloadStrength: number;
  isEmpty: boolean;
  series: Record<EatingOrder, Series>;
};

function buildPulses(input: SimulationInput, order: EatingOrder, totals: Nutrients): Pulse[] {
  const activity = ACTIVITIES_BY_ID.get(input.activityId) ?? ACTIVITIES[0];
  const strength = preloadStrength(input.items, totals);
  const r = brakeRatios(totals);

  // Composition attenuation: credit for these macros being in the meal at all.
  // Deliberately gentler than a true preload effect — the order effect below is
  // the extra credit for them arriving *before* the carbohydrate.
  const compositionAttenuation = 1 / (1 + 0.45 * r.protein + 1.8 * r.fibre + 0.35 * r.fat);

  // Shukla 2019: eating protein and vegetables first attenuated the incremental
  // peak by >40% in prediabetes. 0.42 × strength lands a Shukla-shaped meal on
  // ~34%, and a plate with nothing to preload with on ~0%.
  const orderAttenuation = order === "protein-fibre-first" ? 1 - 0.42 * strength : 1;

  const mealAmplitude =
    rawAmplitude(totals.glycaemicLoad) *
    compositionAttenuation *
    orderAttenuation *
    (activity.emptyingFlatteningFactor ?? 1);

  // The same brakes that lower the peak also push it later.
  const rawDelay =
    22 * (2.5 * r.fibre + 0.6 * r.fat + 0.5 * r.protein) +
    (order === "protein-fibre-first" ? 14 * strength : 0) +
    activity.emptyingDelayMin;
  const delayMin = saturatingDelay(rawDelay);

  return input.items
    .map((item) => {
      const n = nutrientsFor(item.food, item.units);
      if (n.glycaemicLoad <= 0 || totals.glycaemicLoad <= 0) return undefined;
      const gi = item.food.gi ?? 55;
      return {
        // Share the saturated meal amplitude out by each item's contribution.
        amplitude: mealAmplitude * (n.glycaemicLoad / totals.glycaemicLoad),
        // Fast carbohydrate peaks early: GI 100 → 28 min, GI 50 → 43 min.
        peakMin: Math.min(78, Math.max(26, 28 + (100 - gi) * 0.3 + delayMin)),
        // Higher GI also means a narrower spike, not just an earlier one.
        sharpness: 6 + (gi / 100) * 4,
      };
    })
    .filter((pulse): pulse is Pulse => pulse !== undefined);
}

function buildSeries(input: SimulationInput, order: EatingOrder, totals: Nutrients): Series {
  const activity = ACTIVITIES_BY_ID.get(input.activityId) ?? ACTIVITIES[0];
  const pulses = buildPulses(input, order, totals);
  const peakAmplitude = pulses.reduce((max, p) => Math.max(max, p.amplitude), 0);

  // Real curves undershoot baseline a little on the way down after a big rise.
  // Small, late, and bounded — the clamp is the backstop, not the mechanism.
  const dipAmplitude = Math.min(MAX_REACTIVE_DIP_MG_DL, 0.11 * peakAmplitude);
  const dipPeakMin = Math.min(150, 2.2 * (pulses[0]?.peakMin ?? 45));

  const points: SeriesPoint[] = [];
  let peakMgDl = BASELINE_MG_DL;
  let peakMin = 0;
  let iauc = 0;
  let minutesAbove140 = 0;

  for (let t = 0; t <= WINDOW_MIN; t += SAMPLE_STEP_MIN) {
    const rise = pulses.reduce((sum, p) => sum + p.amplitude * gammaPulse(t, p.peakMin, p.sharpness), 0);
    const dip = dipAmplitude * gammaPulse(t, dipPeakMin, 4);
    const excursion = (rise - dip) * activityFactor(t, activity) * taper(t);
    const mgdl = clampFloor(BASELINE_MG_DL + excursion);

    points.push({ minutes: t, mgdl });
    if (mgdl > peakMgDl) {
      peakMgDl = mgdl;
      peakMin = t;
    }
    iauc += Math.max(0, mgdl - BASELINE_MG_DL) * SAMPLE_STEP_MIN;
    if (mgdl > TARGET_CEILING_MG_DL) minutesAbove140 += SAMPLE_STEP_MIN;
  }

  return { order, points, peakMgDl, peakMin, iaucMgDlMin: iauc, minutesAbove140 };
}

export function simulate(input: SimulationInput): Simulation {
  const totals = sumNutrients(input.items.map((item) => nutrientsFor(item.food, item.units)));
  const activity = ACTIVITIES_BY_ID.get(input.activityId) ?? ACTIVITIES[0];
  return {
    baselineMgDl: BASELINE_MG_DL,
    floorMgDl: HYPO_FLOOR_MG_DL,
    windowMin: WINDOW_MIN,
    totals,
    activity,
    preloadStrength: preloadStrength(input.items, totals),
    isEmpty: input.items.length === 0 || totals.grams === 0,
    series: {
      "protein-fibre-first": buildSeries(input, "protein-fibre-first", totals),
      "carbs-sugar-first": buildSeries(input, "carbs-sugar-first", totals),
    },
  };
}
