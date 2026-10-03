// The notebook editor: a column of math steps and text cells, with graphs on the right.

import { MathfieldElement } from 'mathlive';
import { api } from '../api';
import { saveIncoming } from '../incoming';
import { renderMarkdown } from '../markdown';
import katex from 'katex';
import { applyOperation } from '../mathfn';
import {
  dividerCell, layoutCell, mathCell, matrixCell, meaningOf, newId, nowIso, proofCell, systemCell, textCell, variablesCell,
  type LayoutKind,
  type Cell, type DividerCell, type MathCell, type Notebook, type TextCell,
} from '../model';
import { loadSettings, saveSettings, shareBase } from '../settings';
import { shareLink } from '../share';
import { confirm, debounce, downloadJson, h, openMenu, prompt, relativeTime, showDialog, toast } from '../ui';
import { folderHash, folderOf } from '../routes';
import { GraphPanel } from './graphs';
import { focusable } from './mathfield';
import { WorkRow, hasRelation, leftSideEnd } from './workrow';
import { nextSystemRows, setSystemSuggestions, systemEditor } from './system';
import { variablesEditor } from './variables';
import { layoutEditor } from './layouts';
import { matrixEditor, nextMatrix, setMatrixSuggestions } from './matrix';
import { proofEditor } from './proof';
import { cleanLatex, substitute, valueStep } from '../substitute';
import { solutionSet } from '../inequality';
import { renderNumberLine } from './numberline';

export type Mode = { kind: 'file'; name: string } | { kind: 'scratch' } | { kind: 'shared' };

/**
 * Comment shortcut: ⌘/ or Ctrl+/, plus Option+/ (Alt+/) because Safari keeps ⌘/ for
 * its own "Show Status Bar" menu item. Matched by physical key, since Option+/ types ÷ on a Mac.
 */
function isCommentShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && (e.code === 'Slash' || e.key === '/');
}

/** Address of the locally running app, used by the hosted viewer's "open in my app" button. */
const LOCAL_APP = 'http://127.0.0.1:8642/';

interface CellView {
  cell: Cell;
  el: HTMLElement;
  focus(where: 'start' | 'end'): void;
  numberEl: HTMLElement;
  setCommentsOpen(open: boolean): void;
  /** Show the previous step in gray as a starting point (math cells only). */
  suggest?(latex: string): void;
}

interface CellEditor {
  el: HTMLElement;
  focus(where: 'start' | 'end'): void;
  suggest?(latex: string): void;
  /** Open the work row under a math step. */
  openWork?(): void;
  /** Show or hide the number line under a math step. */
  toggleNumberLine?(): void;
  /** In a system: make the next system with multiplied / distributed rows suggested. */
  continueSystem?(): boolean;
  /** In a matrix: make the next matrix with the noted row operations applied. */
  continueMatrix?(): boolean;
}

/** The layouts offered by "+ Layout" and the ⋯ menu. */
const LAYOUTS: { label: string; make: () => Cell }[] = [
  { label: '▦  Box (area model)', make: () => layoutCell('box' as LayoutKind) },
  { label: '✕  X (factoring diamond)', make: () => layoutCell('diamond' as LayoutKind) },
  { label: '⌐  Synthetic division', make: () => layoutCell('synthetic' as LayoutKind) },
  { label: '⟌  Long division', make: () => layoutCell('longdiv' as LayoutKind) },
  { label: '[ ]  Matrix (row operations)', make: () => matrixCell() },
  { label: '∴  Two-column proof', make: () => proofCell() },
];

