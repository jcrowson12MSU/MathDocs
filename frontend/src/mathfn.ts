// Turn LaTeX typed in a math field into something we can plot.

import { ComputeEngine, compile } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

export type Params = Record<string, number>;

export type Plottable =
  | { kind: 'function'; f: (x: number, p: Params) => number; params: string[] }
  | { kind: 'implicit'; f: (x: number, y: number, p: Params) => number; params: string[] }
  | { kind: 'vertical'; x: number }
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
  const expr = ce.parse(latex);
  const json: Json = expr.json;
  if (hasErrors(json)) return { kind: 'error', message: 'Finish typing the expression' };
  if (Array.isArray(json) && INEQUALITIES.has(json[0])) {
    return { kind: 'error', message: 'Inequalities aren’t graphed yet' };
  }

  let body: Json = json;
  let implicit = false;
  if (Array.isArray(json) && json[0] === 'Equal' && json.length === 3) {
    const [, lhs, rhs] = json;
    const lhsHasY = symbolsIn(lhs).has('y');
    const rhsHasY = symbolsIn(rhs).has('y');
    if ((lhs === 'y' || isFunctionHead(lhs)) && !rhsHasY) body = rhs;
    else if ((rhs === 'y' || isFunctionHead(rhs)) && !lhsHasY) body = lhs;
    else if (lhs === 'x' && !symbolsIn(rhs).has('x') && !rhsHasY) {
      const fn = compileJson(rhs);
      if (typeof fn === 'string') return { kind: 'error', message: fn };
      return { kind: 'vertical', x: fn({}) };
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

/** LaTeX for a variable name as Compute Engine spells it, e.g. "a_12" -> "a_{12}", "alpha" -> "\alpha". */
export function variableLatex(name: string): string {
  return ce.box(name).latex;
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
