// Bringing a notebook from a share link or an imported file into the journal folder.

import { api } from './api';
import { mergeComments, type Notebook } from './model';
import { confirm, toast } from './ui';

/**
 * If the journal already has this notebook (same id), offer to merge in the incoming comments;
 * otherwise save it as a new notebook. Returns the name of the notebook to open, or null if cancelled.
 */
export async function saveIncoming(nb: Notebook): Promise<string | null> {
  const existing = (await api.list()).find((s) => s.id === nb.id);
  if (existing) {
    const merge = await confirm(
      'You already have this notebook',
      `“${existing.title}” is in your journal. Add the comments from this copy to it? Your work won’t be changed.`,
      'Add comments',
    );
    if (merge) {
      const local = await api.get(existing.name);
      const added = mergeComments(local, nb);
      await api.save(existing.name, local);
      toast(added ? `Added ${added} new comment${added === 1 ? '' : 's'}.` : 'No new comments to add.');
      return existing.name;
    }
    if (!(await confirm('Save a separate copy?', 'Save this as a new notebook instead?', 'Save copy'))) return null;
    nb = { ...nb, id: crypto.randomUUID(), title: `${nb.title} (copy)` };
  }
  const { name } = await api.create(nb);
  toast(`Saved “${nb.title}” to your journal.`);
  return name;
}
