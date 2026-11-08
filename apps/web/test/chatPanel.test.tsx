// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_NOTICE, ChatPanel, OfferChatPanel, OTHER_DEVICE, TradeChatPanel } from '../src/chat/ChatPanel.js';
import { ChatFailed, setChatClient, type ChatClient, type ChatSnapshot } from '../src/chat/client.js';
import { emitChatLive } from '../src/chat/live.js';
import { render } from './render.js';

const CHAT = 'K7M2-9QXA-4FTR-8WPN';

const snap = (over: Partial<ChatSnapshot> = {}): ChatSnapshot => ({
  phase: 'ready',
  problem: null,
  role: 'buyer',
  counterparty: 'Sam',
  disputeOpen: false,
  lines: [],
  more: false,
  ...over,
});

let current: ChatSnapshot;
let client: { sync: ReturnType<typeof vi.fn<ChatClient['sync']>>; send: ReturnType<typeof vi.fn<ChatClient['send']>> };

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  current = snap();
  client = { sync: vi.fn(async () => current), send: vi.fn(async () => current) };
  setChatClient(client);
});

afterEach(() => {
  setChatClient(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function type(el: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ChatPanel', () => {
  it('always shows the spec 6.6 notice, word for word', async () => {
    expect(CHAT_NOTICE).toBe('Chats are encrypted. If a dispute is opened, a moderator can read this conversation.');
    current = snap({ phase: 'waiting' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    expect(host.textContent).toContain(CHAT_NOTICE);
    await flush();
    expect(host.textContent).toContain(CHAT_NOTICE);
    expect(host.textContent).toContain('Securing this chat');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('shows my lines as You, theirs by public name, a moderator line with the badge, and a missing message', async () => {
    current = snap({
      disputeOpen: true,
      lines: [
        { id: '1', from: 'buyer', text: 'Sent', at: null, mine: true, gapBefore: false },
        { id: '2', from: 'seller', text: 'Not yet', at: null, mine: false, gapBefore: false },
        { id: '4', from: 'seller', text: 'Got it', at: null, mine: false, gapBefore: true },
        { id: '5', from: 'mod', text: 'Moderator here', at: null, mine: false, gapBefore: false },
      ],
    });
    // Inside DisputeRoom, with a moderator on the dispute record: the badge, through ModeratorTag.
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" dispute={{ moderator: 'sarah.v' }} />);
    await flush();
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['You: Sent', 'Sam: Not yet', 'A message is missing here.', 'Sam: Got it', 'X2F Moderator: Moderator here']);
    expect(host.querySelector('[data-from="seller"] [data-username]')?.textContent).toBe('Sam');
    expect(host.querySelector('[data-from="mod"] .x2f-tag[data-role="mod"]')).not.toBeNull();
    expect(host.querySelectorAll('.x2f-tag[data-role="mod"]')).toHaveLength(1);
    // The room shows its own dispute notices.
    expect(host.querySelector('[data-system="dispute"]')).toBeNull();
    // The panel never adds a second primary action to the screen it sits in.
    expect(host.querySelector('[data-primary]')).toBeNull();
  });

  it('outside the dispute room a moderator line reads "Moderator", with no badge, and the panel says a dispute is open', async () => {
    current = snap({ disputeOpen: true, lines: [{ id: '5', from: 'mod', text: 'Moderator here', at: null, mine: false, gapBefore: false }] });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Moderator: Moderator here']);
    expect(host.querySelector('.x2f-tag[data-role="mod"]')).toBeNull();
    expect(host.querySelector('[data-system="dispute"]')?.textContent).toBe('A dispute is open. A moderator can read this conversation and write here.');
    // No moderator on the dispute record: no badge in the room either.
    const room = render(<ChatPanel chat={CHAT} name="Sam" dispute={{ moderator: null }} />);
    await flush();
    expect(room.host.querySelector('.x2f-tag[data-role="mod"]')).toBeNull();
  });

  it('another device of the account reads the conversation-elsewhere notice and has no composer', async () => {
    current = snap({ phase: 'other-device' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(host.textContent).toContain(OTHER_DEVICE);
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('a failed attestation check is a danger alert, never a composer', async () => {
    current = snap({ phase: 'failed', problem: 'security' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Security check failed');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('sends the typed text, clears the box, and says why a send was refused', async () => {
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const box = host.querySelector('textarea')!;
    type(box, 'Sending via Zelle now');
    client.send.mockResolvedValueOnce(snap({ lines: [{ id: '1', from: 'buyer', text: 'Sending via Zelle now', at: null, mine: true, gapBefore: false }] }));
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(client.send).toHaveBeenCalledWith(CHAT, 'Sending via Zelle now');
    expect(host.querySelector('textarea')!.value).toBe('');
    expect(host.querySelector('li')?.textContent).toBe('You: Sending via Zelle now');

    type(host.querySelector('textarea')!, 'x'.repeat(10));
    client.send.mockRejectedValueOnce(new ChatFailed('too-large'));
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(host.querySelector('.x2f-chat__error')?.textContent).toBe('This message is too long.');
    expect(host.querySelector('textarea')!.value).toBe('x'.repeat(10));
  });

  it('keeps the composer focusable while sending and puts focus back in the box after a send (review M3a)', async () => {
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const box = host.querySelector('textarea')!;
    box.focus();
    type(box, 'hello');
    let release!: (s: ChatSnapshot) => void;
    client.send.mockImplementationOnce(() => new Promise((r) => (release = r)));
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    const during = host.querySelector('textarea')!;
    expect(during.disabled).toBe(false);
    expect(during.readOnly).toBe(true);
    expect(during.getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelector<HTMLButtonElement>('.x2f-chat__send')!.disabled).toBe(false);
    expect(host.querySelector('.x2f-chat__send')!.getAttribute('aria-disabled')).toBe('true');
    // A second submit while sending sends nothing.
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(client.send).toHaveBeenCalledTimes(1);
    await act(async () => release(snap({ lines: [{ id: '1', from: 'buyer', text: 'hello', at: null, mine: true, gapBefore: false }] })));
    await flush();
    expect(host.querySelector('textarea')!.readOnly).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    // An empty box sends nothing (the button is aria-disabled, not disabled).
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('announces only new lines from the other side, never the history or my own lines (review M3b)', async () => {
    current = snap({ lines: [{ id: '1', from: 'seller', text: 'old', at: null, mine: false, gapBefore: false }] });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const list = host.querySelector('ol')!;
    expect(list.hasAttribute('aria-live')).toBe(false);
    const announcer = host.querySelector('[data-chat-announce]')!;
    expect(announcer.getAttribute('role')).toBe('status');
    expect(announcer.textContent).toBe('');
    current = snap({
      lines: [
        { id: '1', from: 'seller', text: 'old', at: null, mine: false, gapBefore: false },
        { id: '2', from: 'buyer', text: 'mine', at: null, mine: true, gapBefore: false },
      ],
    });
    act(() => emitChatLive(CHAT));
    await flush();
    expect(announcer.textContent).toBe('');
    current = snap({
      lines: [...current.lines, { id: '3', from: 'seller', text: 'new one', at: null, mine: false, gapBefore: false }],
    });
    act(() => emitChatLive(CHAT));
    await flush();
    expect(announcer.textContent).toBe('Sam: new one');
  });

  it('the message list is a labelled, focusable scroll region; the waiting states are in a status region (review M3d/e)', async () => {
    current = snap({ phase: 'waiting' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    const list = host.querySelector('ol')!;
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('aria-label')).toBe('Messages');
    expect(host.querySelector('[role="status"].x2f-chat__statusbox')?.textContent).toBe('Opening the chat…');
    await flush();
    expect(host.querySelector('[role="status"].x2f-chat__statusbox')?.textContent).toBe('Securing this chat…');
  });

  it('a sync that stopped early says it is loading more and syncs again at once (review M8)', async () => {
    const a = { id: '1', from: 'seller' as const, text: 'a', at: null, mine: false, gapBefore: false };
    const b = { ...a, id: '2', text: 'b' };
    let release!: (s: ChatSnapshot) => void;
    client.sync.mockResolvedValueOnce(snap({ more: true, lines: [a] })).mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(client.sync.mock.calls.length).toBe(2);
    expect(host.querySelector('.x2f-chat__statusbox')?.textContent).toBe('Loading more messages…');
    await act(async () => release(snap({ more: false, lines: [a, b] })));
    await flush();
    expect(client.sync.mock.calls.length).toBe(2);
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('.x2f-chat__statusbox')?.textContent).toBe('');
  });

  it('a sync that stops early with nothing new does not loop (it waits for the timer)', async () => {
    current = snap({ more: true, lines: [{ id: '1', from: 'seller', text: 'a', at: null, mine: false, gapBefore: false }] });
    render(<ChatPanel chat={CHAT} name="Sam" />);
    for (let i = 0; i < 6; i++) await flush();
    // The first sync showed a new line, so one more at once; that one added nothing, so it stops.
    expect(client.sync.mock.calls.length).toBe(2);
  });

  it('a rate-limited send says to wait', async () => {
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    type(host.querySelector('textarea')!, 'hi');
    client.send.mockRejectedValueOnce(new ChatFailed('slow-down'));
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(host.querySelector('.x2f-chat__error')?.textContent).toBe("You're sending messages too fast. Wait a minute and try again.");
  });

  it("re-syncs on the chat's live event (any spelling) and not on another chat's", async () => {
    render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const before = client.sync.mock.calls.length;
    act(() => emitChatLive('K7M2-9QXA-4FTR-XXXX'));
    await flush();
    expect(client.sync.mock.calls.length).toBe(before);
    act(() => emitChatLive(CHAT.toLowerCase().replace(/-/g, '')));
    await flush();
    expect(client.sync.mock.calls.length).toBe(before + 1);
  });
});

describe('ChatPanel: block (Task 37)', () => {
  it("offers Block <name> in the chat; after a block it re-syncs (an offer chat then answers 404, a trade chat stays)", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const { host } = render(
      <MemoryRouter>
        <ChatPanel chat={CHAT} name="Sam" />
      </MemoryRouter>,
    );
    await flush();
    const open = host.querySelector<HTMLButtonElement>('[data-part="block-open"]');
    expect(open?.textContent).toBe('Block Sam');
    // In the chat's header area: after the notice, before the messages.
    const order = [...host.querySelectorAll('.x2f-chat__notice, [data-part="block-open"], .x2f-chat__lines')];
    expect(order.map((e) => e.className || 'block')).toEqual(['x2f-chat__notice', expect.stringContaining('x2f-button'), 'x2f-chat__lines']);
    const before = client.sync.mock.calls.length;
    act(() => open!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-part="block-confirm"]')!.click());
    await flush();
    expect(fetch).toHaveBeenCalledWith('/v1/account/blocks', expect.objectContaining({ method: 'POST' }));
    expect(host.querySelector('[data-part="block-done"]')?.textContent).toContain('You blocked Sam.');
    expect(client.sync.mock.calls.length).toBe(before + 1);
  });

  it('a chat that answers 404 after the block shows no composer and says it has been closed', async () => {
    const { host } = render(
      <MemoryRouter>
        <ChatPanel chat={CHAT} name="Sam" />
      </MemoryRouter>,
    );
    await flush();
    expect(host.querySelector('textarea')).not.toBeNull();
    client.sync.mockRejectedValue(new ChatFailed('not-found'));
    act(() => emitChatLive(CHAT));
    await flush();
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('This chat has been closed.');
  });
});

describe('TradeChatPanel', () => {
  it("opens the trade's chat through POST /v1/trades/:code/chat", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ chat: CHAT, role: 'buyer' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { host } = render(<TradeChatPanel code="AAAA-BBBB-CCCC-DDDD" name="Sam" />);
    await flush();
    await flush();
    expect(fetch).toHaveBeenCalledWith('/v1/trades/AAAA-BBBB-CCCC-DDDD/chat', expect.objectContaining({ method: 'POST' }));
    expect(client.sync).toHaveBeenCalledWith(CHAT);
    expect(host.querySelector('textarea')).not.toBeNull();
  });

  it('says so when the trade has no chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'chat-unavailable' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    const { host } = render(<TradeChatPanel code="AAAA-BBBB-CCCC-DDDD" name="Sam" />);
    await flush();
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('This trade has no chat.');
    expect(client.sync).not.toHaveBeenCalled();
  });
});

describe('OfferChatPanel', () => {
  it('a refused open (own-offer) goes through CantDoThat with its feedback link (Plan 5 Task 21)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'own-offer' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    const { host } = render(
      <MemoryRouter>
        <OfferChatPanel offerId="8c1f9a52-3a4e-4f0b-9d55-6c1e2b7a9f10" name="Sam" />
      </MemoryRouter>,
    );
    await flush();
    await flush();
    const popup = document.querySelector('[data-part="cant-do-that"]');
    expect(popup?.getAttribute('data-from')).toBe('own-offer');
    expect(popup?.textContent).toContain('This is your own offer.');
    expect(host.querySelector('textarea')).toBeNull();
    expect(client.sync).not.toHaveBeenCalled();
  });
});
