// The glucose chart, hand-rolled as SVG.
//
// The chart is measured in real CSS pixels rather than drawn into a fixed
// viewBox and scaled. A fixed viewBox is the tempting shortcut and it wrecks the
// phone viewport: a 760-unit viewBox squeezed into a 350 px column renders
// 12-unit axis labels at about 5 px. Sizing to the container and re-rendering on
// resize keeps every label at its true size, and makes resizing mid-interaction
// a non-event.

import type { Series, Simulation } from "../model/glucose";
import { HYPO_FLOOR_MG_DL, TARGET_CEILING_MG_DL, WINDOW_MIN } from "../model/glucose";

const Y_MIN = 60;

export type ChartGeometry = {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  yMax: number;
  x: (minutes: number) => number;
  y: (mgdl: number) => number;
};

/** Top of the y-axis: adapts to the peak, but never low enough to clip 140. */
function yMaxFor(sim: Simulation): number {
  const peak = Math.max(
    sim.series["carbs-sugar-first"].peakMgDl,
    sim.series["protein-fibre-first"].peakMgDl,
  );
  return Math.min(210, Math.max(160, Math.ceil((peak + 18) / 10) * 10));
}

/**
 * Plot padding, exported so the scrubber maps a pointer position through the
 * same numbers the axes were drawn with. Duplicating them in the event handler
 * is how a crosshair silently drifts off its own gridlines.
 */
export function padsFor(width: number): {
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
} {
  const narrow = width < 460;
  return {
    padLeft: narrow ? 34 : 46,
    padRight: narrow ? 12 : 18,
    padTop: narrow ? 18 : 24,
    padBottom: narrow ? 40 : 48,
  };
}

export function geometryFor(sim: Simulation, width: number, height: number): ChartGeometry {
  const { padLeft, padRight, padTop, padBottom } = padsFor(width);
  const yMax = yMaxFor(sim);
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);
  return {
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    yMax,
    x: (minutes) => padLeft + (minutes / WINDOW_MIN) * plotW,
    y: (mgdl) => padTop + (1 - (mgdl - Y_MIN) / (yMax - Y_MIN)) * plotH,
  };
}

function linePath(series: Series, g: ChartGeometry): string {
  return series.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${g.x(p.minutes).toFixed(1)} ${g.y(p.mgdl).toFixed(1)}`)
    .join(" ");
}

/**
 * The band between the two curves: the glucose the visitor never had, drawn as
 * a shape rather than described in a caption.
 */
function betweenPath(sim: Simulation, g: ChartGeometry): string {
  const high = sim.series["carbs-sugar-first"].points;
  const low = sim.series["protein-fibre-first"].points;
  const forward = high.map(
    (p, i) => `${i === 0 ? "M" : "L"}${g.x(p.minutes).toFixed(1)} ${g.y(p.mgdl).toFixed(1)}`,
  );
  const back = [...low]
    .reverse()
    .map((p) => `L${g.x(p.minutes).toFixed(1)} ${g.y(p.mgdl).toFixed(1)}`);
  return `${forward.join(" ")} ${back.join(" ")} Z`;
}

/**
 * The y-axis is labelled at the values that mean something rather than at every
 * multiple of twenty: the hypoglycaemia floor, the fasting baseline, and the
 * spike threshold. A plain 20-step scale skipped 140 entirely on a phone, which
 * left the amber dashed line sitting there unexplained.
 */
function yTicks(yMax: number): number[] {
  const ticks = [HYPO_FLOOR_MG_DL, 90, 120, TARGET_CEILING_MG_DL];
  for (let v = 160; v <= yMax; v += 20) ticks.push(v);
  return ticks.filter((v) => v <= yMax);
}

/** These three get their own styled rule, so they skip the faint grid line. */
const RULED = new Set([HYPO_FLOOR_MG_DL, 90, TARGET_CEILING_MG_DL]);

function gridLines(g: ChartGeometry): string {
  return yTicks(g.yMax)
    .flatMap((v) => {
      const y = g.y(v).toFixed(1);
      const line = RULED.has(v)
        ? ""
        : `<line class="chart__grid" x1="${g.padLeft}" y1="${y}" x2="${
            g.width - g.padRight
          }" y2="${y}" />`;
      return [
        line,
        `<text class="chart__ytick" x="${g.padLeft - 8}" y="${y}" dy="0.32em" text-anchor="end">${v}</text>`,
      ];
    })
    .join("");
}

function xAxis(g: ChartGeometry): string {
  const plotW = g.width - g.padLeft - g.padRight;
  const step = plotW < 380 ? 60 : 30;
  const parts: string[] = [];
  for (let t = 0; t <= WINDOW_MIN; t += step) {
    const x = g.x(t).toFixed(1);
    parts.push(
      `<line class="chart__grid chart__grid--v" x1="${x}" y1="${g.padTop}" x2="${x}" y2="${g.height - g.padBottom}" />`,
      `<text class="chart__xtick" x="${x}" y="${g.height - g.padBottom + 18}" text-anchor="middle">${t}</text>`,
    );
  }
  parts.push(
    `<text class="chart__axislabel" x="${g.padLeft + plotW / 2}" y="${g.height - 8}" text-anchor="middle">minutes after the first bite</text>`,
  );
  return parts.join("");
}

