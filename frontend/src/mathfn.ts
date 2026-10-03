// Turn LaTeX typed in a math field into something we can plot.

import { ComputeEngine, compile } from '@cortex-js/compute-engine';
import { solutionSet, yRegion, type Interval } from './inequality';
import { mixedNumbers } from './latexutil';

export { mixedNumbers };

const ce = new ComputeEngine();

export type Params = Record<string, number>;

export type Plottable =
  | { kind: 'function'; f: (x: number, p: Params) => number; params: string[] }
  | { kind: 'implicit'; f: (x: number, y: number, p: Params) => number; params: string[] }
  /** x = 3, or an equation in x alone like 2x+3 = 5x−8 (drawn at its solutions). */
  | { kind: 'verticals'; xs: number[] }
  /** (10, 0) or (1, 2), (3, 4). */
  | { kind: 'points'; points: ((p: Params) => [number, number])[]; params: string[] }
  /** y < f(x), y ≥ f(x), …: shade below or above the boundary (dashed when it isn't included). */
  | { kind: 'region'; f: (x: number, p: Params) => number; shade: 'below' | 'above'; inclusive: boolean; params: string[] }
  /** An inequality in x alone (x > 3, x² < 9): shade the vertical bands where it's true. */
  | { kind: 'xbands'; intervals: Interval[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type Json = any;

// Compute Engine writes > and ≥ as flipped < and ≤, and a chain like 1 < x < 3 as And(…).
const INEQUALITIES = new Set(['Less', 'LessEqual', 'Greater', 'GreaterEqual', 'NotEqual', 'And']);

function inequality(latex: string): Plottable {
  const region = yRegion(latex);
  if (region) {
    const fn = compileJson(region.boundary);
    if (typeof fn === 'string') return { kind: 'error', message: fn };
    const params = [...symbolsIn(region.boundary)].filter((s) => s !== 'x' && /^[a-zA-Z]/.test(s) && !['Pi', 'ExponentialE'].includes(s)).sort();
    return { kind: 'region', f: (x, p) => fn({ ...p, x }), shade: region.shade, inclusive: region.inclusive, params };
  }
  const set = solutionSet(latex);
  if (set && set.variable === 'x') return { kind: 'xbands', intervals: set.intervals };
  return { kind: 'error', message: 'Write it as y < … (or ≤, >, ≥), or as an inequality in x' };
}

function symbolsIn(json: Json, out = new Set<string>()): Set<string> {
  if (typeof json === 'string') out.add(json);
  else if (Array.isArray(json)) json.slice(1).forEach((j) => symbolsIn(j, out));
  return out;
}

function compileJson(json: Json): ((vars: Params) => number) | string {
  try {
    const expr = ce.box(json);
    const result = compile(expr);
    if (!result.success) return 'This expression can’t be graphed yet';
    const run = result.run as (vars: Params) => unknown;
    return (vars) => {
      const v = run(vars);
      return typeof v === 'number' ? v : NaN;
    };
  } catch {
    return 'This expression can’t be graphed';
  }
}

/** f(x) = ..., g(x) = ..., or y(x) = ... on the left of an equation. */
function isFunctionHead(json: Json): boolean {
  return Array.isArray(json) && json.length === 2 && typeof json[0] === 'string' && json[1] === 'x' && json[0].length === 1;
}

function hasErrors(json: Json): boolean {
  return Array.isArray(json) && (json[0] === 'Error' || json.slice(1).some(hasErrors));
}

export function analyze(latex: string): Plottable {
  if (!latex.trim()) return { kind: 'empty' };
  // 2\frac12x means 2½·x, as students write it (Compute Engine alone would read 2·½·x).
  const expr = ce.parse(mixedNumbers(latex));
  const json: Json = expr.json;
  if (hasErrors(json)) return { kind: 'error', message: 'Finish typing the expression' };
  if (Array.isArray(json) && INEQUALITIES.has(json[0])) return inequality(latex);
  if (Array.isArray(json) && json[0] === 'Tuple') return points(json);

  let body: Json = json;
  let implicit = false;
  if (Array.isArray(json) && json[0] === 'Equal' && json.length === 3) {
    const [, lhs, rhs] = json;
    const lhsHasY = symbolsIn(lhs).has('y');
    const rhsHasY = symbolsIn(rhs).has('y');
    if ((lhs === 'y' || isFunctionHead(lhs)) && !rhsHasY) body = rhs;
    else if ((rhs === 'y' || isFunctionHead(rhs)) && !lhsHasY) body = lhs;
    else if (!lhsHasY && !rhsHasY) {
      // An equation in x alone (x = 3, 2x+3 = 5x−8): its graph is a vertical line at each solution.
      // Drawing it as a curve in x and y would be slow and show the same thing.
      return verticals(json);
    } else {
      // Standard form like 9x + 12y = 30: if it has exactly one solution for y, draw y = (30 − 9x)/12 —
      // fast, and its crossings get marked. Otherwise (a circle has two) draw the implicit curve.
      const solved = solveForY(json);
      if (solved !== null) body = solved;
      else {
        body = ['Subtract', lhs, rhs];
        implicit = true;
      }
    }
  } else if (symbolsIn(json).has('y')) {
    return { kind: 'error', message: 'Write it as an equation, like x^2 + y^2 = 25' };
  }

  const unknowns = [...(ce.box(body).unknowns as string[])];
  // Every other variable becomes a slider: a, b, a_1, v_{max}, \alpha …
  const params = unknowns.filter((s) => s !== 'x' && s !== 'y').sort();
  const fn = compileJson(body);
  if (typeof fn === 'string') return { kind: 'error', message: fn };

  if (implicit) {
    return { kind: 'implicit', f: (x, y, p) => fn({ ...p, x, y }), params };
  }
  return { kind: 'function', f: (x, p) => fn({ ...p, x }), params };
}

/** Functions whose solutions Compute Engine finds completely (sin x = 0 has infinitely many, for example). */
const ALGEBRAIC = new Set(['Equal', 'Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Rational', 'Power', 'Square', 'Sqrt', 'Root', 'Delimiter', 'Abs']);

function isAlgebraic(json: Json): boolean {
  if (!Array.isArray(json)) return true;
  if (!ALGEBRAIC.has(json[0])) return false;
  // x or y in an exponent (2^x = 8) isn't something we solve here.
  if ((json[0] === 'Power' || json[0] === 'Root') && (symbolsIn(json[2]).has('x') || symbolsIn(json[2]).has('y'))) return false;
  return json.slice(1).every(isAlgebraic);
}

/** The one y = … form of an equation in x and y (9x + 12y = 30 → 5/2 − 3x/4), or null if there isn't exactly one. */
function solveForY(json: Json): Json | null {
  if (!isAlgebraic(json)) return null;
  try {
    const raw: unknown = ce.box(json).solve('y');
    if (!Array.isArray(raw) || raw.length !== 1) return null;
    const solution: Json = (raw[0] as { json: Json }).json;
    return symbolsIn(solution).has('y') || hasErrors(solution) ? null : solution;
  } catch {
    return null;
  }
}

function verticals(json: Json): Plottable {
  if (!symbolsIn(json).has('x')) return { kind: 'error', message: 'There’s no x or y to graph' };
  const others = [...symbolsIn(json)].filter((s) => s !== 'x' && /^[a-zA-Z]/.test(s) && !['Pi', 'ExponentialE'].includes(s));
  if (others.length || !isAlgebraic(json)) {
    return { kind: 'error', message: 'To graph this, write it as y = … (or x = a number)' };
  }
  try {
    const raw: unknown = ce.box(json).solve('x');
    const solutions = (Array.isArray(raw) ? raw : []) as { N(): { valueOf(): unknown } }[];
    // Keep real solutions only (x² = −1 has none); imaginary ones come back as non-numbers.
    const xs = solutions.map((s) => s.N().valueOf()).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!xs.length) return { kind: 'error', message: 'No real solution to graph' };
    return { kind: 'verticals', xs };
  } catch {
    return { kind: 'error', message: 'Couldn’t solve this for x' };
  }
}

function points(json: Json): Plottable {
  // (1, 2) is a Tuple of two numbers; (1, 2), (3, 4) is a Tuple of Tuples.
  const pairs: Json[] = json.slice(1).every((t: Json) => Array.isArray(t) && t[0] === 'Tuple') ? json.slice(1) : [json];
  if (!pairs.every((t) => t.length === 3)) return { kind: 'error', message: 'A point needs two numbers, like (2, 5)' };
  const params = new Set<string>();
  const out: ((p: Params) => [number, number])[] = [];
  for (const [, xj, yj] of pairs) {
    for (const s of [...symbolsIn(xj), ...symbolsIn(yj)]) if (/^[a-zA-Z]/.test(s) && !['Pi', 'ExponentialE'].includes(s)) params.add(s);
    const fx = compileJson(xj);
    const fy = compileJson(yj);
    if (typeof fx === 'string' || typeof fy === 'string') return { kind: 'error', message: 'Couldn’t read this point' };
    out.push((p) => [fx(p), fy(p)]);
  }
  return { kind: 'points', points: out, params: [...params].sort() };
}

/** LaTeX for a variable name as Compute Engine spells it, e.g. "a_12" -> "a_{12}", "alpha" -> "\alpha". */
export function variableLatex(name: string): string {
  return ce.box(name).latex;
}

// ---- doing the same thing to both sides -------------------------------------------------

const RELATION_COMMANDS = new Set(['\\le', '\\ge', '\\leq', '\\geq', '\\ne', '\\neq', '\\lt', '\\gt', '\\approx']);
/** The relation you get after multiplying or dividing both sides by a negative number. */
const FLIPPED: Record<string, string> = {
  '<': '>', '>': '<', '\\lt': '\\gt', '\\gt': '\\lt', '\\le': '\\ge', '\\ge': '\\le', '\\leq': '\\geq', '\\geq': '\\leq',
};


// ---- multiplying an equation in a system (elimination) ------------------------------------

/**
 * The number a row note multiplies by: "\times3", "×3", "\cdot\left(-2\right)", "3" → "3" / "-2".
 * Null unless it's a nonzero number (we only set up and distribute multiplications the student chose).
 */
export function multiplierOf(note: string): string | null {
  let t = note.trim().replace(/^(\\times|\\cdot|×|\*|·)\s*/, '').trim();
  const paren = /^\\left\((.*)\\right\)$/.exec(t) ?? /^\((.*)\)$/.exec(t);
  if (paren) t = paren[1].trim();
  if (!t) return null;
  const json = ce.parse(mixedNumbers(t)).json;
  if (hasErrors(json) || [...symbolsIn(json)].some((s) => /^[a-zA-Z]/.test(s) && !['Pi', 'ExponentialE'].includes(s))) return null;
  const value = ce.box(json).N().valueOf();
  return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? t : null;
}

/** Does a side have more than one term at the top level (so it needs brackets when multiplied)? */
function isSum(latex: string): boolean {
  const json = ce.parse(mixedNumbers(latex)).json;
  return Array.isArray(json) && (json[0] === 'Add' || json[0] === 'Subtract');
}

/**
 * Write out multiplying both sides of a row by its note, the way it's done on paper:
 * "2x-y=5" with "×3" → "3\left(2x-y\right)=3\cdot5".
 */
export function multiplyRow(row: string, note: string): string | null {
  const k = multiplierOf(note);
  const sides = splitRelation(row);
  if (!k || !sides || sides[1] !== '=') return null;
  const factor = k.startsWith('-') ? `\\left(${k}\\right)` : k;
  const [left, , right] = sides;
  const rhs = isSum(right) ? `\\left(${right}\\right)` : right.startsWith('-') ? `\\left(${right}\\right)` : right;
  return `${factor}\\left(${left}\\right)=${factor}\\cdot${rhs}`;
}

/** Expand a side, keeping x terms before y terms (and numbers last), like the other rows of the system. */
function distributeSide(latex: string): string {
  const expanded = ce.box(['Expand', ce.parse(mixedNumbers(latex)).json]).evaluate();
  const json: Json = expanded.json;
  if (!Array.isArray(json) || json[0] !== 'Add') return expanded.latex;
  const firstLetter = (t: Json) => /"([a-zA-Z][a-zA-Z_0-9]*)"/.exec(JSON.stringify(t))?.[1] ?? '~';
  const terms = json.slice(1).sort((a: Json, b: Json) => firstLetter(a).localeCompare(firstLetter(b)));
  return terms
    .map((t: Json, i: number) => {
      const s = ce.box(t).latex;
      return i === 0 || s.startsWith('-') ? s : `+${s}`;
    })
    .join('');
}

/**
 * Distribute and simplify a multiplied row: "3\left(2x-y\right)=3\cdot5" → "6x-3y=15".
 * Null when there's nothing to distribute (the row is already simplified).
 */
export function distributeRow(row: string): string | null {
  const sides = splitRelation(row);
  if (!sides || sides[1] !== '=') return null;
  const json = ce.parse(mixedNumbers(row)).json;
  if (hasErrors(json)) return null;
  const [left, , right] = sides;
  const out = `${distributeSide(left)}=${distributeSide(right)}`;
  const plain = (s: string) => s.replace(/\s+/g, '');
  return plain(out) === plain(row) ? null : out;
}

/** Split a step at its one top-level relation: "2x+3=5x-8" → ["2x+3", "=", "5x-8"]. */
export function splitRelation(latex: string): [string, string, string] | null {
  let depth = 0;
  let found: [number, number, string] | null = null;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth > 0) continue;
    else if (ch === '=' || ch === '<' || ch === '>') {
      if (found) return null;
      found = [i, i + 1, ch];
    } else if (ch === '\\') {
      const name = /^\\[a-zA-Z]+/.exec(latex.slice(i))?.[0] ?? '\\';
      if (RELATION_COMMANDS.has(name)) {
        if (found) return null;
        found = [i, i + name.length, name];
      }
      i += name.length - 1;
    }
  }
  if (!found) return null;
  const [start, end, rel] = found;
  const left = latex.slice(0, start).trim();
  const right = latex.slice(end).trim();
  return left && right ? [left, rel, right] : null;
}

