// Wiring for "After the Bite": state, rendering, and the interaction.
//
// The model modules own every number; this file owns the DOM and nothing else.
//
// Two rules earned by fixing them the hard way, both about the keyboard:
//
// 1. Re-rendering a container throws away the element inside it that had focus.
//    Adding a serve with the Enter key dumped focus to <body> and the next Tab
//    started from the top of the page. Anything that rebuilds markup a visitor
//    might be standing on goes through `withFocusRestored`.
// 2. The category chips and the activity radios are built once and then updated
//    in place, because rebuilding a radio group mid-arrow-key destroys the
//    group's focus and its roving tabindex along with it.

import type { Category, Diet, Food } from "./src/data/foods";
import { CATEGORIES, FOODS, FOODS_BY_ID, PRESETS } from "./src/data/foods";
import type { ActivityLevel, Goal, Profile, Sex } from "./src/model/energy";
import { ACTIVITY_LEVELS, GOALS, adviceFor, estimateTrend } from "./src/model/energy";
import type { Simulation } from "./src/model/glucose";
import {
  ACTIVITIES,
  ACTIVITIES_BY_ID,
  SAMPLE_STEP_MIN,
  TARGET_CEILING_MG_DL,
  WINDOW_MIN,
  nutrientsFor,
  simulate,
  sumNutrients,
} from "./src/model/glucose";
import { chartSummary, padsFor, renderChart, tableRows } from "./src/ui/chart";
import { escapeHtml, integer, round, signed, unitsAndGrams } from "./src/ui/format";

type DietFilter = "all" | Diet;

type State = {
  category: Category;
  diet: DietFilter;
  /** foodId → serves. Serves are the only quantity stored; grams are derived. */
  plate: Map<string, number>;
  activityId: string;
  hasRun: boolean;
  scrubIndex: number | null;
  profile: Profile;
};

const state: State = {
  category: "protein",
  diet: "all",
  plate: new Map(),
  activityId: "sit",
  hasRun: false,
  scrubIndex: null,
  profile: {
    weightKg: 70,
    heightCm: 170,
    ageYears: 25,
    sex: "female",
    activityLevel: "light",
    mealsPerDay: 3,
    goal: "maintain",
  },
};

function ref<T extends HTMLElement>(role: string): T {
  const node = document.querySelector<T>(`[data-role="${role}"]`);
  if (!node) throw new Error(`missing [data-role="${role}"]`);
  return node;
}

const dom = {
  categories: ref("categories"),
  categoryBlurb: ref("category-blurb"),
  foodGrid: ref<HTMLUListElement>("food-grid"),
  libraryEmpty: ref("library-empty"),
  plateItems: ref<HTMLUListElement>("plate-items"),
  plateEmpty: ref("plate-empty"),
  plateTotal: ref("plate-total"),
  presets: ref("presets"),
  tallyItems: ref<HTMLUListElement>("tally-items"),
  tallyEmpty: ref("tally-empty"),
  macros: ref<HTMLDListElement>("macros"),
  clear: ref<HTMLButtonElement>("clear"),
  activities: ref<HTMLFieldSetElement>("activities"),
  activityEvidence: ref("activity-evidence"),
  theme: ref<HTMLButtonElement>("theme"),
  themeGlyph: ref("theme-glyph"),
  navToggle: ref<HTMLButtonElement>("nav-toggle"),
  run: ref<HTMLButtonElement>("run"),
  runHint: ref("run-hint"),
  stage: ref("stage"),
  stageSub: ref("stage-sub"),
  results: ref("results"),
  chart: ref("chart"),
  readout: ref("readout"),
  stats: ref("stats"),
  verdict: ref("verdict"),
  curveTable: ref<HTMLTableElement>("curve-table"),
  profile: ref<HTMLFormElement>("profile"),
  trendCard: ref("trend-card"),
  advice: ref("advice"),
};

