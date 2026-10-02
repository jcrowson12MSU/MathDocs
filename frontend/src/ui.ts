// Tiny DOM helpers, dialogs and toasts.

type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: any) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement;
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function toast(message: string, action?: { label: string; run: () => void }, ms = 4000): void {
  const root = document.getElementById('toasts') ?? document.body.appendChild(h('div', { id: 'toasts' }));
  const el = h('div', { class: 'toast', role: 'status' }, message);
  if (action) {
    el.append(
      h('button', {
        class: 'link',
        onclick: () => {
          action.run();
          el.remove();
        },
      }, action.label),
    );
  }
  root.append(el);
  setTimeout(() => el.remove(), ms);
}

function dialog(build: (close: (v: any) => void) => Node[]): Promise<any> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' });
    const close = (v: any) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.append(...build(close));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function prompt(title: string, value = '', okLabel = 'OK'): Promise<string | null> {
  return dialog((close) => {
    const input = h('input', { type: 'text', value, class: 'text-input' });
    const form = h('form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        close(input.value.trim() || null);
      },
    },
      h('h3', {}, title),
      input,
      h('div', { class: 'dialog-buttons' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, okLabel),
      ),
    );
    queueMicrotask(() => input.select());
    return [form];
  });
}

export function confirm(title: string, message: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return dialog((close) => [
    h('h3', {}, title),
    h('p', {}, message),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: danger ? 'btn danger' : 'btn primary', onclick: () => close(true), autofocus: true }, okLabel),
    ),
  ]).then(Boolean);
}

export function showDialog(title: string, body: (Node | null)[], buttons: { label: string; primary?: boolean; run?: () => void }[]): Promise<void> {
  return dialog((close) => [
    h('h3', {}, title),
    ...body.filter((n): n is Node => n !== null),
    h('div', { class: 'dialog-buttons' },
      ...buttons.map((b) => h('button', {
        class: b.primary ? 'btn primary' : 'btn',
        onclick: () => {
          b.run?.();
          close(null);
        },
      }, b.label)),
    ),
  ]);
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T & { flush: () => void; pending: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] = [];
  const run = () => {
    timer = null;
    fn(...lastArgs);
  };
  const d = ((...args: any[]) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as T & { flush: () => void; pending: () => boolean };
  d.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  d.pending = () => timer !== null;
  return d;
}

export interface MenuItem {
  label: string;
  /** Keyboard shortcut shown on the right. */
  hint?: string;
  run: () => void;
  danger?: boolean;
}

let closeOpenMenu: (() => void) | null = null;

/** A small popup menu under `anchor`. `null` entries draw a separator. Closes on outside click or Esc. */
export function openMenu(anchor: HTMLElement, items: (MenuItem | null)[]): void {
  closeOpenMenu?.();
  const buttons: HTMLButtonElement[] = [];
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (!item) {
      if (menu.lastElementChild && !menu.lastElementChild.classList.contains('menu-sep')) menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    const b = h('button', {
      class: item.danger ? 'menu-item danger' : 'menu-item', role: 'menuitem',
      onclick: () => {
        close(false);
        item.run();
      },
    }, h('span', {}, item.label), item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null);
    buttons.push(b);
    menu.append(b);
  }
  if (menu.lastElementChild?.classList.contains('menu-sep')) menu.lastElementChild.remove();

  const onPointer = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = buttons.length;
      const down = e.key === 'ArrowDown';
      const next = i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n;
      buttons[next]?.focus();
    }
  };
  function close(refocus: boolean) {
    menu.remove();
    anchor.classList.remove('menu-open');
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeNow);
    if (closeOpenMenu === closeNow) closeOpenMenu = null;
    if (refocus) anchor.focus();
  }
  const closeNow = () => close(false);
  closeOpenMenu = closeNow;

  document.body.append(menu);
  anchor.classList.add('menu-open');
  // Right-align under the button, flipping above it if there's no room below.
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const top = r.bottom + 4 + m.height > window.innerHeight ? r.top - 4 - m.height : r.bottom + 4;
  menu.style.top = `${Math.max(4, top)}px`;
  menu.style.left = `${Math.max(4, Math.min(r.right - m.width, window.innerWidth - m.width - 4))}px`;
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeNow);
  buttons[0]?.focus();
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
