// Share links carry the whole notebook in the URL fragment (after #), so it never reaches a server.

import LZString from 'lz-string';
import { normalize, type Notebook } from './model';

const PREFIX = '#/share/';

export function encodeNotebook(nb: Notebook): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(nb));
}

export function decodeNotebook(data: string): Notebook {
  const json = LZString.decompressFromEncodedURIComponent(data);
  if (!json) throw new Error('This share link is damaged or incomplete');
  return normalize(JSON.parse(json));
}

/** Base is the viewer address, e.g. https://you.github.io/MathDocs/ (defaults to this app). */
export function shareLink(nb: Notebook, base: string): string {
  const clean = base.split('#')[0];
  return clean + PREFIX + encodeNotebook(nb);
}