/**
 * Re-renders without stranding the keyboard. Remembers which control had focus
 * by its data attribute, then puts focus back on the same control afterwards —
 * or on the library card for that food if the control it was on has gone
 * (pressing "−" on the last serve removes the row you were standing on).
 */
function withFocusRestored(render: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const data = active?.dataset ?? {};
  const foodId = data.inc ?? data.dec ?? data.add;
  const selector = data.inc
    ? `[data-inc="${data.inc}"]`
    : data.dec
      ? `[data-dec="${data.dec}"]`
      : data.add
        ? `[data-add="${data.add}"]`
        : null;

  render();

  if (!selector) return;
  const restored =
    document.querySelector<HTMLElement>(selector) ??
    (foodId ? document.querySelector<HTMLElement>(`[data-add="${foodId}"]`) : null);
  restored?.focus();
}

// --------------------------------------------------------------- derivations

function plateEntries(): { food: Food; units: number }[] {
  return [...state.plate.entries()]
    .map(([foodId, units]) => {
      const food = FOODS_BY_ID.get(foodId);
      return food ? { food, units } : undefined;
    })
    .filter((entry): entry is { food: Food; units: number } => entry !== undefined);
}

function plateTotals() {
  return sumNutrients(plateEntries().map((entry) => nutrientsFor(entry.food, entry.units)));
}

function matchesDiet(food: Food): boolean {
  if (state.diet === "all") return true;
  if (state.diet === "vegan") return food.diet === "vegan";
  return food.diet === "vegan" || food.diet === "vegetarian";
}

// ------------------------------------------------------------------- step 1

function buildCategories(): void {
  dom.categories.innerHTML = CATEGORIES.map(
    (cat) =>
      `<button type="button" class="chip" data-category="${cat.id}" aria-pressed="${
        cat.id === state.category
      }">${escapeHtml(cat.label)}</button>`,
  ).join("");
}

function updateCategorySelection(): void {
  dom.categories.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
  });
  const active = CATEGORIES.find((cat) => cat.id === state.category);
  dom.categoryBlurb.textContent = active ? active.blurb : "";
}

function foodCardInner(food: Food, units: number): string {
  // Serve and GI go on separate lines rather than in one "·"-joined string:
  // at 390 px that string wrapped mid-value and the cards read as ragged noise.
  const gi = food.gi === null ? "no GI" : `GI ${food.gi}`;
  return `<span class="food__emoji" aria-hidden="true">${food.emoji}</span>
    <span class="food__name">${escapeHtml(food.name)}</span>
    <span class="food__meta">${escapeHtml(food.unit)} · ${food.unitWeightG} g</span>
    <span class="food__gi${food.gi === null ? " food__gi--none" : ""}">${gi}</span>
    <span class="food__count" ${units > 0 ? "" : "hidden"}>${units}</span>`;
}

function buildFoodGrid(): void {
  const visible = FOODS.filter((food) => food.category === state.category && matchesDiet(food));
  dom.libraryEmpty.hidden = visible.length > 0;
  dom.foodGrid.innerHTML = visible
    .map((food) => {
      const units = state.plate.get(food.id) ?? 0;
      const title = food.note ? ` title="${escapeHtml(food.note)}"` : "";
      return `<li><button type="button" class="food${units > 0 ? " food--on" : ""}"
        data-add="${food.id}" aria-pressed="${units > 0}"${title}>${foodCardInner(
          food,
          units,
        )}</button></li>`;
    })
    .join("");
}

/** Updates one card in place, so adding a serve never rebuilds the library. */
function updateFoodCard(foodId: string): void {
  const food = FOODS_BY_ID.get(foodId);
  const card = dom.foodGrid.querySelector<HTMLButtonElement>(`[data-add="${foodId}"]`);
  if (!food || !card) return;
  const units = state.plate.get(foodId) ?? 0;
  card.classList.toggle("food--on", units > 0);
  card.setAttribute("aria-pressed", String(units > 0));
  card.innerHTML = foodCardInner(food, units);
}

