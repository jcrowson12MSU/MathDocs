// The operation written under a step, once under each side of the = and kept identical:
//
//     y + 5 = x + 3
//      −5      −5
//
// The step stays one ordinary editable mathfield. We measure where each top-level term is drawn,
// and place the two linked copies centered under a term on each side. Copies can be dragged
// along their side and snap to the nearest term.

import { MathfieldElement } from 'mathlive';
import type { MathCell } from '../model';
import { h } from '../ui';
import { focusable } from './mathfield';

/** A term of the step: caret offsets, position relative to the step's left edge, and side (0 = left of the =). */
export interface Column {
  first: number;
  last: number;
  left: number;
  right: number;
  side: number;
}

export interface Atom {
  latex: string;
  left: number;
  right: number;
}

const RELATIONS = new Set(['=', '<', '>', '\\le', '\\ge', '\\leq', '\\geq', '\\ne', '\\neq', '\\approx', '\\lt', '\\gt']);
/** After these, a + or − is a sign (as in 3·−2), not the start of a new term. */
const BINARY = new Set(['+', '-', '\\pm', '\\mp', '\\cdot', '\\times', '\\div', '/', '*']);

/** Does the step have a top-level =, <, >, ≤, ≥, ≠ or ≈ (so it has two sides)? */
export function hasRelation(latex: string): boolean {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && (ch === '=' || ch === '<' || ch === '>')) return true;
    else if (ch === '\\') {
      const name = /^\\[a-zA-Z]+/.exec(latex.slice(i))?.[0] ?? '';
      if (depth === 0 && RELATIONS.has(name)) return true;
      i += Math.max(name.length - 1, 0);
    }
  }
  return false;
}

/**
 * Group the atoms of a step into terms: "y+5=x+3" → y | +5 ‖ x | +3.
 * `atoms[k]` is the atom at caret offset k + 1, or null when it is nested inside a
 * fraction, exponent, etc. (it then belongs to the term around it).
 */
