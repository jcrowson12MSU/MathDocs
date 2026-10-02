// Client for the local FastAPI server. When the app is hosted as a static viewer
// (e.g. GitHub Pages) there is no server and `available()` resolves to false.

import type { Notebook } from './model';

export interface NotebookSummary {
  name: string;
  title: string;
  modified: string;
  cellCount: number;
  id: string | null;
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

const enc = encodeURIComponent;

export const api = {
  list: () => call<NotebookSummary[]>('GET', '/notebooks'),
  get: (name: string) => call<Notebook>('GET', `/notebooks/${enc(name)}`),
  create: (nb: Notebook) => call<{ name: string }>('POST', '/notebooks', nb),
  save: (name: string, nb: Notebook, keepalive = false) =>
    call<{ modified: string }>('PUT', `/notebooks/${enc(name)}`, nb, keepalive),
  rename: (name: string, title: string) => call<{ name: string }>('POST', `/notebooks/${enc(name)}/rename`, { title }),
  remove: (name: string) => call<void>('DELETE', `/notebooks/${enc(name)}`),
  getScratch: () => call<Notebook | null>('GET', '/scratch'),
  saveScratch: (nb: Notebook, keepalive = false) => call<{ ok: boolean }>('PUT', '/scratch', nb, keepalive),
  clearScratch: () => call<void>('DELETE', '/scratch'),
};
