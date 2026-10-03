// A matrix (augmented by default) with a note beside each row for its row operation (R_2 − 3R_1, R_1 ↔ R_2,
// ½R_1). Enter in a note makes the next matrix below with those operations applied, as gray suggestions —
// the student chooses the operations; the app only does the arithmetic. In practice mode it's a plain copy.

import type { MatrixCell } from '../model';
import { applyRowOps, parseRowOp } from '../rowops';
import { h } from '../ui';
import { gridMath, gridNavigator, type GridContext, type GridField } from './gridnav';

export interface MatrixContext extends GridContext {
  onChange: () => void;
  practice: () => boolean;
  /** Add the next matrix below; rows given as suggestions start empty and show them in gray. */
  continueBelow: (rows: string[][], suggestions: (string[] | undefined)[], augmented: boolean) => void;
}

const pending = new WeakMap<MatrixCell, (string[] | undefined)[]>();

export function setMatrixSuggestions(cell: MatrixCell, suggestions: (string[] | undefined)[]): void {
  pending.set(cell, suggestions);
}

/** The next matrix: rows and gray suggestions, or null if there's nothing to carry on with. */
export function nextMatrix(cell: MatrixCell, practice: boolean): { rows: string[][]; suggestions: (string[] | undefined)[] } | null {
  if (practice) {
    if (!cell.rows.some((r) => r.some((v) => v.trim()))) return null;
    return { rows: cell.rows.map((r) => r.map(() => '')), suggestions: cell.rows.map((r) => [...r]) };
  }
  const applied = applyRowOps(cell.rows, cell.notes);
  if (!applied) return null;
  return {
    rows: applied.rows.map((r, i) => (applied.changed[i] ? r.map(() => '') : r)),
    suggestions: applied.rows.map((r, i) => (applied.changed[i] ? r : undefined)),
  };
}

export function matrixEditor(cell: MatrixCell, ctx: MatrixContext) {
  const box = h('div', { class: 'step-box matrix-box' });
  const suggestions = [...(pending.get(cell) ?? [])];
  pending.delete(cell);
  let nav: GridField[][] = [];
  let entries: GridField[][] = [];

  const continueMatrix = (): boolean => {
    const next = nextMatrix(cell, ctx.practice());
    if (!next) return false;
    ctx.continueBelow(next.rows, next.suggestions, cell.augmented);
    return true;
  };

  const navigator = gridNavigator(() => nav, ctx, {
    onEnter: (f) => {
      // Enter in a row-operation note carries on to the next matrix.
      const i = nav.findIndex((row) => row[row.length - 1] === f && f.el.classList.contains('matrix-note'));
      if (i < 0 || !parseRowOp(cell.notes[i] ?? '', i, cell.rows.length)) return false;
      return continueMatrix();
    },
  });

  const acceptRow = (r: number) => {
    const s = suggestions[r];
    if (!s) return false;
    cell.rows[r] = [...s];
    suggestions[r] = undefined;
    entries[r].forEach((f, c) => {
      (f.el as HTMLInputElement).value = s[c] ?? '';
      f.el.setAttribute('placeholder', '');
      f.el.classList.toggle('is-empty', !s[c]);
    });
    ctx.onChange();
    return true;
  };

  const build = () => {
    nav = [];
    entries = [];
    const cols = Math.max(1, ...cell.rows.map((r) => r.length));
    const grid = h('div', {
      class: `matrix-grid${cell.augmented ? ' augmented' : ''}`,
      style: `grid-template-columns: repeat(${cols}, auto)`,
    });
    const notesCol = h('div', { class: 'matrix-notes' });
    cell.rows.forEach((row, r) => {
      const line: GridField[] = [];
      for (let c = 0; c < cols; c++) {
        const s = !row.some((v) => v.trim()) ? suggestions[r]?.[c] : undefined;
        const f = gridMath(row[c] ?? '', ctx.readOnly, 'matrix-entry', s ?? '');
        f.el.addEventListener('input', () => {
          while (cell.rows[r].length <= c) cell.rows[r].push('');
          cell.rows[r][c] = (f.el as HTMLInputElement).value;
          ctx.onChange();
        });
        // → in an empty box of a suggested row accepts the whole row.
        f.el.addEventListener('keydown', (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'ArrowRight' && !ke.shiftKey && !ke.metaKey && !ke.altKey && !(f.el as HTMLInputElement).value && suggestions[r] && !ctx.readOnly) {
            ke.preventDefault();
            ke.stopPropagation();
            acceptRow(r);
          }
        }, true);
        navigator.attach(f);
        const last = c === cols - 1;
        grid.append(h('div', { class: `matrix-cell${cell.augmented && last ? ' after-bar' : ''}` }, f.el));
        line.push(f);
      }
      entries.push(line);
      const note = gridMath(cell.notes[r] ?? '', ctx.readOnly, 'matrix-note', '');
      note.el.addEventListener('input', () => {
        cell.notes[r] = note.el.value;
        ctx.onChange();
      });
      navigator.attach(note);
      notesCol.append(h('div', { class: 'matrix-note-row' }, note.el));
      nav.push([...line, note]);
    });
    const button = (label: string, title: string, run: () => void) =>
      ctx.readOnly ? null : h('button', { class: 'link small', title, onclick: () => (run(), build(), ctx.onChange()) }, label);
    box.replaceChildren(
      h('div', { class: 'matrix-wrap' }, h('div', { class: 'matrix-brackets' }, grid), notesCol),
      h('div', { class: 'layout-tools' },
        button('+ row', 'Add a row', () => {
          cell.rows.push(Array(cols).fill(''));
          cell.notes.push('');
        }),
        button('+ column', 'Add a column', () => cell.rows.forEach((r) => r.push(''))),
        cell.rows.length > 1 ? button('− row', 'Remove the last row', () => {
          cell.rows.pop();
          cell.notes.pop();
        }) : null,
        cols > 1 ? button('− column', 'Remove the last column', () => cell.rows.forEach((r) => r.pop())) : null,
        button(cell.augmented ? 'remove bar' : 'augmented bar', 'Show or hide the bar before the last column', () => (cell.augmented = !cell.augmented)),
        ctx.readOnly ? null : h('span', { class: 'muted small matrix-hint' }, 'Row notes: R_2−3R_1 · R_1<->R_2 to swap · ½R_1 (type 1/2 R_1)'),
      ),
    );
  };
  build();

  return {
    el: box,
    focus: (where: 'start' | 'end') => {
      const firstSuggested = suggestions.findIndex(Boolean);
      if (where === 'start' && firstSuggested >= 0) entries[firstSuggested]?.[0]?.focus('start');
      else navigator.focus(where);
    },
    continueMatrix,
  };
}
