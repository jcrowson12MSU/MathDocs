// The "System" cell: equations stacked for elimination, with their = signs lined up, a note beside
// each row (×3), a + or − on the last row, a line, and the combined equation under it.
// It is layout only: nothing here combines equations; the student writes every part.

import { MathfieldElement } from 'mathlive';
import type { SystemCell } from '../model';
import { h } from '../ui';
import { focusable, type Where } from './mathfield';

export interface SystemEditorContext {
  readOnly: boolean;
  onChange: () => void;
  /** Shared cell shortcuts (comments, moving cells…). Return true if handled. */
  cellKeys: (e: KeyboardEvent) => boolean;
  /** Leave the cell upward / downward. Returns false if there's nowhere to go. */
  leave: (dir: -1 | 1) => boolean;
  /** Enter under the line: go on to the next step. */
  next: () => void;
}

const RELATIONS = new Set(['=', '<', '>', '\\le', '\\ge', '\\leq', '\\geq', '\\ne', '\\neq', '\\lt', '\\gt']);

/** Horizontal position of the top-level = (or < ≤ …) inside a rendered mathfield, or null. */
function relationX(mf: MathfieldElement): number | null {
  const box = mf.getBoundingClientRect();
  if (!box.width) return null;
  // MathLive caches atom positions until it redraws; clear them (see workrow.ts).
  (mf as unknown as { _mathfield?: { atomBoundsCache?: Map<unknown, unknown> } })._mathfield?.atomBoundsCache?.clear?.();
  for (let o = 1; o <= mf.lastOffset; o++) {
    const info = mf.getElementInfo(o);
    if (info?.depth === 0 && info.bounds && RELATIONS.has((info.latex ?? '').trim())) {
      return info.bounds.left - box.left;
    }
  }
  return null;
}

function field(value: string, readOnly: boolean, cls: string, placeholder: string): MathfieldElement {
  const mf = new MathfieldElement();
  mf.className = cls;
  mf.value = value;
  mf.readOnly = readOnly;
  mf.setAttribute('placeholder', placeholder);
  mf.setAttribute('math-virtual-keyboard-policy', 'manual');
  return mf;
}

