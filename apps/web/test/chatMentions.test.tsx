// PR #44 follow-up tests: the trader app's @mention helpers (chat/ChatPanel.tsx) as implemented.
// What the code does: the names offered are the moderator's then the counterparty's (empty and
// repeated left out); a mention is typed after the start or white space; in lines `@<known name>`
// is highlighted case-SENSITIVELY (unlike the staff app's mentionNodes, which ignores case), the
// longest name first, never after a letter, digit or `_` and never as the start of a longer word.
import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mentionAt, mentionNames, withMentions } from '../src/chat/ChatPanel.js';

/** Strings stay strings; a mention <span> becomes ['span', its text]. */
const shape = (node: ReactNode) => {
  if (typeof node === 'string') return node;
  return (node as ReactNode[]).map((n) => {
    if (typeof n === 'string') return n;
    if (isValidElement<{ children: unknown; className?: string }>(n)) {
      expect(n.props.className).toBe('x2f-chat__mention');
      const c = n.props.children;
      return [n.type, Array.isArray(c) ? c.join('') : c];
    }
    throw new Error(`unexpected node ${String(n)}`);
  });
};

describe('mentionNames (trader)', () => {
  it('the moderator first, then the counterparty; no moderator, empty or repeated names are left out', () => {
    expect(mentionNames('sarah.v', 'Sam')).toEqual(['sarah.v', 'Sam']);
    expect(mentionNames(null, 'Sam')).toEqual(['Sam']);
    expect(mentionNames('  ', 'Sam')).toEqual(['Sam']);
    expect(mentionNames('Sam', 'Sam')).toEqual(['Sam']);
  });
});

describe('mentionAt (trader)', () => {
  it('after a new line, and with the caret in the middle of the text', () => {
    expect(mentionAt('one\n@sa', 7)).toEqual({ at: 4, query: 'sa' });
    expect(mentionAt('hi @sarah.v there', 6)).toEqual({ at: 3, query: 'sa' });
  });

  it('null right after a second @ glued to the first', () => {
    expect(mentionAt('@@', 2)).toBeNull();
  });
});

describe('withMentions (trader)', () => {
  it('highlights each known name, with punctuation after it left plain', () => {
    expect(shape(withMentions('@Sam, ask @sarah.v.', ['sarah.v', 'Sam']))).toEqual([['span', '@Sam'], ', ask ', ['span', '@sarah.v'], '.']);
  });

  it('is case-sensitive: "@sam" is not "@Sam"', () => {
    expect(shape(withMentions('@sam hi', ['Sam']))).toEqual(['@sam hi']);
  });

  it('never after a word character or as the start of a longer word; the longest name wins', () => {
    expect(shape(withMentions('me@Sam', ['Sam']))).toEqual(['me@Sam']);
    expect(shape(withMentions('@Samuel', ['Sam']))).toEqual(['@Samuel']);
    expect(shape(withMentions('@Sam_1 @Sam', ['Sam', 'Sam_1']))).toEqual([['span', '@Sam_1'], ' ', ['span', '@Sam']]);
  });

  it('as implemented, a second @ glued to the first still starts a mention ("@@Sam" highlights "@Sam"; the staff app does not)', () => {
    expect(shape(withMentions('@@Sam', ['Sam']))).toEqual(['@', ['span', '@Sam']]);
  });

  it('no names, or no @, gives the text back as it is', () => {
    expect(withMentions('@Sam', [])).toBe('@Sam');
    expect(withMentions('Sam', ['Sam'])).toBe('Sam');
  });
});
