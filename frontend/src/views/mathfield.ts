// Focusing MathLive fields reliably from code.

import { MathfieldElement } from 'mathlive';

export type Where = 'start' | 'end' | number;

/**
 * Returns a focus function that works even right after the field is created.
 *
 * - A new mathfield can't take focus until MathLive has mounted it (one frame after insertion).
 * - MathLive keeps the keyboard if another mathfield still holds focus, so release it first.
 * - MathLive hands the keyboard over ~60ms after focus(); focusing its input sink directly
 *   keeps quick keystrokes (like holding ↑) from being dropped in between.
 */
export function focusable(mf: MathfieldElement, onMount?: () => void): (where: Where) => void {
  let mounted = false;
  let pending: Where | null = null;
  const focusNow = (where: Where) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== mf) active.blur();
    mf.focus();
    mf.shadowRoot?.querySelector<HTMLElement>('[part="keyboard-sink"]')?.focus({ preventScroll: true });
    mf.position = where === 'start' ? 0 : where === 'end' ? mf.lastOffset : Math.min(where, mf.lastOffset);
  };
  mf.addEventListener('mount', () => {
    mounted = true;
    onMount?.();
    if (pending !== null) focusNow(pending);
    pending = null;
  });
  return (where) => {
    if (mounted) focusNow(where);
    else {
      // Release the previous field so fast typing doesn't land in the wrong place.
      (document.activeElement as HTMLElement | null)?.blur();
      pending = where;
    }
  };
}
