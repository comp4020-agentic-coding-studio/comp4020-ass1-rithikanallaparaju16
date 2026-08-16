// The three prototype invariants from CLAUDE.md, held to across the whole
// space of plates a visitor can build rather than on one example each.
//
// The plates are enumerated, not sampled: every food on its own, every food at
// a silly serve count, every preset, every activity, and a deterministic set of
// mixed plates. If any of those can render a curve below 70, leave one elevated
// at 180 minutes, or print grams that disagree with the serve count, a test
// here fails and names which plate did it.

import { describe, expect, it } from "vitest";
import type { Food } from "../src/data/foods";
import { FOODS, FOODS_BY_ID, PRESETS } from "../src/data/foods";
import {
  ACTIVITIES,
  BASELINE_MG_DL,
  HYPO_FLOOR_MG_DL,
  SAMPLE_STEP_MIN,
  WINDOW_MIN,
  clampFloor,
  gramsFor,
  nutrientsFor,
  simulate,
  sumNutrients,
} from "../src/model/glucose";
import { unitsAndGrams } from "../src/ui/format";

type Plate = { name: string; items: { food: Food; units: number }[] };

function plate(name: string, spec: [string, number][]): Plate {
  return {
    name,
    items: spec.map(([id, units]) => {
      const food = FOODS_BY_ID.get(id);
      if (!food) throw new Error(`no such food: ${id}`);
      return { food, units };
    }),
  };
}

/**
 * A deterministic spread of plates. No randomness: a test that fails only on
 * some runs is worse than no test, because you cannot tell whether a fix worked.
 */
function everyPlate(): Plate[] {
  const plates: Plate[] = [{ name: "empty plate", items: [] }];

  for (const food of FOODS) {
    plates.push({ name: `one ${food.name}`, items: [{ food, units: 1 }] });
    plates.push({ name: `twenty ${food.name}`, items: [{ food, units: 20 }] });
  }

  for (const preset of PRESETS) {
    plates.push(plate(preset.label, preset.items.map((i) => [i.foodId, i.units])));
  }

  // Deliberately awkward mixtures: pure liquid sugar, sugar with a huge fatty
  // preload, and the biggest plate the UI can express.
  plates.push(
    plate("liquid sugar only", [
      ["cola", 2],
      ["sports-drink", 1],
      ["sugar-tea", 6],
    ]),
    plate("sugar behind a wall of fat", [
      ["cola", 2],
      ["olive-oil", 6],
      ["cheddar", 4],
      ["almonds", 6],
    ]),
    plate("carb blowout", [
      ["white-rice", 6],
      ["mashed-potato", 4],
      ["cornflakes", 4],
      ["donut", 4],
      ["honey", 6],
    ]),
    plate("fibre wall", [
      ["chia-seeds", 12],
      ["lentils", 6],
      ["broccoli", 8],
      ["white-rice", 2],
    ]),
    plate("protein only", [
      ["chicken-breast", 4],
      ["whey-shake", 6],
      ["egg", 6],
    ]),
    plate("maximum plate", FOODS.map((food) => [food.id, 20] as [string, number])),
  );

  return plates;
}

const PLATES = everyPlate();

