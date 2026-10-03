// Turn LaTeX typed in a math field into something we can plot.

import { ComputeEngine, compile } from '@cortex-js/compute-engine';
import { solutionSet, yRegion, type Interval } from './inequality';
export type { Interval };
import { mixedNumbers } from './latexutil';

export { mixedNumbers };

export const ce = new ComputeEngine();

export type Params = Record<string, number>;

export type Plottable =
  /**
   * y = f(x). `domain` is set by a restriction like y = x^2 {x < 2} (with dots at its ends); `holes` are the
   * points where it's undefined but continues on both sides, like x = 2 in (x² − 4)/(x − 2).
   */
  | { kind: 'function'; f: (x: number, p: Params) => number; params: string[]; domain?: Interval[]; holes?: [number, number][] }
  /** r = f(θ), for θ from `from` to `to`. */
  | { kind: 'polar'; f: (theta: number, p: Params) => number; params: string[]; from: number; to: number }
  /** (x(t), y(t)), for t from `from` to `to`. */
  | { kind: 'parametric'; x: (t: number, p: Params) => number; y: (t: number, p: Params) => number; params: string[]; from: number; to: number }
  | { kind: 'implicit'; f: (x: number, y: number, p: Params) => number; params: string[] }
  /** x = 3, or an equation in x alone like 2x+3 = 5x−8 (drawn at its solutions). */
  | { kind: 'verticals'; xs: number[] }
  /** (10, 0) or (1, 2), (3, 4). */
  | { kind: 'points'; points: ((p: Params) => [number, number])[]; params: string[] }
  /** y < f(x), y ≥ f(x), …: shade below or above the boundary (dashed when it isn't included). */
  | { kind: 'region'; f: (x: number, p: Params) => number; shade: 'below' | 'above'; inclusive: boolean; params: string[] }
  /** An inequality in x alone (x > 3, x² < 9): shade the vertical bands where it's true. */
  | { kind: 'xbands'; intervals: Interval[] }
  /** a_n = 1/n: the points (n, a_n) for n = 1, 2, 3 … */
  | { kind: 'sequence'; a: (n: number, p: Params) => number; params: string[] }
  /** ⟨3, 4⟩ (or \vec{v} = ⟨3, 4⟩): an arrow from the origin. */
  | { kind: 'vector'; x: (p: Params) => number; y: (p: Params) => number; name: string; params: string[] }
  /** ⟨P(x, y), Q(x, y)⟩: a vector field (or a phase plane for x′ = P, y′ = Q). */
  | { kind: 'field'; P: (x: number, y: number, p: Params) => number; Q: (x: number, y: number, p: Params) => number; params: string[] }
  /** dy/dx = f(x, y) (or y′ = f(x, y)): a slope field. */
  | { kind: 'slopefield'; f: (x: number, y: number, p: Params) => number; params: string[] }
  /** 3D: z = f(x, y). */
  | { kind: 'surface'; f: (x: number, y: number, p: Params) => number; params: string[] }
  /** 3D: (x(t), y(t), z(t)). */
  | { kind: 'curve3d'; x: (t: number, p: Params) => number; y: (t: number, p: Params) => number; z: (t: number, p: Params) => number; from: number; to: number; params: string[] }
  /** 3D: (1, 2, 3), or the arrow ⟨1, 2, 3⟩. */
  | { kind: 'point3d'; at: (p: Params) => [number, number, number]; arrow: boolean; name: string; params: string[] }
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

export function hasErrors(json: Json): boolean {
  return Array.isArray(json) && (json[0] === 'Error' || json.slice(1).some(hasErrors));
}

export interface AnalyzeOptions {
  /** Angles in degrees: sin x takes x in degrees, arcsin gives degrees, θ runs 0…360. */
  degrees?: boolean;
}

/** y = x^2 {x < 2}: the expression and the restriction inside the braces at the end, if any. */
export function splitRestriction(latex: string): [string, string | null] {
  const m = /^([\s\S]*?)\s*(?:\\left\\lbrace|\\left\\\{|\\lbrace|\\\{)([\s\S]*?)(?:\\right\\rbrace|\\right\\\}|\\rbrace|\\\})\s*$/.exec(latex);
  if (!m || !m[1].trim()) return [latex, null];
  return [m[1], m[2]];
}

