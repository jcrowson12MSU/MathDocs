// Small LaTeX clean-ups shared by the math modules.

/**
 * Students write 2½x as 2\frac12x. Read a whole number written right before a number-over-number
 * fraction as a mixed number (Compute Engine would otherwise multiply: 2·½·x).
 */
export function mixedNumbers(latex: string): string {
  const num = String.raw`(\d|\{\d+\})`;
  return connectives(latex).replace(new RegExp(String.raw`(^|[^\d.}^_])(\d+)\\frac${num}${num}`, 'g'), (_m, pre, whole, a, b) =>
    `${pre}\\left(${whole}+\\frac{${a.replace(/[{}]/g, '')}}{${b.replace(/[{}]/g, '')}}\\right)`,
  );
}

/**
 * "or" / "and" written as words — x < −1 or x ≥ 4, typed as \;\operatorname{\mathrm{or}}\; or \text{ or } — read as
 * the logic connectives Compute Engine understands (\lor, \land).
 */
export function connectives(latex: string): string {
  const space = String.raw`(?:\\[;,:! ]|\s|~)*`;
  return latex.replace(
    new RegExp(String.raw`${space}(?:\\operatorname\{(?:\\mathrm\{)?|\\text\{\s*|\\mathrm\{)(or|and)(?:\})?\s*\}${space}`, 'g'),
    (_m, word: string) => (word === 'or' ? String.raw`\lor ` : String.raw`\land `),
  );
}
