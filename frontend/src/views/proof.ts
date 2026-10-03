// A two-column proof: Given and Prove, then numbered Statement | Reason rows. Statements are math
// (∠A ≅ ∠B, \overline{AB} ≅ \overline{CD}); reasons are plain text ("Vertical angles are congruent").

import type { ProofCell } from '../model';
import { h } from '../ui';
import { gridMath, gridNavigator, gridText, type GridContext, type GridField } from './gridnav';

export interface ProofContext extends GridContext {
  onChange: () => void;
}

export function proofEditor(cell: ProofCell, ctx: ProofContext) {
  const box = h('div', { class: 'step-box proof-box' });
  let nav: GridField[][] = [];
  const navigator = gridNavigator(() => nav, ctx, {
    // Enter in the last reason adds a row.
    addRow: (r) => {
      if (r !== nav.length - 1 || r < 2) return false;
      cell.rows.push({ statement: '', reason: '' });
      build();
      ctx.onChange();
      return true;
    },
    // Backspace in an empty statement of an empty last row removes it.
    onEmptyBackspace: (r, c) => {
      const i = r - 2;
      const row = cell.rows[i];
      if (c !== 0 || !row || row.reason || i !== cell.rows.length - 1 || cell.rows.length <= 1) return false;
      cell.rows.pop();
      build();
      ctx.onChange();
      setTimeout(() => nav[nav.length - 1]?.[1]?.focus('end'));
      return true;
    },
  });

  const build = () => {
    const given = gridMath(cell.given, ctx.readOnly, 'proof-given', '\\text{what you know}');
    const prove = gridMath(cell.prove, ctx.readOnly, 'proof-given', '\\text{what to show}');
    given.el.addEventListener('input', () => ((cell.given = given.el.value), ctx.onChange()));
    prove.el.addEventListener('input', () => ((cell.prove = prove.el.value), ctx.onChange()));
    navigator.attach(given);
    navigator.attach(prove);
    nav = [[given], [prove]];
    const table = h('div', { class: 'proof-table' },
      h('div', { class: 'proof-head' }, h('span', {}, ''), h('span', {}, 'Statements'), h('span', {}, 'Reasons')));
    cell.rows.forEach((row, i) => {
      const st = gridMath(row.statement, ctx.readOnly, 'proof-statement');
      const re = gridText(row.reason, ctx.readOnly, 'proof-reason', i === 0 ? 'Given' : '');
      st.el.addEventListener('input', () => ((row.statement = st.el.value), ctx.onChange()));
      re.el.addEventListener('input', () => ((row.reason = re.el.value), ctx.onChange()));
      navigator.attach(st);
      navigator.attach(re);
      nav.push([st, re]);
      table.append(h('div', { class: 'proof-row' }, h('span', { class: 'proof-num' }, `${i + 1}.`), st.el, re.el));
    });
    box.replaceChildren(
      h('div', { class: 'proof-gp' }, h('span', { class: 'proof-label' }, 'Given'), given.el),
      h('div', { class: 'proof-gp' }, h('span', { class: 'proof-label' }, 'Prove'), prove.el),
      table,
      ctx.readOnly ? '' : h('div', { class: 'layout-tools' },
        h('button', {
          class: 'link small',
          onclick: () => {
            cell.rows.push({ statement: '', reason: '' });
            build();
            ctx.onChange();
            setTimeout(() => nav[nav.length - 1][0].focus('start'));
          },
        }, '+ row'),
        h('span', { class: 'muted' }, 'Type \\angle ∠  \\cong ≅  \\triangle △  \\overline  \\parallel ∥  \\perp ⊥')),
    );
  };
  build();
  return { el: box, focus: navigator.focus };
}