const TRIG = new Set(['Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot']);
const ARC_TRIG = new Set(['Arcsin', 'Arccos', 'Arctan', 'Arcsec', 'Arccsc', 'Arccot']);

/** Degrees mode: sin x → sin(x·π/180), arcsin x → arcsin(x)·180/π. */
export function toDegrees(json: Json): Json {
  if (!Array.isArray(json)) return json;
  const args = json.slice(1).map(toDegrees);
  if (TRIG.has(json[0])) return [json[0], ['Multiply', args[0], ['Divide', 'Pi', 180]], ...args.slice(1)];
  if (ARC_TRIG.has(json[0])) return ['Multiply', [json[0], ...args], ['Divide', 180, 'Pi']];
  return [json[0], ...args];
}

const hasTrig = (json: Json): boolean => Array.isArray(json) && (TRIG.has(json[0]) || json.slice(1).some(hasTrig));

const paramsOf = (json: Json, exclude: string[]) =>
  [...(ce.box(json).unknowns as string[])].filter((s) => !exclude.includes(s)).sort();

export function analyze(latex: string, opts: AnalyzeOptions = {}): Plottable {
  if (!latex.trim()) return { kind: 'empty' };
  const [main, restriction] = splitRestriction(latex);
  if (restriction !== null) return restricted(main, restriction, opts);
  // 2\frac12x means 2½·x, as students write it (Compute Engine alone would read 2·½·x).
  const expr = ce.parse(mixedNumbers(latex));
  let json: Json = expr.json;
  if (hasErrors(json)) return { kind: 'error', message: 'Finish typing the expression' };
  if (Array.isArray(json) && INEQUALITIES.has(json[0])) return inequality(latex);
  if (opts.degrees) json = toDegrees(json);
  const calc = calculusKinds(json, opts);
  if (calc) return calc;
  const curve = polarOrParametric(json, opts);
  if (curve) return curve;
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
  const f = (x: number, p: Params) => fn({ ...p, x });
  const found = params.length ? [] : holes(body, (x) => f(x, {}));
  return { kind: 'function', f, params, ...(found.length ? { holes: found } : {}) };
}

/** r = f(θ) or (x(t), y(t)), or null if it's neither. */
function polarOrParametric(json: Json, opts: AnalyzeOptions, range?: [number, number]): Plottable | null {
  const full: [number, number] = opts.degrees ? [0, 360] : [0, 2 * Math.PI];
  if (Array.isArray(json) && json[0] === 'Equal' && json.length === 3 && (json[1] === 'r' || json[2] === 'r')) {
    const body = json[1] === 'r' ? json[2] : json[1];
    const used = symbolsIn(body);
    if (used.has('x') || used.has('y') || used.has('r')) return null;
    const fn = compileJson(body);
    if (typeof fn === 'string') return { kind: 'error', message: fn };
    const [from, to] = range ?? full;
    return { kind: 'polar', f: (theta, p) => fn({ ...p, theta }), params: paramsOf(body, ['theta']), from, to };
  }
  if (Array.isArray(json) && json[0] === 'Tuple' && json.length === 3 && symbolsIn(json).has('t')) {
    const used = symbolsIn(json);
    if (used.has('x') || used.has('y')) return null;
    const fx = compileJson(json[1]);
    const fy = compileJson(json[2]);
    if (typeof fx === 'string') return { kind: 'error', message: fx };
    if (typeof fy === 'string') return { kind: 'error', message: fy };
    // Around the circle for trig curves; otherwise −10 … 10. A restriction {0 ≤ t ≤ 5} sets it.
    const [from, to] = range ?? (hasTrig(json) ? full : [-10, 10]);
    return {
      kind: 'parametric', x: (t, p) => fx({ ...p, t }), y: (t, p) => fy({ ...p, t }),
      params: paramsOf(json, ['t']), from, to,
    };
  }
  return null;
}

