// @vitest-environment happy-dom
// PR #44 follow-up tests: the trader app's @mention helpers (chat/ChatPanel.tsx).
// What the code does: the names offered are the moderator's then the counterparty's (empty and
// repeated left out); a mention is typed after the start or white space; in lines `@<known name>`
// is highlighted case-insensitively (preserving typed text), the longest name first, never after
// a letter, digit or `_` and never as the start of a longer word. In ChatPanel, the signed-in
// trader's own display name is also highlighted in lines while staying out of the picker.
import { act, isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel, mentionAt, mentionNames, withMentions } from '../src/chat/ChatPanel.js';
import { setChatClient, type ChatSnapshot } from '../src/chat/client.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

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

  it('matches case-insensitively while preserving the typed text', () => {
    expect(shape(withMentions('@sam hi', ['Sam']))).toEqual([['span', '@sam'], ' hi']);
    expect(shape(withMentions('ping @alice and @ALICE!', ['Alice']))).toEqual(['ping ', ['span', '@alice'], ' and ', ['span', '@ALICE'], '!']);
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

describe('ChatPanel own-name mentions (trader)', () => {
  afterEach(() => {
    setChatClient(null);
    vi.unstubAllGlobals();
    refreshSession();
  });

  it('highlights the signed-in trader\'s own display name (case-insensitively) without offering it in the picker', async () => {
    refreshSession();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ displayName: 'Alice' }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    const snap: ChatSnapshot = {
      phase: 'ready',
      problem: null,
      role: 'buyer',
      counterparty: 'Sam',
      disputeOpen: true,
      systemCalled: false,
      paySecured: true,
      lines: [
        { id: '1', from: 'mod', text: 'Hi @Alice and @alice, please reply to @Sam.', at: null, mine: false, gapBefore: false },
      ],
      more: false,
    };
    setChatClient({
      sync: vi.fn(async () => snap),
      send: vi.fn(async () => snap),
      sendPay: vi.fn(async () => snap),
      sendProof: vi.fn(async () => snap),
      sendUnblurred: vi.fn(async () => snap),
      sendNotice: vi.fn(async () => snap),
    });

    const { host } = render(<ChatPanel chat="K7M2-9QXA-4FTR-8WPN" name="Sam" dispute={{ moderator: 'sarah.v' }} />);
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    const mentions = [...host.querySelectorAll('li.x2f-chat__line [data-mention]')].map((m) => m.textContent);
    expect(mentions).toEqual(['@Alice', '@alice', '@Sam']);

    const box = host.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '@');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const opts = [...host.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.textContent);
    expect(opts).toEqual(['@sarah.v', '@Sam']);
  });
});
