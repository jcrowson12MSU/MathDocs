// Inequalities: the set of numbers that make one true (for number lines and shaded graphs).
//
// We don't rearrange anything symbolically. We find where the two sides are equal (the
// "critical" numbers), then test one number in each gap and each critical number itself.

import { ComputeEngine, compile } from '@cortex-js/compute-engine';
import { mixedNumbers } from './latexutil';

const ce = new ComputeEngine();
type Json = any;

/** A piece of the solution: from..to (either may be ±Infinity), with closed (filled) or open ends. */
export interface Interval {
  from: number;
  to: number;
  fromClosed: boolean;
  toClosed: boolean;
}

export interface SolutionSet {
  variable: string;
  intervals: Interval[];
  /** The numbers where a side equals the other (endpoints), for choosing a number-line range. */
  critical: number[];
}

/** One condition `left REL right` where REL is <, ≤, = or ≠ (Compute Engine writes > as a flipped <). */
interface Condition {
  rel: 'Less' | 'LessEqual' | 'Equal' | 'NotEqual';
  left: Json;
  right: Json;
}

const RELS = new Set(['Less', 'LessEqual', 'Equal', 'NotEqual']);

function symbols(json: Json, out = new Set<string>()): Set<string> {
  if (typeof json === 'string' && /^[a-zA-Z]/.test(json) && !['Pi', 'ExponentialE', 'ImaginaryUnit'].includes(json)) out.add(json);
  else if (Array.isArray(json)) json.slice(1).forEach((j) => symbols(j, out));
  return out;
}

function conditions(json: Json): Condition[] | null {
  if (!Array.isArray(json)) return null;
  if (json[0] === 'And') {
    const parts = json.slice(1).map(conditions);
    return parts.every(Boolean) ? (parts as Condition[][]).flat() : null;
  }
  if (RELS.has(json[0]) && json.length === 3) return [{ rel: json[0], left: json[1], right: json[2] }];
  return null;
}

function hasError(json: Json): boolean {
  return Array.isArray(json) && (json[0] === 'Error' || json.slice(1).some(hasError));
}

/** Parse a step into its conditions, or null if it isn't an (in)equality. */
export function parseConditions(latex: string): Condition[] | null {
  if (!latex.trim()) return null;
  const json = ce.parse(mixedNumbers(latex)).json;
  if (hasError(json)) return null;
  return conditions(json);
}

export function isInequality(latex: string): boolean {
  const c = parseConditions(latex);
  return !!c && c.some((k) => k.rel !== 'Equal');
}

function evaluator(json: Json, variable: string): ((v: number) => number) | null {
  try {
    const result = compile(ce.box(json));
    if (!result.success) return null;
    const run = result.run as (vars: Record<string, number>) => unknown;
    return (v) => {
      const out = run({ [variable]: v });
      return typeof out === 'number' ? out : NaN;
    };
  } catch {
    return null;
  }
}

/** Arithmetic and powers only: Compute Engine finds all their solutions (sin x = 0 has infinitely many). */
const ALGEBRAIC = new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Rational', 'Power', 'Square', 'Sqrt', 'Root', 'Abs', 'Delimiter']);

function isAlgebraic(json: Json, variable: string): boolean {
  if (!Array.isArray(json)) return true;
  if (!ALGEBRAIC.has(json[0])) return false;
  if ((json[0] === 'Power' || json[0] === 'Root') && symbols(json[2]).has(variable)) return false; // 2^x
  return json.slice(1).every((j: Json) => isAlgebraic(j, variable));
}

/** Real numbers where left = right (algebraic equations only). */
function roots(left: Json, right: Json, variable: string): number[] | null {
  if (!isAlgebraic(left, variable) || !isAlgebraic(right, variable)) return null;
  try {
    const raw: unknown = ce.box(['Equal', left, right]).solve(variable);
    if (!Array.isArray(raw)) return null;
    return (raw as { N(): { valueOf(): unknown } }[])
      .map((s) => s.N().valueOf())
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  } catch {
    return null;
  }
}

