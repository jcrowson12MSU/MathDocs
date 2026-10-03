import { describe, expect, it } from 'vitest';
import { analyze, applyOperation, derivative, distributeRow, integrate, intersections, mixedNumbers, multiplierOf, multiplyRow, splitRelation, variableLatex } from './mathfn';
import { mathCell, mergeComments, type MathCell, newNotebook, normalize, parseNumber } from './model';
import { decodeNotebook, encodeNotebook, shareLink } from './share';
import { solutionSet, yRegion } from './inequality';
import { splitMath } from './markdown';
import { cleanLatex, substitute, valueStep } from './substitute';
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
    expect(analyze('x=3')).toEqual({ kind: 'verticals', xs: [3] });
  });

  it('draws standard-form equations as lines (y solved for), so crossings get marked', () => {
    // From "Elimination Practice": 9x + 12y = 30 and 8x − 12y = −64 cross at (−2, 4).
    const a = analyze('9x+12y=30');
    const b = analyze('8x-12y=-64');
    expect(a.kind).toBe('function');
    expect(b.kind).toBe('function');
    if (a.kind !== 'function' || b.kind !== 'function') return;
    expect(a.f(0, {})).toBeCloseTo(2.5, 9);
    const xs = intersections((x) => a.f(x, {}), (x) => b.f(x, {}), -10, 10);
    expect(xs.map((x) => +x.toFixed(9))).toEqual([-2]);
    expect(a.f(-2, {})).toBeCloseTo(4, 9);
    // Letters still become sliders.
    const p = analyze('ax+by=c');
    expect(p.kind === 'function' && p.params).toEqual(['a', 'b', 'c']);
    expect(analyze('x^2+y=4').kind).toBe('function');
    expect(analyze('x^2+y^2=25').kind).toBe('implicit'); // two y values for each x
  });

  it('draws an equation in x alone as vertical lines at its solutions', () => {
    const one = analyze('2x+3=5x-8');
    expect(one.kind === 'verticals' && one.xs.map((x) => +x.toFixed(6))).toEqual([3.666667]);
    const two = analyze('x^2=9');
    expect(two.kind === 'verticals' && [...two.xs].sort()).toEqual([-3, 3]);
    expect(analyze('x^2=-1').kind).toBe('error'); // no real solution
    expect(analyze('\\sin(x)=0').kind).toBe('error'); // infinitely many: ask for y = … instead
  });

  it('graphs points', () => {
    const p = analyze('\\left(10,0\\right)');
    expect(p.kind === 'points' && p.points.map((f) => f({}))).toEqual([[10, 0]]);
    const ps = analyze('\\left(1,2\\right),\\left(3,4\\right)');
    expect(ps.kind === 'points' && ps.points.map((f) => f({}))).toEqual([[1, 2], [3, 4]]);
    const withSlider = analyze('\\left(a,3\\right)');
    expect(withSlider.kind === 'points' && withSlider.params).toEqual(['a']);
    expect(withSlider.kind === 'points' && withSlider.points[0]({ a: 5 })).toEqual([5, 3]);
  });

  it('reports what it cannot graph', () => {
    expect(analyze('')).toEqual({ kind: 'empty' });
    expect(analyze('x^2+y^2<25').kind).toBe('error'); // shaded circles aren't supported yet
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

describe('intersections', () => {
  const line = (latex: string) => {
    const r = analyze(latex);
    if (r.kind !== 'function') throw new Error(latex);
    return (x: number) => r.f(x, {});
  };

  it('finds where the two candle lines cross', () => {
    // From "Systems of Equations": y = 5/6 x + 55 and y = 2½x + 25 meet at (18, 70).
    const a = line('y=\\frac56x+55');
    const b = line(mixedNumbers('y=2\\frac12x+25'));
    const xs = intersections(a, b, -100, 100);
    expect(xs.length).toBe(1);
    expect(xs[0]).toBeCloseTo(18, 9);
    expect(a(xs[0])).toBeCloseTo(70, 9);
  });

  it('finds every crossing in the range, left to right', () => {
    const xs = intersections((x) => x * x, (x) => x + 2, -10, 10); // x² = x + 2 → x = −1, 2
    expect(xs.map((x) => +x.toFixed(9))).toEqual([-1, 2]);
    expect(intersections((x) => x * x, (x) => x + 2, 5, 10)).toEqual([]); // none in this range
  });

  it('ignores parallel lines and asymptotes', () => {
    expect(intersections((x) => 2 * x + 1, (x) => 2 * x + 5, -50, 50)).toEqual([]);
    // 1/x jumps from −∞ to +∞ at 0 but never crosses y = 0.
    expect(intersections((x) => 1 / x, () => 0, -5, 5)).toEqual([]);
  });
});

describe('inequalities', () => {
  const set = (latex: string) => {
    const s = solutionSet(latex);
    if (!s) return null;
    const end = (v: number) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : +v.toFixed(6));
    return s.intervals.map((i) => `${i.fromClosed ? '[' : '('}${end(i.from)}, ${end(i.to)}${i.toClosed ? ']' : ')'}`).join(' ∪ ');
  };

  it('solves one-variable inequalities into intervals', () => {
    expect(set('x>3')).toBe('(3, ∞)');
    expect(set('x\\ge3')).toBe('[3, ∞)');
    expect(set('2x+3>7')).toBe('(2, ∞)');
    expect(set('-3x\\le12')).toBe('[-4, ∞)'); // dividing by −3 flips it
    expect(set('-2<x\\le3')).toBe('(-2, 3]');
    expect(set('x^2<9')).toBe('(-3, 3)');
    expect(set('x^2\\ge9')).toBe('(-∞, -3] ∪ [3, ∞)');
    expect(set('x\\ne4')).toBe('(-∞, 4) ∪ (4, ∞)');
    expect(set('x=5')).toBe('[5, 5]');
    expect(set('t>5')).toBe('(5, ∞)');
    expect(solutionSet('t>5')?.variable).toBe('t');
  });

  it('handles "or", "and", and absolute value both ways round', () => {
    expect(set('x<-1\\text{ or }x\\ge4')).toBe('(-∞, -1) ∪ [4, ∞)');
    expect(set('x>2\\text{ and }x\\le6')).toBe('(2, 6]');
    expect(set('-3\\le2x+1<5')).toBe('[-2, 2)');
    expect(set('\\left|x-3\\right|<5')).toBe('(-2, 8)');
    expect(set('\\left|x-3\\right|\\ge5')).toBe('(-∞, -2] ∪ [8, ∞)');
    expect(set('\\left|2x+1\\right|=7')).toBe('[-4, -4] ∪ [3, 3]');
  });

  it('handles mixed numbers and has no solution when none exists', () => {
    expect(set('x<2\\frac12')).toBe('(-∞, 2.5)');
    expect(set('x^2<-1')).toBe('');
  });

  it('declines what it cannot do', () => {
    expect(solutionSet('y<2x+1')).toBeNull(); // two variables
    expect(solutionSet('2x+3')).toBeNull(); // not an (in)equality
    expect(solutionSet('\\sin(x)>0')).toBeNull(); // infinitely many pieces
  });

  it('graphs inequalities as shaded regions or bands', () => {
    const r = analyze('y<2x+1');
    expect(r.kind === 'region' && [r.shade, r.inclusive, r.f(3, {})]).toEqual(['below', false, 7]);
    const withSlider = analyze('y\\ge ax^2');
    expect(withSlider.kind === 'region' && withSlider.params).toEqual(['a']);
    const bands = analyze('x^2>9');
    expect(bands.kind === 'xbands' && bands.intervals.length).toBe(2);
  });

  it('finds the boundary and side to shade for y inequalities', () => {
    expect(yRegion('y<2x+1')).toMatchObject({ shade: 'below', inclusive: false });
    expect(yRegion('y\\ge x^2')).toMatchObject({ shade: 'above', inclusive: true });
    expect(yRegion('2x+1>y')).toMatchObject({ shade: 'below', inclusive: false });
    expect(yRegion('x^2+y^2<25')).toBeNull();
  });
});

describe('multiplying a row of a system', () => {
  it('reads the multiplier from a note', () => {
    expect(multiplierOf('\\times3')).toBe('3');
    expect(multiplierOf('×3')).toBe('3');
    expect(multiplierOf('\\cdot\\left(-2\\right)')).toBe('-2');
    expect(multiplierOf('\\times\\frac12')).toBe('\\frac12');
    expect(multiplierOf('add')).toBeNull();
    expect(multiplierOf('\\times x')).toBeNull(); // only numbers
    expect(multiplierOf('\\times0')).toBeNull();
  });

  it('writes out multiplying both sides, like the student did', () => {
    expect(multiplyRow('2x-y=5', '\\times3')).toBe('3\\left(2x-y\\right)=3\\cdot5');
    expect(multiplyRow('x-y=2', '\\times2')).toBe('2\\left(x-y\\right)=2\\cdot2');
    expect(multiplyRow('3x+2y=-4', '\\times\\left(-2\\right)')).toBe('\\left(-2\\right)\\left(3x+2y\\right)=\\left(-2\\right)\\cdot\\left(-4\\right)');
    expect(multiplyRow('2x-y=5', 'check')).toBeNull();
  });

  it('distributes, keeping x before y', () => {
    expect(distributeRow('3\\left(2x-y\\right)=3\\cdot5')).toBe('6x-3y=15');
    expect(distributeRow('2\\left(x-y\\right)=2\\cdot2')).toBe('2x-2y=4');
    expect(distributeRow('\\left(-2\\right)\\left(3x+2y\\right)=\\left(-2\\right)\\cdot\\left(-4\\right)')).toBe('-6x-4y=8');
    expect(distributeRow('-3\\left(-y+2x\\right)=6')).toBe('-6x+3y=6');
    expect(distributeRow('4x+3y=25')).toBeNull(); // nothing to do
    expect(distributeRow('x+3y=13')).toBeNull(); // not reordered to 3y + x
  });
});

describe('substitution', () => {
  it('reads a value from a step like x = 4', () => {
    expect(valueStep('x=4')).toEqual({ variable: 'x', value: '4' });
    expect(valueStep('y=-3')).toEqual({ variable: 'y', value: '-3' });
    expect(valueStep('-2=x')).toEqual({ variable: 'x', value: '-2' });
    expect(valueStep('x=\\frac{1}{2}')).toEqual({ variable: 'x', value: '\\frac{1}{2}' });
    expect(valueStep('x_{}=4')).toEqual({ variable: 'x', value: '4' });
    expect(valueStep('y=2x-5')).toBeNull(); // not a value yet
    expect(valueStep('2x=8')).toBeNull();
  });

  it('writes the value in, with parentheses only where needed', () => {
    expect(substitute('2x-y=5', 'x', '4')).toBe('2\\left(4\\right)-y=5');
    expect(substitute('x+3y=10', 'x', '4')).toBe('4+3y=10');
    expect(substitute('9x+12y=30', 'x', '-2')).toBe('9\\left(-2\\right)+12y=30');
    expect(substitute('2x-y=5', 'y', '-3')).toBe('2x-\\left(-3\\right)=5');
    expect(substitute('x^2+x=6', 'x', '2')).toBe('2^2+2=6');
    expect(substitute('x^2=6', 'x', '-2')).toBe('\\left(-2\\right)^2=6');
    expect(substitute('\\frac{x}{2}=3', 'x', '6')).toBe('\\frac{6}{2}=3');
  });

  it('leaves commands and other variables alone', () => {
    expect(substitute('3\\times x=x_1', 'x', '4')).toBe('3\\times 4=x_1');
    expect(substitute('\\max(x,2)', 'x', '5')).toBe('\\max(5,2)');
  });

  it('cleans up empty subscripts and exponents', () => {
    expect(cleanLatex('y_{}=\\frac56x_{}+55')).toBe('y=\\frac56x+55');
    expect(cleanLatex('x^{}+1')).toBe('x+1');
    expect(cleanLatex('x_{1}+y^{2}')).toBe('x_{1}+y^{2}');
  });
});

describe('text cells: math and dollar signs', () => {
  const formulas = (t: string) => splitMath(t).segments.map((s) => s.tex);

  it('finds $inline$ and $$display$$ math', () => {
    expect(formulas('Solve $2x+3=7$ for $x$.')).toEqual(['2x+3=7', 'x']);
    expect(splitMath('$$x^2$$').segments).toEqual([{ tex: 'x^2', display: true }]);
  });

  it('treats \\$ as a plain dollar sign, not the start of math', () => {
    const r = splitMath('Plan A costs \\$20 plus \\$5 a month.');
    expect(r.segments).toEqual([]);
    expect(r.text).not.toContain('\\$');
    // Money and math in the same sentence.
    expect(formulas('It costs \\$5 per hour, so $c = 5h$.')).toEqual(['c = 5h']);
  });

  it('keeps \\$ inside a formula as a LaTeX dollar sign', () => {
    expect(formulas('$\\$20 + \\$5$')).toEqual(['\\$20 + \\$5']);
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
