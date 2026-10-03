// Substituting a value the student found (x = 4) into an equation they choose, written the way it's done on
// paper: 2x − y = 5 → 2(4) − y = 5. Only the writing-in is done here; the arithmetic is left to the student.

/** A step that gives a variable's value: "x=4", "y=-3", "x=\frac{1}{2}" (the letter alone on one side). */
export function valueStep(latex: string): { variable: string; value: string } | null {
  const m = /^\s*([a-zA-Z])\s*=\s*(.+?)\s*$/.exec(cleanLatex(latex)) ?? /^\s*(.+?)\s*=\s*([a-zA-Z])\s*$/.exec(cleanLatex(latex));
  if (!m) return null;
  const [variable, value] = /^[a-zA-Z]$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  // The value must be a number (no letters), like 4, -3, 2.5, \frac{1}{2}, -\frac34.
  const letters = value.replace(/\\[a-zA-Z]+/g, '').match(/[a-zA-Z]/);
  if (letters || !/\d/.test(value)) return null;
  return { variable, value };
}

const isPlainNumber = (v: string) => /^\d+(\.\d+)?$/.test(v);

/**
 * Write `value` in for every `variable` in `latex`, adding parentheses where they're needed:
 * after a number or letter (2x → 2(4)), for a negative value (−y → −(−3)), and for a non-plain value
 * raised to a power ((½)²). LaTeX commands (\times, \frac…) and other variables (x_1) are left alone.
 */
export function substitute(latex: string, variable: string, value: string): string {
  const out: string[] = [];
  let i = 0;
  /** The last thing written that wasn't a space: a character, or a command like \times. */
  let last: { char?: string; command?: string } = {};
  while (i < latex.length) {
    const ch = latex[i];
    if (ch === '\\') {
      const cmd = /^\\([a-zA-Z]+|.)/.exec(latex.slice(i))![0];
      out.push(cmd);
      last = { command: cmd.slice(1) };
      i += cmd.length;
      continue;
    }
    if (ch === variable && latex[i + 1] !== '_') {
      const next = latex.slice(i + 1).trimStart()[0] ?? '';
      // Right after a number, letter, symbol (π) or closing bracket, writing the value would merge with it.
      const implicit = last.command !== undefined ? SYMBOL_COMMANDS.has(last.command) : /[0-9a-zA-Z})\]]/.test(last.char ?? '');
      const negative = value.trim().startsWith('-');
      const power = next === '^' && !isPlainNumber(value);
      const wrap = implicit || negative || power;
      out.push(wrap ? `\\left(${value}\\right)` : value);
      last = { char: ')' };
      i += 1;
      continue;
    }
    out.push(ch);
    if (ch.trim()) last = { char: ch };
    i += 1;
  }
  return out.join('');
}

/** Commands that stand for a number or letter (so a value written right after them needs brackets). */
const SYMBOL_COMMANDS = new Set(['pi', 'theta', 'alpha', 'beta', 'gamma', 'lambda', 'mu', 'sigma', 'phi', 'omega', 'infty']);

/** Empty subscripts and exponents (x_{}, x^{}) left behind when a box is never filled in. */
export function cleanLatex(latex: string): string {
  let s = latex;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/[_^]\{\s*\}/g, '');
  } while (s !== prev);
  return s;
}
