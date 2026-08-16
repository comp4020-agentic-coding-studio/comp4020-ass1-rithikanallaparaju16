// The weight-trend model, checked against the published equation rather than
// against itself. Mifflin-St Jeor is arithmetic; if these drift, the panel is
// making numbers up.

import { describe, expect, it } from "vitest";
import { FOODS_BY_ID } from "../src/data/foods";
import type { Profile } from "../src/model/energy";
import {
  ACTIVITY_LEVELS,
  KCAL_PER_KG,
  STEADY_BAND_KCAL,
  adviceFor,
  basalMetabolicRate,
  estimateTrend,
  totalDailyEnergy,
} from "../src/model/energy";
import { nutrientsFor, sumNutrients } from "../src/model/glucose";

const base: Profile = {
  weightKg: 80,
  heightCm: 180,
  ageYears: 30,
  sex: "male",
  activityLevel: "sedentary",
  mealsPerDay: 3,
  goal: "maintain",
};

function plate(spec: [string, number][]) {
  return sumNutrients(
    spec.map(([id, units]) => {
      const food = FOODS_BY_ID.get(id);
      if (!food) throw new Error(`no such food: ${id}`);
      return nutrientsFor(food, units);
    }),
  );
}

describe("Mifflin-St Jeor", () => {
  it("matches the published equation for men: 10kg + 6.25cm − 5age + 5", () => {
    // 800 + 1125 − 150 + 5
    expect(basalMetabolicRate(base)).toBeCloseTo(1780, 6);
  });

  it("matches the published equation for women: 10kg + 6.25cm − 5age − 161", () => {
    // 650 + 1031.25 − 125 − 161
    expect(
      basalMetabolicRate({ ...base, sex: "female", weightKg: 65, heightCm: 165, ageYears: 25 }),
    ).toBeCloseTo(1395.25, 6);
  });

  it("uses the midpoint of the two constants when sex is not stated", () => {
    const male = basalMetabolicRate({ ...base, sex: "male" });
    const female = basalMetabolicRate({ ...base, sex: "female" });
    expect(basalMetabolicRate({ ...base, sex: "unspecified" })).toBeCloseTo((male + female) / 2, 6);
  });

  it("multiplies by the activity level to get total daily energy", () => {
    for (const level of ACTIVITY_LEVELS) {
      expect(totalDailyEnergy({ ...base, activityLevel: level.id })).toBeCloseTo(
        1780 * level.multiplier,
        6,
      );
    }
  });

  it("orders the activity multipliers, sedentary to extreme", () => {
    const multipliers = ACTIVITY_LEVELS.map((l) => l.multiplier);
    expect(multipliers).toEqual([...multipliers].sort((a, b) => a - b));
    expect(multipliers[0]).toBe(1.2);
    expect(multipliers.at(-1)).toBe(1.9);
  });
});

describe("the weekly projection", () => {
  it("converts the daily balance at 7,700 kcal per kilogram", () => {
    const trend = estimateTrend(base, plate([["white-rice", 2]]));
    expect(trend.kgPerWeek).toBeCloseTo((trend.balanceKcal * 7) / KCAL_PER_KG, 9);
  });

  it("multiplies the plate by the number of meals a day", () => {
    const totals = plate([["white-rice", 2], ["chicken-breast", 1]]);
    for (const mealsPerDay of [1, 2, 3, 4, 5, 6]) {
      const trend = estimateTrend({ ...base, mealsPerDay }, totals);
      expect(trend.projectedIntakeKcal).toBeCloseTo(totals.kcal * mealsPerDay, 6);
    }
  });

  it("calls a small imbalance steady rather than a trend", () => {
    const tdee = totalDailyEnergy(base);
    const nearly = { ...plate([]), kcal: (tdee + STEADY_BAND_KCAL - 10) / 3 };
    expect(estimateTrend(base, nearly).verdict).toBe("steady");
  });

  it("calls a real surplus a gain and a real deficit a loss", () => {
    const tdee = totalDailyEnergy(base);
    const surplus = { ...plate([]), kcal: (tdee + 900) / 3 };
    const deficit = { ...plate([]), kcal: (tdee - 900) / 3 };
    expect(estimateTrend(base, surplus).verdict).toBe("gain");
    expect(estimateTrend(base, surplus).kgPerWeek).toBeGreaterThan(0);
    expect(estimateTrend(base, deficit).verdict).toBe("lose");
    expect(estimateTrend(base, deficit).kgPerWeek).toBeLessThan(0);
  });

  it("never phrases a loss as a negative gain", () => {
    const tdee = totalDailyEnergy(base);
    const headline = estimateTrend(base, { ...plate([]), kcal: (tdee - 900) / 3 }).headline;
    expect(headline).toMatch(/losing/iu);
    expect(headline).not.toMatch(/-\d/u);
  });

  it("asks more protein of a deficit than of maintenance", () => {
    const totals = plate([["chicken-breast", 1]]);
    const lose = estimateTrend({ ...base, goal: "lose" }, totals).proteinTargetG;
    const gain = estimateTrend({ ...base, goal: "gain" }, totals).proteinTargetG;
    const maintain = estimateTrend({ ...base, goal: "maintain" }, totals).proteinTargetG;
    expect(maintain).toBeLessThan(gain);
    expect(gain).toBeLessThan(lose);
    expect(maintain / base.weightKg).toBeCloseTo(1.2, 6);
  });
});

describe("the advice", () => {
  it("says nothing about an empty plate", () => {
    const totals = plate([]);
    expect(adviceFor(base, totals, estimateTrend(base, totals))).toHaveLength(0);
  });

  it("asks for fibre when there is none, and stops when there is", () => {
    const bare = plate([["white-rice", 2]]);
    const fibrous = plate([["white-rice", 2], ["lentils", 2], ["broccoli", 2]]);
    const said = (totals: ReturnType<typeof plate>) =>
      adviceFor(base, totals, estimateTrend(base, totals))
        .map((a) => `${a.kind}:${a.text}`)
        .join(" | ");
    expect(said(bare)).toMatch(/tweak:[^|]*fibre/iu);
    expect(said(fibrous)).toMatch(/good:[^|]*fibre/iu);
  });

  it("names the contradiction when the goal and the calories disagree", () => {
    const tdee = totalDailyEnergy(base);
    const surplus = { ...plate([["white-rice", 2]]), kcal: (tdee + 900) / 3 };
    const wantsLoss = { ...base, goal: "lose" as const };
    const texts = adviceFor(wantsLoss, surplus, estimateTrend(wantsLoss, surplus)).map((a) => a.text);
    expect(texts.join(" ")).toMatch(/surplus/iu);
  });

  it("flags a big single glycaemic hit and suggests a swap, not a ban", () => {
    const heavy = plate([["white-rice", 3], ["mashed-potato", 2]]);
    const texts = adviceFor(base, heavy, estimateTrend(base, heavy)).map((a) => a.text);
    const glycaemic = texts.find((t) => /glycaemic load/iu.test(t)) ?? "";
    expect(glycaemic).toMatch(/basmati|sourdough|al dente/iu);
    expect(glycaemic).not.toMatch(/\bstop\b|\bnever\b|\bavoid\b/iu);
  });
});