function renderPlate(): void {
  const entries = plateEntries();
  dom.plateEmpty.hidden = entries.length > 0;

  // One chip per serve, so three servings of rice look like three servings.
  dom.plateItems.innerHTML = entries
    .flatMap((entry) => {
      const shown = Math.min(entry.units, 10);
      const chips = Array.from(
        { length: shown },
        () =>
          `<li class="plate__item plate__item--${entry.food.category}"><span>${entry.food.emoji}</span></li>`,
      );
      if (entry.units > shown) {
        chips.push(
          `<li class="plate__item plate__item--more"><span>+${entry.units - shown}</span></li>`,
        );
      }
      return chips;
    })
    .join("");

  const totals = plateTotals();
  dom.plateTotal.textContent = entries.length
    ? `${integer(totals.grams)} g of food · ${integer(totals.kcal)} kcal · glycaemic load ${round(
        totals.glycaemicLoad,
      )}`
    : "";
}

function renderTally(): void {
  const entries = plateEntries();
  dom.tallyEmpty.hidden = entries.length > 0;
  dom.clear.disabled = entries.length === 0;

  dom.tallyItems.innerHTML = entries
    .map(
      (entry) => `<li class="tally__row">
        <span class="tally__emoji" aria-hidden="true">${entry.food.emoji}</span>
        <span class="tally__name">${escapeHtml(entry.food.name)}
          <span class="tally__grams">${unitsAndGrams(entry.food, entry.units)}</span>
        </span>
        <span class="stepper">
          <button type="button" data-dec="${entry.food.id}"
            aria-label="One fewer serve of ${escapeHtml(entry.food.name)}">−</button>
          <span class="stepper__value" aria-hidden="true">${entry.units}</span>
          <button type="button" data-inc="${entry.food.id}"
            aria-label="One more serve of ${escapeHtml(entry.food.name)}">+</button>
        </span>
      </li>`,
    )
    .join("");

  const t = plateTotals();
  const rows: [string, string, string][] = [
    ["Energy", `${integer(t.kcal)} kcal`, ""],
    ["Carbohydrate", `${round(t.carbsG)} g`, `${round(t.availableCarbsG)} g of it available`],
    ["Fibre", `${round(t.fibreG)} g`, "subtracted from the carbs above"],
    ["Protein", `${round(t.proteinG)} g`, ""],
    ["Fat", `${round(t.fatG)} g`, ""],
    ["Glycaemic load", round(t.glycaemicLoad), "GI × available carbs ÷ 100"],
  ];
  dom.macros.innerHTML = rows
    .map(
      ([label, value, hint]) =>
        `<div class="macros__row"><dt>${label}</dt><dd>${value}${
          hint ? `<span class="macros__hint">${hint}</span>` : ""
        }</dd></div>`,
    )
    .join("");
}

function buildPresets(): void {
  dom.presets.innerHTML = PRESETS.map(
    (preset) =>
      `<button type="button" class="btn btn--tiny" data-preset="${preset.id}">${escapeHtml(
        preset.label,
      )}</button>`,
  ).join("");
}

// ------------------------------------------------------------------- step 2

function buildActivities(): void {
  dom.activities.innerHTML =
    '<legend class="visually-hidden">What you do after the meal</legend>' +
    ACTIVITIES.map(
      (activity) => `<label class="activity" data-activity="${activity.id}">
        <input type="radio" name="activity" value="${activity.id}" ${
          activity.id === state.activityId ? "checked" : ""
        } />
        <span class="activity__emoji" aria-hidden="true">${activity.emoji}</span>
        <span class="activity__body">
          <span class="activity__label">${escapeHtml(activity.label)}</span>
          <span class="activity__blurb">${escapeHtml(activity.blurb)}</span>
        </span>
      </label>`,
    ).join("");
}

