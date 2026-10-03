// The ☰ table of contents beside a notebook in a book (a folder with a "Table of Contents" notebook): the contents'
// text, with its links, in a panel on the left. Shown or hidden from the ☰ button; the choice is remembered.

import { api } from '../api';
import { renderMarkdown } from '../markdown';
import { normalize } from '../model';
import { folderOf, isContents } from '../routes';
import { loadSettings, saveSettings } from '../settings';
import { h } from '../ui';

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

  /** Load the contents notebook and show its text (sections collapsed in it stay out of the panel). */
  async load(): Promise<void> {
    const toc = normalize(await api.get(this.tocName));
    const folder = folderOf(this.tocName);
    const parts: HTMLElement[] = [
      h('a', { class: 'toc-title', href: `#/nb/${encodeURIComponent(this.tocName)}?s=` }, toc.title),
    ];
    let hidden = false;
    for (const c of toc.cells) {
      if (c.type === 'divider') {
        hidden = !!c.collapsed;
        if (!hidden) parts.push(h('div', { class: 'toc-unit' }, c.title));
      } else if (c.type === 'markdown' && !hidden && c.text.trim()) {
        const block = h('div', { class: 'toc-block md-view' });
        block.innerHTML = renderMarkdown(c.text, { folder });
        // A narrow panel: keep the headings, lists, and link lines; leave out the big title and paragraphs of prose.
        block.querySelectorAll('h1, h2').forEach((el) => el.remove());
        block.querySelectorAll('p').forEach((p) => {
          if (!p.querySelector('a.notebook-link')) p.remove();
        });
        if (block.textContent?.trim()) parts.push(block);
      }
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
    this.el.querySelector('a.notebook-link.current')?.closest('.toc-block')?.scrollIntoView({ block: 'nearest' });
  }
}