function hasError(json: unknown): boolean {
  return Array.isArray(json) && (json[0] === 'Error' || json.slice(1).some(hasError));
}

/**
 * The step you get by doing `operation` to both sides of `step`, simplified:
 * "2x+3=5x-8" with "-3" → "2x=5x-11"; "\frac23x=8" with "\cdot\frac32" → "x=12".
 * Operations start with + or − (add), ·, × or * (multiply), or ÷ or / (divide).
 * Returns null when it can't be done reliably (no single relation, unclear operation, …).
 */
export function applyOperation(step: string, operation: string): string | null {
  const sides = splitRelation(step);
  const op = operation.trim();
  if (!sides || !op) return null;
  const [left, , right] = sides;
  let rel = sides[1];

  let kind: 'Add' | 'Multiply' | 'Divide';
  let amountLatex: string;
  const m = /^(\\cdot|\\times|\*|\\div|\/)\s*/.exec(op);
  if (m) {
    kind = m[1] === '\\div' || m[1] === '/' ? 'Divide' : 'Multiply';
    amountLatex = op.slice(m[0].length);
  } else if (op.startsWith('+') || op.startsWith('-')) {
    kind = 'Add';
    amountLatex = op;
  } else return null;

  const amount = ce.parse(mixedNumbers(amountLatex));
  if (!amountLatex || hasError(amount.json)) return null;

  if (kind !== 'Add' && rel in FLIPPED) {
    // Multiplying or dividing an inequality by a negative number flips it; we need to know the sign.
    const value = amount.N().valueOf();
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
    if (value < 0) rel = FLIPPED[rel];
  }

  const apply = (side: string): string | null => {
    const s = ce.parse(mixedNumbers(side));
    if (hasError(s.json)) return null;
    return ce.box([kind, s.json, amount.json]).simplify().latex;
  };
  const l = apply(left);
  const r = apply(right);
  return l && r ? `${l}${rel}${r}` : null;
}