function updateActivitySelection(): void {
  dom.activities.querySelectorAll<HTMLElement>("[data-activity]").forEach((label) => {
    label.classList.toggle("activity--on", label.dataset.activity === state.activityId);
  });
  const active = ACTIVITIES_BY_ID.get(state.activityId);
  dom.activityEvidence.innerHTML = active
    ? `<strong>The evidence:</strong> ${escapeHtml(active.evidence)}`
    : "";
}

// ------------------------------------------------------------------- step 3

function currentSimulation(): Simulation {
  return simulate({ items: plateEntries(), activityId: state.activityId });
}

let lastChartSize = { width: 0, height: 0 };

function chartSize(): { width: number; height: number } {
  return {
    width: Math.max(260, Math.round(dom.chart.clientWidth)),
    height: Math.max(200, Math.round(dom.chart.clientHeight)),
  };
}

function drawChart(sim: Simulation): void {
  const { width, height } = chartSize();
  lastChartSize = { width, height };
  dom.chart.innerHTML = renderChart(sim, width, height, state.scrubIndex);
  dom.chart.setAttribute("aria-label", chartSummary(sim));
}

function renderReadout(sim: Simulation): void {
  if (state.scrubIndex === null) {
    dom.readout.textContent = sim.isEmpty
      ? "Nothing on the plate, so nothing to absorb. Both lines sit on the fasting baseline."
      : "Drag across the chart, or focus it and press ← →, to read any minute.";
    return;
  }
  const carbs = sim.series["carbs-sugar-first"].points[state.scrubIndex];
  const protein = sim.series["protein-fibre-first"].points[state.scrubIndex];
  if (!carbs || !protein) return;
  const gap = carbs.mgdl - protein.mgdl;
  dom.readout.innerHTML =
    `<strong>${carbs.minutes} min</strong> · carbs first ` +
    `<strong class="is-carbs">${round(carbs.mgdl)} mg/dL</strong> · protein first ` +
    `<strong class="is-protein">${round(protein.mgdl)} mg/dL</strong>` +
    (gap >= 1 ? ` · a gap of ${round(gap)} mg/dL` : " · no gap here");
}

function renderStats(sim: Simulation): void {
  const cards = [
    { key: "carbs-sugar-first", cls: "carbs", label: "Carbs &amp; sugar first" },
    { key: "protein-fibre-first", cls: "protein", label: "Protein &amp; fibre first" },
  ] as const;

  dom.stats.innerHTML = cards
    .map(({ key, cls, label }) => {
      const s = sim.series[key];
      return `<div class="stat stat--${cls}">
        <h3>${label}</h3>
        <p class="stat__big">${round(s.peakMgDl)}<span class="stat__unit">mg/dL peak</span></p>
        <dl>
          <div class="stat__row"><dt>Peak reached at</dt><dd>${s.peakMin > 0 ? `${s.peakMin} min` : "no rise"}</dd></div>
          <div class="stat__row"><dt>Minutes above ${TARGET_CEILING_MG_DL}</dt><dd>${s.minutesAbove140} min</dd></div>
          <div class="stat__row"><dt>Glucose above baseline</dt><dd>${integer(s.iaucMgDlMin)} <abbr title="milligrams per decilitre times minutes: the area between the curve and the fasting baseline">mg/dL·min</abbr></dd></div>
        </dl>
      </div>`;
    })
    .join("");
}