describe("invariant: the curve never renders below 70 mg/dL", () => {
  // 70 is the clinical hypoglycaemia threshold. A meal cannot drive a healthy
  // person there, so a point below it is a modelling artefact, not a finding.
  it.each(ACTIVITIES.map((a) => a.id))("holds for every plate, doing: %s", (activityId) => {
    for (const { name, items } of PLATES) {
      const sim = simulate({ items, activityId });
      for (const order of ["carbs-sugar-first", "protein-fibre-first"] as const) {
        for (const point of sim.series[order].points) {
          expect(
            point.mgdl,
            `${name} / ${order} / ${activityId} dipped to ${point.mgdl.toFixed(2)} at ${point.minutes} min`,
          ).toBeGreaterThanOrEqual(HYPO_FLOOR_MG_DL);
        }
      }
    }
  });

  it("reports the floor it promises the chart", () => {
    expect(simulate({ items: [], activityId: "sit" }).floorMgDl).toBe(HYPO_FLOOR_MG_DL);
  });

  // Deleting the clamp from the model did not fail the sweep above. That is not
  // the sweep being weak — it is the model keeping enough margin that the clamp
  // never fires. Both facts need a test, or the invariant is being asserted on
  // trust: one that the guard works, one that the margin is really there.
  it("clamps anything a future change might push under the floor", () => {
    expect(clampFloor(42)).toBe(HYPO_FLOOR_MG_DL);
    expect(clampFloor(HYPO_FLOOR_MG_DL - 0.001)).toBe(HYPO_FLOOR_MG_DL);
    expect(clampFloor(-100)).toBe(HYPO_FLOOR_MG_DL);
    expect(clampFloor(HYPO_FLOOR_MG_DL)).toBe(HYPO_FLOOR_MG_DL);
    expect(clampFloor(140), "the clamp must not touch anything in range").toBe(140);
  });

  it("keeps real headroom above the floor, so the clamp is a guard not a crutch", () => {
    // If the lowest value across every plate ever crept down to exactly 70, the
    // curve would be sitting on the clamp and the shape would be a lie.
    let lowest = Infinity;
    let where = "";
    for (const { name, items } of PLATES) {
      for (const activity of ACTIVITIES) {
        const sim = simulate({ items, activityId: activity.id });
        for (const order of ["carbs-sugar-first", "protein-fibre-first"] as const) {
          for (const point of sim.series[order].points) {
            if (point.mgdl < lowest) {
              lowest = point.mgdl;
              where = `${name} / ${order} / ${activity.id} at ${point.minutes} min`;
            }
          }
        }
      }
    }
    expect(lowest, `lowest point anywhere was ${lowest.toFixed(2)} — ${where}`).toBeGreaterThan(
      HYPO_FLOOR_MG_DL + 4,
    );
  });
});

describe("invariant: the curve returns to baseline by 180 minutes", () => {
  it.each(ACTIVITIES.map((a) => a.id))("holds for every plate, doing: %s", (activityId) => {
    for (const { name, items } of PLATES) {
      const sim = simulate({ items, activityId });
      for (const order of ["carbs-sugar-first", "protein-fibre-first"] as const) {
        const points = sim.series[order].points;
        const last = points.at(-1);
        const first = points[0];
        expect(last?.minutes, `${name} / ${order} must span the full window`).toBe(WINDOW_MIN);
        expect(
          last?.mgdl,
          `${name} / ${order} / ${activityId} ended at ${last?.mgdl.toFixed(2)}, not baseline`,
        ).toBeCloseTo(BASELINE_MG_DL, 6);
        expect(first.minutes).toBe(0);
        expect(first.mgdl, `${name} / ${order} must start at the fasting baseline`).toBeCloseTo(
          BASELINE_MG_DL,
          6,
        );
      }
    }
  });

  it("samples the whole window at a fixed step", () => {
    const points = simulate({ items: PLATES[3].items, activityId: "walk-10" }).series[
      "carbs-sugar-first"
    ].points;
    expect(points).toHaveLength(WINDOW_MIN / SAMPLE_STEP_MIN + 1);
    points.forEach((point, i) => expect(point.minutes).toBe(i * SAMPLE_STEP_MIN));
  });
});

