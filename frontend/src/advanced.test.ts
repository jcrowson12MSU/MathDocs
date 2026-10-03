// Algebra II, trig, precalculus and geometry tools.
import { describe, expect, it } from 'vitest';
import { analyze } from './mathfn';
import { normalize } from './model';
import { solutionSet } from './inequality';
import { applyRowOps, parseRowOp } from './rowops';
import { radiansLabel, snapAngle } from './views/unitcircle';
import { removeObject } from './views/geometry';
import type { ConstructionItem } from './model';

describe('matrix row operations', () => {
  it('reads row operations from notes', () => {
    expect(parseRowOp('R_2-3R_1', 1, 2)?.kind).toBe('combine');
    expect(parseRowOp('R_1\\leftrightarrow R_2', 0, 2)).toEqual({ kind: 'swap', a: 0, b: 1 });
    expect(parseRowOp('R_2\\to R_2+2R_1', 1, 2)?.kind).toBe('combine');
    expect(parseRowOp('R_2^2', 1, 2)).toBeNull(); // not a row operation
    expect(parseRowOp('R_3-R_1', 1, 2)).toBeNull(); // no row 3
    expect(parseRowOp('\\times3', 1, 2)).toBeNull();
  });

  it('applies them with exact arithmetic, using the rows from before the step', () => {
    expect(applyRowOps([['1', '2', '5'], ['3', '4', '6']], ['', 'R_2-3R_1'])?.rows).toEqual([['1', '2', '5'], ['0', '-2', '-9']]);
    expect(applyRowOps([['2', '4', '6'], ['3', '4', '6']], ['\\frac12R_1', ''])?.rows[0]).toEqual(['1', '2', '3']);
    expect(applyRowOps([['3', '1', '2'], ['1', '2', '5']], ['', 'R_2-\\frac13R_1'])?.rows[1]).toEqual(['0', '\\frac{5}{3}', '\\frac{13}{3}']);
    expect(applyRowOps([['3', '1', '2'], ['1', '2', '5']], ['R_1\\leftrightarrow R_2', ''])?.rows).toEqual([['1', '2', '5'], ['3', '1', '2']]);
    expect(applyRowOps([['1', '2'], ['3', '4']], ['', ''])).toBeNull();
  });
});

describe('ranges and restrictions', () => {
  it('reads chained inequalities (−1 ≤ x ≤ 3)', () => {
    expect(solutionSet('-1\\le x\\le3')?.intervals).toEqual([{ from: -1, to: 3, fromClosed: true, toClosed: true }]);
    expect(solutionSet('-2<x\\le3')?.intervals).toEqual([{ from: -2, to: 3, fromClosed: false, toClosed: true }]);
  });

  it('restricts a graph to part of its domain', () => {
    const a = analyze('y=x^2\\left\\lbrace-1\\le x\\le3\\right\\rbrace');
    expect(a.kind).toBe('function');
    if (a.kind !== 'function') return;
    expect(a.f(2, {})).toBe(4);
    expect(a.f(4, {})).toBeNaN();
    expect(a.domain).toEqual([{ from: -1, to: 3, fromClosed: true, toClosed: true }]);
  });

  it('finds holes but not asymptotes', () => {
    const hole = analyze('y=\\frac{x^2-4}{x-2}');
    expect(hole.kind === 'function' && hole.holes).toEqual([[2, 4]]);
    const asymptote = analyze('y=\\frac{1}{x-2}');
    expect(asymptote.kind === 'function' && asymptote.holes).toBeUndefined();
    const both = analyze('y=\\frac{x^2-1}{x^2+x}');
    expect(both.kind === 'function' && both.holes).toEqual([[-1, 2]]);
  });
});

