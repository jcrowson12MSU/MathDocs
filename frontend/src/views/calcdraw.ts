// Drawing for calculus graphs: sequences, vectors, vector fields and slope fields (2D), and 3D scenes
// (surfaces z = f(x, y), space curves, points and vectors). These only draw what was typed; nothing is solved.

import type { Params, Plottable } from '../mathfn';

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : 'undefined');

/** a_n: a dot at (n, a_n) for each whole n from 1 to the right edge of the view (at most 300). */
export function drawSequence(board: any, a: Extract<Plottable, { kind: 'sequence' }>, params: () => Params, color: string): void {
  const pts: any[] = [];
  const draw = () => {
    for (const p of pts) board.removeObject(p);
    pts.length = 0;
    const [, , x2] = board.getBoundingBox();
    const last = Math.max(1, Math.min(300, Math.floor(x2)));
    for (let n = 1; n <= last; n++) {
      const y = a.a(n, params());
      if (!Number.isFinite(y)) continue;
      pts.push(board.create('point', [n, y], {
        name: '', size: 3, fillColor: color, strokeColor: color, fixed: true, highlight: false, showInfobox: true, withLabel: false,
      }));
    }
  };
  draw();
  board.on('boundingbox', draw);
}

/** ⟨a, b⟩: an arrow from the origin, labeled with its name if it has one. */
export function drawVector(board: any, v: Extract<Plottable, { kind: 'vector' }>, params: () => Params, color: string): void {
  const head = () => [v.x(params()), v.y(params())];
  board.create('arrow', [[0, 0], [() => head()[0], () => head()[1]]], {
    strokeColor: color, strokeWidth: 2.5, highlight: false, fixed: true, lastArrow: { type: 2, size: 6 },
    point1: { visible: false }, point2: { visible: false },
  });
  board.create('text', [() => head()[0] / 2, () => head()[1] / 2, () => (v.name ? `  ${v.name}` : `  ⟨${fmt(head()[0])}, ${fmt(head()[1])}⟩`)], {
    fontSize: 14, strokeColor: color, fixed: true, highlight: false,
  });
}

/**
 * A field drawn on a grid across the view: arrows for ⟨P, Q⟩ (longer where the field is stronger), short
 * segments of slope f(x, y) for a slope field. Redrawn as the view moves.
 */
export function drawField(board: any, a: Extract<Plottable, { kind: 'field' | 'slopefield' }>, params: () => Params, color: string): void {
  const curve = board.create('curve', [[], []], { strokeColor: color, strokeWidth: 1.5, highlight: false, fixed: true, strokeOpacity: 0.85 });
  curve.updateDataArray = function () {
    const [x1, y1, x2, y2] = board.getBoundingBox();
    // About 20 arrows across, with the same spacing (in pixels) down.
    const cols = 20;
    const dx = (x2 - x1) / cols;
    const dy = (y1 - y2) / Math.max(4, Math.round(cols * ((board.canvasHeight || 1) / (board.canvasWidth || 1))));
    const X: number[] = [];
    const Y: number[] = [];
    const p = params();
    // Pixel-per-unit ratio, so slopes look right when the axes are scaled differently.
    const sx = board.unitX;
    const sy = board.unitY;
    const vectors: [number, number, number, number][] = [];
    let maxLen = 0;
    for (let x = x1 + dx / 2; x < x2; x += dx) {
      for (let y = y2 + dy / 2; y < y1; y += dy) {
        let u: number;
        let w: number;
        if (a.kind === 'field') {
          u = a.P(x, y, p);
          w = a.Q(x, y, p);
        } else {
          u = 1;
          w = a.f(x, y, p);
        }
        if (!Number.isFinite(u) || !Number.isFinite(w)) continue;
        const len = Math.hypot(u * sx, w * sy);
        if (len === 0) continue;
        vectors.push([x, y, u, w]);
        maxLen = Math.max(maxLen, len);
      }
    }
    const cell = Math.min(dx * sx, dy * sy) * 0.8; // pixels
    for (const [x, y, u, w] of vectors) {
      const len = Math.hypot(u * sx, w * sy);
      // Slope fields: all segments the same length. Vector fields: scaled by strength (at least a third).
      const k = a.kind === 'slopefield' ? cell / len : (cell * Math.max(0.35, len / maxLen)) / len;
      const ex = (u * k) / 1;
      const ey = (w * k) / 1;
      if (a.kind === 'slopefield') {
        X.push(x - ex / 2, x + ex / 2, NaN);
        Y.push(y - ey / 2, y + ey / 2, NaN);
      } else {
        const tx = x + ex / 2;
        const ty = y + ey / 2;
        X.push(x - ex / 2, tx, NaN);
        Y.push(y - ey / 2, ty, NaN);
        // Arrowhead: two short strokes back from the tip (computed in pixels, then back to units).
        const px = (ex * sx) / Math.hypot(ex * sx, ey * sy);
        const py = (ey * sy) / Math.hypot(ex * sx, ey * sy);
        const h = Math.min(6, Math.hypot(ex * sx, ey * sy) * 0.4);
        for (const s of [1, -1]) {
          const hx = -px * h + s * -py * h * 0.6;
          const hy = -py * h + s * px * h * 0.6;
          X.push(tx, tx + hx / sx, NaN);
          Y.push(ty, ty + hy / sy, NaN);
        }
      }
    }
    this.dataX = X;
    this.dataY = Y;
  };
  board.update();
}

