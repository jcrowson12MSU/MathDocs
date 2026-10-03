// Client for the local FastAPI server. When the app is hosted as a static viewer
// (e.g. GitHub Pages) there is no server and `available()` resolves to false.

import type { Notebook } from './model';

export interface NotebookSummary {
  /** Path inside the journal without the extension, e.g. "Algebra/Quadratics". */
  name: string;
  /** Folder it's in, e.g. "Algebra" ("" = top level). */
  folder: string;
  title: string;
  modified: string;
  cellCount: number;
  id: string | null;
}

export interface FolderSummary {
  path: string;
  name: string;
  parent: string;
  notebooks: number;
  folders: number;
}

let health: Promise<{ ok: boolean; folder?: string }> | null = null;

export function serverInfo() {
  health ??= fetch('/api/health', { signal: AbortSignal.timeout(2500) })
    .then((r) => (r.ok ? r.json() : { ok: false }))
    .catch(() => ({ ok: false }));
  return health;
}

export async function available(): Promise<boolean> {
  return (await serverInfo()).ok === true;
}

async function call<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(String(detail));
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

/** Encode a path like "Algebra/Unit 2/Quadratics" one part at a time, keeping the slashes. */
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export const api = {
  list: () => call<NotebookSummary[]>('GET', '/notebooks'),
  get: (name: string) => call<Notebook>('GET', `/notebooks/${enc(name)}`),
  create: (nb: Notebook, folder = '') =>
    call<{ name: string }>('POST', `/notebooks${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`, nb),
  save: (name: string, nb: Notebook, keepalive = false) =>
    call<{ modified: string }>('PUT', `/notebooks/${enc(name)}`, nb, keepalive),
  rename: (name: string, title: string) => call<{ name: string }>('POST', `/notebooks/${enc(name)}/rename`, { title }),
  move: (name: string, folder: string) => call<{ name: string }>('POST', `/notebooks/${enc(name)}/move`, { folder }),
  remove: (name: string) => call<void>('DELETE', `/notebooks/${enc(name)}`),
  folders: () => call<FolderSummary[]>('GET', '/folders'),
  createFolder: (parent: string, title: string) => call<{ path: string }>('POST', '/folders', { parent, title }),
  renameFolder: (path: string, title: string) => call<{ path: string }>('POST', '/folders/rename', { path, title }),
  moveFolder: (path: string, parent: string) => call<{ path: string }>('POST', '/folders/move', { path, parent }),
  removeFolder: (path: string) => call<void>('POST', '/folders/delete', { path }),
  getScratch: () => call<Notebook | null>('GET', '/scratch'),
  saveScratch: (nb: Notebook, keepalive = false) => call<{ ok: boolean }>('PUT', '/scratch', nb, keepalive),
  clearScratch: () => call<void>('DELETE', '/scratch'),
};
