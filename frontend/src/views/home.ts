// Home page: browse the journal's folders and notebooks, plus new / scratch / import.

import { api, serverInfo, type FolderSummary, type NotebookSummary } from '../api';
import { newNotebook, normalize } from '../model';
import { folderHash, isContents, notebookHash } from '../routes';

export { isContents };
import { loadSettings, saveSettings } from '../settings';
import { encodeNotebook } from '../share';
import { saveIncoming } from '../incoming';
import { confirm, h, openMenu, pickFile, prompt, relativeTime, showDialog, toast } from '../ui';
import { showHelp } from './notebook';

async function importFile(serverOk: boolean, folder: string): Promise<void> {
  const file = await pickFile('.json,.mathnb.json,application/json');
  if (!file) return;
  try {
    const nb = normalize(JSON.parse(await file.text()));
    if (!serverOk) {
      location.hash = `#/share/${encodeNotebook(nb)}`;
      return;
    }
    const name = await saveIncoming(nb, folder);
    if (name) location.hash = notebookHash(name);
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
    { label: 'Save', primary: true, run: () => saveSettings({ ...loadSettings(), author: author.value.trim(), shareBase: base.value.trim() }) },
  ]);
}

const ROOT_LABEL = 'All notebooks';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const displayPath = (path: string) => (path ? path.split('/').join(' › ') : ROOT_LABEL);

/** Ask which folder to move something into. `exclude` hides a folder and everything inside it. */
function pickFolder(title: string, folders: FolderSummary[], current: string, exclude?: string): Promise<string | null> {
  const choices = ['', ...folders.map((f) => f.path)].filter(
    (p) => !exclude || (p !== exclude && !p.startsWith(`${exclude}/`)),
  );
  const select = h('select', { class: 'text-input' },
    ...choices.map((p) => h('option', { value: p, selected: p === current }, displayPath(p))),
  );
  return new Promise((resolve) => {
    let picked: string | null = null;
    void showDialog(title, [select], [
      { label: 'Cancel' },
      { label: 'Move', primary: true, run: () => (picked = select.value) },
    ]).then(() => resolve(picked));
  });
}


/**
 * Notebooks in a folder, newest first — unless the folder has a table of contents. Then it's a book:
 * the contents first, then the rest by name with numbers in order (Chapter 2 before Chapter 10).
 */
