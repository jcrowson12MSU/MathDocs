// Graph panel: interactive JSXGraph boards with expressions, tables of points, and calculus tools.

import JXG from 'jsxgraph';
import katex from 'katex';
import { MathfieldElement } from 'mathlive';
import { analyze, derivative, integrate, intersections, variableLatex, type Plottable } from '../mathfn';
import {
  COLORS, DEFAULT_BBOX, exprItem, newGraph, newId, nextColor, noteItem, parseNumber, tableItem,
  type ConstructionItem, type ExprItem, type Graph, type GraphItem, type NoteItem, type Notebook, type TableItem,
  type UnitCircleItem,
} from '../model';
import { debounce, h } from '../ui';
import { ConstructionState, constructionRow, drawConstruction, handleBoardClick, type DrawResult } from './geometry';
import { drawUnitCircle } from './unitcircle';

/** Parent functions the student can draw faintly behind a transformed one. */
const PARENTS: [string, string][] = [
  ['x', 'y = x'], ['x^2', 'y = x²'], ['x^3', 'y = x³'], ['\\left|x\\right|', 'y = |x|'], ['\\sqrt{x}', 'y = √x'],
  ['\\sqrt[3]{x}', 'y = ∛x'], ['\\frac{1}{x}', 'y = 1/x'], ['2^x', 'y = 2ˣ'], ['e^x', 'y = eˣ'], ['\\ln x', 'y = ln x'],
  ['\\sin x', 'y = sin x'], ['\\cos x', 'y = cos x'], ['\\tan x', 'y = tan x'],
];

/** x-axis label in multiples of π/2 (or 90°). */
function piLabel(value: number, degrees: boolean): string {
  if (degrees) return `${Math.round(value)}°`;
  const k = Math.round(value / (Math.PI / 2));
  if (k === 0) return '0';
  const sign = k < 0 ? '−' : '';
  const n = Math.abs(k);
  if (n % 2 === 0) return `${sign}${n / 2 === 1 ? '' : n / 2}π`;
  return `${sign}${n === 1 ? '' : n}π/2`;
}

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : 'undefined');
const round = (n: number) => Math.round(n * 100) / 100;

interface PanelOptions {
  readOnly: boolean;
  onChange: () => void;
  /** Practice mode: don't mark crossings or give the slope triangle's numbers. */
  practice?: () => boolean;
  /** Axis labels to use when a graph has none of its own (what x and y stand for in "Let x = …"). */
  axisDefaults?: () => { x: string; y: string };
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

