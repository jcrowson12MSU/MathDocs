// The notebook editor: a column of math steps and text cells, with graphs on the right.

import { MathfieldElement } from 'mathlive';
import { api } from '../api';
import { saveIncoming } from '../incoming';
import { renderMarkdown } from '../markdown';
import {
  dividerCell, mathCell, newId, nowIso, textCell,
  type Cell, type DividerCell, type MathCell, type Notebook, type TextCell,
} from '../model';
import { loadSettings, saveSettings, shareBase } from '../settings';
import { shareLink } from '../share';
import { confirm, debounce, downloadJson, h, prompt, relativeTime, showDialog, toast } from '../ui';
import { GraphPanel } from './graphs';
import { focusable } from './mathfield';
import { WorkRow, hasRelation, leftSideEnd } from './workrow';

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
}

export class NotebookView {
  el = h('div', { class: 'notebook-view' });
  private views = new Map<string, CellView>();
  private cellsEl = h('div', { class: 'cells' });
  private statusEl = h('span', { class: 'save-status' });
  private graphs: GraphPanel;
  private graphsOpen: boolean;
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
    this.graphs = new GraphPanel(nb, { readOnly: this.readOnly, onChange: () => this.changed() });
    this.render();
    window.addEventListener('beforeunload', this.onUnload);
    window.addEventListener('keydown', this.onPageKey);
    window.addEventListener('pagehide', this.onUnload);
  }

  // -- layout ----------------------------------------------------------------

  private render(): void {
    const main = h('div', { class: 'nb-main' }, h('div', { class: 'work' }, this.banner(), this.cellsEl), this.graphs.el);
    main.classList.toggle('graphs-open', this.graphsOpen);
    this.el.replaceChildren(this.header(), main);
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
    graphsBtn.addEventListener('click', () => this.toggleGraphs());

    const buttons: (HTMLElement | null)[] = [
      this.readOnly ? null : h('button', { class: 'btn', title: 'Show the on-screen math keyboard', onclick: () => this.toggleKeyboard() }, '⌨︎ Keyboard'),
      graphsBtn,
      h('button', { class: 'btn', onclick: () => this.share() }, this.readOnly ? 'Share back' : 'Share'),
      h('button', { class: 'btn', title: 'Download as a .mathnb.json file', onclick: () => this.exportFile() }, 'Export'),
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

    return h('header', { class: 'topbar' },
      h('a', { class: 'home-link', href: '#/', title: 'All notebooks' }, '← Notebooks'),
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

  private toggleGraphs(): void {
    this.graphsOpen = !this.graphsOpen;
    this.el.querySelector('.nb-main')?.classList.toggle('graphs-open', this.graphsOpen);
    if (this.graphsOpen) requestAnimationFrame(() => this.graphs.refresh());
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
      cell.type === 'math' ? cell.latex.trim() || cell.operation : cell.type === 'markdown' ? cell.text.trim() : cell.title.trim();
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

  /** Enter in a math step: go to the next step, making one if needed. */
  private nextStep(id: string, copy: boolean): void {
    const i = this.index(id);
    const cell = this.nb.cells[i];
    const latex = cell.type === 'math' ? cell.latex : '';
    const next = this.nb.cells[i + 1];
    if (!copy && next?.type === 'math' && !next.latex.trim()) {
      this.views.get(next.id)?.suggest?.(latex);
      this.focusAt(i + 1, 'start');
      return;
    }
    const added = mathCell(copy ? latex : '');
    this.insertCell(i + 1, added);
    if (copy) this.focusAt(i + 1, 'end');
    else this.views.get(added.id)?.suggest?.(latex);
  }

  /** Step numbers restart after each text cell or divider, so each problem counts from 1. */
  private renumber(): void {
    let n = 0;
    for (const cell of this.nb.cells) {
      const v = this.views.get(cell.id);
      if (!v) continue;
      if (cell.type !== 'math') {
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
    return false;
  }

  private makeCell(cell: Cell): CellView {
    const numberEl = h('span', { class: 'step-num' });
    const commentsEl = h('div', { class: 'comments' });
    const commentBtn = h('button', { class: 'icon comment-btn', title: 'Comments' });
    const el = h('div', { class: `cell ${cell.type}`, 'data-id': cell.id });
    el.addEventListener('focusin', () => (this.lastCellId = cell.id));

    const content: CellEditor =
      cell.type === 'math' ? this.mathEditor(cell, el)
      : cell.type === 'markdown' ? this.textEditor(cell, el)
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

    const actions = h('div', { class: 'cell-actions' },
      commentBtn,
      cell.type === 'math' && !this.readOnly
        ? h('button', {
            class: 'icon work-btn', title: 'Do the same thing to both sides, written under this step (Shift+↓)',
            onclick: () => content.openWork?.(),
          }, '±')
        : null,
      cell.type === 'math' && !this.readOnly
        ? h('button', {
            class: 'icon', title: 'Graph this step',
            onclick: () => {
              if (!this.graphsOpen) this.toggleGraphs();
              this.graphs.addExpression(cell.latex);
            },
          }, '📈')
        : null,
      this.readOnly ? null : h('button', { class: 'icon', title: 'Move up (Alt+↑)', onclick: () => this.moveCell(cell.id, -1) }, '↑'),
      this.readOnly ? null : h('button', { class: 'icon', title: 'Move down (Alt+↓)', onclick: () => this.moveCell(cell.id, 1) }, '↓'),
      this.readOnly ? null : h('button', { class: 'icon', title: 'Delete', onclick: () => this.deleteCell(cell.id, false) }, '✕'),
    );

    const inserter = this.readOnly ? null : h('div', { class: 'inserter' },
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, mathCell()) }, '+ Step'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, textCell()) }, '+ Text'),
      h('button', { onclick: () => this.insertCell(this.index(cell.id) + 1, dividerCell()) }, '+ Divider'),
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
    mf.addEventListener('input', () => {
      cell.latex = mf.value;
      if (suggestion && mf.value) suggest('');
      updateCanWork();
      work.scheduleLayout();
      this.changed();
    });
    mf.addEventListener('focus', () => {
      this.lastMathfield = mf;
      el.classList.add('focused');
    });
    mf.addEventListener('blur', () => el.classList.remove('focused'));
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
        cell.latex = suggestion;
        suggest('');
        mf.position = mf.lastOffset;
        this.changed();
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

    const box = h('div', { class: 'step-box' }, mf, work.el);
    work.scheduleLayout();
    return {
      el: box,
      suggest,
      focus,
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
    const area = h('textarea', { class: 'md-edit', rows: 1, placeholder: 'Notes… (Markdown, with $math$ like $x^2$)' });
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
    this.graphs = new GraphPanel(this.nb, { readOnly: false, onChange: () => this.changed() });
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
    ['Enter', 'Next step, with this step shown in gray as a starting point'],
    ['→ on a gray suggestion', 'Accept it and edit from there (or just type to start fresh)'],
    ['Shift + Enter', 'New step that starts as a copy of this one'],
    ['↑ / ↓', 'Move between steps'],
    ['Backspace on an empty step', 'Delete it'],
    ['Shift + ↓  or  ±', 'Do the same to both sides, written under the step (like −5 under +5 and +3); Esc or Shift + ↑ to go back'],
    ['← / →  under the step', 'Switch between the left and right copy (they always match)'],
    ['Option + ← / →  under the step', 'Move this copy under the next term (or drag it with the mouse)'],
    ['Alt + Enter', 'Add a text cell below'],
    ['Option + H', 'Add a divider (section title) below; click ▾ to collapse the section'],
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