function renderVerdict(sim: Simulation): void {
  if (sim.isEmpty) {
    dom.verdict.innerHTML =
      "<strong>An empty plate is a flat line.</strong> Put something on it and the two curves have something to disagree about.";
    return;
  }

  if (sim.totals.glycaemicLoad < 1) {
    dom.verdict.innerHTML =
      "<strong>No available carbohydrate here, so no curve.</strong> Protein, fat and fibre on their own barely move blood glucose — which is exactly why they work as a preload for something that does.";
    return;
  }

  const carbs = sim.series["carbs-sugar-first"];
  const protein = sim.series["protein-fibre-first"];
  // Subtract the *rounded* peaks, not the raw ones. The stat cards print 143 and
  // 132; a drop computed from 142.6 − 132.2 renders as "10", and a reader who
  // does the subtraction themselves catches the page contradicting itself.
  const peakDrop = Math.round(carbs.peakMgDl) - Math.round(protein.peakMgDl);
  const areaDrop = carbs.iaucMgDlMin > 0 ? 1 - protein.iaucMgDlMin / carbs.iaucMgDlMin : 0;

  if (peakDrop < 1) {
    dom.verdict.innerHTML = `<strong>The two lines are identical, and that is the honest answer.</strong>
      There is nothing on this plate you could eat first — no protein, no vegetables, no fat — so
      there is no preload to put in front of ${round(sim.totals.availableCarbsG)} g of available
      carbohydrate. Eating order is a lever, and a lever needs something to push against. Add a
      chicken breast or a bowl of greens and watch the lines come apart.`;
    return;
  }

  // What the activity itself bought, holding the plate and the order fixed.
  const seated = simulate({ items: plateEntries(), activityId: "sit" });
  const activityDrop = seated.series["carbs-sugar-first"].peakMgDl - carbs.peakMgDl;

  const parts = [
    `<strong>Eating the protein and fibre first takes ${round(
      peakDrop,
    )} mg/dL off the peak</strong> and ${round(
      areaDrop * 100,
    )}% off the total glucose in your blood over three hours — off exactly the same food, the same grams and the same calories.`,
  ];
  if (activityDrop >= 1) {
    parts.push(
      `Choosing to ${escapeHtml(
        sim.activity.label.toLowerCase(),
      )} afterwards took a further ${round(activityDrop)} mg/dL off the top.`,
    );
  }
  if (sim.preloadStrength < 0.35) {
    parts.push(
      "There is not much on this plate to preload with, though, so the order buys less here than it would on a plate with real protein and fibre on it.",
    );
  }
  if (carbs.minutesAbove140 > 0 && protein.minutesAbove140 === 0) {
    parts.push(
      `It is also the difference between ${carbs.minutesAbove140} minutes above ${TARGET_CEILING_MG_DL} mg/dL and none at all.`,
    );
  }
  dom.verdict.innerHTML = parts.join(" ");
}

function renderTable(sim: Simulation): void {
  dom.curveTable.innerHTML =
    "<caption>Blood glucose in mg/dL, every 20 minutes after the first bite.</caption>" +
    '<thead><tr><th scope="col">Minutes</th><th scope="col">Carbs first</th>' +
    '<th scope="col">Protein first</th></tr></thead><tbody>' +
    tableRows(sim)
      .map(
        (row) =>
          `<tr><th scope="row">${row.minutes}</th><td>${round(row.carbs)}</td><td>${round(
            row.protein,
          )}</td></tr>`,
      )
      .join("") +
    "</tbody>";
}

function renderCurve(): void {
  if (!state.hasRun) {
    drawChart(simulate({ items: [], activityId: state.activityId }));
    dom.readout.textContent =
      "Flat at the 90 mg/dL fasting baseline. Build a plate, then press the button.";
    return;
  }
  const sim = currentSimulation();
  drawChart(sim);
  renderReadout(sim);
  renderStats(sim);
  renderVerdict(sim);
  renderTable(sim);
  dom.stageSub.textContent = `Two lines from one plate — same food, same grams, same calories. Afterwards you ${sim.activity.label.toLowerCase()}.`;
}

// ------------------------------------------------------------------- step 4