export function groupTerms(atoms: (Atom | null)[]): Column[] {
  const cols: Column[] = [];
  let cur: Column | null = null;
  let prev: string | null = null;
  let side = 0;
  atoms.forEach((a, k) => {
    const o = k + 1;
    if (!a) {
      if (cur) cur.last = o;
      return;
    }
    if (RELATIONS.has(a.latex)) {
      cur = null;
      prev = a.latex;
      side++;
      return;
    }
    const sign = a.latex === '+' || a.latex === '-' || a.latex === '\\pm';
    const startsTerm = sign && prev !== null && !RELATIONS.has(prev) && !BINARY.has(prev);
    if (!cur || startsTerm) {
      cur = { first: o, last: o, left: a.left, right: a.right, side };
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

/** Caret offset at the end of the left side of the = (where "−5" usually goes). */
export function leftSideEnd(mf: MathfieldElement): number {
  const left = measureColumns(mf).filter((c) => c.side === 0);
  return left.length ? left[left.length - 1].last : mf.lastOffset;
}

/** Index of the column on `side` whose center is nearest to x. */
export function nearestColumn(cols: Column[], side: 'left' | 'right', x: number): number {
  let best = -1;
  let dist = Infinity;
  cols.forEach((c, i) => {
    if ((side === 'left') !== (c.side === 0)) return;
    const d = Math.abs((c.left + c.right) / 2 - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
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

type Side = 'left' | 'right';

interface Copy {
  side: Side;
  mf: MathfieldElement;
  focus: (where: 'start' | 'end') => void;
}

export class WorkRow {
  el = h('div', { class: 'work-row', hidden: true });
  private cols: Column[] = [];
  private copies: Copy[];
  private active = false;
  private dragging: Side | null = null;
  private frame = 0;
  /** Chosen term for each copy; saved into cell.operation whenever there is an operation. */
  private anchors: Record<Side, number | undefined>;

  constructor(private step: MathfieldElement, private cell: MathCell, private opts: WorkRowOptions) {
    this.anchors = { left: cell.operation?.left, right: cell.operation?.right };
    this.copies = (['left', 'right'] as const).map((side) => this.makeCopy(side));
    this.el.addEventListener('focusin', () => (this.active = true));
    this.el.addEventListener('focusout', () => {
      // Wait for focus to land: moving between the copies shouldn't hide the row.
      setTimeout(() => {
        this.active = this.el.contains(document.activeElement);
        this.scheduleLayout();
      });
    });
    if (!opts.readOnly) this.el.addEventListener('pointerdown', (e) => this.startDrag(e), true);
    new ResizeObserver(() => this.scheduleLayout()).observe(step);
    void document.fonts?.ready.then(() => this.scheduleLayout());
  }

  private get value(): string {
    return this.cell.operation?.latex ?? '';
  }

  /** Re-measure the step and center the copies under their terms (or hide an empty row). */
  scheduleLayout(): void {
    cancelAnimationFrame(this.frame);
    if (!hasRelation(this.step.value) || (!this.value.trim() && !this.active)) {
      this.el.hidden = true;
      return;
    }
    this.frame = requestAnimationFrame(() => this.layout());
  }

  /** The term each copy sits under: the chosen one if it's still on that side, else the last term there. */
  private anchor(side: Side): number {
    const saved = this.anchors[side];
    const onSide = (i: number) => this.cols[i] && (side === 'left') === (this.cols[i].side === 0);
    if (saved !== undefined && onSide(saved)) return saved;
    let last = -1;
    this.cols.forEach((_, i) => {
      if (onSide(i)) last = i;
    });
    return last;
  }

  private layout(): void {
    this.cols = measureColumns(this.step);
    const twoSides = this.cols.some((c) => c.side === 0) && this.cols.some((c) => c.side > 0);
    this.el.hidden = !twoSides || (!this.value.trim() && !this.active);
    if (this.el.hidden) return;
    for (const copy of this.copies) {
      if (copy.side === this.dragging) continue;
      const col = this.cols[this.anchor(copy.side)];
      if (col) copy.mf.style.left = `${(col.left + col.right) / 2}px`;
    }
  }

  private makeCopy(side: Side): Copy {
    const mf = new MathfieldElement();
    mf.className = `work-copy ${side}`;
    mf.value = this.value;
    mf.readOnly = this.opts.readOnly;
    mf.setAttribute('math-virtual-keyboard-policy', 'manual');
    mf.setAttribute('placeholder', '\\square');
    mf.addEventListener('input', () => this.store(mf.value, side));
    mf.addEventListener('move-out', (e) => {
      const d = e.detail.direction;
      e.preventDefault();
      if (d === 'upward') setTimeout(() => this.backToStep(side));
      else if (d === 'downward') setTimeout(() => this.opts.toNextStep());
      // The copies hold the same text, so switching keeps the caret where it was.
      else if (d === 'forward' && side === 'left') setTimeout(() => this.copy('right').focus('end'));
      else if (d === 'backward' && side === 'right') setTimeout(() => this.copy('left').focus('start'));
    });
    mf.addEventListener('keydown', (e) => {
      if (this.opts.cellKeys(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const noMods = !e.metaKey && !e.ctrlKey && !e.altKey;
      let handled = true;
      if (e.key === 'Escape' || (e.key === 'ArrowUp' && e.shiftKey && noMods)) this.backToStep(side);
      else if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Option+←/→ moves this copy to the next term over (the keyboard version of dragging).
        this.shift(side, e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Enter' && noMods && mf.mode !== 'latex') {
        this.store(mf.value, side);
        this.opts.onEnter();
      } else if (e.key === 'Backspace' && !mf.value && noMods) this.backToStep(side);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    this.el.append(mf);
    return { side, mf, focus: focusable(mf) };
  }

  private copy(side: Side): Copy {
    return this.copies.find((c) => c.side === side)!;
  }

  /** Both copies always show the same operation. */
  private store(value: string, from: Side): void {
    const other = this.copy(from === 'left' ? 'right' : 'left');
    if (other.mf.value !== value) other.mf.value = value;
    if (value.trim()) this.cell.operation = { latex: value, left: this.anchors.left, right: this.anchors.right };
    else delete this.cell.operation;
    this.opts.onChange();
    // A copy may have grown wider; recentre.
    this.scheduleLayout();
  }

  private setAnchor(side: Side, index: number): void {
    if (index < 0) return;
    this.anchors[side] = index;
    if (this.cell.operation) {
      this.cell.operation[side] = index;
      this.opts.onChange();
    }
  }

  private shift(side: Side, delta: -1 | 1): void {
    const sideCols = this.cols.map((c, i) => [c, i] as const).filter(([c]) => (side === 'left') === (c.side === 0));
    const at = sideCols.findIndex(([, i]) => i === this.anchor(side));
    const next = sideCols[at + delta];
    if (!next) return;
    this.setAnchor(side, next[1]);
    this.layout();
  }

  /** Drag a copy along its side of the =; on release it snaps under the nearest term. A click just edits it. */
  private startDrag(e: PointerEvent): void {
    const copy = this.copies.find((c) => c.mf === e.target || c.mf.contains(e.target as Node));
    if (!copy || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startLeft = parseFloat(copy.mf.style.left) || 0;
    let moved = false;
    copy.mf.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      this.dragging = copy.side;
      copy.mf.classList.add('dragging');
      copy.mf.style.left = `${startLeft + dx}px`;
    };
    const up = (ev: PointerEvent) => {
      copy.mf.removeEventListener('pointermove', move);
      copy.mf.removeEventListener('pointerup', up);
      copy.mf.removeEventListener('pointercancel', up);
      copy.mf.releasePointerCapture(ev.pointerId);
      copy.mf.classList.remove('dragging');
      this.dragging = null;
      if (!moved) {
        copy.focus('end');
        return;
      }
      this.cols = measureColumns(this.step);
      this.setAnchor(copy.side, nearestColumn(this.cols, copy.side, startLeft + (ev.clientX - startX)));
      this.layout();
    };
    copy.mf.addEventListener('pointermove', move);
    copy.mf.addEventListener('pointerup', up);
    copy.mf.addEventListener('pointercancel', up);
  }

  private backToStep(side: Side): void {
    const col = this.cols[this.anchor(side)];
    this.opts.toStep(col ? col.last : this.step.lastOffset);
  }

  /** Open the row: the copy on the caret's side moves under the caret's term and gets the caret. */
  openAt(stepPosition: number): void {
    if (!hasRelation(this.step.value)) return;
    this.active = true;
    this.el.hidden = false;
    this.cols = measureColumns(this.step);
    if (!this.cols.length) return;
    const i = columnAt(this.cols, stepPosition);
    const side: Side = this.cols[i].side === 0 ? 'left' : 'right';
    this.setAnchor(side, i);
    this.layout();
    this.copy(side).focus('end');
  }
}