export function bookOrder<T extends { title: string }>(list: T[]): T[] {
  if (!list.some((n) => isContents(n.title))) return list;
  return [...list].sort((a, b) =>
    Number(isContents(b.title)) - Number(isContents(a.title))
    || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function homeView(folder = ''): Promise<HTMLElement> {
  const info = await serverInfo();
  const serverOk = info.ok;
  const el = h('div', { class: 'home' });

  if (!serverOk) {
    el.append(
      h('h1', {}, 'Math Notebook'),
      h('p', { class: 'lead' }, 'This is the read-only viewer. Open a share link, or open a notebook file to view and comment on it.'),
      h('div', { class: 'home-actions' }, h('button', { class: 'btn primary', onclick: () => importFile(false, '') }, 'Open a file…')),
    );
    return el;
  }

  let notebooks: NotebookSummary[] = [];
  let folders: FolderSummary[] = [];
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Folder' });
  const list = h('div', { class: 'nb-list' });
  const search = h('input', { class: 'text-input search', type: 'search', placeholder: 'Search all notebooks' });

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast(`Couldn’t do that: ${(err as Error).message}`);
    }
    await reload();
  };

  // -- drag and drop: drop a notebook or folder onto a folder row or a breadcrumb -----------
  const DRAG_TYPE = 'application/x-math-notebook-item';
  const draggable = (row: HTMLElement, kind: 'notebook' | 'folder', path: string) => {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ kind, path }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  };
  const dropTarget = (target: HTMLElement, into: string) => {
    target.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      target.classList.add('drop-over');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drop-over'));
    target.addEventListener('drop', (e) => {
      target.classList.remove('drop-over');
      const raw = e.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      const { kind, path } = JSON.parse(raw) as { kind: 'notebook' | 'folder'; path: string };
      if (kind === 'folder' && (into === path || into.startsWith(`${path}/`))) return;
      void run(() => (kind === 'notebook' ? api.move(path, into) : api.moveFolder(path, into)));
    });
  };

  // -- rows ----------------------------------------------------------------------------------
  const folderRow = (f: FolderSummary, showWhere = false) => {
    const menu = h('button', { class: 'icon menu-btn', title: 'More actions', 'aria-haspopup': 'menu' }, '⋯');
    menu.addEventListener('click', () =>
      openMenu(menu, [
        {
          label: 'Rename…',
          run: () => run(async () => {
            const t = await prompt('Rename folder', f.name, 'Rename');
            if (t) await api.renameFolder(f.path, t);
          }),
        },
        {
          label: 'Move to…',
          run: () => run(async () => {
            const to = await pickFolder(`Move “${f.name}” to`, folders, f.parent, f.path);
            if (to !== null && to !== f.parent) await api.moveFolder(f.path, to);
          }),
        },
        null,
        {
          label: 'Delete', danger: true,
          run: () => run(async () => {
            const inside = notebooks.filter((n) => n.folder === f.path || n.folder.startsWith(`${f.path}/`)).length;
            const what = inside ? ` and the ${plural(inside, 'notebook')} in it` : '';
            if (await confirm('Delete folder?', `“${f.name}”${what} will be moved to the .trash folder.`, 'Delete', true)) {
              await api.removeFolder(f.path);
            }
          }),
        },
      ]),
    );
    const row = h('div', { class: 'nb-row folder-row' },
      h('a', { class: 'nb-link', href: folderHash(f.path) },
        h('span', { class: 'nb-name' }, h('span', { class: 'folder-icon' }, '📁'), f.name),
        h('span', { class: 'muted small' },
          showWhere ? `in ${displayPath(f.parent)} · ` : '',
          [f.folders ? plural(f.folders, 'folder') : '', plural(f.notebooks, 'notebook')].filter(Boolean).join(' · ')),
      ),
      menu,
    );
    draggable(row, 'folder', f.path);
    dropTarget(row, f.path);
    return row;
  };

  const notebookRow = (n: NotebookSummary, showWhere = false, book = false) => {
    const menu = h('button', { class: 'icon menu-btn', title: 'More actions', 'aria-haspopup': 'menu' }, '⋯');
    menu.addEventListener('click', () =>
      openMenu(menu, [
        {
          label: 'Rename…',
          run: () => run(async () => {
            const t = await prompt('Rename notebook', n.title, 'Rename');
            if (t) await api.rename(n.name, t);
          }),
        },
        {
          label: 'Move to…',
          run: () => run(async () => {
            const to = await pickFolder(`Move “${n.title}” to`, folders, n.folder);
            if (to !== null && to !== n.folder) await api.move(n.name, to);
          }),
        },
        null,
        {
          label: 'Delete', danger: true,
          run: () => run(async () => {
            if (await confirm('Delete notebook?', `“${n.title}” will be moved to the .trash folder.`, 'Delete', true)) {
              await api.remove(n.name);
            }
          }),
        },
      ]),
    );
    const row = h('div', { class: 'nb-row' },
      // In a book (a folder with a table of contents), notebooks open at the top, to read from the start.
      h('a', { class: 'nb-link', href: notebookHash(n.name, book ? '' : undefined) },
        h('span', { class: 'nb-name' }, isContents(n.title) ? `📖 ${n.title}` : n.title),
        h('span', { class: 'muted small' },
          showWhere && n.folder ? `in ${displayPath(n.folder)} · ` : '',
          `${relativeTime(n.modified)} · ${plural(n.cellCount, 'cell')}`),
      ),
      menu,
    );
    draggable(row, 'notebook', n.name);
    return row;
  };

  // -- rendering -----------------------------------------------------------------------------
  const renderCrumbs = () => {
    const parts = folder ? folder.split('/') : [];
    const items: HTMLElement[] = [];
    const crumb = (label: string, path: string, current: boolean) => {
      const a = current
        ? h('span', { class: 'crumb current', 'aria-current': 'page' }, label)
        : h('a', { class: 'crumb', href: folderHash(path) }, label);
      if (!current) dropTarget(a, path);
      return a;
    };
    items.push(crumb(ROOT_LABEL, '', parts.length === 0));
    parts.forEach((p, i) => {
      items.push(h('span', { class: 'crumb-sep' }, '›'));
      items.push(crumb(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1));
    });
    crumbs.replaceChildren(...items);
  };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    if (q) {
      // Searching looks through every folder.
      const fs = folders.filter((f) => f.name.toLowerCase().includes(q));
      const ns = notebooks.filter((n) => n.title.toLowerCase().includes(q));
      list.replaceChildren(
        ...fs.map((f) => folderRow(f, true)),
        ...ns.map((n) => notebookRow(n, true)),
        fs.length || ns.length ? '' : h('p', { class: 'muted empty' }, 'No matches.'),
      );
      return;
    }
    const fs = folders.filter((f) => f.parent === folder).sort((a, b) => a.name.localeCompare(b.name));
    const ns = bookOrder(notebooks.filter((n) => n.folder === folder));
    const empty = folder ? 'This folder is empty. Make a notebook or a folder here.' : 'No notebooks yet — make one!';
    list.replaceChildren(
      ...fs.map((f) => folderRow(f)),
      ...ns.map((n) => notebookRow(n, false, ns.some((x) => isContents(x.title)))),
      fs.length || ns.length ? '' : h('p', { class: 'muted empty' }, empty),
    );
  };

  const reload = async () => {
    [notebooks, folders] = await Promise.all([api.list(), api.folders()]);
    if (folder && !folders.some((f) => f.path === folder)) {
      toast(`The folder “${displayPath(folder)}” no longer exists.`);
      location.hash = '#/';
      return;
    }
    renderCrumbs();
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
        onclick: () => run(async () => {
          const title = await prompt('Name your new notebook', '', 'Create');
          if (!title) return;
          const { name } = await api.create(newNotebook(title), folder);
          location.hash = notebookHash(name);
        }),
      }, '+ New notebook'),
      h('button', {
        class: 'btn',
        onclick: () => run(async () => {
          const title = await prompt(folder ? `New folder in “${folder.split('/').pop()}”` : 'New folder', '', 'Create');
          if (title) await api.createFolder(folder, title);
        }),
      }, '+ New folder'),
      h('a', { class: 'btn', href: '#/scratch' }, '✏︎ Scratch pad'),
      h('button', { class: 'btn', onclick: () => importFile(true, folder) }, 'Import file…'),
    ),
    crumbs,
    search,
    list,
    h('p', { class: 'muted small folder' }, `Saved in ${info.folder}${folder ? `/${folder}` : ''}`),
  );
  await reload();
  return el;
}
