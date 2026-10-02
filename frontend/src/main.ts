import 'katex/dist/katex.min.css';
import 'jsxgraph-css';
import 'mathlive/fonts.css';
import './style.css';

import { MathfieldElement } from 'mathlive';
import { api, available } from './api';
import { newNotebook, normalize } from './model';
import { decodeNotebook } from './share';
import { h } from './ui';
import { homeView } from './views/home';
import { NotebookView } from './views/notebook';

// Fonts are bundled by Vite (imported above), so MathLive never fetches anything from the network.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

const app = document.getElementById('app')!;
let current: NotebookView | null = null;
let routeToken = 0;

function showError(message: string): void {
  app.replaceChildren(
    h('div', { class: 'home' },
      h('h1', {}, 'Hmm.'),
      h('p', {}, message),
      h('a', { class: 'btn', href: '#/' }, '← Back to notebooks'),
    ),
  );
}

async function route(): Promise<void> {
  const token = ++routeToken;
  if (current) {
    const leaving = current;
    current = null;
    await leaving.destroy();
  }
  const hash = location.hash || '#/';
  const serverOk = await available();
  try {
    let view: NotebookView | null = null;
    if (hash.startsWith('#/nb/')) {
      const name = decodeURIComponent(hash.slice(5));
      const nb = normalize(await api.get(name));
      view = new NotebookView(nb, { kind: 'file', name }, serverOk);
      document.title = `${nb.title} — Math Notebook`;
    } else if (hash.startsWith('#/scratch')) {
      if (!serverOk) throw new Error('The scratch pad needs the Math Notebook app running on this computer.');
      const saved = await api.getScratch();
      const nb = saved ? normalize(saved) : newNotebook('Scratch pad');
      view = new NotebookView(nb, { kind: 'scratch' }, serverOk);
      document.title = 'Scratch pad — Math Notebook';
    } else if (hash.startsWith('#/share/')) {
      const nb = decodeNotebook(hash.slice(8));
      view = new NotebookView(nb, { kind: 'shared' }, serverOk);
      document.title = `${nb.title} (shared) — Math Notebook`;
    }
    if (token !== routeToken) {
      await view?.destroy();
      return;
    }
    if (view) {
      current = view;
      app.replaceChildren(view.el);
    } else {
      const home = await homeView();
      if (token !== routeToken) return;
      document.title = 'Math Notebook';
      app.replaceChildren(home);
    }
  } catch (err) {
    if (token === routeToken) showError((err as Error).message);
  }
}

window.addEventListener('hashchange', route);
route();
