// "Work" written directly under a step, aligned with its terms:
//
//     y + 5 = x + 3
//       − 5     − 5
//
// The step stays one ordinary editable mathfield. We measure where each top-level term is
// drawn and place a small mathfield under each one.

import { MathfieldElement } from 'mathlive';
import type { MathCell } from '../model';
import { h } from '../ui';
import { focusable, type Where } from './mathfield';

/** A term of the step, by caret offsets and on-screen position relative to the step's left edge. */
export interface Column {
  first: number;
  last: number;
  left: number;
  right: number;
}

export interface Atom {
  latex: string;
  left: number;
  right: number;
}

const RELATIONS = new Set(['=', '<', '>', '\\le', '\\ge', '\\leq', '\\geq', '\\ne', '\\neq', '\\approx', '\\lt', '\\gt']);
/** After these, a + or − is a sign (as in 3·−2), not the start of a new term. */
const BINARY = new Set(['+', '-', '\\pm', '\\mp', '\\cdot', '\\times', '\\div', '/', '*']);

/**
 * Group the atoms of a step into terms: "y+5=x+3" → y | +5 | x | +3.
 * `atoms[k]` is the atom at caret offset k + 1, or null when it is nested inside a
 * fraction, exponent, etc. (it then belongs to the term around it).
 */
export function groupTerms(atoms: (Atom | null)[]): Column[] {
  const cols: Column[] = [];
  let cur: Column | null = null;
  let prev: string | null = null;
  atoms.forEach((a, k) => {
    const o = k + 1;
    if (!a) {
      if (cur) cur.last = o;
      return;
    }
    if (RELATIONS.has(a.latex)) {
      cur = null;
      prev = a.latex;
      return;
    }
    const sign = a.latex === '+' || a.latex === '-' || a.latex === '\\pm';
    const startsTerm = sign && prev !== null && !RELATIONS.has(prev) && !BINARY.has(prev);
    if (!cur || startsTerm) {
      cur = { first: o, last: o, left: a.left, right: a.right };
      cols.push(cur);
    } else {
      cur.last = o;
      cur.left = Math.min(cur.left, a.left);
      cur.right = Math.max(cur.right, a.right);
    }
    prev = a.latex;
  });
  return cols;
}

/** Measure a rendered step and split it into terms. */
export function measureColumns(mf: MathfieldElement): Column[] {
  const box = mf.getBoundingClientRect();
  if (box.width === 0) return [];
  // MathLive caches atom positions (in page coordinates) until it next redraws, so after the
  // page layout shifts (e.g. the graph panel opens) they are stale. Clear that cache first.
  // This reaches into MathLive internals (checked against 0.111); if they change, we just
  // measure from the cache as before.
  (mf as unknown as { _mathfield?: { atomBoundsCache?: Map<unknown, unknown> } })._mathfield?.atomBoundsCache?.clear?.();
  const atoms: (Atom | null)[] = [];
  for (let o = 1; o <= mf.lastOffset; o++) {
    const info = mf.getElementInfo(o);
    atoms.push(
      info && info.depth === 0 && info.bounds
        ? { latex: (info.latex ?? '').trim(), left: info.bounds.left - box.left, right: info.bounds.right - box.left }
        : null,
    );
  }
  return groupTerms(atoms);
}

/** The term the caret is in (caret offset p sits after atom p). */
export function columnAt(cols: Column[], position: number): number {
  let idx = 0;
  cols.forEach((c, i) => {
    if (position >= c.first - 1) idx = i;
  });
  return idx;
}

interface WorkRowOptions {
  readOnly: boolean;
  onChange: () => void;
  /** Leave the row: back to the step (at a caret offset), or on to the next step. */
  toStep: (position: number) => void;
  toNextStep: () => void;
  /** Enter in the row behaves like Enter in the step. */
  onEnter: () => void;
  /** Shared cell shortcuts (comments, moving cells…). Return true if handled. */
  cellKeys: (e: KeyboardEvent) => boolean;
}

interface Slot {
  mf: MathfieldElement;
  focus: (where: Where) => void;
}

export class WorkRow {
  el = h('div', { class: 'work-row', hidden: true });
  private slots: Slot[] = [];
  private cols: Column[] = [];
  private active = false;
  private frame = 0;

