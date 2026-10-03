// Calculus I–IV tools: what gets graphed, limit tables, and saving the new cells.
import { describe, expect, it } from 'vitest';
import { analyze, THREE_D_KINDS } from './mathfn';
import { normalize } from './model';
import { limitXs, show } from './views/limit';

describe('calculus graphs', () => {
  it('graphs partial sums with a counting slider (and no slider for the index)', () => {
    const a = analyze('y=\\sum_{k=0}^{n}\\frac{x^k}{k!}');
    expect(a.kind).toBe('function');
    if (a.kind !== 'function') return;
    expect(a.params).toEqual(['n']);
    expect(a.f(0.5, { n: 3 })).toBeCloseTo(1 + 0.5 + 0.125 + 0.5 ** 3 / 6, 12);
  });

  it('plots sequences a_n', () => {
    const a = analyze('a_n=\\left(1+\\frac{1}{n}\\right)^n');
    expect(a.kind).toBe('sequence');
    if (a.kind === 'sequence') expect([a.a(1, {}), a.a(2, {})]).toEqual([2, 2.25]);
  });

  it('draws vectors, vector fields and slope fields', () => {
    const v = analyze('\\vec{v}=\\langle1,2\\rangle');
    expect(v.kind === 'vector' && [v.name, v.x({}), v.y({})]).toEqual(['v', 1, 2]);
    const field = analyze('\\left\\langle-y,x\\right\\rangle');
    expect(field.kind === 'field' && [field.P(1, 2, {}), field.Q(1, 2, {})]).toEqual([-2, 1]);
    const slope = analyze('\\frac{dy}{dx}=x-y');
    expect(slope.kind === 'slopefield' && slope.f(1, 2, {})).toBe(-1);
    const prime = analyze("y'=xy");
    expect(prime.kind === 'slopefield' && prime.f(1, 2, {})).toBe(2);
  });

  it('recognizes 3D surfaces, curves, points and vectors', () => {
    const surface = analyze('z=x^2+y^2');
    expect(surface.kind === 'surface' && surface.f(1, 2, {})).toBe(5);
    const helix = analyze('\\left(\\cos t,\\sin t,t\\right)\\left\\lbrace0\\le t\\le4\\pi\\right\\rbrace');
    expect(helix.kind).toBe('curve3d');
    if (helix.kind === 'curve3d') expect(helix.to).toBeCloseTo(4 * Math.PI, 6);
    const pt = analyze('\\left(1,2,3\\right)');
    expect(pt.kind === 'point3d' && [pt.at({}), pt.arrow]).toEqual([[1, 2, 3], false]);
    const arrow = analyze('\\langle1,2,3\\rangle');
    expect(arrow.kind === 'point3d' && arrow.arrow).toBe(true);
    for (const k of ['surface', 'curve3d', 'point3d']) expect(THREE_D_KINDS.has(k)).toBe(true);
    expect(THREE_D_KINDS.has('function')).toBe(false);
  });
});

describe('limit tables', () => {
  it('closes in on a from both sides, or grows toward ∞', () => {
    const xs = limitXs('2');
    expect(xs?.left.map((x) => +x.toFixed(6))).toEqual([1.9, 1.99, 1.999, 1.9999]);
    expect(xs?.right.map((x) => +x.toFixed(6))).toEqual([2.0001, 2.001, 2.01, 2.1]);
    expect(limitXs('\\infty')?.left).toEqual([10, 100, 1000, 10000]);
    expect(limitXs('-\\infty')?.right).toEqual([-10000, -1000, -100, -10]);
    expect(limitXs('a')).toBeNull();
  });

  it('shows values to 9 significant digits', () => {
    expect(show(3.999900001)).toBe('3.9999');
    expect(show(2.718145926825225)).toBe('2.71814593');
    expect(show(0.9999998333)).toBe('0.999999833');
    expect(show(-0.5)).toBe('−0.5');
    expect(show(NaN)).toBe('undefined');
  });
});

describe('calculus cells survive saving', () => {
  it('keeps limit tables, u-sub / parts / DI layouts, Riemann sums, secants and 3D graphs', () => {
    const nb = normalize({
      title: 't',
      cells: [
        { id: 'a', type: 'limit', expr: '\\frac{1}{x}', at: '\\infty', answer: '0', comments: [] },
        { id: 'b', type: 'layout', layout: 'usub', cells: [['\\int x\\,dx'], ['', ''], [''], [''], ['']], comments: [] },
        { id: 'c', type: 'layout', layout: 'parts', comments: [] },
        { id: 'd', type: 'layout', layout: 'tabular', comments: [] },
      ],
      graphs: [{ id: 'g', title: '', bbox: [-1, 1, 1, -1], view: '3d', range3d: 4, items: [
        { id: 'e', kind: 'expr', latex: 'y=x^2', color: '#000', riemann: { n: 4, from: 0, to: 2, method: 'left' }, secant: { a: 1, h: 0.5 } },
      ] }],
    });
    expect(nb.cells.map((c) => c.type)).toEqual(['limit', 'layout', 'layout', 'layout']);
    expect(nb.cells[0].type === 'limit' && nb.cells[0].answer).toBe('0');
    expect(nb.cells[2].type === 'layout' && nb.cells[2].cells.length).toBe(4);
    expect(nb.cells[3].type === 'layout' && nb.cells[3].cells.length).toBe(5);
    expect([nb.graphs[0].view, nb.graphs[0].range3d]).toEqual(['3d', 4]);
    const item = nb.graphs[0].items[0];
    expect(item.kind === 'expr' && [item.riemann?.n, item.secant?.h]).toEqual([4, 0.5]);
  });
});
