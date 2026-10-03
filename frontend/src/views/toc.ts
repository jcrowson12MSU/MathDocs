// The ☰ table of contents beside a notebook in a book (a folder with a "Table of Contents" notebook): the contents'
// text, with its links, in a panel on the left. Shown or hidden from the ☰ button; the choice is remembered.

import { api } from '../api';
import { renderMarkdown } from '../markdown';
import { normalize } from '../model';
import { folderOf, isContents } from '../routes';
import { loadSettings, saveSettings } from '../settings';
import { h, scrollWithin } from '../ui';

/** The table-of-contents notebook in `folder`, if there is one. */
export async function findContents(folder: string): Promise<{ name: string; names: Set<string> } | null> {
  try {
    const list = await api.list();
    const toc = list.find((n) => n.folder === folder && isContents(n.title));
    return toc ? { name: toc.name, names: new Set(list.map((n) => n.name)) } : null;
  } catch {
    return null;
  }
}

export class TocPanel {
  el = h('nav', { class: 'toc-panel', 'aria-label': 'Table of contents' });

  constructor(
    private tocName: string,
    /** Every notebook in the journal (to grey out links to ones not written yet). */
    private names: Set<string>,
    /** The notebook being shown, highlighted in the contents. */
    private current: string,
    /** A click on a link (the notebook view decides: scroll, open, or offer to start it). */
    onLink: (a: HTMLAnchorElement, e: Event) => void,
  ) {
    this.el.hidden = !TocPanel.isOpen();
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.notebook-link');
      if (a) onLink(a, e);
    });
  }

  static isOpen(): boolean {
    return loadSettings().tocOpen !== false;
  }

  toggle(): boolean {
    const open = this.el.hidden !== false;
    this.el.hidden = !open;
    saveSettings({ ...loadSettings(), tocOpen: open });
    return open;
  }

  /**
   * Load the contents notebook and show it unit by unit (a unit is a divider and the text under it). Every unit with
   * links shows, whether or not it's collapsed on the contents page; sections with no links (help text) are left out.
   * Each unit can be collapsed here too — remembered separately from the contents page.
   */
  async load(): Promise<void> {
    const toc = normalize(await api.get(this.tocName));
    const folder = folderOf(this.tocName);
    const units: { title: string; blocks: HTMLElement[] }[] = [{ title: '', blocks: [] }];
    for (const c of toc.cells) {
      if (c.type === 'divider') units.push({ title: c.title.trim(), blocks: [] });
      else if (c.type === 'markdown' && c.text.trim()) {
        const block = h('div', { class: 'toc-block md-view' });
        block.innerHTML = renderMarkdown(c.text, { folder });
        // A narrow panel: keep the headings, lists, and link lines; leave out the big title and paragraphs of prose.
        block.querySelectorAll('h1, h2').forEach((el) => el.remove());
        block.querySelectorAll('p').forEach((p) => {
          if (!p.querySelector('a.notebook-link')) p.remove();
        });
        if (block.textContent?.trim()) units[units.length - 1].blocks.push(block);
      }
    }
    const collapsed = new Set(loadSettings().tocCollapsed?.[this.tocName] ?? []);
    const saveCollapsed = () => {
      const s = loadSettings();
      saveSettings({ ...s, tocCollapsed: { ...s.tocCollapsed, [this.tocName]: [...collapsed] } });
    };
    const parts: HTMLElement[] = [
      h('a', { class: 'toc-title', href: `#/nb/${encodeURIComponent(this.tocName)}?s=` }, toc.title),
    ];
    for (const unit of units) {
      if (!unit.blocks.some((b) => b.querySelector('a.notebook-link'))) continue;
      const body = h('div', { class: 'toc-unit-body' }, ...unit.blocks);
      if (!unit.title) {
        parts.push(body);
        continue;
      }
      // The unit holding the notebook you're reading always opens.
      const holdsCurrent = unit.blocks.some((b) => b.querySelector(`a.notebook-link[data-nb="${CSS.escape(this.current)}"]`));
      let open = holdsCurrent || !collapsed.has(unit.title);
      const head = h('button', { class: 'toc-unit', type: 'button', 'aria-expanded': String(open) });
      const show = () => {
        head.textContent = `${open ? '▾' : '▸'} ${unit.title}`;
        head.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
      };
      head.addEventListener('click', () => {
        open = !open;
        if (open) collapsed.delete(unit.title);
        else collapsed.add(unit.title);
        saveCollapsed();
        show();
      });
      show();
      parts.push(head, body);
    }
    this.el.replaceChildren(...parts);
    for (const a of this.el.querySelectorAll<HTMLAnchorElement>('a.notebook-link')) {
      const name = a.dataset.nb ?? '';
      if (!name) continue;
      a.classList.toggle('missing', !this.names.has(name));
      if (!this.names.has(name)) a.title = 'Not written yet — click to start it';
      if (name === this.current && !a.dataset.section) {
        a.classList.add('current');
        a.closest('.toc-block')?.classList.add('current-chapter');
      }
    }
    // Bring the current notebook's entry into view.
    const here = this.el.querySelector<HTMLElement>('a.notebook-link.current')?.closest<HTMLElement>('.toc-block');
    if (here) requestAnimationFrame(() => scrollWithin(here, { align: 'nearest' }));
  }
}
