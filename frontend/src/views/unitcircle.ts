// The unit circle: a point on it at a draggable angle (snapping to multiples of 15°), the terminal side, the
// reference triangle down to the x-axis, and the angle labeled (60° or π/3). The coordinates (cos θ, sin θ)
// are left for the student to work out.

import JXG from 'jsxgraph';
import type { UnitCircleItem } from '../model';

const STEP = Math.PI / 12; // 15°

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}

/** θ (a multiple of π/12) written as π/3, 5π/6, π, 3π/2 … */
export function radiansLabel(theta: number): string {
  const k = Math.round(theta / STEP);
  if (k === 0) return '0';
  const g = gcd(k, 12);
  const num = k / g;
  const den = 12 / g;
  const top = num === 1 ? 'π' : num === -1 ? '−π' : `${num < 0 ? '−' : ''}${Math.abs(num)}π`;
  return den === 1 ? top : `${top}/${den}`;
}

export function degreesLabel(theta: number): string {
  return `${Math.round((theta * 180) / Math.PI)}°`;
}

/** Snap an angle to the nearest 15°, kept in [0, 2π]. */
export function snapAngle(theta: number): number {
  let t = Math.round(theta / STEP) * STEP;
  if (t < 0) t += 2 * Math.PI;
  return Math.min(t, 2 * Math.PI);
}

export function drawUnitCircle(
  board: any,
  item: UnitCircleItem,
  opts: { readOnly: boolean; degrees: boolean },
  syncers: (() => boolean)[],
): void {
  const color = item.color;
  const O = board.create('point', [0, 0], { visible: false, fixed: true, withLabel: false });
  const circle = board.create('circle', [O, 1], { strokeColor: color, strokeWidth: 2, highlight: false, fixed: true });
  const P: any = board.create('glider', [Math.cos(item.angle), Math.sin(item.angle), circle], {
    name: '', size: 6, fillColor: color, strokeColor: color, fixed: opts.readOnly, showInfobox: false, withLabel: false,
  });
  // Snap to the nearest 15° while dragging.
  P.on('drag', () => {
    const t = snapAngle(Math.atan2(P.Y(), P.X()));
    P.setPositionDirectly(JXG.COORDS_BY_USER, [Math.cos(t), Math.sin(t)]);
  });
  const angleOf = () => {
    const t = Math.atan2(P.Y(), P.X());
    return snapAngle(t < -1e-9 ? t + 2 * Math.PI : t);
  };
  const foot = board.create('point', [() => P.X(), 0], { visible: false, withLabel: false });
  const X1 = board.create('point', [1, 0], { visible: false, fixed: true, withLabel: false });
  board.create('segment', [O, P], { strokeColor: color, strokeWidth: 2.5, highlight: false, fixed: true });
  const ref = { strokeColor: '#e8590c', strokeWidth: 2, dash: 2, highlight: false, fixed: true };
  board.create('segment', [P, foot], ref);
  board.create('segment', [O, foot], ref);
  // The angle from the positive x-axis, counterclockwise.
  board.create('angle', [X1, O, P], {
    radius: 0.25, fillColor: color, fillOpacity: 0.15, strokeColor: color, withLabel: false, highlight: false, fixed: true,
  });
  board.create('text', [
    () => 0.32 * Math.cos(angleOf() / 2) + 0.04,
    () => 0.32 * Math.sin(angleOf() / 2) + 0.04,
    () => `θ = ${opts.degrees ? degreesLabel(angleOf()) : radiansLabel(angleOf())}`,
  ], { fontSize: 14, strokeColor: color, fixed: true, highlight: false });
  board.create('text', [() => P.X() + (P.X() >= 0 ? 0.05 : -0.05), () => P.Y() + (P.Y() >= 0 ? 0.08 : -0.08), '(?, ?)'], {
    fontSize: 13, strokeColor: color, fixed: true, highlight: false, anchorX: () => (P.X() >= 0 ? 'left' : 'right'),
  });
  syncers.push(() => {
    const t = angleOf();
    if (Math.abs(t - item.angle) < 1e-9) return false;
    item.angle = t;
    return true;
  });
}
