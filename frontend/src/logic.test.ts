import { describe, expect, it } from 'vitest';
import { analyze, derivative, integrate, variableLatex } from './mathfn';
import { mathCell, mergeComments, type MathCell, newNotebook, normalize, parseNumber } from './model';
import { decodeNotebook, encodeNotebook, shareLink } from './share';

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
