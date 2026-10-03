// Geometry constructions on a graph: points, segments, lines, circles and polygons, and constructions built
// from them (midpoint, perpendicular, parallel, bisectors, intersections). Everything is built from the
// points, so dragging a point moves what depends on it. The ruler and protractor show lengths and angles,
// except in practice mode. Choosing the steps is the student's work.

import type { ConstructionItem, GeoObject } from '../model';
import { newId } from '../model';
import { h } from '../ui';

export type GeoTool =
  | 'move' | 'point' | 'segment' | 'line' | 'ray' | 'circle' | 'polygon' | 'midpoint'
  | 'perpendicular' | 'parallel' | 'perpbisector' | 'anglebisector' | 'intersection' | 'length' | 'angle';

type Pick = 'point' | 'linear' | 'curve';

interface ToolInfo {
  tool: GeoTool;
  label: string;
  /** What to click, in order. */
  picks: Pick[] | 'polygon';
  hint: string;
}

export const TOOLS: ToolInfo[] = [
  { tool: 'move', label: '✋ Move', picks: [], hint: 'Drag points to move them.' },
  { tool: 'point', label: '• Point', picks: ['point'], hint: 'Click to place a point.' },
  { tool: 'segment', label: '— Segment', picks: ['point', 'point'], hint: 'Click two points (or empty spots).' },
  { tool: 'line', label: '↔ Line', picks: ['point', 'point'], hint: 'Click two points the line goes through.' },
  { tool: 'ray', label: '→ Ray', picks: ['point', 'point'], hint: 'Click the endpoint, then a point the ray goes through.' },
  { tool: 'circle', label: '○ Circle', picks: ['point', 'point'], hint: 'Click the center, then a point on the circle (compass).' },
  { tool: 'polygon', label: '△ Polygon', picks: 'polygon', hint: 'Click the corners; click the first corner again to finish.' },
  { tool: 'midpoint', label: 'M Midpoint', picks: ['point', 'point'], hint: 'Click the two endpoints.' },
  { tool: 'perpendicular', label: '⊥ Perpendicular', picks: ['linear', 'point'], hint: 'Click a line or segment, then a point.' },
  { tool: 'parallel', label: '∥ Parallel', picks: ['linear', 'point'], hint: 'Click a line or segment, then a point.' },
  { tool: 'perpbisector', label: '⊥ Bisector', picks: ['point', 'point'], hint: 'Click the two endpoints of the segment.' },
  { tool: 'anglebisector', label: '∠ Bisector', picks: ['point', 'point', 'point'], hint: 'Click a point on one side, the vertex, then a point on the other side.' },
  { tool: 'intersection', label: '✕ Intersect', picks: ['curve', 'curve'], hint: 'Click two lines or circles to mark where they cross.' },
  { tool: 'length', label: '📏 Ruler', picks: ['point', 'point'], hint: 'Click two points to measure the distance.' },
  { tool: 'angle', label: '📐 Protractor', picks: ['point', 'point', 'point'], hint: 'Click a point on one side, the vertex, then a point on the other side.' },
];

const LINEAR = new Set(['segment', 'line', 'ray', 'perpendicular', 'parallel', 'perpbisector', 'anglebisector']);
const POINTLIKE = new Set(['point', 'midpoint', 'intersection']);

/** The tool in use and what's been clicked so far (kept across board redraws). */
export class ConstructionState {
  tool: GeoTool = 'move';
  picked: string[] = [];
  /** The cursor's last spot, for a new point. */
  hintEl: HTMLElement | null = null;
}

/** Next unused point name: A, B, … Z, then A_1, B_1 … */
function nextName(objects: GeoObject[]): string {
  const used = new Set(objects.filter((o) => 'name' in o).map((o) => (o as { name: string }).name));
  for (let n = 0; ; n++) {
    for (let c = 0; c < 26; c++) {
      const name = String.fromCharCode(65 + c) + (n ? `_${n}` : '');
      if (!used.has(name)) return name;
    }
  }
}

const dist = (a: any, b: any) => Math.hypot(a.X() - b.X(), a.Y() - b.Y());
const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace('-', '−');

