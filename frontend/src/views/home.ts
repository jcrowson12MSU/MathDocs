// Home page: list of notebooks in the journal folder, plus new / scratch / import.

import { api, serverInfo, type NotebookSummary } from '../api';
import { newNotebook, normalize } from '../model';
import { loadSettings, saveSettings } from '../settings';
import { encodeNotebook } from '../share';
import { saveIncoming } from '../incoming';
import { confirm, h, pickFile, prompt, relativeTime, showDialog, toast } from '../ui';
import { showHelp } from './notebook';

async function importFile(serverOk: boolean): Promise<void> {
  const file = await pickFile('.json,.mathnb.json,application/json');
  if (!file) return;
  try {
    const nb = normalize(JSON.parse(await file.text()));
    if (!serverOk) {
      location.hash = `#/share/${encodeNotebook(nb)}`;
      return;
    }
    const name = await saveIncoming(nb);
    if (name) location.hash = `#/nb/${encodeURIComponent(name)}`;
  } catch (err) {
    toast(`Couldn’t open that file: ${(err as Error).message}`);
  }
}

function openSettings(): void {
  const s = loadSettings();
  const author = h('input', { class: 'text-input', value: s.author, placeholder: 'e.g. Dad' });
  const base = h('input', { class: 'text-input', value: s.shareBase, placeholder: 'https://yourname.github.io/MathDocs/' });
  showDialog('Settings', [
    h('label', { class: 'field' }, 'Your name (shown on comments)', author),
    h('label', { class: 'field' }, 'Viewer address for share links (optional)', base),
    h('p', { class: 'muted small' },
      'Leave the viewer address empty to make links that open in this app. ',
      'If you publish the viewer (see README), put its address here so links open on any device, including phones.'),
  ], [
    { label: 'Cancel' },
    { label: 'Save', primary: true, run: () => saveSettings({ author: author.value.trim(), shareBase: base.value.trim() }) },
  ]);
}

export async function homeView(): Promise<HTMLElement> {
  const info = await serverInfo();
  const serverOk = info.ok;
  const el = h('div', { class: 'home' });

  if (!serverOk) {
    el.append(
      h('h1', {}, 'Math Notebook'),
      h('p', { class: 'lead' }, 'This is the read-only viewer. Open a share link, or open a notebook file to view and comment on it.'),
      h('div', { class: 'home-actions' }, h('button', { class: 'btn primary', onclick: () => importFile(false) }, 'Open a file…')),
    );
    return el;
  }

  let notebooks: NotebookSummary[] = [];
  const list = h('div', { class: 'nb-list' });
  const search = h('input', { class: 'text-input search', type: 'search', placeholder: 'Search notebooks' });

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = notebooks.filter((n) => n.title.toLowerCase().includes(q));
    list.replaceChildren(
      ...shown.map((n) =>
        h('div', { class: 'nb-row' },
          h('a', { class: 'nb-link', href: `#/nb/${encodeURIComponent(n.name)}` },
            h('span', { class: 'nb-name' }, n.title),
            h('span', { class: 'muted small' }, `${relativeTime(n.modified)} · ${n.cellCount} cell${n.cellCount === 1 ? '' : 's'}`),
          ),
          h('button', {
            class: 'icon', title: 'Rename',
            onclick: async () => {
              const t = await prompt('Rename notebook', n.title, 'Rename');
              if (!t) return;
              await api.rename(n.name, t);
              await reload();
            },
          }, '✎'),
          h('button', {
            class: 'icon', title: 'Delete',
            onclick: async () => {
              if (!(await confirm('Delete notebook?', `“${n.title}” will be moved to the .trash folder.`, 'Delete', true))) return;
              await api.remove(n.name);
              await reload();
            },
          }, '🗑'),
        ),
      ),
      shown.length ? '' : h('p', { class: 'muted empty' }, notebooks.length ? 'No matches.' : 'No notebooks yet — make one!'),
    );
  };
  const reload = async () => {
    notebooks = await api.list();
    renderList();
  };
  search.addEventListener('input', renderList);

  el.append(
    h('div', { class: 'home-head' },
      h('h1', {}, 'Math Notebook'),
      h('button', { class: 'icon', title: 'Keyboard shortcuts', onclick: showHelp }, '?'),
      h('button', { class: 'icon', title: 'Settings', onclick: openSettings }, '⚙'),
    ),
    h('div', { class: 'home-actions' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const title = await prompt('Name your new notebook', '', 'Create');
          if (!title) return;
          const { name } = await api.create(newNotebook(title));
          location.hash = `#/nb/${encodeURIComponent(name)}`;
        },
      }, '+ New notebook'),
      h('a', { class: 'btn', href: '#/scratch' }, '✏︎ Scratch pad'),
      h('button', { class: 'btn', onclick: () => importFile(true) }, 'Import file…'),
    ),
    search,
    list,
    h('p', { class: 'muted small folder' }, `Notebooks are saved in ${info.folder}`),
  );
  await reload();
  return el;
}
