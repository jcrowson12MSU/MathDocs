// A number line for a one-variable (in)equality: the solution set drawn the way it's taught,
// with filled dots for included endpoints and open dots for excluded ones.

import type { SolutionSet } from '../inequality';

const NS = 'http://www.w3.org/2000/svg';
const W = 600;
const H = 62;
const AXIS_Y = 26;
const MARGIN = 26;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r).replace('-', '−');
};

/** A tick spacing that gives about 8–14 ticks over the span: 1, 2, 5, 10, 20, … (or 0.5, 0.2, …). */
function niceStep(span: number): number {
  const raw = span / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/** The range to show: the endpoints with some room on each side, snapped to the tick spacing. */
export function numberLineRange(set: SolutionSet): { lo: number; hi: number; step: number } {
  const c = set.critical;
  let lo = c.length ? Math.min(...c) : -5;
  let hi = c.length ? Math.max(...c) : 5;
  const pad = Math.max(2, (hi - lo) * 0.35);
  lo -= pad;
  hi += pad;
  if (hi - lo < 8) {
    const mid = (lo + hi) / 2;
    lo = mid - 4;
    hi = mid + 4;
  }
  const step = niceStep(hi - lo);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

export function renderNumberLine(set: SolutionSet): SVGSVGElement {
  const { lo, hi, step } = numberLineRange(set);
  const x = (v: number) => MARGIN + ((v - lo) / (hi - lo)) * (W - 2 * MARGIN);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'number-line-svg', role: 'img' });
  svg.setAttribute('aria-label', `Number line for ${set.variable}`);

  const defs = el('defs', {});
  // Fixed-size arrowheads (by default SVG scales them with the line's thickness).
  for (const [id, cls, size] of [['nl-arrow-axis', 'nl-axis-head', 9], ['nl-arrow-sol', 'nl-sol-head', 14]] as const) {
    const m = el('marker', {
      id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: size, markerHeight: size,
      markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
    });
    m.append(el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }));
    defs.append(m);
  }
  svg.append(defs);

  // Axis with arrows at both ends, ticks and labels.
  svg.append(el('line', { x1: 6, y1: AXIS_Y, x2: W - 6, y2: AXIS_Y, class: 'nl-axis', 'marker-start': 'url(#nl-arrow-axis)', 'marker-end': 'url(#nl-arrow-axis)' }));
  for (let v = lo; v <= hi + step / 2; v += step) {
    const t = x(v);
    svg.append(el('line', { x1: t, y1: AXIS_Y - 5, x2: t, y2: AXIS_Y + 5, class: 'nl-tick' }));
    const label = el('text', { x: t, y: AXIS_Y + 21, class: 'nl-label', 'text-anchor': 'middle' });
    label.textContent = fmt(v);
    svg.append(label);
  }

  // The solution: thick bands (with arrows when they run off to ±∞) and endpoint dots.
  for (const band of set.intervals) {
    const a = Number.isFinite(band.from) ? x(band.from) : 8;
    const b = Number.isFinite(band.to) ? x(band.to) : W - 8;
    if (band.from !== band.to) {
      const line = el('line', { x1: a, y1: AXIS_Y, x2: b, y2: AXIS_Y, class: 'nl-solution' });
      if (!Number.isFinite(band.from)) line.setAttribute('marker-start', 'url(#nl-arrow-sol)');
      if (!Number.isFinite(band.to)) line.setAttribute('marker-end', 'url(#nl-arrow-sol)');
      svg.append(line);
    }
    for (const [v, closed] of [[band.from, band.fromClosed], [band.to, band.toClosed]] as const) {
      if (!Number.isFinite(v)) continue;
      svg.append(el('circle', { cx: x(v), cy: AXIS_Y, r: 6.5, class: closed ? 'nl-dot closed' : 'nl-dot open' }));
      // Label endpoints that don't fall on a tick (like 2.5 or 11/3).
      if (Math.abs(v / step - Math.round(v / step)) > 1e-9) {
        const t = el('text', { x: x(v), y: AXIS_Y - 12, class: 'nl-label nl-end', 'text-anchor': 'middle' });
        t.textContent = fmt(v);
        svg.append(t);
      }
    }
  }
  return svg;
}
