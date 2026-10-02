import { describe, expect, it } from 'vitest';
import { analyze, applyOperation, derivative, integrate, mixedNumbers, splitRelation, variableLatex } from './mathfn';
import { mathCell, mergeComments, type MathCell, newNotebook, normalize, parseNumber } from './model';
import { decodeNotebook, encodeNotebook, shareLink } from './share';
import { columnAt, groupTerms, hasRelation, nearestColumn, type Atom } from './views/workrow';

/** Fake measured atoms: each token 10px wide; null = nested inside the previous atom. */
const atoms = (...tokens: (string | null)[]): (Atom | null)[] =>
  tokens.map((t, i) => (t === null ? null : { latex: t, left: i * 10, right: i * 10 + 10 }));
const terms = (...tokens: (string | null)[]) => groupTerms(atoms(...tokens)).map((c) => [c.first, c.last]);

describe('work row terms', () => {
  it('splits y + 5 = x + 3 into y | +5 | x | +3', () => {
    expect(terms('y', '+', '5', '=', 'x', '+', '3')).toEqual([[1, 1], [2, 3], [5, 5], [6, 7]]);
  });

  it('treats a sign after · or = as part of the term', () => {
    // -5/3 x · -3/5 = 10  → one term on the left
    expect(terms('-', '\\frac53', 'x', '\\cdot', '-', '\\frac35', '=', '1', '0')).toEqual([[1, 6], [8, 9]]);
    expect(terms('x', '=', '-', '6')).toEqual([[1, 1], [3, 4]]);
  });

  it('keeps nested atoms (inside fractions) in their term', () => {
    expect(terms('x', '+', null, null, '\\frac12')).toEqual([[1, 1], [2, 5]]);
  });

  it('finds the term at the caret', () => {
    const cols = groupTerms(atoms('y', '+', '5', '=', 'x', '+', '3'));
    expect(columnAt(cols, 0)).toBe(0);
    expect(columnAt(cols, 3)).toBe(1); // after "+5"
    expect(columnAt(cols, 7)).toBe(3); // after "+3"
  });

  it('knows which side of the = each term is on', () => {
    const cols = groupTerms(atoms('y', '+', '5', '=', 'x', '+', '3'));
    expect(cols.map((c) => c.side)).toEqual([0, 0, 1, 1]);
  });

  it('snaps a dragged copy to the nearest term on its own side', () => {
    // centers: y=5, +5=25, x=45, +3=65
    const cols = groupTerms(atoms('y', '+', '5', '=', 'x', '+', '3'));
    expect(nearestColumn(cols, 'left', 4)).toBe(0);
    expect(nearestColumn(cols, 'left', 22)).toBe(1);
    expect(nearestColumn(cols, 'left', 70)).toBe(1); // can't cross to the right side
    expect(nearestColumn(cols, 'right', 60)).toBe(3);
    expect(nearestColumn(cols, 'right', 0)).toBe(2);
  });

  it('only offers ± on steps with two sides', () => {
    expect(hasRelation('y+5=x+3')).toBe(true);
    expect(hasRelation('2x\\le8')).toBe(true);
    expect(hasRelation('x>3')).toBe(true);
    expect(hasRelation('2\\left(x+3\\right)+4')).toBe(false);
    expect(hasRelation('\\frac{a=b}{2}')).toBe(false); // nested, not top level
    expect(hasRelation('\\left(x\\right)\\leq1')).toBe(true);
  });
});

const fnAt = (latex: string, x: number, p = {}) => {
  const r = analyze(latex);
  if (r.kind !== 'function') throw new Error(`${latex} -> ${r.kind} ${'message' in r ? r.message : ''}`);
  return r.f(x, p);
};

