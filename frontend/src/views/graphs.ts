// Graph panel: interactive JSXGraph boards with expressions, tables of points, and calculus tools.

import JXG from 'jsxgraph';
import katex from 'katex';
import { MathfieldElement } from 'mathlive';
import { analyze, derivative, integrate, variableLatex, type Plottable } from '../mathfn';
import {
  COLORS, DEFAULT_BBOX, exprItem, newGraph, nextColor, noteItem, parseNumber, tableItem,
  type ExprItem, type Graph, type GraphItem, type NoteItem, type Notebook, type TableItem,
} from '../model';
import { debounce, h } from '../ui';

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : 'undefined');
const round = (n: number) => Math.round(n * 100) / 100;
/** Zoom rate for scrolling over a graph: about 10% per mouse-wheel notch (100px of scroll). */
const ZOOM_PER_PIXEL = 0.001;

interface PanelOptions {
  readOnly: boolean;
  onChange: () => void;
}

export class GraphPanel {
  el = h('aside', { class: 'graph-panel' });
  private cards: GraphCard[] = [];

  constructor(private nb: Notebook, private opts: PanelOptions) {
    this.render();
  }

  render(): void {
    this.cards.forEach((c) => c.destroy());
    this.cards = this.nb.graphs.map((g) => new GraphCard(g, this.opts, () => this.removeGraph(g)));
    this.el.replaceChildren(
      ...this.cards.map((c) => c.el),
      this.opts.readOnly
        ? h('p', { class: 'muted' }, this.nb.graphs.length ? '' : 'No graphs in this notebook.')
        : h('button', { class: 'btn add-graph', onclick: () => this.addGraph() }, '+ Add graph'),
    );
  }

  /** Draw boards after the panel becomes visible (JSXGraph needs real dimensions). */
  refresh(): void {
    this.cards.forEach((c) => c.buildBoard());
  }

  addGraph(): Graph {
    const g = newGraph();
    g.items.push(exprItem('', COLORS[0]));
    this.nb.graphs.push(g);
    this.opts.onChange();
    this.render();
    this.refresh();
    return g;
  }

  /** Called from a math step's "graph this" button. */
  addExpression(latex: string): void {
    const g = this.nb.graphs[0] ?? (this.nb.graphs.push(newGraph()), this.nb.graphs[0]);
    const blank = g.items.find((i): i is ExprItem => i.kind === 'expr' && !i.latex.trim());
    if (blank) blank.latex = latex;
    else g.items.push(exprItem(latex, nextColor(g)));
    this.opts.onChange();
    this.render();
    this.refresh();
  }

  private removeGraph(g: Graph): void {
    this.nb.graphs = this.nb.graphs.filter((x) => x !== g);
    this.opts.onChange();
    this.render();
    this.refresh();
  }

  destroy(): void {
    this.cards.forEach((c) => c.destroy());
  }
}

class GraphCard {
  el: HTMLElement;
  private boardDiv: HTMLDivElement;
  private itemsEl = h('div', { class: 'graph-items' });
  private board: any = null;
  private analyses = new Map<string, Plottable>();
  private resizeObserver: ResizeObserver;
  private lastSize = '';
  private rebuildSoon = debounce(() => this.buildBoard(), 120);
  private saveBbox = debounce(() => {
    if (!this.board) return;
    this.graph.bbox = this.board.getBoundingBox().map(round) as Graph['bbox'];
    this.opts.onChange();
  }, 400);

  private xAxisLabel = h('div', { class: 'axis-label x' });
  private yAxisLabel = h('div', { class: 'axis-label y' });