export function renderChart(sim: Simulation, width: number, height: number, scrubIndex: number | null): string {
  const g = geometryFor(sim, width, height);
  const right = g.width - g.padRight;
  const bottom = g.height - g.padBottom;
  const carbs = sim.series["carbs-sugar-first"];
  const protein = sim.series["protein-fibre-first"];
  const narrow = width < 460;

  const yFloor = g.y(HYPO_FLOOR_MG_DL);
  const y140 = g.y(TARGET_CEILING_MG_DL);
  const yBase = g.y(sim.baselineMgDl);

  const bands = [
    // Why the curve stops at 70: below here is hypoglycaemia, which a meal
    // cannot cause. Drawing the forbidden zone makes the floor legible.
    `<rect class="chart__band chart__band--hypo" x="${g.padLeft}" y="${yFloor.toFixed(1)}" width="${(right - g.padLeft).toFixed(1)}" height="${Math.max(0, bottom - yFloor).toFixed(1)}" />`,
    `<rect class="chart__band chart__band--target" x="${g.padLeft}" y="${y140.toFixed(1)}" width="${(right - g.padLeft).toFixed(1)}" height="${Math.max(0, yFloor - y140).toFixed(1)}" />`,
    `<rect class="chart__band chart__band--spike" x="${g.padLeft}" y="${g.padTop}" width="${(right - g.padLeft).toFixed(1)}" height="${Math.max(0, y140 - g.padTop).toFixed(1)}" />`,
  ].join("");

  const markers = [
    `<line class="chart__rule chart__rule--floor" x1="${g.padLeft}" y1="${yFloor.toFixed(1)}" x2="${right}" y2="${yFloor.toFixed(1)}" />`,
    `<line class="chart__rule chart__rule--base" x1="${g.padLeft}" y1="${yBase.toFixed(1)}" x2="${right}" y2="${yBase.toFixed(1)}" />`,
    `<line class="chart__rule chart__rule--ceiling" x1="${g.padLeft}" y1="${y140.toFixed(1)}" x2="${right}" y2="${y140.toFixed(1)}" />`,
    narrow
      ? ""
      : `<text class="chart__note" x="${right - 6}" y="${(y140 - 7).toFixed(1)}" text-anchor="end">140 — spike territory</text>
         <text class="chart__note" x="${right - 6}" y="${(yFloor + 15).toFixed(1)}" text-anchor="end">70 — below here is hypoglycaemia</text>`,
  ].join("");

  const scrub =
    scrubIndex === null
      ? ""
      : (() => {
          const cp = carbs.points[scrubIndex];
          const pp = protein.points[scrubIndex];
          if (!cp || !pp) return "";
          const x = g.x(cp.minutes).toFixed(1);
          return `<g class="chart__scrub">
            <line x1="${x}" y1="${g.padTop}" x2="${x}" y2="${bottom}" />
            <circle class="chart__dot chart__dot--carbs" cx="${x}" cy="${g.y(cp.mgdl).toFixed(1)}" r="5" />
            <circle class="chart__dot chart__dot--protein" cx="${x}" cy="${g.y(pp.mgdl).toFixed(1)}" r="5" />
          </g>`;
        })();

  const peakDot = (s: Series, kind: string) =>
    s.peakMin > 0
      ? `<circle class="chart__peak chart__peak--${kind}" cx="${g.x(s.peakMin).toFixed(1)}" cy="${g.y(s.peakMgDl).toFixed(1)}" r="4" />`
      : "";

  return `<svg class="chart__svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
      role="img" aria-label="${chartSummary(sim)}" focusable="false">
    ${bands}
    ${gridLines(g)}
    ${xAxis(g)}
    ${markers}
    <path class="chart__between" d="${betweenPath(sim, g)}" />
    <path class="chart__line chart__line--carbs" d="${linePath(carbs, g)}" />
    <path class="chart__line chart__line--protein" d="${linePath(protein, g)}" />
    ${peakDot(carbs, "carbs")}
    ${peakDot(protein, "protein")}
    ${scrub}
    <line class="chart__axis" x1="${g.padLeft}" y1="${bottom}" x2="${right}" y2="${bottom}" />
    <line class="chart__axis" x1="${g.padLeft}" y1="${g.padTop}" x2="${g.padLeft}" y2="${bottom}" />
  </svg>`;
}

/** The one-sentence version, for the screen-reader label on the figure. */
export function chartSummary(sim: Simulation): string {
  if (sim.isEmpty) {
    return `An empty plate: both curves sit flat at the fasting baseline of ${sim.baselineMgDl} milligrams per decilitre for the whole three hours.`;
  }
  const c = sim.series["carbs-sugar-first"];
  const p = sim.series["protein-fibre-first"];
  return (
    `Blood glucose over ${WINDOW_MIN} minutes, from a fasting baseline of ${sim.baselineMgDl} milligrams per decilitre. ` +
    `Eating the carbohydrate first peaks at ${Math.round(c.peakMgDl)} at ${c.peakMin} minutes. ` +
    `Eating protein and fibre first peaks at ${Math.round(p.peakMgDl)} at ${p.peakMin} minutes. ` +
    `Both return to baseline by ${WINDOW_MIN} minutes.`
  );
}

/** Values every 20 minutes, so the chart is readable without seeing it. */
export function tableRows(sim: Simulation): { minutes: number; carbs: number; protein: number }[] {
  const rows: { minutes: number; carbs: number; protein: number }[] = [];
  for (let t = 0; t <= WINDOW_MIN; t += 20) {
    const i = sim.series["carbs-sugar-first"].points.findIndex((p) => p.minutes === t);
    if (i === -1) continue;
    rows.push({
      minutes: t,
      carbs: sim.series["carbs-sugar-first"].points[i].mgdl,
      protein: sim.series["protein-fibre-first"].points[i].mgdl,
    });
  }
  return rows;
}
