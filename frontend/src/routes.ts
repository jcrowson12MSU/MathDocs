// Links between pages (the app uses #hash routes).

/**
 * A notebook, by its path in the journal, e.g. "Algebra/Quadratics". With `section` (from a link), it opens
 * at that section — or at the top when the section is '' — instead of at the last step.
 */
export const notebookHash = (name: string, section?: string) =>
  `#/nb/${encodeURIComponent(name)}${section !== undefined ? `?s=${encodeURIComponent(section)}` : ''}`;

/** The notebook in a #/nb/… hash, and the section to open at (null: carry on at the last step). */
export function parseNotebookHash(hash: string): { name: string; section: string | null } | null {
  if (!hash.startsWith('#/nb/')) return null;
  const [name, section] = hash.slice(5).split('?s=');
  return { name: decodeURIComponent(name), section: section === undefined ? null : decodeURIComponent(section) };
}

/** A folder on the home page ("" = the top level). */
export const folderHash = (path: string) => (path ? `#/folder/${encodeURIComponent(path)}` : '#/');

/** The folder a notebook is in ("" = the top level). */
export const folderOf = (name: string) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');