/** y = x^2 {x < 2}, r = θ {0 ≤ θ ≤ 4π}, (t, t^2) {−1 ≤ t ≤ 1}. */
function restricted(main: string, restriction: string, opts: AnalyzeOptions): Plottable {
  const set = solutionSet(restriction);
  if (!set) return { kind: 'error', message: 'Write the restriction like {x < 2} or {−1 ≤ x ≤ 3}' };
  let json: Json = ce.parse(mixedNumbers(main)).json;
  if (hasErrors(json)) return { kind: 'error', message: 'Finish typing the expression' };
  if (opts.degrees) json = toDegrees(json);
  if (set.variable === 'theta' || set.variable === 't') {
    if (set.intervals.length !== 1) return { kind: 'error', message: `Give one range for ${set.variable === 't' ? 't' : 'θ'}, like {0 ≤ t ≤ 5}` };
    const [{ from, to }] = set.intervals;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === null || to === null) {
      return { kind: 'error', message: 'Give both ends of the range, like {0 ≤ t ≤ 5}' };
    }
    const curve3 = Array.isArray(json) && json[0] === 'Tuple' && json.length === 4 ? calculusKinds(json, opts) : null;
    if (curve3?.kind === 'curve3d') return { ...curve3, from, to };
    return polarOrParametric(json, opts, [from, to]) ?? { kind: 'error', message: `{… ${set.variable} …} restricts polar (r = …) or parametric ((x, y) in t) curves` };
  }
  if (set.variable !== 'x') return { kind: 'error', message: 'Restrict x, like {x < 2}' };
  const a = analyze(main, opts);
  if (a.kind !== 'function') return { kind: 'error', message: 'Restrictions work on y = … graphs' };
  const intervals = set.intervals.map((i) => ({ ...i, from: i.from ?? -Infinity, to: i.to ?? Infinity }));
  const inside = (x: number) =>
    intervals.some((i) => (i.fromClosed ? x >= i.from : x > i.from) && (i.toClosed ? x <= i.to : x < i.to));
  return {
    ...a,
    f: (x: number, p: Params) => (inside(x) ? a.f(x, p) : NaN),
    domain: intervals,
    holes: a.holes?.filter(([x]) => inside(x)),
  };
}

/** Denominators in an expression: b in a/b, and the base of a negative power (x^{-1}). */
function denominators(json: Json, out: Json[] = []): Json[] {
  if (!Array.isArray(json)) return out;
  if (json[0] === 'Divide') out.push(json[2]);
  if (json[0] === 'Power' && typeof json[2] === 'number' && json[2] < 0) out.push(json[1]);
  json.slice(1).forEach((j: Json) => denominators(j, out));
  return out;
}

/** Where f has a hole: a denominator is 0 there but f is defined, and agrees, on both sides. */
function holes(body: Json, f: (x: number) => number): [number, number][] {
  const out: [number, number][] = [];
  for (const d of denominators(body)) {
    if (!isAlgebraic(d) || !symbolsIn(d).has('x')) continue;
    let roots: number[] = [];
    try {
      const raw: unknown = ce.box(['Equal', d, 0]).solve('x');
      if (!Array.isArray(raw)) continue;
      roots = raw.map((r: any) => r.N().valueOf()).filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v));
    } catch {
      continue;
    }
    for (const r of roots) {
      if (Number.isFinite(f(r))) continue;
      const e = 1e-6 * Math.max(1, Math.abs(r));
      const left = f(r - e);
      const right = f(r + e);
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      const y = (left + right) / 2;
      if (Math.abs(left - right) > 1e-3 * Math.max(1, Math.abs(y))) continue;
      if (!out.some(([x]) => Math.abs(x - r) < 1e-9)) out.push([r, Math.round(y * 1e6) / 1e6]);
    }
  }
  return out;
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