/** Angle a–b–c in degrees (0…180). */
function degrees(a: any, b: any, c: any): number {
  const u = [a.X() - b.X(), a.Y() - b.Y()];
  const v = [c.X() - b.X(), c.Y() - b.Y()];
  const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export interface DrawResult {
  elements: Map<string, any>;
  /** JSXGraph element id → construction object id. */
  owner: Map<string, string>;
}

/** Build the construction's objects on the board, in order. */
export function drawConstruction(
  board: any,
  item: ConstructionItem,
  opts: { readOnly: boolean; practice: boolean; picked: string[] },
  syncers: (() => boolean)[],
): DrawResult {
  const color = item.color;
  const els = new Map<string, any>();
  const owner = new Map<string, string>();
  const keep = (o: GeoObject, el: any) => {
    els.set(o.id, el);
    if (el?.id) owner.set(el.id, o.id);
    return el;
  };
  const pointStyle = (o: GeoObject, free: boolean) => ({
    name: (o as { name?: string }).name ?? '', size: free ? 4 : 3,
    fillColor: opts.picked.includes(o.id) ? '#fab005' : free ? color : '#ffffff', strokeColor: color, strokeWidth: 2,
    fixed: opts.readOnly || !free, showInfobox: false, label: { fontSize: 14, strokeColor: color, offset: [8, 8] },
  });
  const line = { strokeColor: color, strokeWidth: 2, highlight: true, fixed: true };
  const helper = { strokeColor: '#868e96', strokeWidth: 1.5, dash: 2, highlight: true, fixed: true };
  const get = (id: string) => els.get(id);

  for (const o of item.objects) {
    try {
      switch (o.type) {
        case 'point': {
          const p = keep(o, board.create('point', [o.x, o.y], pointStyle(o, true)));
          syncers.push(() => {
            const x = Math.round(p.X() * 100) / 100;
            const y = Math.round(p.Y() * 100) / 100;
            if (x === o.x && y === o.y) return false;
            o.x = x;
            o.y = y;
            return true;
          });
          break;
        }
        case 'segment':
          keep(o, board.create('segment', [get(o.of[0]), get(o.of[1])], line));
          break;
        case 'line':
          keep(o, board.create('line', [get(o.of[0]), get(o.of[1])], line));
          break;
        case 'ray':
          keep(o, board.create('line', [get(o.of[0]), get(o.of[1])], { ...line, straightFirst: false, straightLast: true }));
          break;
        case 'circle':
          keep(o, board.create('circle', [get(o.center), get(o.through)], line));
          break;
        case 'polygon':
          keep(o, board.create('polygon', o.of.map(get), {
            fillColor: color, fillOpacity: 0.08, highlight: false, fixed: true, vertices: { visible: false },
            borders: { strokeColor: color, strokeWidth: 2, fixed: true, highlight: true },
          }));
          break;
        case 'midpoint':
          keep(o, board.create('midpoint', [get(o.of[0]), get(o.of[1])], pointStyle(o, false)));
          break;
        case 'perpendicular':
          keep(o, board.create('perpendicular', [get(o.to), get(o.through)], { ...helper, point: { visible: false } }));
          break;
        case 'parallel':
          keep(o, board.create('parallel', [get(o.to), get(o.through)], { ...helper, point: { visible: false } }));
          break;
        case 'perpbisector': {
          const [a, b] = o.of.map(get);
          const m = board.create('midpoint', [a, b], { visible: false, withLabel: false });
          const ab = board.create('line', [a, b], { visible: false });
          keep(o, board.create('perpendicular', [ab, m], { ...helper, point: { visible: false } }));
          break;
        }
        case 'anglebisector':
          keep(o, board.create('bisector', [get(o.of[0]), get(o.of[1]), get(o.of[2])], { ...helper, point: { visible: false } }));
          break;
        case 'intersection':
          keep(o, board.create('intersection', [get(o.of[0]), get(o.of[1]), o.which], pointStyle(o, false)));
          break;
        case 'length': {
          const [a, b] = o.of.map(get);
          // Just off the middle of the segment, on the side away from the left/top.
          const off = () => {
            const len = dist(a, b) || 1;
            const nx = -(b.Y() - a.Y()) / len;
            const ny = (b.X() - a.X()) / len;
            const s = (ny > 0 ? -1 : 1) * 0.35 * (board.getBoundingBox()[2] - board.getBoundingBox()[0]) / 20;
            return [nx * s, ny * s];
          };
          keep(o, board.create('text', [() => (a.X() + b.X()) / 2 + off()[0], () => (a.Y() + b.Y()) / 2 + off()[1],
            () => (opts.practice ? '' : fmt(dist(a, b)))], {
            fontSize: 13, strokeColor: '#e8590c', fixed: true, highlight: false, anchorX: 'middle', anchorY: 'middle',
          }));
          break;
        }
        case 'angle': {
          const [a, b, c] = o.of.map(get);
          board.create('nonreflexangle', [a, b, c], {
            radius: () => Math.min(dist(a, b), dist(c, b)) / 4, fillColor: '#e8590c', fillOpacity: 0.15,
            strokeColor: '#e8590c', withLabel: false, highlight: false, fixed: true,
          });
          // Inside the angle, along its bisector, just past the arc.
          const at = () => {
            const ua = [a.X() - b.X(), a.Y() - b.Y()];
            const uc = [c.X() - b.X(), c.Y() - b.Y()];
            const la = Math.hypot(ua[0], ua[1]) || 1;
            const lc = Math.hypot(uc[0], uc[1]) || 1;
            const m = [ua[0] / la + uc[0] / lc, ua[1] / la + uc[1] / lc];
            const lm = Math.hypot(m[0], m[1]) || 1;
            const r = (Math.min(la, lc) / 4) * 1.9;
            return [b.X() + (m[0] / lm) * r, b.Y() + (m[1] / lm) * r];
          };
          keep(o, board.create('text', [() => at()[0], () => at()[1], () => (opts.practice ? '' : `${Math.round(degrees(a, b, c) * 10) / 10}°`)], {
            fontSize: 13, strokeColor: '#e8590c', fixed: true, highlight: false, anchorX: 'middle', anchorY: 'middle',
          }));
          break;
        }
      }
    } catch {
      // A missing or deleted dependency: skip this object.
    }
  }
  return { elements: els, owner };
}

/**
 * A click on the board while a tool is chosen: pick a point or line under the mouse (or make a new point)
 * and add the object once everything it needs has been clicked. Returns true if the construction changed.
 */
export function handleBoardClick(board: any, e: Event, item: ConstructionItem, state: ConstructionState, drawn: DrawResult): boolean {
  const info = TOOLS.find((t) => t.tool === state.tool);
  if (!info || state.tool === 'move') return false;
  const raw = board.getAllObjectsUnderMouse(e) as any[];
  const under: string[] = raw.map((el) => drawn.owner.get(el.id)).filter((id): id is string => !!id);
  const objOf = (id: string) => item.objects.find((o) => o.id === id);
  // A polygon's side works like a segment: add one between its two corners (once) and use that.
  const sideOf = (): string | undefined => {
    const side = raw.find((el) => el.elType === 'segment' && !drawn.owner.has(el.id) && el.point1 && el.point2);
    if (!side) return undefined;
    const p = drawn.owner.get(side.point1.id);
    const q = drawn.owner.get(side.point2.id);
    if (!p || !q) return undefined;
    const existing = item.objects.find((o) => o.type === 'segment' && ((o.of[0] === p && o.of[1] === q) || (o.of[0] === q && o.of[1] === p)));
    if (existing) return existing.id;
    const seg: GeoObject = { id: newId(), type: 'segment', of: [p, q] };
    item.objects.push(seg);
    return seg.id;
  };
  const pointUnder = under.find((id) => POINTLIKE.has(objOf(id)?.type ?? ''));
  const step = info.picks === 'polygon' ? 'point' : info.picks[state.picked.length];

  let pickedId: string | undefined;
  if (step === 'point') {
    pickedId = pointUnder;
    if (!pickedId) {
      const [x, y] = board.getUsrCoordsOfMouse(e) as number[];
      const p: GeoObject = { id: newId(), type: 'point', name: nextName(item.objects), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      item.objects.push(p);
      pickedId = p.id;
      if (state.tool === 'point') return true;
    } else if (state.tool === 'point') return false;
  } else if (step === 'linear') {
    pickedId = under.find((id) => LINEAR.has(objOf(id)?.type ?? '')) ?? sideOf();
  } else if (step === 'curve') {
    pickedId = under.find((id) => LINEAR.has(objOf(id)?.type ?? '') || objOf(id)?.type === 'circle') ?? sideOf();
  }
  if (!pickedId) return false;

  if (info.picks === 'polygon') {
    if (state.picked[0] === pickedId && state.picked.length >= 3) {
      item.objects.push({ id: newId(), type: 'polygon', of: [...state.picked] });
      state.picked = [];
      return true;
    }
    if (!state.picked.includes(pickedId)) state.picked.push(pickedId);
    return true;
  }
  state.picked.push(pickedId);
  if (state.picked.length < info.picks.length) return true;

  const [a, b, c] = state.picked;
  state.picked = [];
  const id = newId();
  switch (state.tool) {
    case 'segment': case 'line': case 'ray':
      if (a !== b) item.objects.push({ id, type: state.tool, of: [a, b] });
      break;
    case 'circle':
      if (a !== b) item.objects.push({ id, type: 'circle', center: a, through: b });
      break;
    case 'midpoint':
      if (a !== b) item.objects.push({ id, type: 'midpoint', name: nextName(item.objects), of: [a, b] });
      break;
    case 'perpendicular': case 'parallel':
      item.objects.push({ id, type: state.tool, to: a, through: b });
      break;
    case 'perpbisector':
      if (a !== b) item.objects.push({ id, type: 'perpbisector', of: [a, b] });
      break;
    case 'anglebisector':
      item.objects.push({ id, type: 'anglebisector', of: [a, b, c] });
      break;
    case 'intersection': {
      if (a === b) break;
      // Two lines cross once; with a circle there can be two crossings: mark both.
      const circle = [a, b].some((x) => objOf(x)?.type === 'circle');
      item.objects.push({ id, type: 'intersection', name: nextName(item.objects), of: [a, b], which: 0 });
      if (circle) item.objects.push({ id: newId(), type: 'intersection', name: nextName(item.objects), of: [a, b], which: 1 });
      break;
    }
    case 'length':
      if (a !== b) item.objects.push({ id, type: 'length', of: [a, b] });
      break;
    case 'angle':
      item.objects.push({ id, type: 'angle', of: [a, b, c] });
      break;
  }
  return true;
}

/** Remove an object and everything built from it. */
export function removeObject(item: ConstructionItem, id: string): void {
  const gone = new Set([id]);
  const refs = (o: GeoObject): string[] =>
    'of' in o ? [...o.of] : o.type === 'circle' ? [o.center, o.through] : 'through' in o ? [o.through, o.to] : [];
  for (const o of item.objects) if (refs(o).some((r) => gone.has(r))) gone.add(o.id);
  item.objects = item.objects.filter((o) => !gone.has(o.id));
}

/** The tool palette shown in the graph's item list. */
export function constructionRow(
  item: ConstructionItem,
  state: ConstructionState,
  opts: { readOnly: boolean; onChange: () => void; redraw: () => void },
  buttons: HTMLElement[],
): HTMLElement {
  const hint = h('div', { class: 'geo-hint muted small' });
  const showHint = () => {
    const info = TOOLS.find((t) => t.tool === state.tool)!;
    hint.textContent = info.hint + (state.picked.length ? `  (${state.picked.length} picked — click the tool again to start over)` : '');
  };
  state.hintEl = hint;
  hint.addEventListener('refresh', showHint);
  const palette = h('div', { class: 'geo-tools' },
    ...(opts.readOnly ? [] : TOOLS).map((t) => {
      const b = h('button', { class: `geo-tool${state.tool === t.tool ? ' active' : ''}`, title: t.hint }, t.label);
      b.addEventListener('click', () => {
        state.tool = t.tool;
        state.picked = [];
        palette.querySelectorAll('.geo-tool').forEach((x) => x.classList.toggle('active', x === b));
        showHint();
        opts.redraw();
      });
      return b;
    }),
  );
  showHint();
  const undo = opts.readOnly ? null : h('button', {
    class: 'link small', title: 'Remove the last thing added (and anything built on it)',
    onclick: () => {
      const last = item.objects[item.objects.length - 1];
      if (!last) return;
      removeObject(item, last.id);
      state.picked = [];
      opts.onChange();
      opts.redraw();
    },
  }, '↶ Undo last');
  const [swatch, ...rest] = buttons;
  return h('div', { class: 'graph-item geo-item', 'data-item': item.id },
    h('div', { class: 'item-line' }, swatch, h('span', { class: 'geo-title' }, 'Construction'), ...rest),
    palette, h('div', { class: 'geo-foot' }, hint, undo));
}
