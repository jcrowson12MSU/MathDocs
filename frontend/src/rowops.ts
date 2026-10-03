// Row operations on a matrix, written the way they're noted beside a row: R_2 − 3R_1, R_1 ↔ R_2, ½R_1.
// The student picks the operation; this only does the arithmetic of applying it.

import { ce, hasErrors } from './mathfn';

type Json = any;

export type RowOp =
  | { kind: 'swap'; a: number; b: number }
  /** New row = Σ coefficient × row (coefficients as LaTeX, e.g. {1: "1", 0: "-3"} for R_2 − 3R_1). */
  | { kind: 'combine'; coefficients: Map<number, Json> };

const ROW = /R_\{?(\d+)\}?/g;

/** Read the note beside row `row` (0-based). Null if it isn't a row operation. */
export function parseRowOp(note: string, row: number, rowCount: number): RowOp | null {
  let s = note.replace(/\\(left|right)(?![a-zA-Z])/g, '').replace(/\\(,|;|:|!| )/g, '').replace(/\s+/g, '').replace(/r_/g, 'R_');
  if (!s.includes('R_')) return null;
  const valid = (n: number) => n >= 1 && n <= rowCount;
  // Swap: R_1 ↔ R_2
  const swap = /^R_\{?(\d+)\}?(?:\\leftrightarrow|\\longleftrightarrow|\\Leftrightarrow|<->|↔)R_\{?(\d+)\}?$/.exec(s);
  if (swap) {
    const a = Number(swap[1]);
    const b = Number(swap[2]);
    return valid(a) && valid(b) && a !== b ? { kind: 'swap', a: a - 1, b: b - 1 } : null;
  }
  // "R_2 → R_2 − 3R_1": the part after the arrow is the new row.
  const arrow = /^R_\{?(\d+)\}?(?:\\to|\\rightarrow|\\longrightarrow|->|→)(.+)$/.exec(s);
  if (arrow) {
    if (Number(arrow[1]) !== row + 1) return null;
    s = arrow[2];
  }
  // Each R_k becomes a symbol; the note must be a sum of numbers times rows (linear, no constant term).
  const used = new Set<number>();
  const latex = s.replace(ROW, (_, k) => {
    used.add(Number(k));
    return `\\mathrm{R${k}}`;
  });
  if (![...used].every(valid)) return null;
  let expr: any;
  try {
    expr = ce.parse(latex);
  } catch {
    return null;
  }
  if (!expr.isValid || hasErrors(expr.json)) return null;
  const allowed = new Set([...used].map((k) => `R${k}`));
  if ([...expr.unknowns].some((u: string) => !allowed.has(u))) return null;
  const at = (values: Record<string, number>) => {
    const v = expr.subs(values).simplify();
    return v;
  };
  const zero = Object.fromEntries([...allowed].map((u) => [u, 0]));
  if (!at(zero).is(0)) return null;
  const coefficients = new Map<number, Json>();
  for (const k of used) {
    const c = at({ ...zero, [`R${k}`]: 1 });
    if (!c.isNumberLiteral) return null;
    // Linear check: doubling the row doubles the result.
    if (!at({ ...zero, [`R${k}`]: 2 }).isSame(ce.box(['Multiply', 2, c.json]).simplify())) return null;
    coefficients.set(k - 1, c.json);
  }
  return { kind: 'combine', coefficients };
}

/** One entry of the new row: Σ coefficient × entry, simplified (exact fractions). Null if it can't be done. */
function combineEntry(coefficients: Map<number, Json>, rows: string[][], col: number): string | null {
  const terms: Json[] = [];
  for (const [k, c] of coefficients) {
    const entry = rows[k]?.[col]?.trim();
    if (!entry) return null;
    const e = ce.parse(entry);
    if (!e.isValid || hasErrors(e.json)) return null;
    terms.push(['Multiply', c, e.json]);
  }
  const result = ce.box(terms.length === 1 ? terms[0] : ['Add', ...terms]).simplify();
  return result.isValid ? result.latex : null;
}

/**
 * The next matrix after the row operations noted beside its rows, as suggestions for the rows that change
 * (null for rows copied as they are). Every operation uses the rows as they were before this step.
 * Returns null if no note is a row operation.
 */
export function applyRowOps(rows: string[][], notes: string[]): { rows: string[][]; changed: boolean[] } | null {
  const ops = notes.map((n, i) => (n.trim() ? parseRowOp(n, i, rows.length) : null));
  if (!ops.some(Boolean)) return null;
  const next = rows.map((r) => [...r]);
  const changed = rows.map(() => false);
  ops.forEach((op, i) => {
    if (op?.kind !== 'combine') return;
    const cols = rows[i].length;
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const v = combineEntry(op.coefficients, rows, c);
      if (v === null) return;
      row.push(v);
    }
    next[i] = row;
    changed[i] = true;
  });
  const swapped = new Set<string>();
  for (const op of ops) {
    if (op?.kind !== 'swap') continue;
    const key = [op.a, op.b].sort().join();
    if (swapped.has(key)) continue;
    swapped.add(key);
    [next[op.a], next[op.b]] = [next[op.b], next[op.a]];
    changed[op.a] = changed[op.b] = true;
  }
  return changed.some(Boolean) ? { rows: next, changed } : null;
}