describe("invariant: displayed grams equal serves × unit weight", () => {
  it("holds for every food at every serve count the UI allows", () => {
    for (const food of FOODS) {
      for (let units = 1; units <= 20; units += 1) {
        expect(gramsFor(food, units), `${food.name} × ${units}`).toBe(units * food.unitWeightG);
      }
    }
  });

  it("holds in the string the visitor actually reads", () => {
    // The label shows its own arithmetic, so parse it back and check the sum.
    for (const food of FOODS) {
      for (const units of [1, 3, 7, 20]) {
        const label = unitsAndGrams(food, units);
        const match = /^(\d+) × (\d+(?:\.\d+)?) g = (\d+(?:\.\d+)?) g$/u.exec(label);
        expect(match, `unreadable label for ${food.name}: ${label}`).not.toBeNull();
        const [, shownUnits, shownWeight, shownTotal] = match!;
        expect(Number(shownUnits)).toBe(units);
        expect(Number(shownWeight)).toBe(food.unitWeightG);
        expect(Number(shownTotal)).toBe(units * food.unitWeightG);
      }
    }
  });

  it("derives every nutrient from that same gram figure", () => {
    for (const food of FOODS) {
      const n = nutrientsFor(food, 3);
      expect(n.grams).toBe(3 * food.unitWeightG);
      expect(n.kcal).toBeCloseTo((food.per100g.kcal * n.grams) / 100, 9);
      expect(n.carbsG).toBeCloseTo((food.per100g.carbsG * n.grams) / 100, 9);
    }
  });

  it("adds up: the plate total is the sum of its items' grams", () => {
    for (const { name, items } of PLATES) {
      const totals = sumNutrients(items.map((i) => nutrientsFor(i.food, i.units)));
      const byHand = items.reduce((sum, i) => sum + i.units * i.food.unitWeightG, 0);
      expect(totals.grams, name).toBeCloseTo(byHand, 9);
    }
  });
});

describe("the two series differ only in eating order", () => {
  it("gives an identical curve when the plate has nothing to eat first", () => {
    // A cola, two slices of white bread and a donut: no protein, vegetable or
    // fat item, so no preload exists and the honest answer is "no difference".
    const sim = simulate({
      items: plate("", [
        ["cola", 1],
        ["white-bread", 2],
        ["donut", 1],
      ]).items,
      activityId: "sit",
    });
    expect(sim.preloadStrength).toBeCloseTo(0, 6);
    expect(sim.series["protein-fibre-first"].peakMgDl).toBeCloseTo(
      sim.series["carbs-sugar-first"].peakMgDl,
      6,
    );
  });

  it("never makes eating the carbohydrate first the better option", () => {
    for (const { name, items } of PLATES) {
      for (const activity of ACTIVITIES) {
        const sim = simulate({ items, activityId: activity.id });
        const carbs = sim.series["carbs-sugar-first"];
        const protein = sim.series["protein-fibre-first"];
        expect(protein.peakMgDl, `${name} / ${activity.id}`).toBeLessThanOrEqual(
          carbs.peakMgDl + 1e-9,
        );
        expect(protein.iaucMgDlMin, `${name} / ${activity.id}`).toBeLessThanOrEqual(
          carbs.iaucMgDlMin + 1e-9,
        );
      }
    }
  });

  it("cannot be rescued by order when the fibre is locked inside one food", () => {
    // A banana carries fibre, but you cannot eat a banana's fibre before its
    // own sugar. Only separately-eatable items count as a preload.
    const sim = simulate({ items: plate("", [["banana", 2]]).items, activityId: "sit" });
    expect(sim.preloadStrength).toBeCloseTo(0, 6);
  });
});

describe("post-meal activity moves the curve the way the trials say", () => {
  const items = plate("", [
    ["white-rice", 2],
    ["chicken-breast", 1],
    ["broccoli", 1],
  ]).items;

  const iauc = (activityId: string) =>
    simulate({ items, activityId }).series["carbs-sugar-first"].iaucMgDlMin;

  it("puts walking ahead of standing, and standing barely ahead of sitting", () => {
    expect(iauc("walk-20")).toBeLessThan(iauc("walk-10"));
    expect(iauc("walk-10")).toBeLessThan(iauc("stand"));
    expect(iauc("stand")).toBeLessThan(iauc("sit"));
    // Buffey 2022's standing effect is small and a 2026 re-analysis finds it
    // null, so the model must not oversell it.
    expect(1 - iauc("stand") / iauc("sit")).toBeLessThan(0.08);
  });

  it("treats a nap as metabolically about the same as sitting", () => {
    // No trial shows lying down disposes of glucose worse than sitting. The nap
    // gets a later, flatter peak from slower stomach emptying and no more.
    const sit = simulate({ items, activityId: "sit" }).series["carbs-sugar-first"];
    const nap = simulate({ items, activityId: "nap" }).series["carbs-sugar-first"];
    expect(Math.abs(1 - nap.iaucMgDlMin / sit.iaucMgDlMin)).toBeLessThan(0.05);
    expect(nap.peakMin).toBeGreaterThan(sit.peakMin);
    expect(nap.peakMgDl).toBeLessThan(sit.peakMgDl);
  });

  it("does nothing at all when there is no glucose to dispose of", () => {
    const empty = plate("", [["chicken-breast", 2]]).items;
    for (const activity of ACTIVITIES) {
      const sim = simulate({ items: empty, activityId: activity.id });
      expect(sim.series["carbs-sugar-first"].iaucMgDlMin).toBe(0);
    }
  });
});

