// PR #44 follow-up tests: the staff app's @mention helpers (ui/mentions.tsx) as implemented.
// What the code does: a mention is typed after the start or white space; the picker matches
// case-insensitively, names starting with the query first, then names containing it; names with
// white space, empty names and repeats are dropped; in lines `@<known name>` is highlighted
// case-insensitively, the longest name first, never inside a word, an address, after another `@`,
// or as the start of a longer name. Output is strings and <mark> elements only.
import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mentionAt, mentionMatches, mentionNodes } from '../src/ui/mentions.js';

/** Strings stay strings; a <mark> becomes ['mark', its text]. */
const shape = (nodes: ReactNode[]) =>
  nodes.map((n) => {
    if (typeof n === 'string') return n;
    if (isValidElement<{ children: unknown; 'data-part'?: string }>(n)) return [n.type, n.props.children, n.props['data-part']];
    throw new Error(`unexpected node ${String(n)}`);
  });

describe('mentionAt (staff)', () => {
  it('finds the @ typed at the start, after a space or a new line, with the caret anywhere after it', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('hi @mi', 6)).toEqual({ start: 3, query: 'mi' });
    expect(mentionAt('line one\n@ni', 12)).toEqual({ start: 9, query: 'ni' });
    // Caret in the middle of the text: only what is before the caret counts.
    expect(mentionAt('hi @mira.k there', 7)).toEqual({ start: 3, query: 'mir' });
  });

  it('is null in an address, after a space following the name, or after a second @', () => {
    expect(mentionAt('mail a@n', 8)).toBeNull();
    expect(mentionAt('@mira.k hi', 10)).toBeNull();
    expect(mentionAt('@@', 2)).toBeNull();
    expect(mentionAt('no mention', 10)).toBeNull();
  });
});

describe('mentionMatches (staff)', () => {
  const names = ['dmitri_k', 'nightowl_44', 'mira.k'];

  it('case-insensitive: names starting with the query first, then those containing it', () => {
    expect(mentionMatches(names, '')).toEqual(names);
    expect(mentionMatches(names, 'MI')).toEqual(['mira.k', 'dmitri_k']);
    expect(mentionMatches(names, '_')).toEqual(['dmitri_k', 'nightowl_44']);
    expect(mentionMatches(names, 'zz')).toEqual([]);
  });

  it('drops repeats, empty names and names with white space', () => {
    expect(mentionMatches(['sam', 'sam', '', '  ', 'two words', 'lee'], '')).toEqual(['sam', 'lee']);
  });
});

describe('mentionNodes (staff)', () => {
  it('highlights every known name as a <mark data-part="mention">, keeping the rest as strings', () => {
    expect(shape(mentionNodes('@mira.k hi @nightowl_44.', ['mira.k', 'nightowl_44']))).toEqual([
      ['mark', '@mira.k', 'mention'],
      ' hi ',
      ['mark', '@nightowl_44', 'mention'],
      '.',
    ]);
  });

  it('is case-insensitive and keeps the text as typed', () => {
    expect(shape(mentionNodes('ping @MIRA.K', ['mira.k']))).toEqual(['ping ', ['mark', '@MIRA.K', 'mention']]);
  });

  it('never inside an address, after another @, or as the start of a longer name', () => {
    expect(shape(mentionNodes('me@mira.k', ['mira.k']))).toEqual(['me@mira.k']);
    expect(shape(mentionNodes('@@mira.k', ['mira.k']))).toEqual(['@@mira.k']);
    expect(shape(mentionNodes('@mira.kz', ['mira.k']))).toEqual(['@mira.kz']);
    expect(shape(mentionNodes('@sam_2', ['sam']))).toEqual(['@sam_2']);
  });

  it('the longest name wins where one name starts another', () => {
    expect(shape(mentionNodes('@sam_1 and @sam', ['sam', 'sam_1']))).toEqual([['mark', '@sam_1', 'mention'], ' and ', ['mark', '@sam', 'mention']]);
  });

  it('a name with regular-expression characters matches only itself', () => {
    expect(shape(mentionNodes('@mira.k @miraxk', ['mira.k']))).toEqual([['mark', '@mira.k', 'mention'], ' @miraxk']);
  });

  it('text with no @ or no known names comes back whole; HTML in a line stays a string', () => {
    expect(mentionNodes('plain', ['sam'])).toEqual(['plain']);
    expect(mentionNodes('@sam', [])).toEqual(['@sam']);
    expect(shape(mentionNodes('<b>@sam</b>', ['sam']))).toEqual(['<b>', ['mark', '@sam', 'mention'], '</b>']);
  });
});
