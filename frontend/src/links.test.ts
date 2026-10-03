// Links between notebooks ([[…]]) and books (folders with a table of contents).
import { describe, expect, it } from 'vitest';
import { parseNotebookLink } from './markdown';
import { notebookHash, parseNotebookHash } from './routes';
import { bookOrder, isContents } from './views/home';

describe('notebook links', () => {
  it('resolves names against the linking notebook’s folder', () => {
    expect(parseNotebookLink('Chapter 6 - Systems', 'Textbook')).toEqual({ name: 'Textbook/Chapter 6 - Systems', section: '', label: 'Chapter 6 - Systems' });
    expect(parseNotebookLink('/Examples/Inequalities', 'Textbook')?.name).toBe('Examples/Inequalities');
    expect(parseNotebookLink('Algebra/Quadratics', '')?.name).toBe('Algebra/Quadratics');
  });

  it('reads sections and shown text', () => {
    expect(parseNotebookLink('Chapter 6 - Systems#Lesson 2|Substitution', 'Textbook'))
      .toEqual({ name: 'Textbook/Chapter 6 - Systems', section: 'Lesson 2', label: 'Substitution' });
    expect(parseNotebookLink('Chapter 6 - Systems#Lesson 2', 'Textbook')?.label).toBe('Chapter 6 - Systems › Lesson 2');
    expect(parseNotebookLink('#Lesson 3', 'Textbook')).toEqual({ name: '', section: 'Lesson 3', label: 'Lesson 3' });
    expect(parseNotebookLink('', 'Textbook')).toBeNull();
  });

  it('carries the section in the address', () => {
    expect(parseNotebookHash(notebookHash('Textbook/Ch 6', 'Lesson 2'))).toEqual({ name: 'Textbook/Ch 6', section: 'Lesson 2' });
    expect(parseNotebookHash(notebookHash('Textbook/Ch 6', ''))).toEqual({ name: 'Textbook/Ch 6', section: '' });
    expect(parseNotebookHash(notebookHash('Algebra/Notes'))).toEqual({ name: 'Algebra/Notes', section: null });
    expect(parseNotebookHash('#/')).toBeNull();
  });
});

describe('books', () => {
  it('lists the table of contents first, then chapters in number order', () => {
    const list = ['Chapter 10 - Radicals', 'Chapter 2 - Equations', 'Table of Contents', 'Chapter 1 - Foundations'].map((title) => ({ title }));
    expect(bookOrder(list).map((n) => n.title)).toEqual(['Table of Contents', 'Chapter 1 - Foundations', 'Chapter 2 - Equations', 'Chapter 10 - Radicals']);
    // Without a table of contents, the order (newest first) is left alone.
    const plain = [{ title: 'B' }, { title: 'A' }];
    expect(bookOrder(plain)).toBe(plain);
    expect(isContents('Contents') && isContents('table of contents') && !isContents('Contents 2')).toBe(true);
  });
});
