// Turn LaTeX typed in a math field into something we can plot.

import { ComputeEngine, compile } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

export type Params = Record<string, number>;

export type Plottable =
  | { kind: 'function'; f: (x: number, p: Params) => number; params: string[] }
  | { kind: 'implicit'; f: (x: number, y: number, p: Params) => number; params: string[] }
  /** x = 3, or an equation in x alone like 2x+3 = 5x−8 (drawn at its solutions). */
  | { kind: 'verticals'; xs: number[] }
  /** (10, 0) or (1, 2), (3, 4). */
  | { kind: 'points'; points: ((p: Params) => [number, number])[]; params: string[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type Json = any;

const INEQUALITIES = new Set(['Less', 'LessEqual', 'Greater', 'GreaterEqual', 'NotEqual']);

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
  if (Array.isArray(json) && INEQUALITIES.has(json[0])) {
    return { kind: 'error', message: 'Inequalities aren’t graphed yet' };
  }
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
      body = ['Subtract', lhs, rhs];
      implicit = true;
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
  // x in an exponent (2^x = 8) isn't something we solve here.
  if ((json[0] === 'Power' || json[0] === 'Root') && symbolsIn(json[2]).has('x')) return false;
  return json.slice(1).every(isAlgebraic);
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

/**
 * Students write 2½x as 2\frac12x. Read a whole number written right before a number-over-number
 * fraction as a mixed number (Compute Engine would otherwise multiply: 2·½·x).
 */
export function mixedNumbers(latex: string): string {
  const num = String.raw`(\d|\{\d+\})`;
  return latex.replace(new RegExp(String.raw`(^|[^\d.}^_])(\d+)\\frac${num}${num}`, 'g'), (_m, pre, whole, a, b) =>
    `${pre}\\left(${whole}+\\frac{${a.replace(/[{}]/g, '')}}{${b.replace(/[{}]/g, '')}}\\right)`,
  );
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
