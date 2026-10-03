// Notebook data model. This is exactly what is written to the .mathnb.json files,
// so keep it readable and bump FORMAT_VERSION (with a migration in normalize) on breaking changes.

export const FORMAT = 'math-notebook';
export const FORMAT_VERSION = 1;

export interface Comment {
  id: string;
  author: string;
  text: string;
  created: string;
}

export interface MathCell {
  id: string;
  type: 'math';
  latex: string;
  /** What's being done to both sides, written under the step (e.g. −5 under +5 and under +3). */
  operation?: Operation;
  comments: Comment[];
}

/**
 * One operation shown twice under a step: once under a term on the left of the =, once under
 * a term on the right. Terms are numbered left to right across the whole step, skipping the
 * relation, and split at top-level + and − (see views/workrow.ts). A missing index means
 * "the default term on that side".
 */
export interface Operation {
  latex: string;
  left?: number;
  right?: number;
}

export interface TextCell {
  id: string;
  type: 'markdown';
  text: string;
  comments: Comment[];
}

/** A section header; collapsing it hides everything down to the next divider. */
export interface DividerCell {
  id: string;
  type: 'divider';
  title: string;
  collapsed?: boolean;
  comments: Comment[];
}

export type Cell = MathCell | TextCell | DividerCell;

export interface ExprItem {
  id: string;
  kind: 'expr';
  latex: string;
  color: string;
  hidden?: boolean;
  /** Values for letters other than x and y, shown as sliders (e.g. a, b in ax+b). */
  params?: Record<string, number>;
  showDerivative?: boolean;
  /** What the line or curve represents, drawn on the graph at labelPos (draggable). */
  label?: string;
  labelPos?: [number, number] | null;
  /** x position of a draggable tangent line, or null when off. */
  tangentAt?: number | null;
  /** Shaded area under the curve between two draggable bounds, or null when off. */
  area?: { from: number; to: number } | null;
}

export interface TableItem {
  id: string;
  kind: 'table';
  color: string;
  hidden?: boolean;
  /** Each row is [x, y, label?] as typed, so "1/2" survives a round trip. */
  rows: string[][];
  label?: string;
  labelPos?: [number, number] | null;
  connect?: boolean;
  /** When set, y values are computed from this expression item. */
  fromItem?: string | null;
}

/** A free text annotation placed anywhere on the graph. */
export interface NoteItem {
  id: string;
  kind: 'note';
  color: string;
  hidden?: boolean;
  text: string;
  pos: [number, number];
}

export type GraphItem = ExprItem | TableItem | NoteItem;

export interface Graph {
  id: string;
  title: string;
  items: GraphItem[];
  /** What each axis represents, e.g. "time (hours)". */
  xLabel?: string;
  yLabel?: string;
  /** Mark where lines cross (on unless set to false). */
  intersections?: boolean;
  /** [xmin, ymax, xmax, ymin], JSXGraph's order. */
  bbox: [number, number, number, number];
}

export interface Notebook {
  format: typeof FORMAT;
  version: number;
  id: string;
  title: string;
  created: string;
  modified: string;
  cells: Cell[];
  graphs: Graph[];
}

export const COLORS = ['#2f5bea', '#d6336c', '#2b9348', '#e8590c', '#7048e8', '#0c8599', '#495057'];
export const DEFAULT_BBOX: Graph['bbox'] = [-10, 10, 10, -10];