describe('polar, parametric and degrees', () => {
  it('draws r = f(θ) and (x(t), y(t))', () => {
    const r = analyze('r=2\\cos\\left(\\theta\\right)');
    expect(r.kind).toBe('polar');
    if (r.kind === 'polar') expect([r.from, r.to, r.f(0, {})]).toEqual([0, 2 * Math.PI, 2]);
    const spiral = analyze('r=\\theta\\left\\lbrace0\\le\\theta\\le4\\pi\\right\\rbrace');
    expect(spiral.kind === 'polar' && spiral.to).toBeCloseTo(4 * Math.PI, 6);
    const ellipse = analyze('\\left(3\\cos t,2\\sin t\\right)');
    expect(ellipse.kind).toBe('parametric');
    if (ellipse.kind === 'parametric') expect([ellipse.x(0, {}), ellipse.y(0, {})]).toEqual([3, 0]);
    const parabola = analyze('\\left(t,t^2\\right)\\left\\lbrace-1\\le t\\le1\\right\\rbrace');
    expect(parabola.kind === 'parametric' && [parabola.from, parabola.to]).toEqual([-1, 1]);
    expect(analyze('\\left(1,2\\right)').kind).toBe('points');
  });

  it('reads angles in degrees when asked', () => {
    const s = analyze('y=\\sin x', { degrees: true });
    expect(s.kind === 'function' && s.f(30, {})).toBeCloseTo(0.5, 9);
    const inv = analyze('y=\\sin^{-1}x', { degrees: true });
    expect(inv.kind === 'function' && inv.f(1, {})).toBeCloseTo(90, 9);
  });

  it('labels unit-circle angles as multiples of π and snaps to 15°', () => {
    expect(radiansLabel(Math.PI / 3)).toBe('π/3');
    expect(radiansLabel((5 * Math.PI) / 6)).toBe('5π/6');
    expect(radiansLabel(Math.PI)).toBe('π');
    expect(radiansLabel((3 * Math.PI) / 2)).toBe('3π/2');
    expect(snapAngle(1.05)).toBeCloseTo(Math.PI / 3, 9);
    expect(snapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });
});

describe('new cells and graph items survive saving', () => {
  it('keeps layouts, matrices, proofs, unit circles and constructions', () => {
    const nb = normalize({
      title: 't',
      cells: [
        { id: 'a', type: 'layout', layout: 'box', cells: [['', '2x'], ['x', '2x^2']], comments: [] },
        { id: 'b', type: 'matrix', rows: [['1', '2']], notes: ['R_1'], augmented: false, comments: [] },
        { id: 'c', type: 'proof', given: 'g', prove: 'p', rows: [{ statement: 's', reason: 'Given' }], comments: [] },
        { id: 'd', type: 'layout', layout: 'nonsense', comments: [] },
      ],
      graphs: [{ id: 'g', title: '', bbox: [-1, 1, 1, -1], angles: 'deg', piTicks: true, square: true, items: [
        { id: 'u', kind: 'unitcircle', color: '#000', angle: 1 },
        { id: 'k', kind: 'construction', color: '#000', objects: [] },
      ] }],
    });
    expect(nb.cells.map((c) => c.type)).toEqual(['layout', 'matrix', 'proof', 'math']);
    expect(nb.cells[1].type === 'matrix' && nb.cells[1].augmented).toBe(false);
    expect(nb.graphs[0].angles).toBe('deg');
    expect(nb.graphs[0].items.map((i) => i.kind)).toEqual(['unitcircle', 'construction']);
  });

  it('removes a construction object and what was built on it', () => {
    const item: ConstructionItem = { id: 'k', kind: 'construction', color: '#000', objects: [
      { id: 'A', type: 'point', name: 'A', x: 0, y: 0 },
      { id: 'B', type: 'point', name: 'B', x: 1, y: 0 },
      { id: 'C', type: 'point', name: 'C', x: 0, y: 1 },
      { id: 's', type: 'segment', of: ['A', 'B'] },
      { id: 'p', type: 'perpendicular', to: 's', through: 'C' },
      { id: 'm', type: 'midpoint', name: 'M', of: ['A', 'C'] },
    ] };
    removeObject(item, 'B');
    expect(item.objects.map((o) => o.id)).toEqual(['A', 'C', 'm']);
  });
});