describe('analyze', () => {
  it('graphs plain expressions and y = ...', () => {
    expect(fnAt('x^2-5x+6', 2)).toBe(0);
    expect(fnAt('y=3x+1', 2)).toBe(7);
    expect(fnAt('3x+1=y', 2)).toBe(7);
    expect(fnAt('\\frac{1}{x}', 4)).toBe(0.25);
    expect(fnAt('2\\sqrt{x}', 9)).toBe(6);
    expect(fnAt('|x|', -3)).toBe(3);
    expect(fnAt('e^{x}', 0)).toBe(1);
  });

  it('handles f(x) = ...', () => {
    expect(fnAt('f(x)=x^2', 3)).toBe(9);
  });

  it('finds slider parameters', () => {
    const r = analyze('y=ax+b');
    expect(r.kind).toBe('function');
    if (r.kind === 'function') {
      expect(r.params).toEqual(['a', 'b']);
      expect(r.f(2, { a: 3, b: 1 })).toBe(7);
    }
  });

  it('makes sliders for subscripted and Greek variables', () => {
    const r = analyze('y=a_1x+b_{12}');
    expect(r.kind).toBe('function');
    if (r.kind === 'function') {
      expect(r.params).toEqual(['a_1', 'b_12']);
      expect(r.f(3, { a_1: 2, b_12: 1 })).toBe(7);
    }
    const g = analyze('y=\\alpha x+v_{max}');
    expect(g.kind === 'function' && g.params).toEqual(['alpha', 'v_max']);
    expect(variableLatex('b_12')).toBe('b_{12}');
    expect(variableLatex('alpha')).toBe('\\alpha');
  });

  it('returns NaN outside the domain instead of complex numbers', () => {
    expect(fnAt('\\sqrt{x}', -1)).toBeNaN();
  });

  it('recognizes implicit curves and vertical lines', () => {
    const c = analyze('x^2+y^2=25');
    expect(c.kind).toBe('implicit');
    if (c.kind === 'implicit') expect(c.f(3, 4, {})).toBe(0);
    expect(analyze('x=3')).toEqual({ kind: 'vertical', x: 3 });
  });

  it('reports what it cannot graph', () => {
    expect(analyze('')).toEqual({ kind: 'empty' });
    expect(analyze('x<3').kind).toBe('error');
    expect(analyze('x+y').kind).toBe('error');
  });
});

describe('doing the same thing to both sides', () => {
  /** Check a suggested step by value: both sides must agree with the expected equation at a few x values. */
  const sameAt = (got: string | null, expected: string, xs = [-2, 0.5, 3]) => {
    expect(got).not.toBeNull();
    const [gl, , gr] = splitRelation(got!)!;
    const [el, , er] = splitRelation(expected)!;
    for (const x of xs) {
      const at = (s: string) => {
        const r = analyze(mixedNumbers(s));
        return r.kind === 'function' ? r.f(x, {}) : NaN;
      };
      expect(at(gl)).toBeCloseTo(at(el), 9);
      expect(at(gr)).toBeCloseTo(at(er), 9);
    }
  };

  it('subtracts from both sides and simplifies', () => {
    expect(applyOperation('2x+3=5x-8', '-3')).toBe('2x=5x-11');
    expect(applyOperation('y+5=x+3', '-5')).toBe('y=x-2');
    expect(applyOperation('2x=5x-11', '-5x')).toBe('-3x=-11');
  });

  it('multiplies and divides both sides', () => {
    expect(applyOperation('\\frac23x=8', '\\cdot\\frac32')).toBe('x=12');
    expect(applyOperation('2x=8', '\\div2')).toBe('x=4');
    expect(applyOperation('3\\left(x+2\\right)=12', '\\div3')).toBe('x+2=4');
    expect(applyOperation('-\\frac53x=10', '\\cdot\\left(-\\frac35\\right)')).toBe('x=-6');
  });

  it('reads mixed numbers the way students write them', () => {
    expect(mixedNumbers('2\\frac12x')).toBe('\\left(2+\\frac{1}{2}\\right)x');
    expect(mixedNumbers('x^2\\frac12')).toBe('x^2\\frac12'); // an exponent, not a mixed number
    expect(mixedNumbers('2\\frac{x}{3}')).toBe('2\\frac{x}{3}'); // not number-over-number
    // From "Systems of Equations": 5/6 x + 15 = 2½x + 25, subtract 15
    sameAt(applyOperation('\\frac56x+15=2\\frac12x+25', '-15'), '\\frac56x=2.5x+10');
  });

  it('flips an inequality when multiplying or dividing by a negative', () => {
    expect(applyOperation('-2x<8', '\\div\\left(-2\\right)')).toBe('x>-4');
    expect(applyOperation('x+3\\le5', '-3')).toBe('x\\le2');
    expect(applyOperation('2x\\ge6', '\\div2')).toBe('x\\ge3');
  });

  it('gives up when it is unclear', () => {
    expect(applyOperation('2x+3', '-3')).toBeNull(); // no relation
    expect(applyOperation('a=b=c', '-1')).toBeNull(); // two relations
    expect(applyOperation('2x=8', '3')).toBeNull(); // no operation sign
    expect(applyOperation('ax<8', '\\div a')).toBeNull(); // unknown sign for an inequality
  });
});

