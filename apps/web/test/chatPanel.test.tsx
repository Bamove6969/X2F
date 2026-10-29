// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_NOTICE, ChatPanel, OTHER_DEVICE, TradeChatPanel } from '../src/chat/ChatPanel.js';
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
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['YouSent', 'SamNot yet', 'A message is missing here.', 'SamGot it', 'X2F ModeratorModerator here']);
    expect(host.querySelector('[data-from="seller"] [data-username]')?.textContent).toBe('Sam');
    expect(host.querySelector('[data-from="mod"] .x2f-moderator-badge')).not.toBeNull();
    expect(host.querySelectorAll('.x2f-moderator-badge')).toHaveLength(1);
    expect(host.querySelector('[data-system="dispute"]')?.textContent).toContain('moderator can read this conversation');
    // The panel never adds a second primary action to the screen it sits in.
    expect(host.querySelector('[data-primary]')).toBeNull();
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
    expect(host.querySelector('li')?.textContent).toBe('YouSending via Zelle now');

    type(host.querySelector('textarea')!, 'x'.repeat(10));
    client.send.mockRejectedValueOnce(new ChatFailed('too-large'));
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(host.querySelector('.x2f-chat__error')?.textContent).toBe('This message is too long.');
    expect(host.querySelector('textarea')!.value).toBe('x'.repeat(10));
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
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The chat for this trade is not available.');
    expect(client.sync).not.toHaveBeenCalled();
  });
});
