// What the deployed page must contain, checked against the BUILT site.
//
// These are the brief's checkable lines, not implementation details: the visitor
// can act, the two curves are both present and named, the numbers are sourced,
// and nothing on the page reaches off-origin for a resource it needs.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { FOODS_BY_ID } from "../src/data/foods";
import { ACTIVITIES, simulate } from "../src/model/glucose";
import { renderChart } from "../src/ui/chart";

const DIST = resolve("dist");
const doc = new JSDOM(readFileSync(resolve(DIST, "index.html"), "utf8")).window.document;

function text(): string {
  return doc.body.textContent?.replace(/\s+/gu, " ") ?? "";
}

describe("the deployed page", () => {
  it("names itself and says what it is", () => {
    expect(doc.title).toMatch(/After the Bite/iu);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").toMatch(
      /glucose/iu,
    );
  });

  it("carries the logo as inline SVG with a glucose curve in it", () => {
    const mark = doc.querySelector(".brand__mark");
    expect(mark, "the wordmark must be inline SVG, not an image request").toBeTruthy();
    expect(mark?.tagName.toLowerCase()).toBe("svg");
    // A curve rising off a baseline: the mark is the thing the page explains.
    expect(mark?.querySelector(".brand__curve")?.getAttribute("d") ?? "").toMatch(/^M/u);
    expect(mark?.querySelector(".brand__base")).toBeTruthy();
    expect(doc.querySelector(".brand__name")?.textContent?.replace(/\s+/gu, " ").trim()).toBe(
      "After the Bite",
    );
  });

  it("has a skip link to the content", () => {
    const skip = doc.querySelector<HTMLAnchorElement>(".skip-link");
    const target = skip?.getAttribute("href")?.slice(1) ?? "";
    expect(target, "the skip link needs a fragment target").toBeTruthy();
    expect(doc.getElementById(target), `skip link points at #${target}, which does not exist`).toBeTruthy();
  });
});

describe("the visitor can do something that changes what they see", () => {
  it("gives them a food library, a plate and a tally to build a meal in", () => {
    for (const role of ["categories", "food-grid", "plate-items", "tally-items", "macros", "clear"]) {
      expect(doc.querySelector(`[data-role="${role}"]`), `[data-role="${role}"]`).toBeTruthy();
    }
  });

  it("lets them filter the library to vegetarian or vegan", () => {
    const diets = [...doc.querySelectorAll("[data-diet]")].map((b) => b.getAttribute("data-diet"));
    expect(diets).toEqual(expect.arrayContaining(["all", "vegetarian", "vegan"]));
  });

  it("offers presets so the point survives a visitor in a hurry", () => {
    expect(doc.querySelector('[data-role="presets"]')).toBeTruthy();
  });

  it("lets them choose what happens after the meal, without requiring it", () => {
    expect(doc.querySelector('[data-role="activities"]')?.tagName.toLowerCase()).toBe("fieldset");
    expect(doc.querySelector('[data-role="activities"] legend')).toBeTruthy();
    expect(text()).toMatch(/Sitting is the control condition and it is already selected/iu);
  });

  it("has one button that draws the curve", () => {
    const run = doc.querySelector<HTMLButtonElement>('[data-role="run"]');
    expect(run).toBeTruthy();
    expect(run?.getAttribute("type")).toBe("button");
    expect(run?.textContent?.trim()).toBeTruthy();
  });

  it("keeps the chart on the page from the first paint", () => {
    // The chart is the subject, not a reward for pressing a button: it ships
    // visible, showing a flat fasting baseline until there is a meal to draw.
    const stage = doc.querySelector('[data-role="stage"]');
    expect(stage, "the chart panel must exist").toBeTruthy();
    expect(stage?.hasAttribute("hidden"), "the chart must never start hidden").toBe(false);
    expect(stage?.contains(doc.querySelector('[data-role="chart"]'))).toBe(true);
  });

  it("holds the numeric results back until the button is pressed", () => {
    expect(doc.querySelector('[data-role="results"]')?.hasAttribute("hidden")).toBe(true);
  });
});