// ---- 3D -------------------------------------------------------------------------------------------

export interface Item3D {
  analysis: Plottable;
  color: string;
  params: () => Params;
}

/** A rotatable 3D view of the items' surfaces, curves, points and arrows (drag empty space to turn it). */
export function draw3D(board: any, items: Item3D[], range: number): any {
  const r = range;
  const view = board.create('view3d', [[-6, -5], [12, 10], [[-r, r], [-r, r], [-r, r]]], {
    projection: 'parallel',
    trackball: { enabled: true },
    az: { slider: { visible: false, start: 0.9 } },
    el: { slider: { visible: false, start: 0.35 } },
    bank: { slider: { visible: false } },
    xPlaneRear: { visible: false }, yPlaneRear: { visible: false },
    zPlaneRear: { fillOpacity: 0.05, mesh3d: { visible: true } },
    axesPosition: 'center',
  });
  for (const { analysis: a, color, params } of items) {
    if (a.kind === 'surface') {
      // Kept inside the box: heights beyond it are left out.
      const z = (x: number, y: number) => {
        const v = a.f(x, y, params());
        return Math.abs(v) <= r * 1.05 ? v : NaN;
      };
      view.create('functiongraph3d', [z, [-r, r], [-r, r]], {
        strokeColor: color, strokeWidth: 0.6, stepsU: 30, stepsV: 30, strokeOpacity: 0.8,
      });
    } else if (a.kind === 'curve3d') {
      view.create('curve3d', [(t: number) => a.x(t, params()), (t: number) => a.y(t, params()), (t: number) => a.z(t, params()), [a.from, a.to]], {
        strokeColor: color, strokeWidth: 2.5, numberPointsHigh: 600,
      });
    } else if (a.kind === 'point3d') {
      const at = () => a.at(params());
      if (a.arrow) {
        const origin = view.create('point3d', [0, 0, 0], { visible: false, withLabel: false });
        const tip = view.create('point3d', [() => at()[0], () => at()[1], () => at()[2]], {
          size: 2, fillColor: color, strokeColor: color, withLabel: !!a.name, name: a.name, fixed: true,
        });
        view.create('line3d', [origin, tip], { strokeColor: color, strokeWidth: 2.5, lastArrow: { type: 2, size: 6 } });
      } else {
        view.create('point3d', [() => at()[0], () => at()[1], () => at()[2]], {
          size: 4, fillColor: color, strokeColor: color, fixed: true,
          name: `(${at().map(fmt).join(', ')})`, withLabel: true, label: { fontSize: 12, strokeColor: color },
        });
      }
    }
  }
  return view;
}