/**
 * The numbers that make a one-variable (in)equality true, e.g. "2x+3>7" → x > 2,
 * "-2<x\le3" → (−2, 3], "x^2<9" → (−3, 3), "x^2>9" → (−∞, −3) ∪ (3, ∞).
 * Returns null when it isn't a one-variable (in)equality we can handle.
 */
export function solutionSet(latex: string): SolutionSet | null {
  const conds = parseConditions(latex);
  if (!conds?.length) return null;
  const vars = new Set<string>();
  for (const c of conds) for (const s of [...symbols(c.left), ...symbols(c.right)]) vars.add(s);
  if (vars.size !== 1) return null;
  const [variable] = vars;

  const tests: ((v: number) => boolean)[] = [];
  const critical: number[] = [];
  for (const c of conds) {
    const l = evaluator(c.left, variable);
    const r = evaluator(c.right, variable);
    const rs = roots(c.left, c.right, variable);
    if (!l || !r || !rs) return null;
    critical.push(...rs);
    const eps = 1e-9;
    tests.push((v) => {
      const d = l(v) - r(v);
      if (!Number.isFinite(d)) return false;
      const scale = 1 + Math.abs(l(v)) + Math.abs(r(v));
      const zero = Math.abs(d) <= eps * scale;
      switch (c.rel) {
        case 'Less': return d < 0 && !zero;
        case 'LessEqual': return d < 0 || zero;
        case 'Equal': return zero;
        case 'NotEqual': return !zero;
      }
    });
  }
  const holds = (v: number) => tests.every((t) => t(v));

  const pts = [...new Set(critical.map((v) => +v.toPrecision(12)))].sort((a, b) => a - b);
  // Walk the pieces left to right: (−∞, p0), {p0}, (p0, p1), {p1}, …, (pn, ∞).
  type Piece = { from: number; to: number; point: boolean; truth: boolean };
  const pieces: Piece[] = [];
  const gapTest = (a: number, b: number) =>
    holds(a === -Infinity ? (b === Infinity ? 0 : b - 1) : b === Infinity ? a + 1 : (a + b) / 2);
  let prev = -Infinity;
  for (const p of pts) {
    pieces.push({ from: prev, to: p, point: false, truth: gapTest(prev, p) });
    pieces.push({ from: p, to: p, point: true, truth: holds(p) });
    prev = p;
  }
  pieces.push({ from: prev, to: Infinity, point: false, truth: gapTest(prev, Infinity) });

  const intervals: Interval[] = [];
  let cur: Interval | null = null;
  for (const piece of pieces) {
    if (piece.truth) {
      if (!cur) cur = { from: piece.from, to: piece.to, fromClosed: piece.point, toClosed: piece.point };
      else {
        cur.to = piece.to;
        cur.toClosed = piece.point;
      }
    } else if (cur) {
      intervals.push(cur);
      cur = null;
    }
  }
  if (cur) intervals.push(cur);
  return { variable, intervals, critical: pts };
}

/** For graphing y < f(x), y ≥ f(x), …: the boundary f, which side to shade, and whether the boundary is included. */
export interface YRegion {
  boundary: Json;
  shade: 'below' | 'above';
  inclusive: boolean;
}

export function yRegion(latex: string): YRegion | null {
  const conds = parseConditions(latex);
  if (!conds || conds.length !== 1) return null;
  const [{ rel, left, right }] = conds;
  if (rel !== 'Less' && rel !== 'LessEqual') return null;
  const inclusive = rel === 'LessEqual';
  // Compute Engine writes "y > f" as "f < y".
  if (left === 'y' && !symbols(right).has('y')) return { boundary: right, shade: 'below', inclusive };
  if (right === 'y' && !symbols(left).has('y')) return { boundary: left, shade: 'above', inclusive };
  return null;
}