export class NotebookView {
  el = h('div', { class: 'notebook-view' });
  private views = new Map<string, CellView>();
  private cellsEl = h('div', { class: 'cells' });
  private statusEl = h('span', { class: 'save-status' });
  private graphs: GraphPanel;
  private graphsOpen: boolean;
  /** The work column collapsed so the graphs use the whole width. */
  private workHidden = false;
  private mainEl = h('div', { class: 'nb-main' });
  private readOnly: boolean;
  private saving: Promise<void> = Promise.resolve();
  private failed = false;
  private save = debounce(() => this.saveNow(), 700);
  private lastMathfield: MathfieldElement | null = null;
  /** The cell you were last in, so the comment shortcut works even after clicking elsewhere. */
  private lastCellId: string | null = null;
  private onPageKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !isCommentShortcut(e)) return;
    if ((e.target as HTMLElement | null)?.closest?.('.cell, dialog, input, textarea')) return;
    const id = this.lastCellId ?? this.nb.cells[0]?.id;
    if (!id) return;
    e.preventDefault();
    this.views.get(id)?.setCommentsOpen(true);
  };
  private onUnload = () => {
    if (this.save.pending()) {
      this.save.flush();
    }
  };

  constructor(private nb: Notebook, private mode: Mode, private serverOk: boolean) {
    this.readOnly = mode.kind === 'shared';
    this.graphsOpen = nb.graphs.length > 0;
    this.graphs = new GraphPanel(nb, this.graphOptions());
    this.render();
    window.addEventListener('beforeunload', this.onUnload);
    window.addEventListener('keydown', this.onPageKey);
    window.addEventListener('pagehide', this.onUnload);
  }

  // -- layout ----------------------------------------------------------------

  private render(): void {
    this.mainEl.replaceChildren(h('div', { class: 'work' }, this.banner(), this.cellsEl), this.splitter(), this.graphs.el);
    const saved = loadSettings().graphsWidth;
    if (saved) this.mainEl.style.setProperty('--graphs-w', `${saved}px`);
    this.applyLayout();
    this.el.replaceChildren(this.header(), this.mainEl);
    this.cellsEl.replaceChildren();
    this.views.clear();
    this.nb.cells.forEach((c) => this.cellsEl.append(this.makeCell(c).el));
    this.renumber();
    this.applyCollapse();
    this.setStatus(this.mode.kind === 'shared' ? 'Shared copy — not saved' : 'Saved');
    requestAnimationFrame(() => {
      if (this.graphsOpen) this.graphs.refresh();
      if (!this.readOnly) {
        let last = this.nb.cells.length - 1;
        if (this.isHidden(last)) last = this.neighbor(last, -1);
        if (last >= 0) this.focusAt(last, 'end');
      }
    });
  }

  private header(): HTMLElement {
    const m = this.mode;
    const title =
      m.kind === 'file'
        ? h('input', { class: 'nb-title', value: this.nb.title, 'aria-label': 'Notebook title', onchange: (e: Event) => this.rename((e.target as HTMLInputElement).value) })
        : h('span', { class: 'nb-title static' }, m.kind === 'scratch' ? 'Scratch pad' : this.nb.title);

    const graphsBtn = h('button', { class: 'btn', title: 'Show or hide graphs' }, '📈 Graphs');
    const practiceBtn = h('button', { class: 'btn practice-btn', title: 'Practice mode: the app does no arithmetic and graphs don’t mark crossings' });
    practiceBtn.addEventListener('click', () => this.togglePractice(practiceBtn));
    queueMicrotask(() => this.showPractice(practiceBtn));
    graphsBtn.addEventListener('click', () => this.toggleGraphs());

    const buttons: (HTMLElement | null)[] = [
      this.readOnly ? null : h('button', { class: 'btn', title: 'Show the on-screen math keyboard', onclick: () => this.toggleKeyboard() }, '⌨︎ Keyboard'),
      graphsBtn,
      h('button', { class: 'btn', onclick: () => this.share() }, this.readOnly ? 'Share back' : 'Share'),
      h('button', { class: 'btn', title: 'Download as a .mathnb.json file', onclick: () => this.exportFile() }, 'Export'),
      h('button', { class: 'btn', title: 'Print, or save as PDF from the print dialog', onclick: () => this.print() }, '🖨 Print'),
      this.readOnly ? null : practiceBtn,
    ];
    if (m.kind === 'scratch') {
      buttons.unshift(
        h('button', { class: 'btn primary', onclick: () => this.saveScratchAs() }, 'Save as notebook…'),
        h('button', { class: 'btn', onclick: () => this.clearScratch() }, 'Clear'),
      );
    }
    if (m.kind === 'shared' && this.serverOk) {
      buttons.unshift(h('button', { class: 'btn primary', onclick: () => this.saveShared() }, 'Save to my journal'));
    }
    if (m.kind === 'shared' && !this.serverOk) {
      buttons.unshift(h('a', { class: 'btn', href: LOCAL_APP + location.hash, title: 'Opens this in the Math Notebook app on this computer, if it is running' }, 'Open in my app'));
    }

    // Back to the folder this notebook is in.
    const folder = m.kind === 'file' ? folderOf(m.name) : '';
    return h('header', { class: 'topbar' },
      h('a', { class: 'home-link', href: folderHash(folder), title: folder ? `Back to ${folder.split('/').join(' › ')}` : 'All notebooks' },
        folder ? `← ${folder.split('/').pop()}` : '← Notebooks'),
      title,
      this.statusEl,
      h('div', { class: 'spacer' }),
      ...buttons,
      h('button', { class: 'icon help', title: 'Keyboard shortcuts', onclick: () => showHelp() }, '?'),
    );
  }

  private banner(): HTMLElement | null {
    if (this.mode.kind !== 'shared') return null;
    return h('div', { class: 'banner' },
      'You’re viewing a shared notebook. The work is read-only, but you can add comments to any step and then use ',
      h('b', {}, 'Share back'), ' to send it back.');
  }

  private graphOptions() {
    return {
      readOnly: this.readOnly,
      onChange: () => this.changed(),
      practice: () => !!this.nb.practice,
      // Axis labels default to what x and y stand for in the notebook's "Let x = …" boxes.
      axisDefaults: () => ({ x: meaningOf(this.nb, 'x'), y: meaningOf(this.nb, 'y') }),
    };
  }

  /** Practice mode: no arithmetic from the app and no crossing markers, until it's turned off. */
  private togglePractice(btn: HTMLElement): void {
    this.nb.practice = this.nb.practice ? undefined : true;
    this.showPractice(btn);
    this.graphs.render();
    this.graphs.refresh();
    this.changed();
    toast(this.nb.practice
      ? 'Practice mode on: next steps start as a plain copy, and graphs don’t mark crossings.'
      : 'Practice mode off: suggestions and crossing markers are back.');
  }

  private showPractice(btn: HTMLElement): void {
    btn.classList.toggle('active', !!this.nb.practice);
    btn.textContent = this.nb.practice ? '🎓 Practice: on' : '🎓 Practice';
    this.el.classList.toggle('practice', !!this.nb.practice);
  }

  private toggleGraphs(): void {
    this.setLayout(!this.graphsOpen, false);
  }

  private setLayout(graphsOpen: boolean, workHidden: boolean): void {
    this.graphsOpen = graphsOpen;
    // The work can only be collapsed while the graphs are showing (something has to fill the page).
    this.workHidden = workHidden && graphsOpen;
    this.applyLayout();
    if (this.graphsOpen) requestAnimationFrame(() => this.graphs.refresh());
  }

  private applyLayout(): void {
    this.mainEl.classList.toggle('graphs-open', this.graphsOpen);
    this.mainEl.classList.toggle('work-hidden', this.workHidden);
  }

  /**
   * The bar between the work and the graphs: drag it to resize (double-click resets), and use its
   * buttons to collapse either side. A collapsed side leaves the bar with a button to bring it back.
   */
  private splitter(): HTMLElement {
    const btn = (cls: string, title: string, text: string, run: () => void) =>
      h('button', {
        class: `split-btn ${cls}`, title,
        onclick: (e: Event) => {
          e.stopPropagation();
          run();
        },
      }, text);
    const bar = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize · double-click to reset' },
      btn('hide-work', 'Collapse the work', '◀', () => this.setLayout(true, true)),
      btn('hide-graphs', 'Collapse the graphs', '▶', () => this.setLayout(false, false)),
      btn('show-graphs', 'Show graphs', '◀', () => this.setLayout(true, false)),
      btn('show-work', 'Show the work', '▶', () => this.setLayout(true, false)),
    );
    bar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.split-btn')) return;
      this.mainEl.style.removeProperty('--graphs-w');
      const s = loadSettings();
      delete s.graphsWidth;
      saveSettings(s);
    });
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.split-btn') || !this.graphsOpen || this.workHidden || e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      this.mainEl.classList.add('resizing');
      let width = 0;
      const move = (ev: PointerEvent) => {
        const box = this.mainEl.getBoundingClientRect();
        // Keep both sides usable: at least 300px of graphs and 360px of work.
        width = Math.round(Math.min(Math.max(box.right - ev.clientX, 300), box.width - 360));
        this.mainEl.style.setProperty('--graphs-w', `${width}px`);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        this.mainEl.classList.remove('resizing');
        if (width) saveSettings({ ...loadSettings(), graphsWidth: width });
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    return bar;
  }

  private toggleKeyboard(): void {
    const kb = window.mathVirtualKeyboard;
    if (kb.visible) kb.hide();
    else {
      this.lastMathfield?.focus();
      kb.show();
    }
  }

  // -- cells -------------------------------------------------------------------

  private index(id: string): number {
    return this.nb.cells.findIndex((c) => c.id === id);
  }

  private focusAt(i: number, where: 'start' | 'end'): boolean {
    const cell = this.nb.cells[i];
    if (!cell) return false;
    this.reveal(i);
    this.views.get(cell.id)?.focus(where);
    return true;
  }

  private isHidden(i: number): boolean {
    const c = this.nb.cells[i];
    return !!c && !!this.views.get(c.id)?.el.classList.contains('collapsed-away');
  }

  /** The nearest visible cell above (-1) or below (+1) cell i, or -1 if there is none. */
  private neighbor(i: number, dir: -1 | 1): number {
    let j = i + dir;
    while (j >= 0 && j < this.nb.cells.length && this.isHidden(j)) j += dir;
    return j >= 0 && j < this.nb.cells.length ? j : -1;
  }

  /** Expand the section containing cell i if it is collapsed. */
  private reveal(i: number): void {
    if (!this.isHidden(i)) return;
    for (let j = i - 1; j >= 0; j--) {
      const c = this.nb.cells[j];
      if (c.type === 'divider') {
        c.collapsed = false;
        this.applyCollapse();
        this.changed();
        return;
      }
    }
  }

  /** Hide the cells under each collapsed divider, down to the next divider. */
  private applyCollapse(): void {
    let hiding = false;
    let owner: { el: HTMLElement; count: number } | null = null;
    const finish = () => {
      if (owner) owner.el.querySelector('.hidden-count')!.textContent = owner.count ? `${owner.count} hidden` : '';
    };
    for (const cell of this.nb.cells) {
      const v = this.views.get(cell.id);
      if (!v) continue;
      if (cell.type === 'divider') {
        finish();
        hiding = !!cell.collapsed;
        owner = hiding ? { el: v.el, count: 0 } : null;
        v.el.classList.toggle('is-collapsed', hiding);
        if (!hiding) v.el.querySelector('.hidden-count')!.textContent = '';
        v.el.classList.remove('collapsed-away');
        continue;
      }
      v.el.classList.toggle('collapsed-away', hiding);
      if (owner) owner.count++;
    }
    finish();
  }

  private insertCell(at: number, cell: Cell, focus = true): void {
    this.nb.cells.splice(at, 0, cell);
    const view = this.makeCell(cell);
    const next = this.nb.cells[at + 1];
    const before = next ? this.views.get(next.id)?.el : null;
    this.cellsEl.insertBefore(view.el, before ?? null);
    this.renumber();
    this.applyCollapse();
    this.changed();
    if (focus) this.focusAt(at, 'start');
  }

  private deleteCell(id: string, focusPrev = true): void {
    const i = this.index(id);
    if (i < 0) return;
    const [cell] = this.nb.cells.splice(i, 1);
    this.views.get(id)?.el.remove();
    this.views.delete(id);
    if (this.nb.cells.length === 0) this.insertCell(0, mathCell(), false);
    this.renumber();
    this.applyCollapse();
    this.changed();
    if (focusPrev) this.focusAt(Math.max(0, i - 1), 'end');
    const hasContent =
      cell.type === 'math' ? cell.latex.trim() || cell.operation
      : cell.type === 'markdown' ? cell.text.trim()
      : cell.type === 'system' ? cell.rows.some((r) => r.latex.trim()) || cell.result.trim()
      : cell.type === 'variables' ? cell.vars.some((v) => v.meaning.trim())
      : cell.type === 'layout' ? cell.cells.some((r) => r.some((v) => v.trim()))
      : cell.type === 'matrix' ? cell.rows.some((r) => r.some((v) => v.trim())) || cell.notes.some((n) => n.trim())
      : cell.type === 'proof' ? cell.given.trim() || cell.prove.trim() || cell.rows.some((r) => r.statement.trim() || r.reason.trim())
      : cell.title.trim();
    if (hasContent || cell.comments.length) {
      toast('Cell deleted.', { label: 'Undo', run: () => this.insertCell(Math.min(i, this.nb.cells.length), cell) }, 6000);
    }
  }

  private moveCell(id: string, delta: -1 | 1): void {
    const i = this.index(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.nb.cells.length) return;
    const [cell] = this.nb.cells.splice(i, 1);
    this.nb.cells.splice(j, 0, cell);
    const el = this.views.get(id)!.el;
    const ref = this.views.get(this.nb.cells[j + 1]?.id ?? '')?.el ?? null;
    this.cellsEl.insertBefore(el, ref);
    this.renumber();
    this.applyCollapse();
    this.changed();
    this.focusAt(this.index(id), 'end');
  }

  /**
   * "Substitute x = 4 into…": pick an earlier equation; the next step starts as that equation with the
   * value written in (2x − y = 5 → 2(4) − y = 5) as a gray suggestion. The arithmetic is left to the student.
   */
  private substituteFrom(cell: MathCell): void {
    const found = valueStep(cell.latex);
    if (!found) return;
    const { variable, value } = found;
    const here = this.index(cell.id);
    const candidates: string[] = [];
    for (let k = here - 1; k >= 0 && candidates.length < 12; k--) {
      const c = this.nb.cells[k];
      const latexes = c.type === 'math' ? [c.latex] : c.type === 'system' ? c.rows.map((r) => r.latex).reverse() : [];
      for (const raw of latexes) {
        const l = cleanLatex(raw);
        // Equations that use the letter (and aren't themselves just "x = …").
        if (!hasRelation(l) || valueStep(l) || substitute(l, variable, value) === l || candidates.includes(l)) continue;
        candidates.push(l);
      }
    }
    if (!candidates.length) {
      toast(`No equation with ${variable} above this step to substitute into.`);
      return;
    }
    const list = h('div', { class: 'subst-list' },
      ...candidates.map((l) => {
        const b = h('button', { class: 'subst-choice' });
        b.innerHTML = katex.renderToString(l, { throwOnError: false });
        b.addEventListener('click', () => {
          (b.closest('dialog') as HTMLDialogElement | null)?.querySelector<HTMLButtonElement>('.dialog-buttons .btn')?.click();
          const filled = substitute(l, variable, value);
          const after = this.nb.cells[this.index(cell.id) + 1];
          // An empty step right below is used instead of adding another.
          if (after?.type === 'math' && !after.latex.trim()) {
            this.views.get(after.id)?.suggest?.(filled);
            this.focusAt(this.index(after.id), 'start');
            return;
          }
          const next = mathCell();
          this.insertCell(this.index(cell.id) + 1, next);
          this.views.get(next.id)?.suggest?.(filled);
        });
        return b;
      }),
    );
    void showDialog(`Substitute ${variable} = ${value.replace(/\\left|\\right/g, '')} into which equation?`, [
      h('p', { class: 'muted small' }, 'The next step will start with the value written in (press → to accept). You do the arithmetic.'),
      list,
    ], [{ label: 'Cancel' }]);
  }

  /** Pick a layout (box, X, synthetic / long division, matrix, proof) to add at `at`. */
  private layoutMenu(anchor: HTMLElement, at: number): void {
    openMenu(anchor, LAYOUTS.map((l) => ({ label: l.label, run: () => this.insertCell(at, l.make()) })));
  }

  /** Enter in a math step: go to the next step, making one if needed. */
  private nextStep(id: string, copy: boolean): void {
    const i = this.index(id);
    const cell = this.nb.cells[i];
    const latex = cell.type === 'math' ? cell.latex : cell.type === 'system' ? cell.result : '';
    // With an operation under the step (e.g. −3 under both sides), suggest its simplified result.
    const op = cell.type === 'math' ? cell.operation?.latex : undefined;
    const suggestion = (!this.nb.practice && op && applyOperation(latex, op)) || latex;
    const next = this.nb.cells[i + 1];
    if (!copy && next?.type === 'math' && !next.latex.trim()) {
      this.views.get(next.id)?.suggest?.(suggestion);
      this.focusAt(i + 1, 'start');
      return;
    }
    const added = mathCell(copy ? latex : '');
    this.insertCell(i + 1, added);
    if (copy) this.focusAt(i + 1, 'end');
    else this.views.get(added.id)?.suggest?.(suggestion);
  }

  /** Step numbers restart after each text cell or divider, so each problem counts from 1. */
  private renumber(): void {
    let n = 0;
    for (const cell of this.nb.cells) {
      const v = this.views.get(cell.id);
      if (!v) continue;
      if (cell.type === 'markdown' || cell.type === 'divider' || cell.type === 'variables' || cell.type === 'proof') {
        n = 0;
        v.numberEl.textContent = '';
      } else {
        v.numberEl.textContent = String(++n);
      }
    }
  }

  /** Shared key handling for both cell types (runs before MathLive sees the key). */
  private cellKeys(e: KeyboardEvent, cell: Cell): boolean {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !this.readOnly) {
      this.moveCell(cell.id, e.key === 'ArrowUp' ? -1 : 1);
      return true;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete') && !this.readOnly) {
      this.deleteCell(cell.id);
      return true;
    }
    if (e.altKey && e.key === 'Enter' && !this.readOnly) {
      this.insertCell(this.index(cell.id) + 1, textCell());
      return true;
    }
    if (isCommentShortcut(e)) {
      this.views.get(cell.id)?.setCommentsOpen(true);
      return true;
    }
    // Option+H (H for heading). Matched by physical key: Option+H types ˙ on a Mac.
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyH' && !this.readOnly) {
      this.insertCell(this.index(cell.id) + 1, dividerCell());
      return true;
    }
    // Option+S: a system of equations for elimination (matched by key: Option+S types ß on a Mac).
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyS' && !this.readOnly) {
      this.insertCell(this.index(cell.id) + 1, systemCell());
      return true;
    }
    return false;
  }

  private makeCell(cell: Cell): CellView {
    const numberEl = h('span', { class: 'step-num' });
    const commentsEl = h('div', { class: 'comments' });
    const commentBtn = h('button', { class: 'icon comment-btn', title: 'Comments' });
    const el = h('div', { class: `cell ${cell.type}`, 'data-id': cell.id });
    el.addEventListener('focusin', () => (this.lastCellId = cell.id));

    const gridCtx = () => ({
      readOnly: this.readOnly,
      onChange: () => this.changed(),
      cellKeys: (e: KeyboardEvent) => this.cellKeys(e, cell),
      leave: (dir: -1 | 1) => {
        const j = this.neighbor(this.index(cell.id), dir);
        if (j < 0) return false;
        this.focusAt(j, dir < 0 ? 'end' : 'start');
        return true;
      },
      next: () => this.nextStep(cell.id, false),
    });
    const content: CellEditor =
      cell.type === 'math' ? this.mathEditor(cell, el)
      : cell.type === 'markdown' ? this.textEditor(cell, el)
      : cell.type === 'system' ? systemEditor(cell, {
          readOnly: this.readOnly,
          onChange: () => this.changed(),
          cellKeys: (e) => this.cellKeys(e, cell),
          leave: (dir) => {
            const j = this.neighbor(this.index(cell.id), dir);
            if (j < 0) return false;
            this.focusAt(j, dir < 0 ? 'end' : 'start');
            return true;
          },
          next: () => this.nextStep(cell.id, false),
          practice: () => !!this.nb.practice,
          continueBelow: (rows, combine) => {
            const next = systemCell(rows.map((r) => r.latex));
            next.combine = combine;
            setSystemSuggestions(next, rows.map((r) => r.suggestion));
            this.insertCell(this.index(cell.id) + 1, next);
          },
        })
      : cell.type === 'variables' ? variablesEditor(cell, {
          readOnly: this.readOnly,
          onChange: () => {
            this.changed();
            this.graphs.refreshAxisLabels();
          },
          cellKeys: (e) => this.cellKeys(e, cell),
          leave: (dir) => {
            const j = this.neighbor(this.index(cell.id), dir);
            if (j < 0) return false;
            this.focusAt(j, dir < 0 ? 'end' : 'start');
            return true;
          },
          next: () => this.nextStep(cell.id, false),
        })
      : cell.type === 'layout' ? layoutEditor(cell, gridCtx())
      : cell.type === 'matrix' ? matrixEditor(cell, {
          ...gridCtx(),
          practice: () => !!this.nb.practice,
          continueBelow: (rows, suggestions, augmented) => {
            const next = matrixCell(rows.length, rows[0]?.length ?? 1, augmented);
            next.rows = rows;
            setMatrixSuggestions(next, suggestions);
            this.insertCell(this.index(cell.id) + 1, next);
          },
        })
      : cell.type === 'proof' ? proofEditor(cell, gridCtx())
      : this.dividerEditor(cell, el);

    let open = false;
    const setCommentsOpen = (o: boolean) => {
      if (o && open) {
        commentsEl.querySelector('textarea')?.focus();
        return;
      }
      open = o;
      el.classList.toggle('comments-open', open);
      this.renderComments(cell, commentsEl, commentBtn, open, closeComments);
      if (open) commentsEl.querySelector('textarea')?.focus();
    };
    commentBtn.addEventListener('click', () => setCommentsOpen(!open));
    // Closing from the keyboard (Esc or Cmd+/) puts you back in the cell.
    const closeComments = () => {
      setCommentsOpen(false);
      content.focus('end');
    };
    this.renderComments(cell, commentsEl, commentBtn, false, closeComments);

    // The comment count stays visible when there are comments; every other action is in the ⋯ menu.
    const menuBtn = h('button', { class: 'icon menu-btn', title: 'More actions', 'aria-haspopup': 'menu' }, '⋯');
    menuBtn.addEventListener('click', () => {
      const at = () => this.index(cell.id) + 1;
      const isMath = cell.type === 'math';
      const edit = !this.readOnly;
      openMenu(menuBtn, [
        { label: '💬  Comment', hint: '⌘/  ⌥/', run: () => setCommentsOpen(true) },
        isMath && edit && hasRelation(cell.latex)
          ? { label: '±  Same to both sides', hint: 'Shift+↓', run: () => content.openWork?.() }
          : null,
        isMath && edit && !this.nb.practice && valueStep(cell.latex)
          ? {
              label: `↪  Substitute ${valueStep(cell.latex)!.variable} = ${valueStep(cell.latex)!.value.replace(/\\left|\\right/g, '')} into…`,
              run: () => this.substituteFrom(cell as MathCell),
            }
          : null,
        isMath && (edit || cell.numberLine)
          ? { label: cell.numberLine ? '⟷  Hide number line' : '⟷  Show number line', run: () => content.toggleNumberLine?.() }
          : null,
        isMath && edit && cell.latex.trim()
          ? {
              label: '📈  Graph this step',
              run: () => {
                if (!this.graphsOpen) this.toggleGraphs();
                this.graphs.addExpression(cell.latex);
              },
            }
          : null,
        cell.type === 'system' && edit && nextSystemRows(cell, !!this.nb.practice)
          ? { label: this.nb.practice ? '↓  Next system (copy)' : '↓  Next system (multiply / distribute)', hint: '↵ in a note', run: () => content.continueSystem?.() }
          : null,
        cell.type === 'matrix' && edit && nextMatrix(cell, !!this.nb.practice)
          ? { label: this.nb.practice ? '↓  Next matrix (copy)' : '↓  Next matrix (apply row operations)', hint: '↵ in a note', run: () => content.continueMatrix?.() }
          : null,
        cell.type === 'system' && edit && cell.rows.some((r) => r.latex.trim())
          ? {
              label: '📈  Graph these equations',
              run: () => {
                if (!this.graphsOpen) this.toggleGraphs();
                for (const r of cell.rows) if (r.latex.trim()) this.graphs.addExpression(r.latex);
              },
            }
          : null,
        ...(edit
          ? [
              null,
              { label: 'Add step below', run: () => this.insertCell(at(), mathCell()) },
              { label: 'Add text below', hint: '⌥↵', run: () => this.insertCell(at(), textCell()) },
              { label: 'Add divider below', hint: '⌥H', run: () => this.insertCell(at(), dividerCell()) },
              { label: 'Add system (elimination) below', hint: '⌥S', run: () => this.insertCell(at(), systemCell()) },
              { label: 'Add “Let x = …” box below', run: () => this.insertCell(at(), variablesCell()) },
              { label: 'Add layout below…', run: () => this.layoutMenu(menuBtn, at()) },
              null,
              { label: 'Move up', hint: '⌥↑', run: () => this.moveCell(cell.id, -1) },
              { label: 'Move down', hint: '⌥↓', run: () => this.moveCell(cell.id, 1) },
              null,
              { label: 'Delete', run: () => this.deleteCell(cell.id, false), danger: true },
            ]
          : []),
      ]);
    });
    const actions = h('div', { class: 'cell-actions' }, commentBtn, menuBtn);

    const inserter = this.readOnly ? null : h('div', { class: 'inserter' },
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, mathCell()) }, '+ Step'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, textCell()) }, '+ Text'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, dividerCell()) }, '+ Divider'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, systemCell()) }, '+ System'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, variablesCell()) }, '+ Let x ='),
      h('button', { onclick: (e: Event) => this.layoutMenu(e.currentTarget as HTMLElement, this.index(cell.id) + 1) }, '+ Layout ▾'),
    );

    el.append(h('div', { class: 'gutter' }, numberEl), h('div', { class: 'cell-body' }, content.el, commentsEl), actions);
    if (inserter) el.append(inserter);

    const view: CellView = { cell, el, focus: content.focus, numberEl, setCommentsOpen, suggest: content.suggest };
    this.views.set(cell.id, view);
    return view;
  }

  private mathEditor(cell: MathCell, el: HTMLElement): CellEditor {
    const mf = new MathfieldElement();
    mf.value = cell.latex;
    mf.readOnly = this.readOnly;
    // The suggested starting point is shown as the (gray) placeholder; → accepts it.
    // Set via the attribute: MathLive reads it when it mounts and watches it afterwards.
    let suggestion = '';
    const showPlaceholder = () => mf.setAttribute('placeholder', suggestion || '\\text{Write a step}');
    const suggest = (latex: string) => {
      suggestion = mf.value ? '' : latex.trim();
      showPlaceholder();
      el.classList.toggle('has-suggestion', !!suggestion);
    };
    showPlaceholder();
    mf.setAttribute('math-virtual-keyboard-policy', 'manual');
    const focus = focusable(mf, showPlaceholder);

    const work = new WorkRow(mf, cell, {
      readOnly: this.readOnly,
      onChange: () => this.changed(),
      toStep: (position) => focus(position),
      toNextStep: () => {
        const j = this.neighbor(this.index(cell.id), 1);
        if (j >= 0) this.focusAt(j, 'start');
      },
      onEnter: () => {
        cell.latex = mf.value;
        this.nextStep(cell.id, false);
      },
      cellKeys: (e) => this.cellKeys(e, cell),
    });

    // ± only applies to steps with two sides (an =, <, > …).
    const updateCanWork = () => el.classList.toggle('can-work', hasRelation(mf.value));
    updateCanWork();
    // Everything that follows from the step's contents changing. Setting mf.value from code
    // (like accepting a suggestion) fires no input event, so those paths call this directly.
    // Number line under the step (from the ⋯ menu), redrawn as the step changes.
    const numberLine = h('div', { class: 'number-line', hidden: true });
    const drawNumberLine = () => {
      numberLine.hidden = !cell.numberLine;
      if (!cell.numberLine) return numberLine.replaceChildren();
      const set = solutionSet(mf.value);
      numberLine.replaceChildren(
        set
          ? renderNumberLine(set)
          : h('p', { class: 'muted small' }, 'Write an inequality or equation in one letter (like x ≥ 3) to see it on a number line.'),
      );
    };
    const contentChanged = () => {
      cell.latex = cleanLatex(mf.value);
      if (suggestion && mf.value) suggest('');
      updateCanWork();
      work.scheduleLayout();
      if (cell.numberLine) drawNumberLine();
      this.changed();
    };
    mf.addEventListener('input', contentChanged);
    mf.addEventListener('focus', () => {
      this.lastMathfield = mf;
      el.classList.add('focused');
    });
    mf.addEventListener('blur', () => {
      el.classList.remove('focused');
      // An exponent or subscript box left empty (x_{}) is removed when you leave the step.
      const clean = cleanLatex(mf.value);
      if (clean !== mf.value) {
        mf.value = clean;
        contentChanged();
      }
    });
    mf.addEventListener('move-out', (e) => {
      const dir = e.detail.direction;
      if (dir !== 'upward' && dir !== 'downward') return;
      const target = this.neighbor(this.index(cell.id), dir === 'upward' ? -1 : 1);
      if (target < 0) return;
      e.preventDefault();
      // Move focus after MathLive finishes handling this key; doing it inside the
      // event leaves the old field receiving the next keystroke.
      setTimeout(() => this.focusAt(target, dir === 'upward' ? 'end' : 'start'));
    });
    // Capture phase on the wrapper runs before MathLive's own key handling inside its shadow DOM.
    el.addEventListener('keydown', (e) => {
      if (e.target !== mf) return;
      if (this.cellKeys(e, cell)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'ArrowRight' && plain && suggestion && !mf.value && !this.readOnly) {
        stop();
        mf.value = suggestion;
        contentChanged();
        mf.position = mf.lastOffset;
        return;
      }
      if (e.key === 'ArrowDown' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !this.readOnly && mf.value) {
        stop();
        const at = mf.position;
        setTimeout(() => work.openAt(at));
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain) {
        // At the top level of the expression, ↑/↓ always change steps. Inside a fraction
        // or exponent, MathLive moves between parts and fires move-out at the edge.
        const depth = mf.getElementInfo(mf.position)?.depth ?? 0;
        const target = this.neighbor(this.index(cell.id), e.key === 'ArrowUp' ? -1 : 1);
        if (depth === 0 && target >= 0) {
          stop();
          setTimeout(() => this.focusAt(target, e.key === 'ArrowUp' ? 'end' : 'start'));
          return;
        }
      }
      if (this.readOnly || mf.mode === 'latex') return;
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        stop();
        // MathLive's input event can trail the last keystroke; read the live value.
        cell.latex = mf.value;
        this.nextStep(cell.id, e.shiftKey);
      } else if (e.key === 'Backspace' && !mf.value && !cell.operation && this.nb.cells.length > 1) {
        stop();
        this.deleteCell(cell.id);
      }
    }, true);

    const box = h('div', { class: 'step-box' }, mf, work.el, numberLine);
    work.scheduleLayout();
    drawNumberLine();
    return {
      el: box,
      suggest,
      focus,
      toggleNumberLine: () => {
        cell.numberLine = cell.numberLine ? undefined : true;
        drawNumberLine();
        this.changed();
      },
      openWork: () => {
        if (!hasRelation(mf.value)) {
          focus('end');
          return;
        }
        // Start under the last term on the left of the =, the usual place for "−5".
        work.openAt(leftSideEnd(mf));
      },
    };
  }

  private dividerEditor(cell: DividerCell, el: HTMLElement): CellEditor {
    const toggle = h('button', { class: 'collapse-btn', title: 'Collapse or expand this section' }, '▾');
    toggle.addEventListener('click', () => {
      cell.collapsed = !cell.collapsed;
      this.applyCollapse();
      this.changed();
    });
    const title = this.readOnly
      ? h('span', { class: 'divider-title' }, cell.title || 'Untitled section')
      : h('input', { class: 'divider-title', value: cell.title, placeholder: 'Section title', 'aria-label': 'Section title' });
    if (title instanceof HTMLInputElement) {
      title.addEventListener('focus', () => el.classList.add('focused'));
      title.addEventListener('blur', () => el.classList.remove('focused'));
      title.addEventListener('input', () => {
        cell.title = title.value;
        this.changed();
      });
      title.addEventListener('keydown', (e) => {
        if (this.cellKeys(e, cell)) {
          e.preventDefault();
          return;
        }
        const i = this.index(cell.id);
        if (e.key === 'Enter') {
          e.preventDefault();
          // Into the section: open it and go to its first cell (making a step if it's empty).
          if (cell.collapsed) {
            cell.collapsed = false;
            this.applyCollapse();
            this.changed();
          }
          const next = this.nb.cells[i + 1];
          if (next && next.type !== 'divider') this.focusAt(i + 1, 'start');
          else this.insertCell(i + 1, mathCell());
        } else if (e.key === 'ArrowUp' && this.neighbor(i, -1) >= 0) {
          e.preventDefault();
          this.focusAt(this.neighbor(i, -1), 'end');
        } else if (e.key === 'ArrowDown' && this.neighbor(i, 1) >= 0) {
          e.preventDefault();
          this.focusAt(this.neighbor(i, 1), 'start');
        } else if (e.key === 'Backspace' && !title.value && this.nb.cells.length > 1) {
          e.preventDefault();
          this.deleteCell(cell.id);
        }
      });
    }
    const bar = h('div', { class: 'divider-bar' }, toggle, title, h('span', { class: 'hidden-count' }));
    return {
      el: bar,
      focus: (where) => {
        if (title instanceof HTMLInputElement) {
          title.focus();
          const pos = where === 'start' ? 0 : title.value.length;
          title.setSelectionRange(pos, pos);
        } else toggle.focus();
      },
    };
  }

  private textEditor(cell: TextCell, el: HTMLElement): CellEditor {
    const view = h('div', { class: 'md-view', tabindex: '0' });
    const area = h('textarea', { class: 'md-edit', rows: 1, placeholder: 'Notes… (Markdown, with $math$ like $x^2$; type \\$ for a dollar sign)' });
    area.value = cell.text;
    let editing = false;

    const renderView = () => {
      view.innerHTML = cell.text.trim()
        ? renderMarkdown(cell.text)
        : `<p class="muted">${this.readOnly ? '' : 'Empty text — click to write notes'}</p>`;
    };
    const autosize = () => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`;
    };
    const setEditing = (on: boolean) => {
      if (this.readOnly) on = false;
      editing = on;
      el.classList.toggle('editing', on);
      if (on) {
        view.replaceWith(area);
        autosize();
      } else {
        renderView();
        area.replaceWith(view);
      }
    };

    view.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      setEditing(true);
      area.focus();
    });
    view.addEventListener('keydown', (e) => {
      if (this.cellKeys(e, cell)) {
        e.preventDefault();
        return;
      }
      const i = this.index(cell.id);
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditing(true);
        area.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusAt(this.neighbor(i, -1), 'end');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusAt(this.neighbor(i, 1), 'start');
      }
    });
    area.addEventListener('input', () => {
      cell.text = area.value;
      autosize();
      this.changed();
    });
    area.addEventListener('blur', () => setEditing(false));
    area.addEventListener('keydown', (e) => {
      if (this.cellKeys(e, cell)) {
        e.preventDefault();
        return;
      }
      const i = this.index(cell.id);
      const atStart = !area.value.slice(0, area.selectionStart).includes('\n');
      const atEnd = !area.value.slice(area.selectionEnd).includes('\n');
      const noSel = area.selectionStart === area.selectionEnd;
      if (e.key === 'Escape') area.blur();
      else if (e.key === 'ArrowUp' && atStart && noSel && this.neighbor(i, -1) >= 0) {
        e.preventDefault();
        this.focusAt(this.neighbor(i, -1), 'end');
      } else if (e.key === 'ArrowDown' && atEnd && noSel && this.neighbor(i, 1) >= 0) {
        e.preventDefault();
        this.focusAt(this.neighbor(i, 1), 'start');
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.nextStep(cell.id, false);
      } else if (e.key === 'Backspace' && !area.value && this.nb.cells.length > 1) {
        e.preventDefault();
        this.deleteCell(cell.id);
      }
    });

    renderView();
    return {
      el: view as HTMLElement,
      focus: (where: 'start' | 'end') => {
        if (this.readOnly) {
          view.focus();
          return;
        }
        if (!editing) setEditing(true);
        area.focus();
        const pos = where === 'start' ? 0 : area.value.length;
        area.setSelectionRange(pos, pos);
      },
    };
  }

  // -- comments ----------------------------------------------------------------

  private renderComments(cell: Cell, box: HTMLElement, btn: HTMLElement, open: boolean, close: () => void): void {
    const n = cell.comments.length;
    btn.textContent = n ? `💬 ${n}` : '💬';
    btn.classList.toggle('has-comments', n > 0);
    if (!open) {
      box.replaceChildren();
      return;
    }
    const text = h('textarea', { class: 'comment-input', rows: 2, placeholder: 'Add a comment…' });
    const submit = async () => {
      const body = text.value.trim();
      if (!body) return;
      const author = await this.authorName();
      if (!author) return;
      cell.comments.push({ id: newId(), author, text: body, created: nowIso() });
      this.changed();
      this.renderComments(cell, box, btn, true, close);
      box.querySelector('textarea')?.focus();
    };
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape' || isCommentShortcut(e)) {
        e.preventDefault();
        close();
      }
    });
    box.replaceChildren(
      ...cell.comments.map((c) =>
        h('div', { class: 'comment' },
          h('div', { class: 'comment-meta' },
            h('b', {}, c.author || 'Someone'), ' · ', h('span', { title: new Date(c.created).toLocaleString() }, relativeTime(c.created)),
            h('button', {
              class: 'icon tiny', title: 'Delete comment',
              onclick: () => {
                cell.comments = cell.comments.filter((x) => x !== c);
                this.changed();
                this.renderComments(cell, box, btn, true, close);
              },
            }, '✕'),
          ),
          h('div', { class: 'comment-text' }, c.text),
        ),
      ),
      h('div', { class: 'comment-form' }, text, h('button', { class: 'btn small primary', onclick: submit }, 'Comment')),
    );
  }

  private async authorName(): Promise<string | null> {
    const s = loadSettings();
    if (s.author) return s.author;
    const name = await prompt('What’s your name? It’s shown on your comments.', '', 'Save');
    if (name) saveSettings({ ...s, author: name });
    return name;
  }

  // -- saving --------------------------------------------------------------------

  private setStatus(text: string, error = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', error);
  }

  private changed(): void {
    if (this.mode.kind === 'shared') return;
    this.setStatus('Saving…');
    this.save();
  }

  private saveNow(keepalive = false): Promise<void> {
    const m = this.mode;
    this.saving = this.saving.then(async () => {
      try {
        if (m.kind === 'file') await api.save(m.name, this.nb, keepalive);
        else if (m.kind === 'scratch') await api.saveScratch(this.nb, keepalive);
        this.failed = false;
        if (!this.save.pending()) this.setStatus('Saved');
      } catch (err) {
        this.failed = true;
        this.setStatus('Not saved — retrying…', true);
        setTimeout(() => this.failed && this.save(), 3000);
      }
    });
    return this.saving;
  }

  async flush(): Promise<void> {
    this.save.flush();
    await this.saving;
  }

  private async rename(title: string): Promise<void> {
    if (this.mode.kind !== 'file') return;
    title = title.trim() || 'Untitled';
    await this.flush();
    try {
      const { name } = await api.rename(this.mode.name, title);
      this.nb.title = title;
      this.mode = { kind: 'file', name };
      history.replaceState(null, '', `#/nb/${encodeURIComponent(name)}`);
      document.title = `${title} — Math Notebook`;
    } catch (err) {
      toast(`Couldn’t rename: ${(err as Error).message}`);
    }
  }

  // -- scratch / shared / export -------------------------------------------------

  private async saveScratchAs(): Promise<void> {
    const title = await prompt('Name this notebook', '', 'Save');
    if (!title) return;
    await this.flush();
    const nb: Notebook = { ...structuredClone(this.nb), id: crypto.randomUUID(), title };
    const { name } = await api.create(nb);
    await api.clearScratch();
    toast(`Saved as “${title}”. The scratch pad is clear again.`);
    location.hash = `#/nb/${encodeURIComponent(name)}`;
  }

  private async clearScratch(): Promise<void> {
    if (!(await confirm('Clear the scratch pad?', 'Everything on the scratch pad will be erased.', 'Clear', true))) return;
    this.nb.cells = [mathCell()];
    this.nb.graphs = [];
    this.graphs.destroy();
    this.graphs = new GraphPanel(this.nb, this.graphOptions());
    this.render();
    this.changed();
  }

  private async saveShared(): Promise<void> {
    try {
      const name = await saveIncoming(structuredClone(this.nb));
      if (name) location.hash = `#/nb/${encodeURIComponent(name)}`;
    } catch (err) {
      toast(`Couldn’t save: ${(err as Error).message}`);
    }
  }

  /**
   * Print (or Save as PDF): lay the page out for paper (see the print styles), with every section
   * expanded and graphs drawn at their printed size, then open the browser's print dialog.
   */
  private async print(): Promise<void> {
    await this.flush();
    const collapsed = [...this.cellsEl.querySelectorAll('.cell.collapsed-away')];
    collapsed.forEach((c) => c.classList.remove('collapsed-away'));
    // Empty steps would print as blank boxes.
    const empty = this.nb.cells
      .filter((c) => (c.type === 'math' && !c.latex.trim() && !c.operation) || (c.type === 'markdown' && !c.text.trim()))
      .map((c) => this.views.get(c.id)?.el)
      .filter((el): el is HTMLElement => !!el);
    empty.forEach((el) => el.classList.add('print-skip'));
    const wasOpen = this.graphsOpen;
    const wasWorkHidden = this.workHidden;
    const hasGraphs = this.nb.graphs.length > 0;
    document.body.classList.add('printing');
    this.el.dataset.printDate = new Date().toLocaleDateString();
    if (hasGraphs) this.setLayout(true, false);
    // Let the graphs redraw at their printed size before the dialog takes its snapshot.
    await new Promise((r) => setTimeout(r, 450));
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restore);
      document.body.classList.remove('printing');
      empty.forEach((el) => el.classList.remove('print-skip'));
      this.applyCollapse();
      if (hasGraphs) this.setLayout(wasOpen, wasWorkHidden);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    // Safari doesn't always fire afterprint; print() blocks until the dialog closes anyway.
    setTimeout(restore, 0);
  }

  private exportFile(): void {
    downloadJson(`${this.nb.title || 'notebook'}.mathnb.json`, this.nb);
  }

  private async share(): Promise<void> {
    await this.flush();
    const link = shareLink(this.nb, shareBase());
    const field = h('textarea', { class: 'share-link', readonly: true, rows: 4 });
    field.value = link;
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      /* clipboard blocked; the user can copy from the box */
    }
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(link);
    await showDialog('Share this notebook', [
      h('p', {}, copied ? 'Link copied — paste it in a message.' : 'Copy this link and send it:'),
      field,
      isLocal
        ? h('p', { class: 'muted small' },
            'This link opens in the Math Notebook app on the other person’s computer. ',
            'To open links on any device, set a viewer address on the home page (⚙ Settings).')
        : null,
      link.length > 8000 ? h('p', { class: 'muted small' }, 'This is a long link. If it gets cut off, use Export and send the file instead.') : null,
      h('p', { class: 'muted small' }, 'The notebook is stored inside the link itself — nothing is uploaded anywhere.'),
    ], [{ label: 'Done', primary: true }]);
  }

  async destroy(): Promise<void> {
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('keydown', this.onPageKey);
    window.removeEventListener('pagehide', this.onUnload);
    await this.flush();
    this.graphs.destroy();
    window.mathVirtualKeyboard?.hide();
  }
}

