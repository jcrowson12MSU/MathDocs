// Small LaTeX clean-ups shared by the math modules.

/**
 * Students write 2½x as 2\frac12x. Read a whole number written right before a number-over-number
 * fraction as a mixed number (Compute Engine would otherwise multiply: 2·½·x).
 */
export function mixedNumbers(latex: string): string {
  const num = String.raw`(\d|\{\d+\})`;
  return latex.replace(new RegExp(String.raw`(^|[^\d.}^_])(\d+)\\frac${num}${num}`, 'g'), (_m, pre, whole, a, b) =>
    `${pre}\\left(${whole}+\\frac{${a.replace(/[{}]/g, '')}}{${b.replace(/[{}]/g, '')}}\\right)`,
  );
}
