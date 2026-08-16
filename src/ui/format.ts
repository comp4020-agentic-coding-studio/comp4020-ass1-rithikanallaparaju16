// Formatting helpers.
//
// `unitsAndGrams` exists as a named, tested function rather than as a template
// literal inline in the renderer, because it is where a CLAUDE.md invariant
// lives: the grams the visitor reads must always be the serve count times the
// food's serve weight. Keeping it here means a spec test can hold it to that
// without needing to boot a browser.

import type { Food } from "../data/foods";
import { gramsFor } from "../model/glucose";

/** e.g. "2 × 150 g = 300 g" — shows the arithmetic rather than asserting it. */
export function unitsAndGrams(food: Food, units: number): string {
  return `${units} × ${food.unitWeightG} g = ${gramsFor(food, units)} g`;
}

/** e.g. "300 g" */
export function gramsLabel(food: Food, units: number): string {
  return `${gramsFor(food, units)} g`;
}

export function round(value: number, places = 0): string {
  return value.toFixed(places);
}

/** Whole numbers with a thousands separator, for kcal and areas. */
export function integer(value: number): string {
  return Math.round(value).toLocaleString("en-AU");
}

export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${integer(rounded)}` : integer(rounded);
}

/** Escapes text before it goes into an innerHTML string. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