  /** The "Let x = …" meanings changed: update axis labels that come from them. */
  refreshAxisLabels(): void {
    this.cards.forEach((c) => c.showAxisLabels());
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
  /** Intersection markers currently on the board (recomputed when the view or a slider changes). */
  private crossings: any[] = [];
  private crossingsSoon = debounce(() => this.drawIntersections(), 80);
  private saveBbox = debounce(() => {
    if (!this.board) return;
    this.graph.bbox = this.board.getBoundingBox().map(round) as Graph['bbox'];
    this.opts.onChange();
  }, 400);

  private geo = new ConstructionState();
  private geoDrawn: DrawResult | null = null;
  private xAxisLabel = h('div', { class: 'axis-label x' });
  private yAxisLabel = h('div', { class: 'axis-label y' });
  private axisInputs: Partial<Record<'x' | 'y', HTMLInputElement>> = {};
  private practiceNote = h('span', { class: 'muted small practice-note', hidden: true }, 'Practice mode: crossings aren’t marked');

  constructor(private graph: Graph, private opts: PanelOptions, onDelete: () => void) {
    this.boardDiv = h('div', { class: 'board', id: `board-${graph.id}-${Math.random().toString(36).slice(2)}` });
    const ro = opts.readOnly;
    const axisInput = (axis: 'x' | 'y') => {
      const key = axis === 'x' ? 'xLabel' : 'yLabel';
      const input = h('input', {
        class: 'axis-input', value: graph[key] ?? '',
        placeholder: axis === 'x' ? 'e.g. time (hours)' : 'e.g. height (cm)',
      });
      this.axisInputs[axis] = input;
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
      ro ? null : h('div', { class: 'axis-fields' }, axisInput('x'), axisInput('y'),
        this.toggle('Mark intersections', graph.intersections !== false, (on) => (graph.intersections = on ? undefined : false)),
        this.toggle('Degrees', graph.angles === 'deg', (on) => this.setDegrees(on)),
        this.toggle('π ticks', !!graph.piTicks, (on) => (graph.piTicks = on || undefined)),
        this.toggle('Same scale', !!graph.square, (on) => (graph.square = on || undefined)),
        this.practiceNote),
      this.itemsEl,
      ro ? null : h('div', { class: 'graph-add' },
        h('button', { class: 'btn small', onclick: () => this.addItem(exprItem('', nextColor(graph))) }, '+ Expression'),
        h('button', { class: 'btn small', onclick: () => this.addItem(tableItem(nextColor(graph))) }, '+ Table of points'),
        h('button', { class: 'btn small', title: 'A text note you can drag anywhere on the graph', onclick: () => this.addNote() }, '+ Note'),
        h('button', { class: 'btn small', title: 'The unit circle with a draggable angle', onclick: () => this.addUnitCircle() }, '+ Unit circle'),
        h('button', { class: 'btn small', title: 'Points, segments, circles and constructions', onclick: () => this.addConstruction() }, '+ Construction'),
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
    this.boardDiv.addEventListener('wheel', this.onPinchWheel, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      this.boardDiv.addEventListener(type, this.onGesture as EventListener, { passive: false });
    }
  }

  /** Zoom around the pointer using JSXGraph's own zoomIn/zoomOut (factor > 1 zooms in). */
  private zoomBy(factor: number, e: { clientX: number; clientY: number }): void {
    const board = this.board;
    if (!board || !Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    const zoom = board.attr.zoom;
    const saved = [zoom.factorx, zoom.factory];
    const step = factor > 1 ? factor : 1 / factor;
    zoom.factorx = zoom.factory = step;
    try {
      const [x, y] = board.getUsrCoordsOfMouse(e);
      if (factor > 1) board.zoomIn(x, y);
      else board.zoomOut(x, y);
    } finally {
      // Put the +/− buttons' step back.
      [zoom.factorx, zoom.factory] = saved;
    }
  }

  /** Chrome and Firefox report a trackpad pinch as wheel events with Ctrl held; plain scrolling scrolls the page. */
  private onPinchWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.01), e);
  };

  /** Safari reports a trackpad pinch as gesture events with a running scale. */
  private gestureScale = 1;
  private onGesture = (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault(); // stop Safari zooming the whole page
    if (e.type === 'gesturestart') this.gestureScale = 1;
    else if (e.type === 'gesturechange' && e.scale) {
      this.zoomBy(e.scale / this.gestureScale, { clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
      this.gestureScale = e.scale;
    }
  };

  showAxisLabels(): void {
    // A label typed on the graph wins; otherwise use what x and y stand for in the "Let x = …" box.
    const defaults = this.opts.axisDefaults?.() ?? { x: '', y: '' };
    this.xAxisLabel.textContent = this.graph.xLabel ?? defaults.x;
    this.yAxisLabel.textContent = this.graph.yLabel ?? defaults.y;
    for (const axis of ['x', 'y'] as const) {
      const input = this.axisInputs[axis];
      if (input && defaults[axis]) input.placeholder = defaults[axis];
    }
  }

  /** Switch between radians and degrees, keeping the same part of the x-axis in view. */
  private setDegrees(on: boolean): void {
    if (on === (this.graph.angles === 'deg')) return;
    const k = on ? 180 / Math.PI : Math.PI / 180;
    const [x1, y1, x2, y2] = this.graph.bbox;
    this.graph.bbox = [x1 * k, y1, x2 * k, y2];
    this.graph.angles = on ? 'deg' : undefined;
    this.analyses.clear();
    this.renderItems();
  }

  private addUnitCircle(): void {
    const item: UnitCircleItem = { id: newId(), kind: 'unitcircle', color: nextColor(this.graph), angle: Math.PI / 3 };
    this.graph.bbox = [-1.7, 1.5, 1.7, -1.5];
    this.graph.square = true;
    this.addItem(item);
    this.buildBoard();
  }

  private addConstruction(): void {
    const item: ConstructionItem = { id: newId(), kind: 'construction', color: nextColor(this.graph), objects: [] };
    this.graph.square = true;
    this.geo.tool = 'point';
    this.addItem(item);
    this.buildBoard();
  }

  private addNote(): void {
    const [x1, y1, x2, y2] = this.board?.getBoundingBox() ?? this.graph.bbox;
    this.addItem(noteItem([round((x1 + x2) / 2), round((y1 + y2) / 2)]));
  }

  private analysis(item: ExprItem): Plottable {
    let a = this.analyses.get(item.id);
    if (!a) {
      a = analyze(item.latex, { degrees: this.graph.angles === 'deg' });
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
        item.kind === 'expr' ? this.exprRow(item)
        : item.kind === 'table' ? this.tableRow(item)
        : item.kind === 'unitcircle' ? this.unitCircleRow(item)
        : item.kind === 'construction' ? constructionRow(item, this.geo, {
            readOnly: this.opts.readOnly,
            onChange: () => this.opts.onChange(),
            redraw: () => this.buildBoard(),
          }, this.commonButtons(item))
        : this.noteRow(item),
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
      const names = 'params' in a ? a.params : [];
      item.params ??= {};
      for (const n of names) item.params[n] ??= 1;
      params.replaceChildren(...names.map((n) => this.slider(item, n)));
      // Calculus tools only make sense for y = f(x).
      tools.replaceChildren();
      if (a.kind === 'function' && !this.opts.readOnly) {
        tools.append(
          this.toggle('f′ derivative', !!item.showDerivative, (on) => (item.showDerivative = on)),
          this.toggle('Slope triangle', item.slopeTriangle != null, (on) => (item.slopeTriangle = on ? { x1: 0, x2: 1 } : null)),
          this.toggle('Tangent line', item.tangentAt != null, (on) => (item.tangentAt = on ? 1 : null)),
          this.toggle('Area under curve', item.area != null, (on) => (item.area = on ? { from: 0, to: 2 } : null)),
          this.parentSelect(item),
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

  /** Pick a parent function (y = x², y = |x| …) to draw faintly behind this one. */
  private parentSelect(item: ExprItem): HTMLElement {
    const select = h('select', { class: 'parent-select', title: 'Draw a parent function faintly behind this one' },
      h('option', { value: '' }, 'Parent: none'),
      ...PARENTS.map(([latex, label]) => h('option', { value: latex, selected: item.parent === latex }, `Parent: ${label}`)));
    select.addEventListener('change', () => {
      item.parent = select.value || null;
      this.changed();
    });
    return h('label', { class: 'chip' }, select);
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

  private unitCircleRow(item: UnitCircleItem): HTMLElement {
    const [swatch, ...buttons] = this.commonButtons(item);
    return h('div', { class: 'graph-item', 'data-item': item.id },
      h('div', { class: 'item-line' }, swatch, h('span', { class: 'geo-title' }, 'Unit circle'), ...buttons),
      h('div', { class: 'muted small' }, 'Drag the point around the circle; it stops every 15°. Its coordinates are (?, ?) — that part is yours.'));
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
      this.crossingsSoon();
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
    this.showAxisLabels();
    if (!this.boardDiv.isConnected || this.boardDiv.clientWidth === 0) return;
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    const board: any = JXG.JSXGraph.initBoard(this.boardDiv.id, {
      boundingbox: this.graph.bbox,
      axis: true,
      grid: true,
      keepAspectRatio: !!this.graph.square,
      ...(this.graph.piTicks ? {
        defaultAxes: {
          x: {
            ticks: {
              insertTicks: false, ticksDistance: this.graph.angles === 'deg' ? 90 : Math.PI / 2, minorTicks: 1,
              generateLabelText: (tick: any, zero: any) => piLabel(tick.usrCoords[1] - zero.usrCoords[1], this.graph.angles === 'deg'),
            },
          },
        },
      } : {}),
      showCopyright: false,
      showNavigation: true,
      pan: { enabled: true, needShift: false, needTwoFingers: true },
      // Two-finger scrolling scrolls the page; pinching zooms (see onPinchWheel / onGesture).
      zoom: { wheel: false, needShift: false, factorX: 1.2, factorY: 1.2 },
    } as any);
    this.board = board;
    const syncers: (() => boolean)[] = [];

    for (const item of this.graph.items) {
      if (item.hidden) continue;
      if (item.kind === 'expr') this.drawExpr(board, item, syncers);
      else if (item.kind === 'table') this.drawTable(board, item, syncers);
      else if (item.kind === 'unitcircle') drawUnitCircle(board, item, { readOnly: this.opts.readOnly, degrees: this.graph.angles === 'deg' }, syncers);
      else if (item.kind === 'construction') {
        this.geoDrawn = drawConstruction(board, item, {
          readOnly: this.opts.readOnly, practice: this.opts.practice?.() ?? false, picked: this.geo.picked,
        }, syncers);
        this.wireConstruction(board, item);
      } else this.drawNote(board, item, syncers);
    }

    this.crossings = [];
    this.drawIntersections();
    board.on('boundingbox', () => {
      this.saveBbox();
      this.crossingsSoon();
    });
    board.on('up', () => {
      if (syncers.map((s) => s()).some(Boolean)) this.opts.onChange();
    });
  }

  /**
   * Mark where the graph's lines and curves (y = …, and vertical lines like x = 3) cross, within the
   * current view, labeled with their coordinates. Redrawn when the view or a slider changes.
   */
  private drawIntersections(): void {
    const board = this.board;
    if (!board) return;
    for (const el of this.crossings) board.removeObject(el);
    this.crossings = [];
    const practice = this.opts.practice?.() ?? false;
    this.practiceNote.hidden = !practice || this.graph.intersections === false;
    if (this.graph.intersections === false || practice) return;

    const curves: ((x: number) => number)[] = [];
    const verticals: number[] = [];
    for (const item of this.graph.items) {
      if (item.kind !== 'expr' || item.hidden) continue;
      const a = this.analysis(item);
      if (a.kind === 'function') curves.push((x) => a.f(x, item.params ?? {}));
      else if (a.kind === 'verticals') verticals.push(...a.xs);
    }
    if (curves.length + verticals.length < 2 && !(curves.length && verticals.length)) return;

    const [x1, y1, x2, y2] = board.getBoundingBox();
    const inView = ([x, y]: [number, number]) => x >= x1 && x <= x2 && y <= y1 && y >= y2;
    const found: [number, number][] = [];
    for (let i = 0; i < curves.length; i++) {
      for (let j = i + 1; j < curves.length; j++) {
        for (const x of intersections(curves[i], curves[j], x1, x2)) found.push([x, curves[i](x)]);
      }
    }
    for (const x of verticals) for (const f of curves) found.push([x, f(x)]);

    // One marker per spot (three lines through one point give one marker), at most 40.
    const near = (p: [number, number], q: [number, number]) =>
      Math.abs(p[0] - q[0]) < (x2 - x1) / 500 && Math.abs(p[1] - q[1]) < (y1 - y2) / 500;
    const points = found.filter((p, i) => Number.isFinite(p[1]) && inView(p) && !found.slice(0, i).some((q) => near(p, q))).slice(0, 40);
    for (const [x, y] of points) {
      this.crossings.push(board.create('point', [x, y], {
        name: `(${fmt(x)}, ${fmt(y)})`, withLabel: true, fixed: true, highlight: false,
        size: 4, fillColor: '#ffffff', strokeColor: '#1d2433', strokeWidth: 2,
        label: { fontSize: 12, strokeColor: '#1d2433', offset: [8, -12], cssStyle: 'font-weight:600;background:rgba(255,255,255,0.8);padding:0 3px;border-radius:3px;' },
      }));
    }
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

  /** Clicks on the board with a construction tool chosen build the construction. */
  private wireConstruction(board: any, item: ConstructionItem): void {
    if (this.opts.readOnly) return;
    let down: [number, number] | null = null;
    board.on('down', (e: PointerEvent) => (down = [e.clientX, e.clientY]));
    board.on('up', (e: PointerEvent) => {
      if (!down || this.geo.tool === 'move' || !this.geoDrawn) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 5) return;
      if (handleBoardClick(board, e, item, this.geo, this.geoDrawn)) {
        this.opts.onChange();
        // Redraw after JSXGraph finishes handling this click.
        setTimeout(() => {
          this.buildBoard();
          this.geo.hintEl?.dispatchEvent(new Event('refresh'));
        });
      }
    });
  }

  private drawNote(board: any, item: NoteItem, syncers: (() => boolean)[]): void {
    if (!item.text.trim()) return;
    this.draggableText(board, item.text, item.pos, item.color, syncers, (p) => (item.pos = p), () => item.pos, false);
  }

  private drawExpr(board: any, item: ExprItem, syncers: (() => boolean)[]): void {
    const a = this.analysis(item);
    const color = item.color;
    const [x1, y1, x2, y2] = board.getBoundingBox();
    if (a.kind === 'region') {
      // y < f(x): shade below the boundary; dashed when the boundary isn't included (< or >).
      const f = (x: number) => a.f(x, item.params ?? {});
      const boundary = board.create('functiongraph', [f], {
        strokeColor: color, strokeWidth: 2.5, highlight: false, dash: a.inclusive ? 0 : 2,
      });
      board.create('inequality', [boundary], {
        inverse: a.shade === 'above', fillColor: color, fillOpacity: 0.18, highlight: false,
      });
      this.drawItemLabel(board, item, () => this.spotOnCurve(board, f), syncers);
      return;
    }
    if (a.kind === 'xbands') {
      // x > 3, x² < 9, …: shade each band where it's true, edges dashed when not included.
      for (const band of a.intervals) {
        const fill = board.create('curve', [[], []], { fillColor: color, fillOpacity: 0.18, strokeWidth: 0, highlight: false });
        fill.updateDataArray = function () {
          const [bx1, by1, bx2, by2] = board.getBoundingBox();
          const pad = (bx2 - bx1) * 2;
          const left = Math.max(band.from, bx1 - pad);
          const right = Math.min(band.to, bx2 + pad);
          const top = by1 + (by1 - by2);
          const bottom = by2 - (by1 - by2);
          this.dataX = [left, right, right, left, left];
          this.dataY = [bottom, bottom, top, top, bottom];
        };
        for (const [edge, closed] of [[band.from, band.fromClosed], [band.to, band.toClosed]] as const) {
          if (!Number.isFinite(edge)) continue;
          board.create('line', [[edge, 0], [edge, 1]], {
            strokeColor: color, strokeWidth: 2.5, dash: closed ? 0 : 2, fixed: true, highlight: false,
            point1: { visible: false }, point2: { visible: false },
          });
        }
      }
      board.update();
      return;
    }
    if (a.kind === 'verticals') {
      for (const x of a.xs) {
        board.create('line', [[x, 0], [x, 1]], {
          strokeColor: color, strokeWidth: 2.5, fixed: true, highlight: false,
          point1: { visible: false }, point2: { visible: false },
        });
      }
      this.drawItemLabel(board, item, () => [a.xs[0] + (x2 - x1) * 0.02, y1 - (y1 - y2) * 0.12], syncers);
      return;
    }
    if (a.kind === 'points') {
      for (const pt of a.points) {
        const at = () => pt(item.params ?? {});
        board.create('point', [() => at()[0], () => at()[1]], {
          name: () => `(${fmt(at()[0])}, ${fmt(at()[1])})`, withLabel: true, fixed: true, size: 4,
          fillColor: color, strokeColor: color, label: { fontSize: 11, strokeColor: color, offset: [6, 8] },
        });
      }
      const first = a.points[0]?.(item.params ?? {}) ?? [0, 0];
      this.drawItemLabel(board, item, () => [first[0] + (x2 - x1) * 0.03, first[1] - (y1 - y2) * 0.06], syncers);
      return;
    }
    if (a.kind === 'implicit') {
      board.create('implicitcurve', [(x: number, y: number) => a.f(x, y, item.params ?? {})], { strokeColor: color, strokeWidth: 2.5 });
      this.drawItemLabel(board, item, () => [x1 + (x2 - x1) * 0.6, y1 - (y1 - y2) * 0.12], syncers);
      return;
    }
    if (a.kind === 'polar' || a.kind === 'parametric') {
      const p = () => item.params ?? {};
      const k = a.kind === 'polar' && this.graph.angles === 'deg' ? Math.PI / 180 : 1;
      const X = a.kind === 'polar' ? (t: number) => a.f(t, p()) * Math.cos(t * k) : (t: number) => a.x(t, p());
      const Y = a.kind === 'polar' ? (t: number) => a.f(t, p()) * Math.sin(t * k) : (t: number) => a.y(t, p());
      board.create('curve', [X, Y, a.from, a.to], { strokeColor: color, strokeWidth: 2.5, highlight: false, numberPointsHigh: 1600 });
      const mid = (a.from + a.to) / 3;
      this.drawItemLabel(board, item, () => [X(mid), Y(mid)], syncers);
      return;
    }
    if (a.kind !== 'function') return;

    const f = (x: number) => a.f(x, item.params ?? {});
    if (item.parent) {
      const parent = analyze(`y=${item.parent}`, { degrees: this.graph.angles === 'deg' });
      if (parent.kind === 'function') {
        board.create('functiongraph', [(x: number) => parent.f(x, {})], { strokeColor: '#adb5bd', strokeWidth: 2, dash: 1, highlight: false });
      }
    }
    this.drawItemLabel(board, item, () => this.spotOnCurve(board, f), syncers);
    const curve = board.create('functiongraph', [f], { strokeColor: color, strokeWidth: 2.5, highlight: false });
    // Ends of a restricted domain: a filled dot if the end is included, an open one if not.
    for (const i of a.domain ?? []) {
      for (const [end, closed, inward] of [[i.from, i.fromClosed, 1], [i.to, i.toClosed, -1]] as const) {
        if (!Number.isFinite(end)) continue;
        const near = (q: number) => a.f(end + inward * q * Math.max(1, Math.abs(end)), item.params ?? {});
        const y = () => (closed ? f(end) : near(1e-9));
        board.create('point', [end, y], {
          name: '', size: 4, fixed: true, highlight: false, showInfobox: false, withLabel: false,
          fillColor: closed ? color : '#ffffff', strokeColor: color, strokeWidth: 2,
        });
      }
    }
    // Holes: where the expression is undefined but the graph continues on both sides.
    for (const [hx, hy] of a.holes ?? []) {
      board.create('point', [hx, hy], {
        name: '', size: 4, fixed: true, highlight: false, showInfobox: false, withLabel: false,
        fillColor: '#ffffff', strokeColor: color, strokeWidth: 2,
      });
    }

    if (item.showDerivative) {
      board.create('functiongraph', [derivative(f)], { strokeColor: color, strokeWidth: 1.5, dash: 2, highlight: false });
    }

    if (item.slopeTriangle) this.drawSlopeTriangle(board, item, f, color, syncers);

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

  /**
   * Two points on the line (dragged along it, landing on whole-number x) and the right triangle between
   * them: run across, rise up. It shows rise and run, never the slope, so the dividing is left to the student.
   * In practice mode the numbers are left off too.
   */
  private drawSlopeTriangle(board: any, item: ExprItem, f: (x: number) => number, color: string, syncers: (() => boolean)[]): void {
    const tri = item.slopeTriangle!;
    const practice = this.opts.practice?.() ?? false;
    const opts = { size: 5, fillColor: color, strokeColor: color, strokeWidth: 2, withLabel: false, fixed: this.opts.readOnly, showInfobox: false, name: '' };
    const p1: any = board.create('point', [tri.x1, f(tri.x1)], opts);
    const p2: any = board.create('point', [tri.x2, f(tri.x2)], opts);
    for (const p of [p1, p2]) {
      if (!practice) {
        board.create('text', [() => p.X(), () => p.Y(), () => `(${fmt(p.X())}, ${fmt(p.Y())})  `], {
          anchorX: 'right', anchorY: 'bottom', fontSize: 13, strokeColor: color, fixed: true, highlight: false,
        });
      }
      // Dragged anywhere, a point lands back on the line at the nearest whole-number x.
      p.on('drag', () => {
        const x = Math.round(p.X());
        const y = f(x);
        if (Number.isFinite(y)) p.setPositionDirectly(JXG.COORDS_BY_USER, [x, y]);
      });
    }
    const corner: any = board.create('point', [() => p2.X(), () => p1.Y()], { visible: false, withLabel: false, name: '' });
    const side = { strokeColor: '#e8590c', strokeWidth: 2, dash: 2, highlight: false, fixed: true };
    board.create('segment', [p1, corner], side);
    board.create('segment', [corner, p2], side);
    const text = { fontSize: 13, strokeColor: '#e8590c', fixed: true, highlight: false };
    board.create('text', [() => (p1.X() + p2.X()) / 2, () => p1.Y(),
      () => (practice ? 'run' : `run = ${fmt(p2.X() - p1.X())}`)], { ...text, anchorX: 'middle', anchorY: p2.Y() >= p1.Y() ? 'top' : 'bottom' });
    board.create('text', [() => p2.X(), () => (p1.Y() + p2.Y()) / 2,
      () => (practice ? '  rise' : `  rise = ${fmt(p2.Y() - p1.Y())}`)], { ...text, anchorX: 'left', anchorY: 'middle' });
    syncers.push(() => {
      const x1 = Math.round(p1.X());
      const x2 = Math.round(p2.X());
      if (x1 === tri.x1 && x2 === tri.x2) return false;
      item.slopeTriangle = { x1, x2 };
      return true;
    });
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

  destroy(): void {
    this.resizeObserver.disconnect();
    this.boardDiv.removeEventListener('wheel', this.onPinchWheel);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      this.boardDiv.removeEventListener(type, this.onGesture as EventListener);
    }
    this.saveBbox.flush();
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    this.board = null;
  }
}
