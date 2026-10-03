// Links between pages (the app uses #hash routes).

/** A notebook, by its path in the journal, e.g. "Algebra/Quadratics". */
export const notebookHash = (name: string) => `#/nb/${encodeURIComponent(name)}`;

/** A folder on the home page ("" = the top level). */
export const folderHash = (path: string) => (path ? `#/folder/${encodeURIComponent(path)}` : '#/');

/** The folder a notebook is in ("" = the top level). */
export const folderOf = (name: string) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');