function renderTrend(): void {
  const totals = plateTotals();
  const trend = estimateTrend(state.profile, totals);
  const advice = adviceFor(state.profile, totals, trend);
  const arrow = trend.verdict === "gain" ? "↗" : trend.verdict === "lose" ? "↘" : "→";

  dom.trendCard.innerHTML = `
    <p class="trend-card__verdict trend-card__verdict--${trend.verdict}">
      <span class="trend-card__arrow" aria-hidden="true">${arrow}</span>
      ${escapeHtml(trend.headline)}
    </p>
    <dl class="trend-card__figures">
      <div class="trend-card__figure"><dt>Resting burn (Mifflin–St Jeor)</dt><dd>${integer(trend.bmrKcal)} kcal/day</dd></div>
      <div class="trend-card__figure"><dt>Total burn with your activity</dt><dd>${integer(trend.tdeeKcal)} kcal/day</dd></div>
      <div class="trend-card__figure"><dt>${state.profile.mealsPerDay} × this plate</dt><dd>${integer(
        trend.projectedIntakeKcal,
      )} kcal/day</dd></div>
      <div class="trend-card__figure"><dt>Daily balance</dt><dd class="trend-card__balance">${signed(
        trend.balanceKcal,
      )} kcal</dd></div>
      <div class="trend-card__figure"><dt>Protein on the plate</dt><dd>${round(trend.proteinOnPlateG)} g against a ${round(
        trend.proteinTargetG,
      )} g daily target</dd></div>
      <div class="trend-card__figure"><dt>Fibre on the plate</dt><dd>${round(trend.fibreOnPlateG)} g against a ${round(
        trend.fibreTargetPerMealG,
      )} g share of 30 g</dd></div>
    </dl>
    <p class="trend-card__caveat">
      One week only, at 7,700 kcal per kilogram. Past that the estimate drifts, because what you burn
      falls as your weight does.
    </p>`;

  dom.advice.innerHTML =
    "<h3>What I would change about this plate</h3>" +
    (advice.length
      ? `<ul>${advice
          .map(
            (a) =>
              `<li class="advice__item advice__item--${a.kind}"><span class="advice__icon" aria-hidden="true">${
                a.kind === "good" ? "✓" : "→"
              }</span><span>${escapeHtml(a.text)}</span></li>`,
          )
          .join("")}</ul>`
      : "<p>Put some food on the plate and this fills in with advice pointed at your goal.</p>");
}

// -------------------------------------------------------------------- render

/** Everything downstream of the plate, without rebuilding the food library. */
function renderPlateDependent(): void {
  renderPlate();
  renderTally();
  renderCurve();
  renderTrend();
}

// --------------------------------------------------------------- interaction

function addServe(foodId: string, delta: number): void {
  const next = (state.plate.get(foodId) ?? 0) + delta;
  if (next <= 0) state.plate.delete(foodId);
  else state.plate.set(foodId, Math.min(20, next));
  state.scrubIndex = null;
  withFocusRestored(() => {
    updateFoodCard(foodId);
    renderPlateDependent();
  });
}

dom.categories.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-category]");
  if (!button?.dataset.category) return;
  state.category = button.dataset.category as Category;
  updateCategorySelection();
  buildFoodGrid();
});

document.querySelectorAll<HTMLButtonElement>("[data-diet]").forEach((button) => {
  button.addEventListener("click", () => {
    state.diet = button.dataset.diet as DietFilter;
    document.querySelectorAll<HTMLButtonElement>("[data-diet]").forEach((other) => {
      other.setAttribute("aria-pressed", String(other === button));
    });
    buildFoodGrid();
  });
});

dom.foodGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
  if (button?.dataset.add) addServe(button.dataset.add, 1);
});

dom.tallyItems.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const inc = target.closest<HTMLButtonElement>("[data-inc]");
  if (inc?.dataset.inc) {
    addServe(inc.dataset.inc, 1);
    return;
  }
  const dec = target.closest<HTMLButtonElement>("[data-dec]");
  if (dec?.dataset.dec) addServe(dec.dataset.dec, -1);
});

dom.clear.addEventListener("click", () => {
  const ids = [...state.plate.keys()];
  state.plate.clear();
  state.scrubIndex = null;
  ids.forEach(updateFoodCard);
  renderPlateDependent();
});

