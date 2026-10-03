// The "Let x = …" cell: what each letter stands for in a word problem ("x = months", "y = cost in $").
// It only records the student's choices; graphs use the meanings of x and y as axis labels.

import type { VariablesCell } from '../model';
import { h } from '../ui';

export interface VariablesEditorContext {
  readOnly: boolean;
  onChange: () => void;
  cellKeys: (e: KeyboardEvent) => boolean;
  leave: (dir: -1 | 1) => boolean;
  /** Enter on the last meaning: go on to the next step. */
  next: () => void;
}

export function variablesEditor(cell: VariablesCell, ctx: VariablesEditorContext) {
  const list = h('div', { class: 'vars-list' });
  const box = h('div', { class: 'vars-box' }, h('div', { class: 'vars-head' }, 'Let'), list);
  let names: HTMLInputElement[] = [];
  let meanings: HTMLInputElement[] = [];

  const focusField = (input: HTMLInputElement | undefined, where: 'start' | 'end') => {
    if (!input) return false;
    input.focus();
    const pos = where === 'start' ? 0 : input.value.length;
    input.setSelectionRange(pos, pos);
    return true;
  };

  const build = () => {
    names = [];
    meanings = [];
    list.replaceChildren(
      ...cell.vars.map((v, i) => {
        const name = h('input', { class: 'var-name', value: v.name, maxlength: 3, placeholder: 'x', disabled: ctx.readOnly, 'aria-label': 'Letter' });
        const meaning = h('input', {
          class: 'var-meaning', value: v.meaning, disabled: ctx.readOnly, 'aria-label': 'What it stands for',
          placeholder: i === 0 ? 'what it stands for, e.g. number of months' : 'e.g. total cost in dollars',
        });
        name.addEventListener('input', () => {
          v.name = name.value.trim();
          ctx.onChange();
        });
        meaning.addEventListener('input', () => {
          v.meaning = meaning.value;
          ctx.onChange();
        });
        for (const [input, isName] of [[name, true], [meaning, false]] as const) {
          input.addEventListener('keydown', (e) => {
            if (ctx.cellKeys(e)) {
              e.preventDefault();
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isName) focusField(meaning, 'end');
              else if (i < cell.vars.length - 1) focusField(names[i + 1], 'end');
              else ctx.next();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (!focusField((isName ? names : meanings)[i - 1], 'end')) ctx.leave(-1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!focusField((isName ? names : meanings)[i + 1], 'start')) ctx.leave(1);
            } else if (e.key === 'Backspace' && !input.value && !isName && !name.value && cell.vars.length > 1) {
              e.preventDefault();
              cell.vars.splice(i, 1);
              build();
              ctx.onChange();
              focusField(meanings[Math.max(0, i - 1)], 'end');
            }
          });
        }
        names.push(name);
        meanings.push(meaning);
        return h('div', { class: 'var-row' }, name, h('span', { class: 'var-eq' }, '='), meaning,
          ctx.readOnly ? null : h('button', {
            class: 'icon tiny', title: 'Remove',
            onclick: () => {
              cell.vars.splice(i, 1);
              if (!cell.vars.length) cell.vars.push({ name: '', meaning: '' });
              build();
              ctx.onChange();
            },
          }, '✕'));
      }),
      ctx.readOnly ? '' : h('button', {
        class: 'link small vars-add',
        onclick: () => {
          const used = new Set(cell.vars.map((v) => v.name));
          const letter = ['x', 'y', 'z', 't', 'a', 'b'].find((l) => !used.has(l)) ?? '';
          cell.vars.push({ name: letter, meaning: '' });
          build();
          ctx.onChange();
          focusField(letter ? meanings[meanings.length - 1] : names[names.length - 1], 'end');
        },
      }, '+ variable'),
    );
  };
  build();

  return {
    el: box,
    focus: (where: 'start' | 'end') => {
      if (where === 'start') focusField(meanings[0], 'start');
      else focusField(meanings[meanings.length - 1], 'end');
    },
  };
}
