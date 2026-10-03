// Layouts the student fills in, drawn the way they're done on paper: the area model (box) for multiplying and
// factoring, the X (diamond) for factoring, synthetic division and long division. Nothing here is computed:
// the app only keeps the boxes lined up.

import type { LayoutCell } from '../model';
import katex from 'katex';
import { h } from '../ui';
import { gridMath, gridNavigator, type GridContext, type GridField } from './gridnav';

export interface LayoutContext extends GridContext {
  onChange: () => void;
}

export function layoutEditor(cell: LayoutCell, ctx: LayoutContext) {
  const box = h('div', { class: `step-box layout-box layout-${cell.layout}` });
  let nav: GridField[][] = [];
  const navigator = gridNavigator(() => nav, ctx, {
    addRow: (r) => addRowAfter(r),
    onEmptyBackspace: (r) => removeEmptyRow(r),
  });

  /** A box bound to cells[r][c]. */
  const field = (r: number, c: number, cls: string, placeholder = '') => {
    const f = gridMath(cell.cells[r]?.[c] ?? '', ctx.readOnly, `layout-field ${cls}`, placeholder);
    f.el.addEventListener('input', () => {
      while (cell.cells.length <= r) cell.cells.push([]);
      cell.cells[r][c] = f.el.value;
      ctx.onChange();
    });
    navigator.attach(f);
    return f;
  };
  const button = (label: string, title: string, run: () => void) =>
    ctx.readOnly ? null : h('button', { class: 'link small', title, onclick: () => (run(), build(), ctx.onChange()) }, label);

  const build = () => {
    nav = [];
    box.replaceChildren();
    if (cell.layout === 'box') buildBox();
    else if (cell.layout === 'diamond') buildDiamond();
    else if (cell.layout === 'synthetic') buildSynthetic();
    else if (cell.layout === 'usub') buildUSub();
    else if (cell.layout === 'parts') buildParts();
    else if (cell.layout === 'tabular') buildTabular();
    else buildLongDivision();
  };

  /** A label written in math (e.g. "u ="), shown beside a box. */
  const label = (latex: string) => {
    const el = h('span', { class: 'calc-label' });
    el.innerHTML = katex.renderToString(latex, { throwOnError: false });
    return el;
  };
  const row = (...parts: (HTMLElement | string)[]) => h('div', { class: 'calc-row' }, ...parts);

  // u-substitution: the integral, u and du, the integral in u, the result in u, then back in x.
  const buildUSub = () => {
    const orig = field(0, 0, 'calc-wide', '\\int f(x)\\,dx');
    const u = field(1, 0, 'calc-mid');
    const du = field(1, 1, 'calc-mid');
    const inU = field(2, 0, 'calc-wide', '\\int \\ldots \\,du');
    const resU = field(3, 0, 'calc-wide');
    const resX = field(4, 0, 'calc-wide');
    nav = [[orig], [u, du], [inU], [resU], [resX]];
    box.append(
      row(orig.el),
      row(label('\\text{Let } u ='), u.el, label('\\quad du ='), du.el),
      row(label('\\text{In } u\\text{:}'), inU.el),
      row(label('='), resU.el),
      row(label('\\text{In } x\\text{:}\\;='), resX.el),
    );
  };

  // Integration by parts: u and dv chosen, du and v found, then uv − ∫v du.
  const buildParts = () => {
    const u = field(0, 0, 'calc-mid');
    const dv = field(0, 1, 'calc-mid');
    const du = field(1, 0, 'calc-mid');
    const v = field(1, 1, 'calc-mid');
    const formula = field(2, 0, 'calc-wide', 'uv-\\int v\\,du');
    const result = field(3, 0, 'calc-wide');
    nav = [[u, dv], [du, v], [formula], [result]];
    box.append(
      h('div', { class: 'parts-grid' },
        label('u ='), u.el, label('dv ='), dv.el,
        label('du ='), du.el, label('v ='), v.el),
      row(label('\\int u\\,dv = uv-\\int v\\,du ='), formula.el),
      row(label('='), result.el),
    );
  };

  // The DI (tabular) method: signs alternate +, −, +, … down the left; D column differentiates, I integrates.
  const buildTabular = () => {
    const rows = cell.cells.length - 1;
    const grid = h('div', { class: 'di-grid' }, h('span', {}, ''), h('span', { class: 'di-head' }, 'D'), h('span', { class: 'di-head' }, 'I'));
    for (let r = 0; r < rows; r++) {
      const d = field(r, 0, 'calc-mid');
      const i = field(r, 1, 'calc-mid');
      grid.append(h('span', { class: 'di-sign' }, r % 2 === 0 ? '+' : '−'), d.el, i.el);
      nav.push([d, i]);
    }
    const answer = field(rows, 0, 'calc-wide');
    nav.push([answer]);
    box.append(grid, row(label('\\int = '), answer.el), h('div', { class: 'layout-tools' },
      button('+ row', 'Add a row to the table', () => cell.cells.splice(rows, 0, ['', ''])),
      rows > 2 ? button('− row', 'Remove the last row', () => cell.cells.splice(rows - 1, 1)) : null));
  };

  // Area model: top terms across, side terms down, products inside.
  const buildBox = () => {
    const rows = cell.cells.length;
    const cols = Math.max(...cell.cells.map((r) => r.length));
    const grid = h('div', { class: 'area-grid', style: `grid-template-columns: repeat(${cols}, auto)` });
    for (let r = 0; r < rows; r++) {
      const line: GridField[] = [];
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) {
          grid.append(h('div', { class: 'area-corner' }, '×'));
          continue;
        }
        const header = r === 0 || c === 0;
        const f = field(r, c, header ? 'area-head' : 'area-in');
        grid.append(h('div', { class: header ? 'area-cell head' : 'area-cell' }, f.el));
        line.push(f);
      }
      nav.push(line);
    }
    box.append(grid, h('div', { class: 'layout-tools' },
      button('+ row', 'Add a term down the side', () => cell.cells.push(Array(cols).fill(''))),
      button('+ column', 'Add a term across the top', () => cell.cells.forEach((r) => r.push(''))),
      rows > 2 ? button('− row', 'Remove the last row', () => cell.cells.pop()) : null,
      cols > 2 ? button('− column', 'Remove the last column', () => cell.cells.forEach((r) => r.pop())) : null,
    ));
  };

  // The X: what the two numbers multiply to (top) and add to (bottom); the two numbers go left and right.
  const buildDiamond = () => {
    const top = field(0, 0, 'x-top');
    const left = field(0, 1, 'x-left');
    const right = field(0, 2, 'x-right');
    const bottom = field(0, 3, 'x-bottom');
    nav = [[top], [left, right], [bottom]];
    box.append(h('div', { class: 'x-wrap' },
      h('div', { class: 'x-lines' }),
      h('div', { class: 'x-slot top' }, h('span', { class: 'x-hint' }, 'multiplies to'), top.el),
      h('div', { class: 'x-slot left' }, left.el),
      h('div', { class: 'x-slot right' }, right.el),
      h('div', { class: 'x-slot bottom' }, bottom.el, h('span', { class: 'x-hint' }, 'adds to')),
    ));
  };

  // Synthetic division: the divisor's zero in the corner, coefficients across, middle row, rule, bottom row.
  const buildSynthetic = () => {
    const cols = Math.max(...cell.cells.map((r) => r.length));
    const grid = h('div', { class: 'synth-grid', style: `grid-template-columns: repeat(${cols}, auto)` });
    for (let r = 0; r < 3; r++) {
      const line: GridField[] = [];
      for (let c = 0; c < cols; c++) {
        if (c === 0 && r > 0) {
          grid.append(h('div', { class: `synth-cell divisor-col${r === 1 ? ' rule-below' : ''}` }));
          continue;
        }
        const f = field(r, c, c === 0 ? 'synth-divisor' : 'synth-num');
        const cls = ['synth-cell', c === 0 ? 'divisor' : '', r === 1 ? 'rule-below' : ''].join(' ');
        grid.append(h('div', { class: cls }, f.el));
        line.push(f);
      }
      nav.push(line);
    }
    box.append(grid, h('div', { class: 'layout-tools' },
      button('+ coefficient', 'Add a column', () => cell.cells.forEach((r) => r.push(''))),
      cols > 3 ? button('− coefficient', 'Remove the last column', () => cell.cells.forEach((r) => r.pop())) : null,
    ));
  };

  // Long division: quotient over the bracket, divisor ) dividend, then work lines under it.
  const buildLongDivision = () => {
    cell.indents ??= [];
    const quotient = field(0, 0, 'ld-quotient');
    const divisor = field(1, 0, 'ld-divisor');
    const dividend = field(1, 1, 'ld-dividend');
    nav = [[quotient], [divisor, dividend]];
    const work = h('div', { class: 'ld-work' });
    for (let r = 2; r < cell.cells.length; r++) {
      const i = r - 2;
      const f = field(r, 0, 'ld-line');
      const line = h('div', { class: `ld-row${i % 2 === 0 ? ' subtract' : ''}`, style: `padding-left: ${cell.indents![i] ?? 0}em` }, f.el);
      // Option+← / Option+→ shift the line, to line up like terms.
      f.el.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (!ke.altKey || (ke.key !== 'ArrowLeft' && ke.key !== 'ArrowRight') || ctx.readOnly) return;
        ke.preventDefault();
        ke.stopPropagation();
        const n = Math.max(0, (cell.indents![i] ?? 0) + (ke.key === 'ArrowRight' ? 1 : -1));
        cell.indents![i] = n;
        line.style.paddingLeft = `${n}em`;
        ctx.onChange();
      }, true);
      if (!ctx.readOnly) {
        line.append(h('span', { class: 'ld-shift' },
          h('button', { class: 'icon tiny', title: 'Shift left (⌥←)', onclick: () => shift(i, -1, line) }, '◂'),
          h('button', { class: 'icon tiny', title: 'Shift right (⌥→)', onclick: () => shift(i, 1, line) }, '▸'),
        ));
      }
      work.append(line);
      nav.push([f]);
    }
    box.append(
      h('div', { class: 'ld-top' }, h('div', { class: 'ld-gap' }), h('div', { class: 'ld-quot' }, quotient.el)),
      h('div', { class: 'ld-main' },
        h('div', { class: 'ld-div' }, divisor.el),
        h('div', { class: 'ld-bracket' }, h('div', { class: 'ld-dividend' }, dividend.el), work)),
      h('div', { class: 'layout-tools' },
        button('+ line', 'Add a work line', () => {
          cell.cells.push(['']);
          cell.indents!.push(cell.indents![cell.indents!.length - 1] ?? 0);
        })),
    );
  };
  const shift = (i: number, d: number, line: HTMLElement) => {
    const n = Math.max(0, (cell.indents![i] ?? 0) + d);
    cell.indents![i] = n;
    line.style.paddingLeft = `${n}em`;
    ctx.onChange();
  };

  /** Enter at the end of the last long-division line adds another. */
  const addRowAfter = (r: number): boolean => {
    if (cell.layout !== 'longdiv' || r !== nav.length - 1 || r < 2) return false;
    cell.cells.push(['']);
    cell.indents!.push(cell.indents![r - 2] ?? 0);
    build();
    ctx.onChange();
    return true;
  };
  const removeEmptyRow = (r: number): boolean => {
    if (cell.layout !== 'longdiv' || r < 2 || cell.cells.length <= 4 || r !== nav.length - 1) return false;
    cell.cells.pop();
    cell.indents!.pop();
    build();
    ctx.onChange();
    setTimeout(() => nav[nav.length - 1]?.[0]?.focus('end'));
    return true;
  };

  build();
  return { el: box, focus: navigator.focus };
}
