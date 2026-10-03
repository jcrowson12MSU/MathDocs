// Keyboard movement for cells made of several boxes (area models, synthetic division, matrices, proofs):
// ↑/↓ go to the nearest box in the row above/below, ←/→ past the edge of a box go to the previous/next box,
// Enter goes to the next box (and from the last one on to the next step).

import { MathfieldElement } from 'mathlive';
import { focusable, type Where } from './mathfield';

export interface GridContext {
  readOnly: boolean;
  /** Shared cell shortcuts (comments, moving cells…). Return true if handled. */
  cellKeys: (e: KeyboardEvent) => boolean;
  /** Leave the cell upward / downward. Returns false if there's nowhere to go. */
  leave: (dir: -1 | 1) => boolean;
  /** Enter in the last box. */
  next: () => void;
}

export interface GridField {
  el: MathfieldElement | HTMLInputElement;
  focus: (where: Where) => void;
}

/** A math box for a grid cell. */
export function gridMath(value: string, readOnly: boolean, cls: string, placeholder = ''): GridField & { el: MathfieldElement } {
  const mf = new MathfieldElement();
  mf.className = cls;
  mf.value = value;
  mf.readOnly = readOnly;
  if (placeholder) mf.setAttribute('placeholder', placeholder);
  mf.setAttribute('math-virtual-keyboard-policy', 'manual');
  // Empty boxes get a faint outline so there's somewhere to click.
  const sync = () => mf.classList.toggle('is-empty', !mf.value);
  sync();
  mf.addEventListener('input', sync);
  return { el: mf, focus: focusable(mf) };
}

/** A plain-text box for a grid cell (proof reasons). */
export function gridText(value: string, readOnly: boolean, cls: string, placeholder = ''): GridField & { el: HTMLInputElement } {
  const input = document.createElement('input');
  input.className = cls;
  input.value = value;
  input.disabled = readOnly;
  input.placeholder = placeholder;
  return {
    el: input,
    focus: (where) => {
      input.focus();
      const pos = where === 'start' ? 0 : where === 'end' ? input.value.length : where;
      input.setSelectionRange(pos, pos);
    },
  };
}

export interface GridOptions {
  /** Enter in a box: return true if handled here (e.g. making the next matrix); otherwise it moves on. */
  onEnter?: (field: GridField, e: KeyboardEvent) => boolean;
  /** Enter in the last box of a row: return true to add a row (the grid is rebuilt by the caller). */
  addRow?: (rowIndex: number) => boolean;
  /** Backspace in an empty box: return true if handled (e.g. removing an empty row). */
  onEmptyBackspace?: (rowIndex: number, colIndex: number) => boolean;
}

/**
 * Wire up keyboard movement for `rows()` (boxes in reading order, row by row). Call `attach` on each box
 * once when it's created; `rows` is read at key time so it can change as rows are added.
 */
export function gridNavigator(rows: () => GridField[][], ctx: GridContext, opts: GridOptions = {}) {
  const locate = (f: GridField): [number, number] => {
    const all = rows();
    for (let r = 0; r < all.length; r++) {
      const c = all[r].indexOf(f);
      if (c >= 0) return [r, c];
    }
    return [-1, -1];
  };
  const flat = () => rows().flat();

  const moveBy = (f: GridField, step: -1 | 1) => {
    const list = flat();
    const i = list.indexOf(f) + step;
    if (i < 0) return ctx.leave(-1);
    if (i >= list.length) return ctx.leave(1);
    list[i].focus(step < 0 ? 'end' : 'start');
    return true;
  };

  const moveVertical = (f: GridField, dir: -1 | 1) => {
    const all = rows();
    const [r] = locate(f);
    const target = all[r + dir];
    if (!target?.length) return ctx.leave(dir);
    // The box in that row closest to this one horizontally.
    const x = (b: GridField) => {
      const box = b.el.getBoundingClientRect();
      return box.left + box.width / 2;
    };
    const here = x(f);
    let best = target[0];
    for (const b of target) if (Math.abs(x(b) - here) < Math.abs(x(best) - here)) best = b;
    best.focus(dir < 0 ? 'end' : 'start');
    return true;
  };

  const attach = (f: GridField) => {
    const el = f.el;
    const isMath = el instanceof MathfieldElement;
    el.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const stop = () => {
        ke.preventDefault();
        ke.stopPropagation();
      };
      if (ctx.cellKeys(ke)) return stop();
      const plain = !ke.metaKey && !ke.ctrlKey && !ke.altKey && !ke.shiftKey;
      const atTop = isMath ? ((el as MathfieldElement).getElementInfo((el as MathfieldElement).position)?.depth ?? 0) === 0 : true;
      if ((ke.key === 'ArrowUp' || ke.key === 'ArrowDown') && plain && atTop) {
        stop();
        setTimeout(() => moveVertical(f, ke.key === 'ArrowUp' ? -1 : 1));
      } else if (!isMath && (ke.key === 'ArrowLeft' || ke.key === 'ArrowRight') && plain) {
        const input = el as HTMLInputElement;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === input.value.length;
        if (ke.key === 'ArrowLeft' && atStart) {
          stop();
          moveBy(f, -1);
        } else if (ke.key === 'ArrowRight' && atEnd) {
          stop();
          moveBy(f, 1);
        }
      } else if (ke.key === 'Enter' && !ke.metaKey && !ke.ctrlKey && !ke.altKey && !(isMath && (el as MathfieldElement).mode === 'latex')) {
        stop();
        if (opts.onEnter?.(f, ke)) return;
        const all = rows();
        const [r, c] = locate(f);
        const lastInRow = c === all[r].length - 1;
        if (lastInRow && !ctx.readOnly && opts.addRow?.(r)) {
          setTimeout(() => rows()[r + 1]?.[0]?.focus('start'));
          return;
        }
        const list = flat();
        if (list.indexOf(f) === list.length - 1) ctx.next();
        else setTimeout(() => moveBy(f, 1));
      } else if (ke.key === 'Backspace' && plain && !ctx.readOnly && !(isMath ? (el as MathfieldElement).value : (el as HTMLInputElement).value)) {
        const [r, c] = locate(f);
        if (opts.onEmptyBackspace?.(r, c)) return stop();
        if (c > 0 || isMath) {
          stop();
          setTimeout(() => moveBy(f, -1));
        }
      }
    }, true);
    if (isMath) {
      el.addEventListener('move-out', (e: Event) => {
        const dir = (e as CustomEvent<{ direction: string }>).detail.direction;
        if (dir !== 'forward' && dir !== 'backward') return;
        e.preventDefault();
        setTimeout(() => moveBy(f, dir === 'forward' ? 1 : -1));
      });
    }
  };

  return {
    attach,
    focus: (where: 'start' | 'end') => {
      const list = flat();
      (where === 'start' ? list[0] : list[list.length - 1])?.focus(where);
    },
  };
}
