// A limit table: f(x) for x closing in on a from the left and from the right (or growing toward ∞).
// Working out f at a number is arithmetic; what the values approach — the limit — is the student's answer.
// In practice mode the f(x) column is left blank to fill in.

import { analyze } from '../mathfn';
import type { LimitCell } from '../model';
import { h } from '../ui';
import { gridMath, gridNavigator, type GridContext, type GridField } from './gridnav';

export interface LimitContext extends GridContext {
  onChange: () => void;
  practice: () => boolean;
}

/** The x values to try: a ∓ 0.1, 0.01, 0.001 (or 10, 100, … for ∞). Null if `at` isn't a number or ±∞. */
export function limitXs(at: string): { left: number[]; right: number[] } | null {
  const t = at.replace(/\s+/g, '');
  if (/^\+?\\infty$/.test(t)) return { left: [10, 100, 1000, 10000], right: [] };
  if (/^-\\infty$/.test(t)) return { left: [], right: [-10000, -1000, -100, -10] };
  const a = analyze(`y=${at}`);
  if (a.kind !== 'function' || a.params.length) return null;
  const v = a.f(0, {});
  if (!Number.isFinite(v)) return null;
  const steps = [0.1, 0.01, 0.001, 0.0001];
  return { left: steps.map((s) => v - s), right: [...steps].reverse().map((s) => v + s) };
}

/** A value shown to 9 significant digits (or "undefined"), enough to see it closing in. */
export function show(v: number): string {
  if (!Number.isFinite(v)) return 'undefined';
  if (v === 0) return '0';
  const s = Number(v.toPrecision(9));
  return String(s).replace('-', '−');
}

const xShow = (x: number) => String(Number(x.toPrecision(8))).replace('-', '−');

export function limitEditor(cell: LimitCell, ctx: LimitContext) {
  const box = h('div', { class: 'step-box limit-box' });
  const table = h('div', { class: 'limit-table' });
  const f = gridMath(cell.expr, ctx.readOnly, 'limit-field', 'f(x)');
  const at = gridMath(cell.at, ctx.readOnly, 'limit-field small', 'a');
  const answer = gridMath(cell.answer, ctx.readOnly, 'limit-field', '');
  const nav: GridField[][] = [[f, at], [answer]];
  const navigator = gridNavigator(() => nav, ctx);
  [f, at, answer].forEach(navigator.attach);

  const draw = () => {
    const xs = limitXs(cell.at);
    const fn = analyze(`y=${cell.expr}`);
    table.replaceChildren();
    if (!cell.expr.trim() || !cell.at.trim()) {
      table.append(h('p', { class: 'muted small' }, 'Type f(x) and the number x approaches (or ∞: type \\infty).'));
      return;
    }
    if (!xs) {
      table.append(h('p', { class: 'muted small' }, 'x should approach a number, or ∞ (type \\infty).'));
      return;
    }
    if (fn.kind !== 'function') {
      table.append(h('p', { class: 'muted small' }, fn.kind === 'error' ? fn.message : 'Write f(x) using x.'));
      return;
    }
    const practice = ctx.practice();
    const cellsFor = (list: number[], title: string) => list.length ? h('div', { class: 'limit-side' },
      h('div', { class: 'limit-title' }, title),
      h('div', { class: 'limit-grid' },
        h('span', { class: 'limit-head' }, 'x'), h('span', { class: 'limit-head' }, 'f(x)'),
        ...list.flatMap((x) => [h('span', {}, xShow(x)), h('span', { class: practice ? 'limit-blank' : '' }, practice ? '' : show(fn.f(x, {})))]))) : null;
    const infinite = /infty/.test(cell.at);
    table.append(
      cellsFor(xs.left, infinite ? (cell.at.includes('-') ? '' : 'x → ∞') : 'from the left (x < a)') ?? '',
      cellsFor(xs.right, infinite ? 'x → −∞' : 'from the right (x > a)') ?? '',
    );
  };

  f.el.addEventListener('input', () => {
    cell.expr = f.el.value;
    draw();
    ctx.onChange();
  });
  at.el.addEventListener('input', () => {
    cell.at = at.el.value;
    draw();
    ctx.onChange();
  });
  answer.el.addEventListener('input', () => {
    cell.answer = answer.el.value;
    ctx.onChange();
  });
  draw();

  const lim = h('span', { class: 'calc-label limit-lim' }, 'lim');
  box.append(
    h('div', { class: 'calc-row' }, h('span', { class: 'calc-label' }, 'f(x) ='), f.el, h('span', { class: 'calc-label' }, 'as x →'), at.el),
    table,
    h('div', { class: 'calc-row' }, lim, h('span', { class: 'calc-label' }, 'f(x) ='), answer.el),
  );
  return { el: box, focus: navigator.focus, refresh: draw };
}