export function systemEditor(cell: SystemCell, ctx: SystemEditorContext) {
  const grid = h('div', { class: 'system-grid' });
  const resultRow = h('div', { class: 'system-result' });
  const box = h('div', { class: 'step-box system-box' }, grid, h('div', { class: 'system-rule' }), resultRow);

  // Every editable field in reading order, so ↑/↓ and Enter can move between them.
  let equations: { mf: MathfieldElement; focus: (w: Where) => void }[] = [];
  let notes: { mf: MathfieldElement; focus: (w: Where) => void }[] = [];
  const result = field(cell.result, ctx.readOnly, 'system-eq system-result-eq', '\\text{combined equation}');
  const focusResult = focusable(result);
  result.addEventListener('input', () => {
    cell.result = result.value;
    align();
    ctx.onChange();
  });
  resultRow.append(h('span', { class: 'system-note-spacer' }), h('span', { class: 'system-sign' }), result);

  const signBtn = h('button', { class: 'system-sign toggle', title: 'Add or subtract this row (click to switch)', disabled: ctx.readOnly });
  const showSign = () => (signBtn.textContent = cell.combine === '-' ? '−' : '+');
  signBtn.addEventListener('click', () => {
    cell.combine = cell.combine === '-' ? '+' : '-';
    showSign();
    ctx.onChange();
  });
  showSign();

  /** Line the = signs up: shift each equation (and the result) so its = is at the same x. */
  let frame = 0;
  const align = () => {
    cancelAnimationFrame(frame);
    // Two frames: MathLive draws the latest keystroke in the next frame; measure after that.
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(alignNow)));
  };
  const alignNow = () => {
    const fields = [...equations.map((e) => e.mf), result];
    for (const mf of fields) mf.style.marginLeft = '0px';
    const xs = fields.map(relationX);
    const target = Math.max(0, ...xs.filter((x): x is number => x !== null));
    fields.forEach((mf, i) => {
      const x = xs[i];
      mf.style.marginLeft = x === null ? '0px' : `${target - x}px`;
    });
  };

  const moveTo = (index: number, where: Where) => {
    // 0..rows-1 are equations, rows is the result.
    if (index < 0) return ctx.leave(-1);
    if (index > cell.rows.length) return ctx.leave(1);
    if (index === cell.rows.length) focusResult(where);
    else equations[index].focus(where);
    return true;
  };

  /** `at` gives the field's position when the key is pressed (the result moves down as rows are added). */
  const keys = (mf: MathfieldElement, at: () => number, isNote: boolean) =>
    mf.addEventListener('keydown', (e) => {
      const index = at();
      if (ctx.cellKeys(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain && (mf.getElementInfo(mf.position)?.depth ?? 0) === 0) {
        stop();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        setTimeout(() => moveTo(index + dir, dir < 0 ? 'end' : 'start'));
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && mf.mode !== 'latex' && !ctx.readOnly) {
        stop();
        if (index === cell.rows.length) ctx.next();
        else setTimeout(() => moveTo(index + 1, 'start'));
      } else if (e.key === 'Backspace' && !mf.value && plain && !ctx.readOnly) {
        stop();
        if (isNote) equations[index].focus('start');
        else if (index < cell.rows.length && cell.rows.length > 2) {
          // Remove an empty row (keep at least two equations).
          cell.rows.splice(index, 1);
          build();
          ctx.onChange();
          setTimeout(() => moveTo(Math.max(0, index - 1), 'end'));
        } else setTimeout(() => moveTo(index - 1, 'end'));
      }
    }, true);

  /** ← at the start of an equation goes into its note; → at the end of a note goes back. */
  const noteNav = (eq: MathfieldElement, note: MathfieldElement) => {
    eq.addEventListener('move-out', (e) => {
      if (e.detail.direction === 'backward') {
        e.preventDefault();
        setTimeout(() => notes[equations.findIndex((x) => x.mf === eq)]?.focus('end'));
      }
    });
    note.addEventListener('move-out', (e) => {
      if (e.detail.direction === 'forward') {
        e.preventDefault();
        setTimeout(() => equations[notes.findIndex((x) => x.mf === note)]?.focus('start'));
      }
    });
  };

  const build = () => {
    equations = [];
    notes = [];
    grid.replaceChildren();
    cell.rows.forEach((row, i) => {
      const note = field(row.note ?? '', ctx.readOnly, 'system-note', '');
      const eq = field(row.latex, ctx.readOnly, 'system-eq', i === 0 ? '\\text{first equation}' : '\\text{next equation}');
      note.addEventListener('input', () => {
        if (note.value.trim()) row.note = note.value;
        else delete row.note;
        ctx.onChange();
      });
      eq.addEventListener('input', () => {
        row.latex = eq.value;
        align();
        ctx.onChange();
      });
      keys(eq, () => i, false);
      keys(note, () => i, true);
      noteNav(eq, note);
      equations.push({ mf: eq, focus: focusable(eq, align) });
      notes.push({ mf: note, focus: focusable(note) });
      const last = i === cell.rows.length - 1;
      grid.append(h('div', { class: 'system-row' }, note, last ? signBtn : h('span', { class: 'system-sign' }), eq));
    });
    if (!ctx.readOnly) {
      grid.append(h('div', { class: 'system-row add' },
        h('span', { class: 'system-note-spacer' }), h('span', { class: 'system-sign' }),
        h('button', {
          class: 'link small', title: 'Add another equation (for three-variable systems)',
          onclick: () => {
            cell.rows.push({ latex: '' });
            build();
            ctx.onChange();
            setTimeout(() => moveTo(cell.rows.length - 1, 'start'));
          },
        }, '+ equation')));
    }
    align();
  };
  keys(result, () => cell.rows.length, false);
  build();
  new ResizeObserver(() => align()).observe(box);
  void document.fonts?.ready.then(align);

  return {
    el: box,
    focus: (where: 'start' | 'end') => {
      if (where === 'start') equations[0]?.focus('start');
      else if (cell.result || !cell.rows.some((r) => r.latex)) focusResult('end');
      else equations[cell.rows.length - 1].focus('end');
    },
  };
}
