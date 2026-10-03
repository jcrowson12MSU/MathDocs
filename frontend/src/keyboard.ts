// A "Calculus" tab for the on-screen math keyboard (⌨ Keyboard): integrals, derivatives, limits, sums,
// partial derivatives, vectors. Each key only writes notation; nothing is evaluated.

import type { VirtualKeyboardLayout } from 'mathlive';

const CALCULUS: VirtualKeyboardLayout = {
  label: '∫ d/dx',
  tooltip: 'Calculus',
  rows: [
    [
      { latex: '\\frac{d}{dx}', insert: '\\frac{d}{dx}\\left(#0\\right)', tooltip: 'derivative' },
      { latex: '\\frac{dy}{dx}', tooltip: 'dy/dx' },
      { latex: "f'(x)", insert: "#@'", tooltip: 'prime' },
      { latex: "f''(x)", insert: "#@''", tooltip: 'second derivative' },
      { latex: '\\frac{\\partial}{\\partial x}', insert: '\\frac{\\partial}{\\partial #?}\\left(#0\\right)', tooltip: 'partial derivative' },
      { latex: '\\partial', tooltip: 'partial' },
      { latex: '\\nabla', tooltip: 'gradient (del)' },
    ],
    [
      { latex: '\\int\\,dx', insert: '\\int #0\\,dx', tooltip: 'integral' },
      { latex: '\\int_a^b', insert: '\\int_{#?}^{#?}#0\\,dx', tooltip: 'definite integral' },
      { latex: '\\iint', insert: '\\iint_{#?}#0\\,dA', tooltip: 'double integral' },
      { latex: '\\iiint', insert: '\\iiint_{#?}#0\\,dV', tooltip: 'triple integral' },
      { latex: '\\oint', insert: '\\oint_{#?}#0', tooltip: 'line integral' },
      { latex: '\\Big|_a^b', insert: '\\Big|_{#?}^{#?}', tooltip: 'evaluate from a to b' },
      { latex: '+C', tooltip: 'constant of integration' },
    ],
    [
      { latex: '\\lim_{x\\to a}', insert: '\\lim_{x\\to #?}#0', tooltip: 'limit' },
      { latex: '\\lim_{x\\to a^-}', insert: '\\lim_{x\\to #?^-}#0', tooltip: 'limit from the left' },
      { latex: '\\lim_{x\\to a^+}', insert: '\\lim_{x\\to #?^+}#0', tooltip: 'limit from the right' },
      { latex: '\\sum', insert: '\\sum_{n=#?}^{#?}#0', tooltip: 'sum' },
      { latex: '\\infty', tooltip: 'infinity' },
      { latex: '\\to', tooltip: 'approaches' },
      { latex: '\\Delta x', insert: '\\Delta ', tooltip: 'change in' },
    ],
    [
      { latex: '\\vec{v}', insert: '\\vec{#@}', tooltip: 'vector' },
      { latex: '\\langle a,b\\rangle', insert: '\\left\\langle #0\\right\\rangle', tooltip: 'vector components' },
      { latex: '\\hat{\\imath}', insert: '\\hat{\\imath}', tooltip: 'i unit vector' },
      { latex: '\\hat{\\jmath}', insert: '\\hat{\\jmath}', tooltip: 'j unit vector' },
      { latex: '\\hat{k}', insert: '\\hat{k}', tooltip: 'k unit vector' },
      { latex: '\\|\\vec{v}\\|', insert: '\\left\\|#0\\right\\|', tooltip: 'magnitude' },
      { latex: '\\times', tooltip: 'cross product' },
    ],
    ['[left]', '[right]', '[backspace]', { latex: '\\cdot', tooltip: 'dot product' }, { latex: '\\theta' }, '[return]', '[hide-keyboard]'],
  ],
};

let installed = false;

/** Add the Calculus tab (once) next to MathLive's own keyboards. */
export function installCalculusKeyboard(): void {
  if (installed || typeof window === 'undefined' || !window.mathVirtualKeyboard) return;
  installed = true;
  window.mathVirtualKeyboard.layouts = ['numeric', 'symbols', CALCULUS, 'alphabetic', 'greek'];
}
