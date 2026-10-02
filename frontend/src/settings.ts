// Per-browser preferences (not part of notebooks).

const KEY = 'math-notebook-settings';

export interface Settings {
  /** Name shown on comments. */
  author: string;
  /** Where share links point, e.g. https://you.github.io/MathDocs/. Empty means this app. */
  shareBase: string;
}

export function loadSettings(): Settings {
  try {
    return { author: '', shareBase: '', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { author: '', shareBase: '' };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked; settings just won't persist */
  }
}

export function shareBase(): string {
  return loadSettings().shareBase.trim() || location.origin + location.pathname;
}