/** The kinds of things graphed in calculus: sequences, vectors and fields, slope fields, and 3D. */
function calculusKinds(json: Json, opts: AnalyzeOptions): Plottable | null {
  const head = Array.isArray(json) ? json[0] : null;
  const fn = (j: Json) => compileJson(j);
  const bad = (f: unknown): f is string => typeof f === 'string';
  const params = (j: Json, exclude: string[]) => paramsOf(j, exclude);

  // \vec{v} = ⟨…⟩ names the vector.
  let name = '';
  let body = json;
  if (head === 'Equal' && Array.isArray(json[1]) && json[1][0] === 'OverVector' && typeof json[1][1] === 'string') {
    name = json[1][1];
    body = json[2];
  }
  if (Array.isArray(body) && body[0] === 'AngleBracket') {
    const parts = body.slice(1);
    const used = symbolsIn(body);
    if (parts.length === 2 && (used.has('x') || used.has('y'))) {
      const [P, Q] = parts.map(fn);
      if (bad(P)) return { kind: 'error', message: P };
      if (bad(Q)) return { kind: 'error', message: Q };
      return { kind: 'field', P: (x, y, p) => P({ ...p, x, y }), Q: (x, y, p) => Q({ ...p, x, y }), params: params(body, ['x', 'y']) };
    }
    if (parts.length === 2) {
      const [X, Y] = parts.map(fn);
      if (bad(X)) return { kind: 'error', message: X };
      if (bad(Y)) return { kind: 'error', message: Y };
      return { kind: 'vector', x: (p) => X(p), y: (p) => Y(p), name, params: params(body, []) };
    }
    if (parts.length === 3) {
      const [X, Y, Z] = parts.map(fn);
      if (bad(X) || bad(Y) || bad(Z)) return { kind: 'error', message: 'Couldn’t read this vector' };
      return { kind: 'point3d', at: (p) => [X(p), Y(p), Z(p)], arrow: true, name, params: params(body, []) };
    }
    return { kind: 'error', message: 'A vector has 2 or 3 parts, like ⟨3, 4⟩' };
  }

  if (head === 'Equal' && json.length === 3) {
    const [, lhs, rhs] = json;
    // dy/dx = f(x, y) or y′ = f(x, y): a slope field.
    const isDy = (j: Json) => Array.isArray(j) && ((j[0] === 'D' && JSON.stringify(j).includes('"y"')) || (j[0] === 'Prime' && j[1] === 'y'));
    if (isDy(lhs) || isDy(rhs)) {
      const f = fn(isDy(lhs) ? rhs : lhs);
      if (bad(f)) return { kind: 'error', message: f };
      return { kind: 'slopefield', f: (x, y, p) => f({ ...p, x, y }), params: params(isDy(lhs) ? rhs : lhs, ['x', 'y']) };
    }
    // a_n = …: a sequence.
    if (typeof lhs === 'string' && /^[a-zA-Z]+_n$/.test(lhs) && !symbolsIn(rhs).has('x')) {
      const a = fn(rhs);
      if (bad(a)) return { kind: 'error', message: a };
      return { kind: 'sequence', a: (n, p) => a({ ...p, n }), params: params(rhs, ['n']) };
    }
    // z = f(x, y): a surface (3D graphs).
    if (lhs === 'z' && !symbolsIn(rhs).has('z')) {
      const f = fn(rhs);
      if (bad(f)) return { kind: 'error', message: f };
      return { kind: 'surface', f: (x, y, p) => f({ ...p, x, y }), params: params(rhs, ['x', 'y']) };
    }
  }

  // (x(t), y(t), z(t)) or (1, 2, 3): 3D.
  if (head === 'Tuple' && json.length === 4) {
    const [X, Y, Z] = json.slice(1).map(fn);
    if (bad(X) || bad(Y) || bad(Z)) return { kind: 'error', message: 'Couldn’t read this' };
    if (symbolsIn(json).has('t')) {
      const [from, to] = hasTrig(json) ? (opts.degrees ? [0, 360] : [0, 2 * Math.PI]) : [-5, 5];
      return {
        kind: 'curve3d', x: (t, p) => X({ ...p, t }), y: (t, p) => Y({ ...p, t }), z: (t, p) => Z({ ...p, t }),
        from, to, params: params(json, ['t']),
      };
    }
    return { kind: 'point3d', at: (p) => [X(p), Y(p), Z(p)], arrow: false, name: '', params: params(json, []) };
  }
  return null;
}

/** Kinds drawn in a 3D graph. */
export const THREE_D_KINDS = new Set(['surface', 'curve3d', 'point3d']);

/** Letters that count (the n in a_n or in Σ up to n): their sliders step by 1. */
export const COUNTING = new Set(['n', 'N', 'm']);

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
  // Nothing multiplied to write out (x + 3y = 13): leave the row exactly as the student wrote it.
  if (!/\(|\\cdot|\\times/.test(row)) return null;
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