describe("the curve stays inside the range a healthy adult could produce", () => {
  it("never peaks somewhere no meal could put a non-diabetic", () => {
    for (const { name, items } of PLATES) {
      for (const activity of ACTIVITIES) {
        const sim = simulate({ items, activityId: activity.id });
        for (const order of ["carbs-sugar-first", "protein-fibre-first"] as const) {
          expect(sim.series[order].peakMgDl, `${name} / ${activity.id}`).toBeLessThan(200);
        }
      }
    }
  });

  it("puts a bigger glycaemic load above a smaller one", () => {
    // The first version of the model failed exactly here: absolute-gram brakes
    // let a 2,700 kcal blowout peak lower than a vending-machine lunch.
    const small = simulate({ items: plate("", [["banana", 1]]).items, activityId: "sit" });
    const medium = simulate({
      items: plate("", [
        ["cola", 1],
        ["white-bread", 2],
        ["donut", 1],
      ]).items,
      activityId: "sit",
    });
    const huge = simulate({
      items: plate("", [
        ["white-rice", 4],
        ["fries", 2],
        ["cola", 2],
        ["donut", 2],
        ["naan", 2],
      ]).items,
      activityId: "sit",
    });
    const peak = (s: ReturnType<typeof simulate>) => s.series["carbs-sugar-first"].peakMgDl;
    expect(peak(small)).toBeLessThan(peak(medium));
    expect(peak(medium)).toBeLessThan(peak(huge));
  });

  it("lands a balanced mixed meal in the range healthy CGM cohorts report", () => {
    // Metabolism 2023: breakfast 132 ± 17, lunch 118 ± 13, dinner 123 ± 17.
    const sim = simulate({
      items: plate("", [
        ["white-bread", 2],
        ["orange-juice", 1],
        ["chicken-breast", 2],
        ["broccoli", 1],
        ["salad-leaves", 1],
      ]).items,
      activityId: "sit",
    });
    const peak = sim.series["carbs-sugar-first"].peakMgDl;
    expect(peak).toBeGreaterThan(110);
    expect(peak).toBeLessThan(150);
    expect(sim.series["carbs-sugar-first"].peakMin).toBeGreaterThanOrEqual(25);
    expect(sim.series["carbs-sugar-first"].peakMin).toBeLessThanOrEqual(80);
  });

  it("cuts the peak by roughly a third when protein and fibre go first", () => {
    // Shukla 2019 in prediabetes: incremental peak attenuated by more than 40%,
    // iAUC down 38.8%. A healthy-adult model should be in that neighbourhood
    // and on the conservative side of it.
    const sim = simulate({
      items: plate("", [
        ["white-bread", 2],
        ["orange-juice", 1],
        ["chicken-breast", 2],
        ["broccoli", 1],
        ["salad-leaves", 1],
      ]).items,
      activityId: "sit",
    });
    const carbs = sim.series["carbs-sugar-first"];
    const protein = sim.series["protein-fibre-first"];
    const peakDrop =
      1 - (protein.peakMgDl - BASELINE_MG_DL) / (carbs.peakMgDl - BASELINE_MG_DL);
    const areaDrop = 1 - protein.iaucMgDlMin / carbs.iaucMgDlMin;
    expect(peakDrop).toBeGreaterThan(0.2);
    expect(peakDrop).toBeLessThan(0.45);
    expect(areaDrop).toBeGreaterThan(0.15);
    expect(areaDrop).toBeLessThan(0.45);
  });
});