/**
 * Where y = f(x) and y = g(x) cross between a and b: the x values, left to right.
 * Samples f − g, refines each sign change by bisection, and skips the false "crossings" at a
 * vertical asymptote (like 1/x at 0), where f − g jumps sign without being near zero.
 */
export function intersections(f: (x: number) => number, g: (x: number) => number, a: number, b: number, samples = 600): number[] {
  const h = (x: number) => f(x) - g(x);
  const roots: number[] = [];
  const step = (b - a) / samples;
  const add = (x: number) => {
    const scale = 1 + Math.abs(f(x)) + Math.abs(g(x));
    if (!Number.isFinite(h(x)) || Math.abs(h(x)) > 1e-7 * scale) return; // an asymptote, not a crossing
    if (roots.length && Math.abs(roots[roots.length - 1] - x) < step / 2) return; // same crossing twice
    roots.push(x);
  };
  let x0 = a;
  let h0 = h(x0);
  for (let i = 1; i <= samples; i++) {
    const x1 = a + i * step;
    const h1 = h(x1);
    if (h0 === 0) add(x0);
    else if (Number.isFinite(h0) && Number.isFinite(h1) && h0 * h1 < 0) {
      let lo = x0;
      let hi = x1;
      let hlo = h0;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        const hm = h(mid);
        if (hm === 0 || !Number.isFinite(hm)) {
          lo = hi = mid;
          break;
        }
        if (hlo * hm < 0) hi = mid;
        else {
          lo = mid;
          hlo = hm;
        }
      }
      add((lo + hi) / 2);
    }
    x0 = x1;
    h0 = h1;
  }
  if (h0 === 0) add(x0);
  return roots;
}

/** Numerical derivative (central difference). */
export function derivative(f: (x: number) => number): (x: number) => number {
  return (x) => {
    const h = 1e-5 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  };
}

/** Area under f from a to b by composite Simpson's rule. */
export function integrate(f: (x: number) => number, a: number, b: number, n = 400): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