  constructor(private step: MathfieldElement, private cell: MathCell, private opts: WorkRowOptions) {
    this.el.addEventListener('focusin', () => (this.active = true));
    this.el.addEventListener('focusout', () => {
      // Wait for focus to land: moving between boxes shouldn't hide the row.
      setTimeout(() => {
        this.active = this.el.contains(document.activeElement);
        this.scheduleLayout();
      });
    });
    new ResizeObserver(() => this.scheduleLayout()).observe(step);
    void document.fonts?.ready.then(() => this.scheduleLayout());
  }

  private hasWork(): boolean {
    return !!this.cell.work?.some((w) => w.trim());
  }

  /** Re-measure the step and line the boxes up under its terms (or hide an empty row). */
  scheduleLayout(): void {
    cancelAnimationFrame(this.frame);
    if (!this.hasWork() && !this.active) {
      this.el.hidden = true;
      return;
    }
    this.frame = requestAnimationFrame(() => this.layout());
  }

  private layout(): void {
    this.el.hidden = false;
    this.cols = measureColumns(this.step);
    const n = this.slotCount();
    while (this.slots.length < n) this.slots.push(this.makeSlot(this.slots.length));
    const lastCol = this.cols[this.cols.length - 1];
    this.slots.forEach((slot, i) => {
      const col = this.cols[i];
      // Work for terms that no longer exist (the step was shortened) trails off to the right.
      const center = col ? (col.left + col.right) / 2 : (lastCol?.right ?? 0) + 36 * (i - this.cols.length + 1);
      slot.mf.style.left = `${center}px`;
      slot.mf.style.minWidth = `${col ? Math.max(col.right - col.left, 22) : 28}px`;
      slot.mf.classList.toggle('orphan', !col);
      slot.mf.hidden = i >= n;
    });
  }

  private slotCount(): number {
    return Math.max(this.cols.length, this.cell.work?.length ?? 0);
  }

  private makeSlot(i: number): Slot {
    const mf = new MathfieldElement();
    mf.className = 'work-slot';
    mf.value = this.cell.work?.[i] ?? '';
    mf.readOnly = this.opts.readOnly;
    mf.setAttribute('math-virtual-keyboard-policy', 'manual');
    mf.addEventListener('input', () => this.store(i, mf.value));
    mf.addEventListener('move-out', (e) => {
      const d = e.detail.direction;
      e.preventDefault();
      if (d === 'upward') setTimeout(() => this.backToStep(i));
      else if (d === 'downward') setTimeout(() => this.opts.toNextStep());
      else {
        const target = d === 'forward' ? i + 1 : i - 1;
        if (target >= 0 && target < this.slotCount()) setTimeout(() => this.slots[target].focus(d === 'forward' ? 'start' : 'end'));
      }
    });
    mf.addEventListener('keydown', (e) => {
      if (this.opts.cellKeys(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const noMods = !e.metaKey && !e.ctrlKey && !e.altKey;
      let handled = true;
      if (e.key === 'Escape' || (e.key === 'ArrowUp' && e.shiftKey && noMods)) this.backToStep(i);
      else if (e.key === 'Enter' && noMods && mf.mode !== 'latex') {
        this.store(i, mf.value);
        this.opts.onEnter();
      } else if (e.key === 'Backspace' && !mf.value && noMods) {
        if (i > 0) this.slots[i - 1].focus('end');
        else this.backToStep(i);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    const focus = focusable(mf);
    this.el.append(mf);
    return { mf, focus };
  }

  private store(i: number, value: string): void {
    const work = (this.cell.work ??= []);
    while (work.length <= i) work.push('');
    work[i] = value;
    while (work.length && !work[work.length - 1].trim()) work.pop();
    if (!work.length) delete this.cell.work;
    this.opts.onChange();
  }

  private backToStep(i: number): void {
    const col = this.cols[i] ?? this.cols[this.cols.length - 1];
    this.opts.toStep(col ? col.last : this.step.lastOffset);
  }

  /** Open the row with the caret in the box under the term at the step's caret. */
  openAt(stepPosition: number): void {
    this.active = true;
    this.layout();
    if (!this.cols.length) {
      this.active = false;
      this.el.hidden = true;
      return;
    }
    this.slots[columnAt(this.cols, stepPosition)]?.focus('end');
  }
}
