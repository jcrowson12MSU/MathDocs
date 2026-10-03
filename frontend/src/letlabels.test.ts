// "Let x = …" boxes label the axes of their own graph only.
import { describe, expect, it } from 'vitest';
import { letBoxAbove, letBoxFor, meaningIn, normalize } from './model';

const nbWith = (graphs: number, labelsFrom?: string | null) => normalize({
  title: 't',
  cells: [
    { id: 'L1', type: 'variables', vars: [{ name: 'a', meaning: 'adult tickets' }], comments: [] },
    { id: 'm1', type: 'math', latex: 'x+1=2', comments: [] },
    { id: 'L2', type: 'variables', vars: [{ name: 'x', meaning: 'months' }, { name: 'y', meaning: 'cost' }], comments: [] },
    { id: 'm2', type: 'math', latex: 'y=25x+40', comments: [] },
  ],
  graphs: Array.from({ length: graphs }, (_, i) => ({
    id: `g${i}`, title: '', bbox: [-1, 1, 1, -1], items: [],
    ...(i === 0 && labelsFrom !== undefined ? { labelsFrom } : {}),
  })),
});

describe('Let boxes label only their own graph', () => {
  it('older notebooks: the only x/y Let box labels the only graph', () => {
    const one = nbWith(1);
    expect(letBoxFor(one, one.graphs[0])?.id).toBe('L2');
    const many = nbWith(3);
    expect(many.graphs.map((g) => letBoxFor(many, g)?.id)).toEqual([undefined, undefined, undefined]);
  });

  it('a graph can be linked to a Let box, or to none', () => {
    const linked = nbWith(3, 'L2');
    expect(letBoxFor(linked, linked.graphs[0])?.id).toBe('L2');
    expect(letBoxFor(linked, linked.graphs[1])).toBeUndefined();
    const none = nbWith(1, null);
    expect(letBoxFor(none, none.graphs[0])).toBeUndefined();
  });

  it('finds the Let box above a step (one that says what x or y is)', () => {
    const nb = nbWith(1);
    expect(letBoxAbove(nb, 1)).toBeUndefined(); // L1 only defines a
    expect(letBoxAbove(nb, 3)?.id).toBe('L2');
    expect(meaningIn(letBoxAbove(nb, 3), 'x')).toBe('months');
  });
});
