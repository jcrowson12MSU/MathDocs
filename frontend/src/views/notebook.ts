// The notebook editor: a column of math steps and text cells, with graphs on the right.

import { MathfieldElement } from 'mathlive';
import { api } from '../api';
import { saveIncoming } from '../incoming';
import { renderMarkdown } from '../markdown';
import { mathCell, newId, nowIso, textCell, type Cell, type MathCell, type Notebook, type TextCell } from '../model';
import { loadSettings, saveSettings, shareBase } from '../settings';
import { shareLink } from '../share';
import { confirm, debounce, downloadJson, h, prompt, relativeTime, showDialog, toast } from '../ui';
import { GraphPanel } from './graphs';

export type Mode = { kind: 'file'; name: string } | { kind: 'scratch' } | { kind: 'shared' };

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
    this.setStatus(this.mode.kind === 'shared' ? 'Shared copy — not saved' : 'Saved');
    requestAnimationFrame(() => {
      if (this.graphsOpen) this.graphs.refresh();
      if (!this.readOnly) this.views.get(this.nb.cells[this.nb.cells.length - 1].id)?.focus('end');
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
    this.views.get(cell.id)?.focus(where);
    return true;
  }

  private insertCell(at: number, cell: Cell, focus = true): void {
    this.nb.cells.splice(at, 0, cell);
    const view = this.makeCell(cell);
    const next = this.nb.cells[at + 1];
    const before = next ? this.views.get(next.id)?.el : null;
    this.cellsEl.insertBefore(view.el, before ?? null);
    this.renumber();
    this.changed();
    if (focus) view.focus('start');
  }

  private deleteCell(id: string, focusPrev = true): void {
    const i = this.index(id);
    if (i < 0) return;
    const [cell] = this.nb.cells.splice(i, 1);
    this.views.get(id)?.el.remove();
    this.views.delete(id);
    if (this.nb.cells.length === 0) this.insertCell(0, mathCell(), false);
    this.renumber();
    this.changed();
    if (focusPrev) this.focusAt(Math.max(0, i - 1), 'end');
    const hasContent = cell.type === 'math' ? cell.latex.trim() : cell.text.trim();
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
    this.changed();
    this.views.get(id)?.focus('end');
  }

  /** Enter in a math step: go to the next step, making one if needed. */
  private nextStep(id: string, copy: boolean): void {
    const i = this.index(id);
    const cell = this.nb.cells[i] as MathCell;
    const next = this.nb.cells[i + 1];
    if (!copy && next?.type === 'math' && !next.latex.trim()) {
      this.views.get(next.id)?.suggest?.(cell.latex);
      this.focusAt(i + 1, 'start');
      return;
    }
    const added = mathCell(copy ? cell.latex : '');
    this.insertCell(i + 1, added);
    if (copy) this.focusAt(i + 1, 'end');
    else this.views.get(added.id)?.suggest?.(cell.latex);
  }

  /** Step numbers restart after each text cell, so each problem counts from 1. */
  private renumber(): void {
    let n = 0;
    for (const cell of this.nb.cells) {
      const v = this.views.get(cell.id);
      if (!v) continue;
      if (cell.type === 'markdown') {
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
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      this.views.get(cell.id)?.setCommentsOpen(true);
      return true;
    }
    return false;
  }

  private makeCell(cell: Cell): CellView {
    const numberEl = h('span', { class: 'step-num' });
    const commentsEl = h('div', { class: 'comments' });
    const commentBtn = h('button', { class: 'icon comment-btn', title: 'Comments' });
    const el = h('div', { class: `cell ${cell.type}`, 'data-id': cell.id });

    const content: CellEditor = cell.type === 'math' ? this.mathEditor(cell, el) : this.textEditor(cell, el);

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
    );

    el.append(h('div', { class: 'gutter' }, numberEl), h('div', { class: 'cell-body' }, content.el, commentsEl), actions);
    if (inserter) el.append(inserter);

    const view: CellView = { cell, el, focus: content.focus, numberEl, setCommentsOpen, suggest: content.suggest };
    this.views.set(cell.id, view);
    return view;
  }

  private mathEditor(cell: MathCell, el: HTMLElement) {
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

    mf.addEventListener('input', () => {
      cell.latex = mf.value;
      if (suggestion && mf.value) suggest('');
      this.changed();
    });
    mf.addEventListener('focus', () => {
      this.lastMathfield = mf;
      el.classList.add('focused');
    });
    mf.addEventListener('blur', () => el.classList.remove('focused'));
    mf.addEventListener('move-out', (e) => {
      const i = this.index(cell.id);
      const dir = e.detail.direction;
      const target = dir === 'upward' ? i - 1 : dir === 'downward' ? i + 1 : -1;
      if (target < 0 || target >= this.nb.cells.length) return;
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
      if (e.key === 'ArrowRight' && plain && suggestion && !mf.value && !this.readOnly) {
        e.preventDefault();
        e.stopPropagation();
        mf.value = suggestion;
        cell.latex = suggestion;
        suggest('');
        mf.position = mf.lastOffset;
        this.changed();
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain) {
        // At the top level of the expression, ↑/↓ always change steps. Inside a fraction
        // or exponent, MathLive moves between parts and fires move-out at the edge.
        const depth = mf.getElementInfo(mf.position)?.depth ?? 0;
        const target = this.index(cell.id) + (e.key === 'ArrowUp' ? -1 : 1);
        if (depth === 0 && target >= 0 && target < this.nb.cells.length) {
          e.preventDefault();
          e.stopPropagation();
          setTimeout(() => this.focusAt(target, e.key === 'ArrowUp' ? 'end' : 'start'));
          return;
        }
      }
      if (this.readOnly || mf.mode === 'latex') return;
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        // MathLive's input event can trail the last keystroke; read the live value.
        cell.latex = mf.value;
        this.nextStep(cell.id, e.shiftKey);
      } else if (e.key === 'Backspace' && !mf.value && this.nb.cells.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteCell(cell.id);
      }
    }, true);

    // A new mathfield can't take focus until MathLive has mounted it (one frame after insertion).
    let mounted = false;
    let pendingFocus: 'start' | 'end' | null = null;
    const focusNow = (where: 'start' | 'end') => {
      // MathLive keeps the keyboard if another mathfield still holds focus, so release it first.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== mf) active.blur();
      mf.focus();
      // MathLive hands the keyboard over ~60ms after focus(); focus its input sink now so
      // quick keystrokes (like holding ↑) aren't dropped in between.
      mf.shadowRoot?.querySelector<HTMLElement>('[part="keyboard-sink"]')?.focus({ preventScroll: true });
      mf.position = where === 'start' ? 0 : mf.lastOffset;
    };
    mf.addEventListener('mount', () => {
      mounted = true;
      showPlaceholder();
      if (pendingFocus) focusNow(pendingFocus);
      pendingFocus = null;
    });

    return {
      el: mf as HTMLElement,
      suggest,
      focus: (where: 'start' | 'end') => {
        if (mounted) focusNow(where);
        else {
          // Release the previous field so fast typing doesn't land in the wrong step.
          (document.activeElement as HTMLElement | null)?.blur();
          pendingFocus = where;
        }
      },
    };
  }

  private textEditor(cell: TextCell, el: HTMLElement) {
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
      const i = this.index(cell.id);
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditing(true);
        area.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusAt(i - 1, 'end');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusAt(i + 1, 'start');
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
      else if (e.key === 'ArrowUp' && atStart && noSel && i > 0) {
        e.preventDefault();
        this.focusAt(i - 1, 'end');
      } else if (e.key === 'ArrowDown' && atEnd && noSel && i < this.nb.cells.length - 1) {
        e.preventDefault();
        this.focusAt(i + 1, 'start');
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
      } else if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
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
    ['Alt + Enter', 'Add a text cell below'],
    ['Alt + ↑ / ↓', 'Move this cell up or down'],
    ['⌘ + /  (Ctrl + / on Windows)', 'Comment on this step; again or Esc to close'],
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