dom.presets.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]");
  const preset = PRESETS.find((p) => p.id === button?.dataset.preset);
  if (!preset) return;
  const touched = new Set([...state.plate.keys(), ...preset.items.map((i) => i.foodId)]);
  state.plate = new Map(preset.items.map((item) => [item.foodId, item.units]));
  state.scrubIndex = null;
  touched.forEach(updateFoodCard);
  renderPlateDependent();
});

dom.activities.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name !== "activity") return;
  state.activityId = input.value;
  state.scrubIndex = null;
  updateActivitySelection();
  renderCurve();
});

dom.run.addEventListener("click", () => {
  state.hasRun = true;
  dom.results.hidden = false;
  dom.run.textContent = "Redraw the curves";
  dom.runHint.textContent =
    "Change the plate or what you do afterwards and both curves redraw straight away.";
  renderCurve();
  // No scrollIntoView: the chart is pinned above the controls, so it is already
  // on screen. Scrolling here would fight the sticky panel it scrolls towards.
  measureChrome();
});

// --------------------------------------------------------------- the scrubber

const POINT_COUNT = WINDOW_MIN / SAMPLE_STEP_MIN + 1;

function scrubTo(index: number): void {
  const clamped = Math.max(0, Math.min(POINT_COUNT - 1, index));
  if (clamped === state.scrubIndex) return;
  state.scrubIndex = clamped;
  renderCurve();
}

function indexFromClientX(clientX: number): number {
  const { width } = chartSize();
  const { padLeft, padRight } = padsFor(width);
  const plotW = Math.max(10, width - padLeft - padRight);
  const offset = clientX - dom.chart.getBoundingClientRect().left - padLeft;
  return Math.round((offset / plotW) * (POINT_COUNT - 1));
}

dom.chart.addEventListener("pointermove", (event) => {
  if (state.hasRun) scrubTo(indexFromClientX(event.clientX));
});

dom.chart.addEventListener("pointerdown", (event) => {
  if (state.hasRun) scrubTo(indexFromClientX(event.clientX));
});

dom.chart.addEventListener("pointerleave", (event) => {
  // Touch has no hover to leave, so only a mouse clears the crosshair.
  if (event.pointerType !== "mouse" || state.scrubIndex === null) return;
  state.scrubIndex = null;
  renderCurve();
});

dom.chart.addEventListener("keydown", (event) => {
  if (!state.hasRun) return;
  const current = state.scrubIndex ?? 0;
  const moves: Record<string, number | undefined> = {
    ArrowLeft: current - 1,
    ArrowRight: current + 1,
    PageDown: current - 10,
    PageUp: current + 10,
    Home: 0,
    End: POINT_COUNT - 1,
  };
  const next = moves[event.key];
  if (next === undefined) return;
  event.preventDefault();
  scrubTo(next);
});

// ---------------------------------------------------------------- the profile

function select(id: string): HTMLSelectElement {
  const node = dom.profile.querySelector<HTMLSelectElement>(`#${id}`);
  if (!node) throw new Error(`missing select #${id}`);
  return node;
}

function buildProfileSelects(): void {
  select("activityLevel").innerHTML = ACTIVITY_LEVELS.map(
    (level) =>
      `<option value="${level.id}"${
        level.id === state.profile.activityLevel ? " selected" : ""
      }>${escapeHtml(level.label)} — ${escapeHtml(level.blurb)}</option>`,
  ).join("");

  select("goal").innerHTML = GOALS.map(
    (goal) =>
      `<option value="${goal.id}"${goal.id === state.profile.goal ? " selected" : ""}>${escapeHtml(
        goal.label,
      )}</option>`,
  ).join("");
}