export function newId(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function mathCell(latex = ''): MathCell {
  return { id: newId(), type: 'math', latex, comments: [] };
}

export function textCell(text = ''): TextCell {
  return { id: newId(), type: 'markdown', text, comments: [] };
}

export function dividerCell(title = ''): DividerCell {
  return { id: newId(), type: 'divider', title, collapsed: false, comments: [] };
}

export function newGraph(): Graph {
  return { id: newId(), title: '', items: [], bbox: [...DEFAULT_BBOX] };
}

export function exprItem(latex = '', color = COLORS[0]): ExprItem {
  return { id: newId(), kind: 'expr', latex, color };
}

export function tableItem(color = COLORS[0]): TableItem {
  return { id: newId(), kind: 'table', color, rows: [['', ''], ['', ''], ['', '']], connect: false, fromItem: null };
}

export function noteItem(pos: [number, number], color = COLORS[6]): NoteItem {
  return { id: newId(), kind: 'note', color, text: '', pos };
}

export function nextColor(graph: Graph): string {
  const used = new Set(graph.items.map((i) => i.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[graph.items.length % COLORS.length];
}

export function newNotebook(title = 'Untitled'): Notebook {
  const now = nowIso();
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: crypto.randomUUID(),
    title,
    created: now,
    modified: now,
    cells: [mathCell()],
    graphs: [],
  };
}

const termIndex = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined);

/**
 * Read a step's operation. Also converts the short-lived earlier format, where `work` was a list
 * with one entry per term (e.g. ["", "-5", "", "-5"]).
 */
function normalizeOperation(op: any, legacyWork: unknown): Operation | undefined {
  if (op && typeof op === 'object' && typeof op.latex === 'string' && op.latex.trim()) {
    return { latex: op.latex, left: termIndex(op.left), right: termIndex(op.right) };
  }
  if (Array.isArray(legacyWork)) {
    const filled = legacyWork.map((w, i) => [typeof w === 'string' ? w.trim() : '', i] as const).filter(([w]) => w);
    if (filled.length) {
      const [first, last] = [filled[0], filled[filled.length - 1]];
      return { latex: first[0], left: first[1], right: last !== first ? last[1] : undefined };
    }
  }
  return undefined;
}

/** Accept anything that looks like a notebook (old versions, hand-edited files) and fill in defaults. */
export function normalize(raw: unknown): Notebook {
  if (!raw || typeof raw !== 'object') throw new Error('Not a math notebook file');
  const r = raw as Record<string, any>;
  if (!Array.isArray(r.cells)) throw new Error('Not a math notebook file (no cells)');
  const base = newNotebook(typeof r.title === 'string' ? r.title : 'Untitled');
  const cells: Cell[] = r.cells
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any): Cell => {
      const comments: Comment[] = Array.isArray(c.comments)
        ? c.comments
            .filter((m: any) => m && typeof m.text === 'string')
            .map((m: any) => ({
              id: String(m.id ?? newId()),
              author: String(m.author ?? ''),
              text: m.text,
              created: String(m.created ?? nowIso()),
            }))
        : [];
      const id = String(c.id ?? newId());
      if (c.type === 'markdown') return { id, type: 'markdown', text: String(c.text ?? ''), comments };
      if (c.type === 'divider') {
        return { id, type: 'divider', title: String(c.title ?? ''), collapsed: !!c.collapsed, comments };
      }
      const math: MathCell = { id, type: 'math', latex: String(c.latex ?? ''), comments };
      const op = normalizeOperation(c.operation, c.work);
      if (op) math.operation = op;
      return math;
    });
  const graphs: Graph[] = Array.isArray(r.graphs)
    ? r.graphs.map((g: any) => ({
        id: String(g.id ?? newId()),
        title: String(g.title ?? ''),
        ...(typeof g.xLabel === 'string' && g.xLabel ? { xLabel: g.xLabel } : {}),
        ...(typeof g.yLabel === 'string' && g.yLabel ? { yLabel: g.yLabel } : {}),
        ...(g.intersections === false ? { intersections: false } : {}),
        bbox: Array.isArray(g.bbox) && g.bbox.length === 4 && g.bbox.every(Number.isFinite) ? g.bbox : [...DEFAULT_BBOX],
        items: Array.isArray(g.items) ? g.items.filter((i: any) => i && ['expr', 'table', 'note'].includes(i.kind)) : [],
      }))
    : [];
  return {
    ...base,
    id: typeof r.id === 'string' ? r.id : base.id,
    created: typeof r.created === 'string' ? r.created : base.created,
    modified: typeof r.modified === 'string' ? r.modified : base.modified,
    cells: cells.length ? cells : [mathCell()],
    graphs,
  };
}

/**
 * Merge comments from `incoming` (e.g. a notebook shared back with feedback) into `local`.
 * Only comments are merged: the local work itself is never overwritten.
 * Returns how many comments were added.
 */
export function mergeComments(local: Notebook, incoming: Notebook): number {
  const byId = new Map(local.cells.map((c) => [c.id, c]));
  let added = 0;
  for (const cell of incoming.cells) {
    const target = byId.get(cell.id);
    if (!target) continue;
    const have = new Set(target.comments.map((c) => c.id));
    for (const c of cell.comments) {
      if (!have.has(c.id)) {
        target.comments.push(c);
        added++;
      }
    }
    target.comments.sort((a, b) => a.created.localeCompare(b.created));
  }
  return added;
}

/** Parse a number as typed in a table: "3", "-2.5", "1/2", "-3/4". */
export function parseNumber(s: string): number {
  const t = s.trim().replace(/−/g, '-');
  if (!t) return NaN;
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(t) ? Number(t) : NaN;
}
