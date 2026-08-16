// A colour-contrast sensor.
//
// CLAUDE.md notes that nothing in the shipped roster measures accessibility and
// that wiring those sensors is my work. This is the cheapest useful one: WCAG
// 2.1 relative luminance over the palette, computed from the tokens as they are
// actually declared in styles.css rather than from a copy of them kept here.
// Reading the real file is the point — a duplicated palette drifts silently,
// and then the test is measuring a colour the site no longer uses.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("styles.css"), "utf8");

function tokens(): Map<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/u.exec(css);
  if (!root) throw new Error("no :root block in styles.css");
  const found = new Map<string, string>();
  for (const match of root[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8});/gu)) {
    found.set(match[1], match[2]);
  }
  return found;
}

const PALETTE = tokens();

function hex(name: string): string {
  const value = PALETTE.get(name);
  if (!value) throw new Error(`--${name} is not declared in styles.css`);
  return value;
}

function channels(value: string): [number, number, number] {
  const raw = value.slice(1);
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.1 relative luminance. */
function luminance(value: string): number {
  const [r, g, b] = channels(value).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground/background pair the stylesheet actually puts together. */
const NORMAL_TEXT: [string, string, string][] = [
  ["body copy", "ink", "bg"],
  ["body copy on a card", "ink", "surface"],
  ["secondary copy", "ink-soft", "bg"],
  ["secondary copy on a card", "ink-soft", "surface"],
  ["muted copy", "ink-faint", "bg"],
  ["muted copy on a card", "ink-faint", "surface"],
  ["muted copy on a sunk panel", "ink-faint", "surface-sunk"],
  ["links and the eyebrow", "green", "bg"],
  ["links on a card", "green", "surface"],
  ["the protein reading", "series-protein", "green-wash"],
  ["step numbers and the carbs reading", "amber", "bg"],
  ["the carbs reading on a card", "amber", "surface"],
  ["the evidence note", "ink-soft", "amber-wash"],
  ["the GI tag", "amber", "amber-wash"],
  ["the verdict", "ink", "green-wash"],
];

/** Buttons and pressed chips: white text on a solid fill. */
const ON_FILL: [string, string, string][] = [
  ["primary button", "surface", "ink"],
  ["pressed category chip", "surface", "ink"],
  ["pressed diet chip", "surface", "green"],
  ["the serve-count badge", "surface", "green"],
];

/** Lines, borders and focus rings only have to clear 3:1. */
const NON_TEXT: [string, string, string][] = [
  ["the focus ring", "green", "bg"],
  ["the focus ring on a card", "green", "surface"],
  ["the protein curve", "series-protein", "green-wash"],
  ["the carbs curve", "series-carbs", "green-wash"],
  ["the carbs curve in the spike band", "series-carbs", "amber-wash"],
  ["the 140 rule", "series-carbs", "green-wash"],
  ["an input or button border", "border-input", "surface"],
];

describe("colour contrast (WCAG 2.1 AA)", () => {
  it.each([...NORMAL_TEXT, ...ON_FILL])("%s clears 4.5:1", (_what, fg, bg) => {
    const ratio = contrast(hex(fg), hex(bg));
    expect(ratio, `${hex(fg)} on ${hex(bg)} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)("%s clears 3:1", (_what, fg, bg) => {
    const ratio = contrast(hex(fg), hex(bg));
    expect(ratio, `${hex(fg)} on ${hex(bg)} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it("tells the two curves apart without using colour at all", () => {
    // This started out asserting a luminance ratio between the two series and
    // failed at 1.09:1 — correctly, but for the wrong reason. Two categorical
    // colours differ by hue, and both of these were deliberately darkened to
    // similar lightness so they would clear 4.5:1 as text. Luminance between
    // series is not the property that protects anyone; redundant encoding is.
    // So this measures that: one line is dashed and the other is not, which
    // survives greyscale, colour-vision deficiency and a bad projector.
    const carbs = /\.chart__line--carbs\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    const protein = /\.chart__line--protein\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(carbs, "the carbs series must carry a dash pattern").toMatch(/stroke-dasharray/u);
    expect(protein, "the protein series must stay solid, or the cue is not a cue").not.toMatch(
      /stroke-dasharray/u,
    );
    expect(carbs).toMatch(/--series-carbs/u);
    expect(protein).toMatch(/--series-protein/u);
  });

  it("computes a ratio it can be checked on", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 6);
    expect(contrast("#fff", "#000")).toBeCloseTo(21, 6);
  });
});