describe("the food catalogue is sound", () => {
  it("gives every food a unique id", () => {
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
  });

  it("declares a GI for anything carrying real available carbohydrate", () => {
    // 8 g, not 3 g. The first version of this test used 3 g and failed on
    // broccoli, which has 3.5 g per serve and legitimately has no GI: the ISO
    // method needs 25-50 g of available carbohydrate in the test portion, which
    // is over a kilo of broccoli. The threshold has to sit above the foods GI
    // testing cannot reach, and 8 g is comfortably there.
    for (const food of FOODS) {
      const n = nutrientsFor(food, 1);
      if (n.availableCarbsG > 8) {
        expect(
          food.gi,
          `${food.name} has ${n.availableCarbsG.toFixed(1)} g of available carbs`,
        ).not.toBeNull();
      }
    }
  });

  it("bounds how wrong a null GI could make the curve", () => {
    // `gi: null` is treated as contributing no glucose. That is only honest if
    // being wrong about it barely moves the line, so this measures the error
    // directly: give every null-GI food a middling GI of 55 and check a single
    // serve still could not shift the peak more than 5 mg/dL.
    for (const food of FOODS.filter((f) => f.gi === null)) {
      const asIfMeasured: Food = { ...food, gi: 55 };
      const sim = simulate({ items: [{ food: asIfMeasured, units: 1 }], activityId: "sit" });
      const rise = sim.series["carbs-sugar-first"].peakMgDl - BASELINE_MG_DL;
      expect(rise, `${food.name} would move the peak by ${rise.toFixed(1)} mg/dL`).toBeLessThan(5);
    }
  });

  it("keeps every food's numbers physically possible", () => {
    for (const food of FOODS) {
      const p = food.per100g;
      expect(food.unitWeightG, food.name).toBeGreaterThan(0);
      expect(p.fibreG, `${food.name} fibre exceeds its carbohydrate`).toBeLessThanOrEqual(p.carbsG);
      expect(p.carbsG + p.proteinG + p.fatG, `${food.name} exceeds 100 g per 100 g`).toBeLessThanOrEqual(100);
      if (food.gi !== null) {
        expect(food.gi, food.name).toBeGreaterThanOrEqual(0);
        expect(food.gi, food.name).toBeLessThanOrEqual(115);
      }
      // Atwater: 4 kcal/g carbohydrate and protein, 9 kcal/g fat. Fibre and
      // alcohol make this approximate, so the band is generous — it is here to
      // catch a decimal point in the wrong place, not to audit a lab.
      const atwater = 4 * (p.carbsG - p.fibreG) + 4 * p.proteinG + 9 * p.fatG;
      expect(Math.abs(p.kcal - atwater), `${food.name}: ${p.kcal} kcal vs ~${atwater.toFixed(0)}`).toBeLessThan(
        60 + 0.25 * p.kcal,
      );
    }
  });

  it("offers a real choice to vegans and vegetarians in every category", () => {
    for (const category of new Set(FOODS.map((f) => f.category))) {
      const inCategory = FOODS.filter((f) => f.category === category);
      expect(inCategory.filter((f) => f.diet === "vegan").length, `vegan options in ${category}`).toBeGreaterThan(0);
      expect(
        inCategory.filter((f) => f.diet === "vegan" || f.diet === "vegetarian").length,
        `vegetarian options in ${category}`,
      ).toBeGreaterThan(1);
    }
  });

  it("points every preset at a food that exists", () => {
    for (const preset of PRESETS) {
      for (const item of preset.items) {
        expect(FOODS_BY_ID.has(item.foodId), `${preset.label} → ${item.foodId}`).toBe(true);
        expect(item.units).toBeGreaterThan(0);
      }
    }
  });
});