function numberField(id: string, fallback: number, min: number, max: number): number {
  const input = dom.profile.querySelector<HTMLInputElement>(`#${id}`);
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readProfile(): void {
  state.profile = {
    weightKg: numberField("weight", 70, 30, 250),
    heightCm: numberField("height", 170, 120, 220),
    ageYears: numberField("age", 25, 15, 100),
    sex: select("sex").value as Sex,
    activityLevel: select("activityLevel").value as ActivityLevel,
    mealsPerDay: numberField("mealsPerDay", 3, 1, 6),
    goal: select("goal").value as Goal,
  };
  renderTrend();
}

dom.profile.addEventListener("input", readProfile);
dom.profile.addEventListener("change", readProfile);
dom.profile.addEventListener("submit", (event) => event.preventDefault());

// -------------------------------------------------------- theme and the menu

/**
 * The theme is already set on <html> by a tiny inline script in the head, so
 * there is no white flash before this module loads. This only handles the
 * toggle and keeps the button's label honest — an icon-only control needs its
 * accessible name to say what pressing it will *do*, not what it currently is.
 */
function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  dom.theme.setAttribute("aria-label", `Switch to ${next} theme`);
  dom.themeGlyph.textContent = theme === "dark" ? "☀" : "☾";
  try {
    localStorage.setItem("atb-theme", theme);
  } catch {
    // Private browsing: the toggle still works for this session.
  }
  // Both themes redraw the same geometry, but the SVG picks its colours up from
  // CSS variables, so nothing needs re-rendering here.
}

dom.theme.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

const siteNav = document.getElementById("site-nav");

function setMenu(open: boolean): void {
  if (!siteNav) return;
  dom.navToggle.setAttribute("aria-expanded", String(open));
  dom.navToggle.setAttribute("aria-label", open ? "Close the menu" : "Open the menu");
  siteNav.dataset.open = String(open);
  measureChrome();
}

dom.navToggle.addEventListener("click", () => {
  const open = dom.navToggle.getAttribute("aria-expanded") !== "true";
  setMenu(open);
  // Opening a panel that sits before its trigger in the DOM would otherwise
  // send the next Tab backwards past it.
  if (open) siteNav?.querySelector<HTMLAnchorElement>("a")?.focus();
});

siteNav?.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("a")) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || dom.navToggle.getAttribute("aria-expanded") !== "true") return;
  setMenu(false);
  dom.navToggle.focus();
});

document.addEventListener("click", (event) => {
  if (dom.navToggle.getAttribute("aria-expanded") !== "true") return;
  const target = event.target as HTMLElement;
  if (target.closest(".site-header")) return;
  setMenu(false);
});

// ----------------------------------------------------------------- lifecycle

/**
 * The sticky header and the sticky chart both sit between the top of the
 * viewport and the content, so every in-page anchor has to clear them. Measuring
 * beats guessing: the header wraps at some widths and the chart panel changes
 * height at the breakpoints, and a hard-coded scroll-margin was already hiding
 * section headings behind the header once.
 */
function measureChrome(): void {
  const root = document.documentElement;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (header) {
    root.style.setProperty("--header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
  }
  const stuck = getComputedStyle(dom.stage).position === "sticky";
  root.style.setProperty(
    "--stage-h",
    stuck ? `${Math.round(dom.stage.getBoundingClientRect().height)}px` : "0px",
  );
}

let resizeFrame = 0;
const observer = new ResizeObserver(() => {
  // Guard against the render resizing the observed box and looping forever.
  const { width, height } = chartSize();
  if (width === lastChartSize.width && height === lastChartSize.height) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    renderCurve();
    measureChrome();
  });
});
observer.observe(dom.chart);
new ResizeObserver(measureChrome).observe(document.body);

buildCategories();
updateCategorySelection();
buildFoodGrid();
buildPresets();
buildActivities();
updateActivitySelection();
buildProfileSelects();
applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
measureChrome();
renderCurve();

// Start from a real plate rather than an empty demonstration of nothing. One
// press of "Clear the plate" undoes it.
state.plate = new Map(PRESETS[0].items.map((item) => [item.foodId, item.units]));
buildFoodGrid();
renderPlateDependent();