describe('calculus helpers', () => {
  it('derivative and integral', () => {
    expect(derivative((x) => x * x)(3)).toBeCloseTo(6, 5);
    expect(integrate((x) => x * x, 0, 3)).toBeCloseTo(9, 8);
  });
});

describe('model', () => {
  it('normalizes partial or old files', () => {
    const nb = normalize({ title: 'HW', cells: [{ latex: 'x=1' }, { type: 'markdown', text: 'hi' }] });
    expect(nb.cells[0]).toMatchObject({ type: 'math', latex: 'x=1', comments: [] });
    expect(nb.cells[1]).toMatchObject({ type: 'markdown', text: 'hi' });
    expect(nb.graphs).toEqual([]);
    expect(() => normalize({ foo: 1 })).toThrow();
  });

  it('keeps dividers, work rows and graph annotations', () => {
    const nb = normalize({
      title: 'HW',
      cells: [
        { type: 'divider', title: 'Problem 1', collapsed: true },
        { type: 'math', latex: 'y+5=x+3', operation: { latex: '-5', left: 1, right: 3 } },
        { type: 'math', latex: 'x=1', operation: { latex: '  ' } },
        // The earlier format: one entry per term.
        { type: 'math', latex: 'y+5=x+3', work: ['', '-5', '', '-5'] },
        { type: 'math', latex: '2x=8', work: ['\\div2'] },
      ],
      graphs: [{ xLabel: 'hours', yLabel: 'cm', items: [{ kind: 'note', text: 'meet', pos: [1, 2] }, { kind: 'bogus' }] }],
    });
    expect(nb.cells[0]).toMatchObject({ type: 'divider', title: 'Problem 1', collapsed: true });
    expect((nb.cells[1] as MathCell).operation).toEqual({ latex: '-5', left: 1, right: 3 });
    expect((nb.cells[2] as MathCell).operation).toBeUndefined();
    expect((nb.cells[3] as MathCell).operation).toEqual({ latex: '-5', left: 1, right: 3 });
    expect((nb.cells[4] as MathCell).operation).toEqual({ latex: '\\div2', left: 0, right: undefined });
    expect(nb.cells[3]).not.toHaveProperty('work');
    expect(nb.graphs[0]).toMatchObject({ xLabel: 'hours', yLabel: 'cm' });
    expect(nb.graphs[0].items.map((i) => i.kind)).toEqual(['note']);
  });

  it('merges only new comments into matching cells', () => {
    const local = newNotebook('A');
    local.cells = [mathCell('x=1')];
    const incoming = structuredClone(local);
    (incoming.cells[0] as MathCell).latex = 'changed';
    incoming.cells[0].comments.push({ id: 'c1', author: 'Dad', text: 'Nice', created: '2026-01-01T00:00:00Z' });
    expect(mergeComments(local, incoming)).toBe(1);
    expect(mergeComments(local, incoming)).toBe(0);
    expect((local.cells[0] as MathCell).latex).toBe('x=1');
    expect(local.cells[0].comments[0].author).toBe('Dad');
  });

  it('parses table numbers', () => {
    expect(parseNumber('3')).toBe(3);
    expect(parseNumber('-2.5')).toBe(-2.5);
    expect(parseNumber('1/2')).toBe(0.5);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });
});

describe('share links', () => {
  it('round-trips a notebook through the URL', () => {
    const nb = newNotebook('Shared');
    nb.cells = [mathCell('\\frac{x+1}{2}=3')];
    const link = shareLink(nb, 'https://example.github.io/MathDocs/#/somewhere');
    expect(link.startsWith('https://example.github.io/MathDocs/#/share/')).toBe(true);
    const back = decodeNotebook(link.split('#/share/')[1]);
    expect(back.cells[0]).toMatchObject({ latex: '\\frac{x+1}{2}=3' });
    expect(back.id).toBe(nb.id);
    expect(encodeNotebook(nb).length).toBeLessThan(600);
  });

  it('rejects damaged links', () => {
    expect(() => decodeNotebook('garbage!!')).toThrow();
  });
});