describe("the chart", () => {
  it("gives the visitor a focusable, described chart region", () => {
    const frame = doc.querySelector('[data-role="chart"]');
    expect(frame?.getAttribute("tabindex")).toBe("0");
    const describedBy = frame?.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toBeTruthy();
    expect(doc.getElementById(describedBy)?.textContent ?? "").toMatch(/arrow keys/iu);
  });

  it("names both series in the legend, and says what makes them differ", () => {
    const legend = doc.querySelector(".legend")?.textContent?.replace(/\s+/gu, " ") ?? "";
    expect(legend).toMatch(/Carbs & sugar first/iu);
    expect(legend).toMatch(/Protein & fibre first/iu);
  });

  it("offers the same numbers as text for anyone who cannot use the picture", () => {
    expect(doc.querySelector('[data-role="curve-table"]')?.tagName.toLowerCase()).toBe("table");
    expect(doc.querySelector(".table-details summary")?.textContent ?? "").toMatch(/table/iu);
  });

  it("has somewhere to put the scrubbed reading, announced politely", () => {
    expect(doc.querySelector('[data-role="readout"]')?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("the weight panel asks for what the equation needs", () => {
  it("collects weight, height, age, sex, activity, meals and a goal", () => {
    for (const id of ["weight", "height", "age", "sex", "activityLevel", "mealsPerDay", "goal"]) {
      const field = doc.getElementById(id);
      expect(field, `#${id}`).toBeTruthy();
      expect(
        doc.querySelector(`label[for="${id}"]`),
        `#${id} needs a label pointing at it`,
      ).toBeTruthy();
    }
  });

  it("lets someone decline to state their sex", () => {
    const options = [...doc.querySelectorAll("#sex option")].map((o) => o.getAttribute("value"));
    expect(options).toContain("unspecified");
  });

  it("bounds the numeric inputs so a typo cannot produce nonsense", () => {
    for (const id of ["weight", "height", "age", "mealsPerDay"]) {
      const input = doc.getElementById(id);
      expect(input?.getAttribute("type"), id).toBe("number");
      expect(input?.hasAttribute("min"), `#${id} needs a min`).toBe(true);
      expect(input?.hasAttribute("max"), `#${id} needs a max`).toBe(true);
    }
  });
});

describe("the page is honest about its own model", () => {
  it("says it is not medical advice", () => {
    expect(text()).toMatch(/not medical advice/iu);
  });

  it("says whose physiology it is modelling", () => {
    expect(text()).toMatch(/teaching model of a healthy adult/iu);
  });

  it("declines the bigger headline effect size and says why", () => {
    // Shukla 2015 found 73% off the iAUC in type 2 diabetes. Using that number
    // for a healthy visitor would be the easy, wrong choice.
    expect(text()).toMatch(/73%/u);
    expect(text()).toMatch(/prediabetes/iu);
  });

  it("admits the glycaemic index is a wide average", () => {
    expect(text()).toMatch(/48\s*to\s*92/iu);
  });

  it("admits the weight projection is linear and drifts", () => {
    expect(text()).toMatch(/7,700 kcal/u);
  });

  it("cites the papers the numbers came from, as real links", () => {
    const refs = [...doc.querySelectorAll<HTMLAnchorElement>(".refs__list a")];
    expect(refs.length).toBeGreaterThanOrEqual(8);
    for (const ref of refs) {
      expect(ref.getAttribute("href") ?? "", ref.textContent ?? "").toMatch(/^https:\/\//u);
      expect((ref.textContent ?? "").trim().length, "a citation needs readable link text").toBeGreaterThan(12);
    }
    const list = doc.querySelector(".refs__list")?.textContent ?? "";
    for (const expected of ["Atkinson", "Shukla", "Mifflin", "Buffey"]) {
      expect(list, `sources should cite ${expected}`).toContain(expected);
    }
  });
});

describe("the build is a static, self-contained site", () => {
  it("fetches no scripts, styles or images from another origin", () => {
    const resources = [
      ...doc.querySelectorAll<HTMLElement>("script[src], link[rel~='stylesheet'], img[src], iframe[src]"),
    ];
    for (const node of resources) {
      const url = node.getAttribute("src") ?? node.getAttribute("href") ?? "";
      expect(/^(https?:)?\/\//u.test(url), `${node.tagName} reaches off-origin: ${url}`).toBe(false);
    }
  });

  it("uses relative asset URLs, so it works under the Pages sub-path", () => {
    for (const node of doc.querySelectorAll<HTMLElement>("script[src], link[rel~='stylesheet']")) {
      const url = node.getAttribute("src") ?? node.getAttribute("href") ?? "";
      expect(url.startsWith("/"), `${url} is absolute and will 404 under /<repo>/`).toBe(false);
    }
  });

  it("keeps the process evidence out of the deployed site", () => {
    for (const leaked of ["PROCESS.md", "reflections", "CLAUDE.md", "DESIGN.md"]) {
      expect(existsSync(resolve(DIST, leaked)), `${leaked} should not ship`).toBe(false);
    }
  });

  it("resolves every in-page anchor to something that exists", () => {
    for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const id = link.getAttribute("href")?.slice(1) ?? "";
      expect(doc.getElementById(id), `${link.getAttribute("href")} goes nowhere`).toBeTruthy();
    }
  });
});

describe("the page is one scroll, with the steps signposted", () => {
  const css = readFileSync(resolve("styles.css"), "utf8");

  it("runs top to bottom: plate, then afterwards, then the curve, then weight", () => {
    // The chart used to be pinned beside the builder. It is not: until there is
    // food on the plate the curve has nothing to show, and the space is worth
    // more to the plate. Order is the contract, so assert the order.
    const steps = [...doc.querySelectorAll(".journey .step")].map((el) => el.id);
    expect(steps).toEqual(["plate", "after", "curve", "trend"]);
  });

  it("pins nothing except the site header", () => {
    for (const rule of ["\\.stage", "\\.journey", "\\.builder"]) {
      const block = new RegExp(`${rule}\\s*\\{([^}]*)\\}`, "u").exec(css)?.[1] ?? "";
      expect(block, `${rule} must not be sticky`).not.toMatch(/position:\s*sticky/u);
    }
    expect(css).toMatch(/\.site-header\s*\{[^}]*position:\s*sticky/u);
  });

  it("gives every step a numbered checkpoint on a dashed rail", () => {
    const steps = [...doc.querySelectorAll<HTMLElement>(".journey .step")];
    expect(steps).toHaveLength(4);
    steps.forEach((step, i) => {
      expect(step.dataset.step, "each step declares its number").toBe(String(i + 1));
      const marker = step.querySelector(".step__marker");
      expect(marker, `step ${i + 1} needs a checkpoint`).toBeTruthy();
      expect(marker?.getAttribute("aria-hidden")).toBe("true");
      expect(step.querySelector(`[data-role="marker-${i + 1}"]`)).toBeTruthy();
    });
    expect(css).toMatch(/\.step\s*\{[^}]*border-left:[^;]*dashed/u);
    expect(css, "a completed checkpoint has to look different").toMatch(
      /\.step\[data-done="true"\] \.step__marker\s*\{/u,
    );
  });

  it("labels the three habits as before, while and after eating", () => {
    const kickers = [...doc.querySelectorAll(".step__kicker")].map((el) =>
      el.textContent?.toLowerCase().replace(/\s+/gu, " ").trim(),
    );
    expect(kickers[0]).toMatch(/before you eat/u);
    expect(kickers[1]).toMatch(/after you eat/u);
    expect(kickers[2]).toMatch(/while you eat/u);
  });

  it("opens on what the page is for, not on what it is called", () => {
    const hero = doc.querySelector(".hero")?.textContent?.replace(/\s+/gu, " ") ?? "";
    expect(hero).toMatch(/habits/iu);
    expect(hero, "the hero must name all three habits").toMatch(/on the plate/iu);
    expect(hero).toMatch(/the order you eat it in/iu);
    expect(hero).toMatch(/twenty minutes/iu);
  });

  it("labels both curves on the lines, not only in a legend", () => {
    const sim = simulate({
      items: [
        { food: FOODS_BY_ID.get("white-rice")!, units: 2 },
        { food: FOODS_BY_ID.get("chicken-breast")!, units: 1 },
        { food: FOODS_BY_ID.get("broccoli")!, units: 1 },
      ],
      activityId: "sit",
    });
    const svg = renderChart(sim, 700, 340, null);
    expect(svg).toMatch(/chart__label--carbs/u);
    expect(svg).toMatch(/chart__label--protein/u);
    expect(css).toMatch(/\.chart__label\s*\{/u);
  });

  it("says so plainly when reordering the plate changes nothing", () => {
    const sim = simulate({
      items: [
        { food: FOODS_BY_ID.get("cola")!, units: 1 },
        { food: FOODS_BY_ID.get("white-bread")!, units: 2 },
        { food: FOODS_BY_ID.get("donut")!, units: 1 },
      ],
      activityId: "sit",
    });
    const svg = renderChart(sim, 700, 340, null);
    expect(svg).toMatch(/both orders ·/u);
    expect(svg).not.toMatch(/chart__label--carbs/u);
  });

  it("keeps every chart colour on a token, so both themes drive it", () => {
    // Restoring these after a refactor is not optional: an SVG whose `fill` is
    // an undefined var falls back to black and whose `stroke` falls back to
    // none, so the chart renders as a black slab with no curves on it.
    for (const cls of [
      "chart__band--target",
      "chart__band--spike",
      "chart__band--hypo",
      "chart__line--carbs",
      "chart__line--protein",
      "chart__between",
      "chart__label--carbs",
      "chart__label--protein",
    ]) {
      const block = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, "u").exec(css)?.[1];
      expect(block, `.${cls} has no rule — the chart will paint black`).toBeTruthy();
      expect(block, `.${cls} must colour from a token`).toMatch(/var\(--/u);
    }
  });
});

describe("the layout cannot be propped open by its own chart", () => {
  const css = readFileSync(resolve("styles.css"), "utf8");

  it("keeps the chart SVG out of flow", () => {
    // renderChart writes a literal `width` attribute on the <svg>. While that
    // SVG was in flow, shrinking the viewport left a stale width holding the
    // grid open — 976px of content in a 768px window — and the ResizeObserver
    // could never fire to correct it, because its own content was stopping the
    // box from ever getting narrower. Out of flow, the frame's width is decided
    // by the grid track alone and the deadlock cannot form.
    const frame = /\.chart__frame\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    const svg = /\.chart__svg\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(frame).toMatch(/position:\s*relative/u);
    expect(frame).toMatch(/overflow:\s*hidden/u);
    expect(svg, "the SVG must not contribute to its container's width").toMatch(
      /position:\s*absolute/u,
    );
  });

  it("stops any grid child resolving to its min-content width", () => {
    expect(css).toMatch(/\.builder\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
    expect(css).toMatch(/\.builder__library,\n\.builder__meal\s*\{[^}]*min-width:\s*0/u);
  });

  it("switches the native controls with the theme", () => {
    // Without color-scheme the <select> menus and number-input spinners stay
    // light inside a dark page, which is most of what "dark mode doesn't work"
    // actually looks like.
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/u);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/u);
  });

  it("collapses the nav into a menu button on a phone", () => {
    const toggle = doc.querySelector('[data-role="nav-toggle"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe("site-nav");
    expect(doc.getElementById("site-nav"), "aria-controls must point at something").toBeTruthy();
    expect(toggle?.getAttribute("aria-label"), "an icon button needs a name").toBeTruthy();
    // Hidden once there is room for the links themselves.
    expect(css).toMatch(/\.nav-toggle\s*\{[^}]*display:\s*none/u);
  });

  it("ships a theme toggle and a flash-free default", () => {
    const toggle = doc.querySelector('[data-role="theme"]');
    expect(toggle?.getAttribute("aria-label")).toMatch(/switch to/iu);
    expect(doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "light dark",
    );
    // The theme is set on <html> before the stylesheet paints, so a dark-mode
    // visitor never sees a white flash on load.
    const head = doc.head.innerHTML;
    expect(head).toMatch(/prefers-color-scheme: dark/u);
    expect(head).toMatch(/dataset\.theme/u);
  });
});

describe("nothing is wired up twice", () => {
  it("uses every data-role exactly once", () => {
    // main.ts resolves roles with querySelector, so a duplicated role silently
    // binds the first element and orphans the rest. Restructuring the page into
    // the journey left two `activity-evidence` paragraphs: the first got the
    // text, the second rendered an empty bordered bar under it and nobody
    // noticed until a screenshot.
    const counts = new Map<string, number>();
    for (const el of doc.querySelectorAll("[data-role]")) {
      const role = el.getAttribute("data-role") ?? "";
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
    expect(duplicated, `duplicated data-role: ${duplicated.map(([r, n]) => `${r}×${n}`).join(", ")}`).toEqual([]);
  });

  it("uses every id exactly once", () => {
    const counts = new Map<string, number>();
    for (const el of doc.querySelectorAll("[id]")) {
      const id = el.getAttribute("id") ?? "";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
    expect(duplicated, `duplicated id: ${duplicated.map(([r]) => r).join(", ")}`).toEqual([]);
  });

  it("divides the activity cards evenly across every column count it uses", () => {
    // Count from the model, not the DOM: the cards are rendered by main.ts, so
    // the built HTML holds an empty fieldset. Eight activities means 4, 2 and 1
    // per row all divide evenly, so no breakpoint ends on a half-empty row —
    // auto-fill gave 5 then 3 at laptop width.
    const count = ACTIVITIES.length;
    expect(count % 4, "add or drop an activity and the laptop row goes ragged").toBe(0);
    const css = readFileSync(resolve("styles.css"), "utf8");
    for (const cols of [/repeat\(4, minmax\(0, 1fr\)\)/u, /repeat\(2, minmax\(0, 1fr\)\)/u]) {
      expect(css, `activities need a ${cols} track`).toMatch(cols);
    }
    for (const per of [4, 2, 1]) expect(count % per, `${count} does not divide by ${per}`).toBe(0);
  });
});