  constructor(private graph: Graph, private opts: PanelOptions, onDelete: () => void) {
    this.boardDiv = h('div', { class: 'board', id: `board-${graph.id}-${Math.random().toString(36).slice(2)}` });
    const ro = opts.readOnly;
    const axisInput = (axis: 'x' | 'y') => {
      const key = axis === 'x' ? 'xLabel' : 'yLabel';
      const input = h('input', {
        class: 'axis-input', value: graph[key] ?? '',
        placeholder: axis === 'x' ? 'e.g. time (hours)' : 'e.g. height (cm)',
      });
      input.addEventListener('input', () => {
        graph[key] = input.value || undefined;
        this.showAxisLabels();
        opts.onChange();
      });
      return h('label', { class: 'axis-field' }, h('span', {}, `${axis}-axis`), input);
    };
    this.showAxisLabels();
    this.el = h('section', { class: 'graph-card' },
      h('div', { class: 'graph-head' },
        ro
          ? h('span', { class: 'graph-title' }, graph.title || 'Graph')
          : h('input', {
              class: 'graph-title', placeholder: 'Graph title', value: graph.title,
              oninput: (e: Event) => {
                graph.title = (e.target as HTMLInputElement).value;
                opts.onChange();
              },
            }),
        h('button', { class: 'icon', title: 'Reset view', onclick: () => this.resetView() }, '⟲'),
        ro ? null : h('button', { class: 'icon', title: 'Delete graph', onclick: onDelete }, '✕'),
      ),
      h('div', { class: 'board-wrap' }, this.yAxisLabel, h('div', { class: 'board-col' }, this.boardDiv, this.xAxisLabel)),
      ro ? null : h('div', { class: 'axis-fields' }, axisInput('x'), axisInput('y')),
      this.itemsEl,
      ro ? null : h('div', { class: 'graph-add' },
        h('button', { class: 'btn small', onclick: () => this.addItem(exprItem('', nextColor(graph))) }, '+ Expression'),
        h('button', { class: 'btn small', onclick: () => this.addItem(tableItem(nextColor(graph))) }, '+ Table of points'),
        h('button', { class: 'btn small', title: 'A text note you can drag anywhere on the graph', onclick: () => this.addNote() }, '+ Note'),
      ),
    );
    this.renderItems();
    this.resizeObserver = new ResizeObserver(() => {
      const size = `${this.boardDiv.clientWidth}x${this.boardDiv.clientHeight}`;
      if (size !== this.lastSize && this.boardDiv.clientWidth > 0) {
        this.lastSize = size;
        this.rebuildSoon();
      }
    });
    this.resizeObserver.observe(this.boardDiv);
    this.boardDiv.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private showAxisLabels(): void {
    this.xAxisLabel.textContent = this.graph.xLabel ?? '';
    this.yAxisLabel.textContent = this.graph.yLabel ?? '';
  }

  private addNote(): void {
    const [x1, y1, x2, y2] = this.board?.getBoundingBox() ?? this.graph.bbox;
    this.addItem(noteItem([round((x1 + x2) / 2), round((y1 + y2) / 2)]));
  }

  private analysis(item: ExprItem): Plottable {
    let a = this.analyses.get(item.id);
    if (!a) {
      a = analyze(item.latex);
      this.analyses.set(item.id, a);
    }
    return a;
  }

  private changed(rebuild = true): void {
    this.opts.onChange();
    if (rebuild) this.rebuildSoon();
  }

  private addItem(item: GraphItem): void {
    this.graph.items.push(item);
    this.renderItems();
    this.changed();
    const mf = this.itemsEl.querySelector<HTMLElement>(`[data-item="${item.id}"] math-field, [data-item="${item.id}"] input`);
    mf?.focus();
  }

  private removeItem(item: GraphItem): void {
    this.graph.items = this.graph.items.filter((i) => i !== item);
    for (const i of this.graph.items) if (i.kind === 'table' && i.fromItem === item.id) i.fromItem = null;
    this.renderItems();
    this.changed();
  }

  private resetView(): void {
    this.graph.bbox = [...DEFAULT_BBOX];
    this.changed();
    this.buildBoard();
  }

  // -- item editors -----------------------------------------------------------

  private renderItems(): void {
    this.itemsEl.replaceChildren(
      ...this.graph.items.map((item) =>
        item.kind === 'expr' ? this.exprRow(item) : item.kind === 'table' ? this.tableRow(item) : this.noteRow(item),
      ),
    );
  }

  private commonButtons(item: GraphItem): HTMLElement[] {
    const swatch = h('button', {
      class: 'swatch', title: 'Change color / show or hide',
      style: `--c:${item.color}`,
      onclick: (e: MouseEvent) => {
        if (e.shiftKey || this.opts.readOnly) item.hidden = !item.hidden;
        else item.color = COLORS[(COLORS.indexOf(item.color) + 1) % COLORS.length];
        swatch.style.setProperty('--c', item.color);
        swatch.classList.toggle('off', !!item.hidden);
        this.changed();
      },
    });
    swatch.classList.toggle('off', !!item.hidden);
    const eye = h('button', {
      class: 'icon', title: 'Show / hide',
      onclick: () => {
        item.hidden = !item.hidden;
        swatch.classList.toggle('off', !!item.hidden);
        this.changed();
      },
    }, '👁');
    return this.opts.readOnly
      ? [swatch, eye]
      : [swatch, eye, h('button', { class: 'icon', title: 'Remove', onclick: () => this.removeItem(item) }, '✕')];
  }

  private exprRow(item: ExprItem): HTMLElement {
    const mf = new MathfieldElement();
    mf.value = item.latex;
    mf.readOnly = this.opts.readOnly;
    mf.setAttribute('placeholder', '\\text{e.g. } y=2x+1');
    const msg = h('div', { class: 'item-msg' });
    const params = h('div', { class: 'params' });
    const tools = h('div', { class: 'calc-tools' });

    const refreshMeta = () => {
      const a = this.analysis(item);
      msg.textContent = a.kind === 'error' ? a.message : '';
      // Sliders for parameters like a, b in y = ax + b.
      const names = a.kind === 'function' || a.kind === 'implicit' ? a.params : [];
      item.params ??= {};
      for (const n of names) item.params[n] ??= 1;
      params.replaceChildren(...names.map((n) => this.slider(item, n)));
      // Calculus tools only make sense for y = f(x).
      tools.replaceChildren();
      if (a.kind === 'function' && !this.opts.readOnly) {
        tools.append(
          this.toggle('f′ derivative', !!item.showDerivative, (on) => (item.showDerivative = on)),
          this.toggle('Tangent line', item.tangentAt != null, (on) => (item.tangentAt = on ? 1 : null)),
          this.toggle('Area under curve', item.area != null, (on) => (item.area = on ? { from: 0, to: 2 } : null)),
        );
      }
    };

    mf.addEventListener('input', () => {
      item.latex = mf.value;
      this.analyses.delete(item.id);
      refreshMeta();
      this.changed();
    });
    refreshMeta();
    const [swatch, ...buttons] = this.commonButtons(item);
    return h('div', { class: 'graph-item', 'data-item': item.id },
      h('div', { class: 'item-line' }, swatch, mf, ...buttons),
      msg, params, tools, this.labelInput(item, 'Label this line, e.g. Candle 1'),
    );
  }

  /** What an expression or table represents; drawn on the graph where you drag it. */
  private labelInput(item: ExprItem | TableItem, placeholder: string): HTMLElement | null {
    if (this.opts.readOnly) return null;
    const input = h('input', { class: 'item-label-input', value: item.label ?? '', placeholder });
    input.addEventListener('input', () => {
      item.label = input.value || undefined;
      this.changed();
    });
    return input;
  }

  private noteRow(item: NoteItem): HTMLElement {
    const [swatch, ...buttons] = this.commonButtons(item);
    const text = this.opts.readOnly
      ? h('span', { class: 'item-label' }, item.text)
      : h('input', { class: 'note-input', value: item.text, placeholder: 'Note text — drag it on the graph' });
    if (text instanceof HTMLInputElement) {
      text.addEventListener('input', () => {
        item.text = text.value;
        this.changed();
      });
    }
    return h('div', { class: 'graph-item', 'data-item': item.id }, h('div', { class: 'item-line' }, swatch, h('span', { class: 'note-tag' }, 'Note'), text, ...buttons));
  }

  private toggle(label: string, on: boolean, set: (on: boolean) => void): HTMLElement {
    const box = h('input', { type: 'checkbox', checked: on });
    box.addEventListener('change', () => {
      set(box.checked);
      this.changed();
    });
    return h('label', { class: 'chip' }, box, label);
  }

  private slider(item: ExprItem, name: string): HTMLElement {
    const value = h('input', { type: 'number', class: 'param-value', step: '0.1', value: String(item.params![name]) });
    const range = h('input', { type: 'range', min: '-10', max: '10', step: '0.1', value: String(item.params![name]) });
    const set = (v: number) => {
      if (!Number.isFinite(v)) return;
      item.params![name] = v;
      this.board?.update();
      this.opts.onChange();
    };
    range.addEventListener('input', () => {
      value.value = range.value;
      set(Number(range.value));
    });
    value.addEventListener('input', () => {
      range.value = value.value;
      set(Number(value.value));
    });
    const label = h('span', { class: 'param-name' });
    label.innerHTML = katex.renderToString(`${variableLatex(name)} =`, { throwOnError: false });
    return h('div', { class: 'param' }, label, range, value);
  }

  private tableRow(item: TableItem): HTMLElement {
    const ro = this.opts.readOnly;
    const body = h('tbody');
    const source = () => {
      const src = this.graph.items.find((i): i is ExprItem => i.kind === 'expr' && i.id === item.fromItem);
      const a = src && this.analysis(src);
      return src && a?.kind === 'function' ? (x: number) => a.f(x, src.params ?? {}) : null;
    };
    const renderRows = () => {
      const f = source();
      body.replaceChildren(
        ...item.rows.map((row, r) => {
          const cell = (c: 0 | 1 | 2) => {
            if (c === 1 && f) return h('td', { class: 'computed' }, fmt(f(parseNumber(row[0]))));
            const input = h('input', {
              value: row[c] ?? '', disabled: ro,
              ...(c === 2 ? { class: 'point-label', placeholder: 'label' } : { inputmode: 'decimal' }),
            });
            input.addEventListener('input', () => {
              while (row.length <= c) row.push('');
              row[c] = input.value;
              if (c === 0 && f) renderRows();
              this.changed();
            });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && r === item.rows.length - 1 && !ro) {
                item.rows.push(['', '']);
                renderRows();
                body.querySelectorAll('tr')[r + 1]?.querySelector('input')?.focus();
              }
            });
            return h('td', {}, input);
          };
          return h('tr', {}, cell(0), cell(1), cell(2),
            ro ? null : h('td', {}, h('button', {
              class: 'icon tiny', title: 'Remove row',
              onclick: () => {
                item.rows.splice(r, 1);
                renderRows();
                this.changed();
              },
            }, '−')));
        }),
      );
    };
    renderRows();

    const exprs = this.graph.items.filter((i): i is ExprItem => i.kind === 'expr');
    const select = h('select', { disabled: ro },
      h('option', { value: '' }, 'type y values'),
      ...exprs.map((e) => h('option', { value: e.id, selected: e.id === item.fromItem }, `y from ${e.latex || '(empty)'}`)),
    );
    select.addEventListener('change', () => {
      item.fromItem = select.value || null;
      renderRows();
      this.changed();
    });

    const [swatch, ...buttons] = this.commonButtons(item);
    return h('div', { class: 'graph-item', 'data-item': item.id },
      h('div', { class: 'item-line' }, swatch, h('span', { class: 'item-label' }, 'Table of points'), ...buttons),
      h('table', { class: 'points' }, h('thead', {}, h('tr', {}, h('th', {}, 'x'), h('th', {}, 'y'), h('th', { class: 'label-head' }, 'label'), ro ? null : h('th'))), body),
      this.labelInput(item, 'Label these points, e.g. Candle 2 measurements'),
      ro ? null : h('div', { class: 'table-opts' },
        h('button', {
          class: 'btn small',
          onclick: () => {
            item.rows.push(['', '']);
            renderRows();
          },
        }, '+ Row'),
        this.toggle('Connect points', !!item.connect, (on) => (item.connect = on)),
        exprs.length ? select : null,
      ),
    );
  }

  // -- drawing -------------------------------------------------------------------

  buildBoard(): void {
    if (!this.boardDiv.isConnected || this.boardDiv.clientWidth === 0) return;
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    const board: any = JXG.JSXGraph.initBoard(this.boardDiv.id, {
      boundingbox: this.graph.bbox,
      axis: true,
      grid: true,
      keepAspectRatio: false,
      showCopyright: false,
      showNavigation: true,
      pan: { enabled: true, needShift: false, needTwoFingers: true },
      // Wheel zooming is handled by onWheel (proportional to scroll distance); keep the +/− buttons and pinch.
      zoom: { wheel: false, needShift: false, factorX: 1.2, factorY: 1.2 },
    } as any);
    this.board = board;
    const syncers: (() => boolean)[] = [];

    for (const item of this.graph.items) {
      if (item.hidden) continue;
      if (item.kind === 'expr') this.drawExpr(board, item, syncers);
      else if (item.kind === 'table') this.drawTable(board, item, syncers);
      else this.drawNote(board, item, syncers);
    }

    board.on('boundingbox', () => this.saveBbox());
    board.on('up', () => {
      if (syncers.map((s) => s()).some(Boolean)) this.opts.onChange();
    });
  }

  /** A draggable text on the board; its position is saved with `save`. */
  private draggableText(board: any, text: string, pos: [number, number], color: string, syncers: (() => boolean)[],
    save: (p: [number, number]) => void, current: () => [number, number] | null | undefined, bold = true): void {
    const t = board.create('text', [pos[0], pos[1], text], {
      fixed: this.opts.readOnly, strokeColor: color, fontSize: 14, highlight: false, dragArea: 'all',
      cssStyle: `${bold ? 'font-weight:600;' : ''}background:rgba(255,255,255,0.75);padding:0 3px;border-radius:3px;`,
    });
    syncers.push(() => {
      const p: [number, number] = [round(t.X()), round(t.Y())];
      const was = current();
      if (was && was[0] === p[0] && was[1] === p[1]) return false;
      if (!was && p[0] === round(pos[0]) && p[1] === round(pos[1])) return false;
      save(p);
      return true;
    });
  }

  /** A spot on a curve that is inside the current view, for its first label position. */
  private spotOnCurve(board: any, f: (x: number) => number): [number, number] {
    const [x1, y1, x2, y2] = board.getBoundingBox();
    for (const t of [0.7, 0.55, 0.85, 0.4, 0.25, 0.1]) {
      const x = x1 + (x2 - x1) * t;
      const y = f(x);
      if (Number.isFinite(y) && y < y1 - (y1 - y2) * 0.08 && y > y2 + (y1 - y2) * 0.08) return [x + (x2 - x1) * 0.02, y];
    }
    return [x1 + (x2 - x1) * 0.6, y1 - (y1 - y2) * 0.1];
  }

  private drawItemLabel(board: any, item: ExprItem | TableItem, fallback: () => [number, number], syncers: (() => boolean)[]): void {
    if (!item.label?.trim()) return;
    this.draggableText(board, item.label, item.labelPos ?? fallback(), item.color, syncers,
      (p) => (item.labelPos = p), () => item.labelPos);
  }

  private drawNote(board: any, item: NoteItem, syncers: (() => boolean)[]): void {
    if (!item.text.trim()) return;
    this.draggableText(board, item.text, item.pos, item.color, syncers, (p) => (item.pos = p), () => item.pos, false);
  }

  private drawExpr(board: any, item: ExprItem, syncers: (() => boolean)[]): void {
    const a = this.analysis(item);
    const color = item.color;
    const [x1, y1, x2, y2] = board.getBoundingBox();
    if (a.kind === 'vertical') {
      board.create('line', [[a.x, 0], [a.x, 1]], { strokeColor: color, strokeWidth: 2.5, fixed: true, highlight: false });
      this.drawItemLabel(board, item, () => [a.x + (x2 - x1) * 0.02, y1 - (y1 - y2) * 0.12], syncers);
      return;
    }
    if (a.kind === 'implicit') {
      board.create('implicitcurve', [(x: number, y: number) => a.f(x, y, item.params ?? {})], { strokeColor: color, strokeWidth: 2.5 });
      this.drawItemLabel(board, item, () => [x1 + (x2 - x1) * 0.6, y1 - (y1 - y2) * 0.12], syncers);
      return;
    }
    if (a.kind !== 'function') return;

    const f = (x: number) => a.f(x, item.params ?? {});
    this.drawItemLabel(board, item, () => this.spotOnCurve(board, f), syncers);
    const curve = board.create('functiongraph', [f], { strokeColor: color, strokeWidth: 2.5, highlight: false });

    if (item.showDerivative) {
      board.create('functiongraph', [derivative(f)], { strokeColor: color, strokeWidth: 1.5, dash: 2, highlight: false });
    }

    if (item.tangentAt != null) {
      const x0 = item.tangentAt;
      const g = board.create('glider', [x0, f(x0), curve], { name: '', size: 5, fillColor: color, strokeColor: color });
      board.create('tangent', [g], { strokeColor: color, strokeWidth: 1.5, dash: 1, highlight: false });
      board.create('text', [() => g.X(), () => g.Y(), () => `  slope = ${fmt(derivative(f)(g.X()))}  at x = ${fmt(g.X())}`], {
        anchorY: 'bottom', fontSize: 13, strokeColor: color, fixed: true, highlight: false,
      });
      syncers.push(() => {
        const nx = round(g.X());
        if (nx === item.tangentAt) return false;
        item.tangentAt = nx;
        return true;
      });
    }

    if (item.area) {
      const ig = board.create('integral', [[item.area.from, item.area.to], curve], {
        fillColor: color, fillOpacity: 0.18, strokeWidth: 0, highlight: false,
        label: { visible: false },
        curveLeft: { visible: true, size: 5, fillColor: color, strokeColor: color, name: '', withLabel: false },
        curveRight: { visible: true, size: 5, fillColor: color, strokeColor: color, name: '', withLabel: false },
        baseLeft: { visible: false, withLabel: false },
        baseRight: { visible: false, withLabel: false },
      });
      const left = ig.curveLeft;
      const right = ig.curveRight;
      board.create('text', [() => (left.X() + right.X()) / 2, () => f((left.X() + right.X()) / 2) / 2,
        () => `area = ${fmt(integrate(f, left.X(), right.X()))}`], {
        anchorX: 'middle', fontSize: 13, strokeColor: color, fixed: true, highlight: false,
      });
      syncers.push(() => {
        const from = round(left.X());
        const to = round(right.X());
        if (from === item.area!.from && to === item.area!.to) return false;
        item.area = { from, to };
        return true;
      });
    }
  }

  private drawTable(board: any, item: TableItem, syncers: (() => boolean)[]): void {
    const src = this.graph.items.find((i): i is ExprItem => i.kind === 'expr' && i.id === item.fromItem);
    const a = src && this.analysis(src);
    const f = src && a?.kind === 'function' ? (x: number) => a.f(x, src.params ?? {}) : null;
    const pts = item.rows
      .map(([xs, ys, label]) => {
        const x = parseNumber(xs ?? '');
        return [x, f ? f(x) : parseNumber(ys ?? ''), (label ?? '').trim()] as const;
      })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    for (const [x, y, label] of pts) {
      board.create('point', [x, y], {
        name: label ? `${label} (${fmt(x)}, ${fmt(y)})` : `(${fmt(x)}, ${fmt(y)})`, withLabel: true, fixed: true, size: 4,
        fillColor: item.color, strokeColor: item.color,
        label: { fontSize: 11, strokeColor: item.color, offset: [6, 8] },
      });
    }
    if (item.connect && pts.length > 1) {
      board.create('curve', [pts.map((p) => p[0]), pts.map((p) => p[1])], { strokeColor: item.color, strokeWidth: 2, highlight: false });
    }
    const [x1, y1, x2, y2] = board.getBoundingBox();
    this.drawItemLabel(board, item, () => (pts.length ? [pts[0][0] + (x2 - x1) * 0.03, pts[0][1] - (y1 - y2) * 0.06] : [x1, y1]), syncers);
  }

  /**
   * Zoom around the pointer in proportion to how far you scroll. A trackpad sends many tiny wheel
   * events and a mouse sends a few big ones; zooming a fixed step per event made trackpads far too fast.
   */
  private onWheel = (e: WheelEvent) => {
    const board = this.board;
    if (!board) return;
    e.preventDefault();
    let px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (e.ctrlKey) px *= 5; // a trackpad pinch arrives as small wheel events with Ctrl held
    const k = Math.exp(Math.max(-150, Math.min(150, px)) * ZOOM_PER_PIXEL); // > 1 zooms out
    const [x, y] = board.getUsrCoordsOfMouse(e);
    const [x1, y1, x2, y2] = board.getBoundingBox();
    board.setBoundingBox([x + (x1 - x) * k, y + (y1 - y) * k, x + (x2 - x) * k, y + (y2 - y) * k], false);
  };

  destroy(): void {
    this.resizeObserver.disconnect();
    this.boardDiv.removeEventListener('wheel', this.onWheel);
    this.saveBbox.flush();
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    this.board = null;
  }
}