export function showHelp(): void {
  const rows: [string, string][] = [
    ['Enter', 'Next step, with this step (or the result of its ± operation) shown in gray as a starting point'],
    ['→ on a gray suggestion', 'Accept it and edit from there (or just type to start fresh)'],
    ['Shift + Enter', 'New step that starts as a copy of this one'],
    ['↑ / ↓', 'Move between steps'],
    ['Backspace on an empty step', 'Delete it'],
    ['Shift + ↓  or  ±', 'Do the same to both sides, written under the step (like −5 under +5 and +3); Esc or Shift + ↑ to go back'],
    ['← / →  under the step', 'Switch between the left and right copy (they always match)'],
    ['Option + ← / →  under the step', 'Move this copy under the next term (or drag it with the mouse)'],
    ['Alt + Enter', 'Add a text cell below'],
    ['Option + H', 'Add a divider (section title) below; click ▾ to collapse the section'],
    ['Option + S', 'Add a system of equations (elimination) below; Enter moves down to the line'],
    ['← at the start of a system row', 'Write a note beside it, like ×3'],
    ['Alt + ↑ / ↓', 'Move this cell up or down'],
    ['⌘ + /  or  Option + /', 'Comment on this step; again or Esc to close (use Option + / in Safari)'],
    ['/', 'Fraction (type 1/2, or select x+1 then /)'],
    ['^  and  _', 'Exponent and subscript; → to leave'],
    ['sqrt, pi, theta, int, lim, sum', 'Type the word to get the symbol'],
    ['(  [  |', 'Brackets and absolute value close themselves'],
    ['<=  >=  !=', '≤  ≥  ≠'],
    ['Esc (in text)', 'Finish editing text'],
  ];
  showDialog('Keyboard shortcuts', [
    h('table', { class: 'help' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
  ], [{ label: 'Got it', primary: true }]);
}
