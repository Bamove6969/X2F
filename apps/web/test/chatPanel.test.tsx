// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_NOTICE, ChatPanel, MISSING_LINE, OfferChatPanel, OTHER_DEVICE, TradeChatPanel } from '../src/chat/ChatPanel.js';
import { ChatFailed, setChatClient, type ChatClient, type ChatSnapshot } from '../src/chat/client.js';
import { emitChatLive } from '../src/chat/live.js';
import { CHAT_NOTICES } from '../src/chat/notices.js';
import { render } from './render.js';

const CHAT = 'K7M2-9QXA-4FTR-8WPN';

const snap = (over: Partial<ChatSnapshot> = {}): ChatSnapshot => ({
  phase: 'ready',
  problem: null,
  role: 'buyer',
  counterparty: 'Sam',
  disputeOpen: false,
  systemCalled: false,
  paySecured: true,
  lines: [],
  more: false,
  ...over,
});

let current: ChatSnapshot;
let client: { sync: ReturnType<typeof vi.fn<ChatClient['sync']>>; send: ReturnType<typeof vi.fn<ChatClient['send']>>; sendPay: ReturnType<typeof vi.fn<ChatClient['sendPay']>>; sendProof: ReturnType<typeof vi.fn<ChatClient['sendProof']>>; sendUnblurred: ReturnType<typeof vi.fn<ChatClient['sendUnblurred']>>; sendNotice: ReturnType<typeof vi.fn<ChatClient['sendNotice']>> };

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  current = snap();
  client = { sync: vi.fn(async () => current), send: vi.fn(async () => current), sendPay: vi.fn(async () => current), sendProof: vi.fn(async () => current), sendUnblurred: vi.fn(async () => current), sendNotice: vi.fn(async () => current) };
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

  it('P-020: a proof notice is a system-styled line with its sender, in this reader\'s own wording (never the line\'s text), and is announced', async () => {
    const WORDS = CHAT_NOTICES['proof-code-hidden'];
    current = snap({ lines: [{ id: '1', from: 'buyer', text: 'hi', at: null, mine: true, gapBefore: false }] });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    current = snap({
      lines: [
        ...current.lines,
        { id: '2', from: 'seller', text: 'anything else', notice: 'proof-code-hidden', at: null, mine: false, gapBefore: false },
        { id: '3', from: 'buyer', text: WORDS, notice: 'proof-code-hidden', at: null, mine: true, gapBefore: false },
      ],
    });
    act(() => emitChatLive(CHAT));
    await flush();
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['You: hi', `Sam: ${WORDS}`, `You: ${WORDS}`]);
    const theirs = host.querySelector('li[data-notice="proof-code-hidden"][data-from="seller"]')!;
    expect(theirs.querySelector('.x2f-chat__autonotice')?.textContent).toBe(WORDS);
    expect(host.querySelectorAll('li[data-notice]')).toHaveLength(2);
    expect(host.querySelector('[data-chat-announce]')?.textContent).toBe(`Sam: ${WORDS}`);
  });

  it('review I2: a line the server no longer serves stays in place as a note with its sender and time, never as its text', async () => {
    current = snap({
      lines: [
        { id: '1', from: 'seller', text: '', at: '2026-11-06T15:00:00.000Z', mine: false, gapBefore: false, missing: true },
        { id: '2', from: 'buyer', text: 'Paid', at: null, mine: true, gapBefore: false },
      ],
    });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual([`Sam: ${MISSING_LINE} Sent 6 Nov 2026, 15:00 UTC.`, 'You: Paid']);
    expect(host.querySelector('li[data-missing] time')?.getAttribute('dateTime')).toBe('2026-11-06T15:00:00.000Z');
    expect(host.querySelectorAll('li[data-missing]')).toHaveLength(1);
  });

  it('design build task 7 (T2): the system\'s dispute shows "A moderator has been called by the system" only when the engine says so', async () => {
    current = snap({ disputeOpen: true });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(host.querySelector('[data-system="system-dispute"]')).toBeNull();
    current = snap({ disputeOpen: true, systemCalled: true });
    const again = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(again.host.querySelector('[data-system="system-dispute"]')?.textContent).toBe('A moderator has been called by the system.');
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

  it('a sync slower than the waiting poll still lands: a poll never starts while one is in flight (it runs once after), so no result is discarded for ever', async () => {
    vi.useFakeTimers();
    const line = { id: '1', from: 'seller' as const, text: 'Hello', at: null, mine: false, gapBefore: false };
    let inFlight = 0;
    let most = 0;
    // A slow device: every sync takes longer than CHAT_POLL_MS.waiting (3 s).
    client.sync.mockImplementation(
      () =>
        new Promise((r) => {
          most = Math.max(most, ++inFlight);
          setTimeout(() => {
            inFlight--;
            r(snap({ lines: [line] }));
          }, 4_000);
        }),
    );
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    for (let t = 0; t < 20; t++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Sam: Hello']);
    expect(most).toBe(1);
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
    act(() => document.querySelector<HTMLButtonElement>('[data-part="block-confirm"]')!.click());
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

// Lead call (20 Nov): the API opens no new chat for a closed trade (409 trade-closed); the panel shows an empty state, not an error or a refusal.
describe('TradeChatPanel: a closed trade with no chat', () => {
  it('shows "This trade has no chat." as an empty state: no alert, no CantDoThat, no sync', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'trade-closed' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    const { host } = render(
      <MemoryRouter>
        <TradeChatPanel code="AAAA-BBBB-CCCC-DDDD" name="Sam" />
      </MemoryRouter>,
    );
    await flush();
    await flush();
    const section = host.querySelector('[data-chat-phase]');
    expect(section?.getAttribute('data-chat-phase')).toBe('empty');
    expect(host.querySelector('[data-chat-empty]')?.textContent).toBe('This trade has no chat.');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="dialog"], dialog')).toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
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

describe('ChatPanel: the payee\'s payment details boxes and the payer\'s card (J-08, S-090; owner p7-3)', () => {
  const INTERAC = { methodId: 'INTERAC_E_TRANSFER' };
  const PAY = { v: 2 as const, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };
  const TEXT = 'Payment details\nFull name: Jane Doe\nEmail: jane@example.ca';
  const boxes = (host: HTMLElement) => host.querySelector<HTMLFormElement>('form[data-pay-boxes]');
  const field = (host: HTMLElement, key: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-pay-field="${key}"]`);
  function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    act(() => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const submit = (form: HTMLFormElement) => act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  it("the seller (who receives the payment) sees the method's boxes: Interac is full name, email, phone, with email-or-phone said", async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    const form = boxes(host)!;
    expect(form).not.toBeNull();
    expect([...form.querySelectorAll('[data-pay-field]')].map((e) => e.getAttribute('data-pay-field'))).toEqual(['name', 'email', 'phone']);
    expect(field(host, 'email')!.getAttribute('type')).toBe('email');
    expect(field(host, 'phone')!.getAttribute('type')).toBe('tel');
    const labels = [...form.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['Full name', 'Email', 'Mobile number']);
    expect(form.textContent).toContain('Fill in at least one of: Email, Mobile number.');
    // The text composer is still there, and the screen keeps one primary (none in the panel).
    expect(host.querySelector('textarea.x2f-chat__input')).not.toBeNull();
    expect(host.querySelector('[data-primary]')).toBeNull();
  });

  it('the buyer (who pays) gets no boxes, nor does anyone in a chat with no method (a pre-trade chat), nor while the chat is not ready', async () => {
    current = snap({ role: 'buyer' });
    expect(boxes(render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />).host)).toBeNull();
    await flush();
    current = snap({ role: 'seller' });
    const noMethod = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    expect(boxes(noMethod.host)).toBeNull();
    current = snap({ role: 'seller', phase: 'waiting' });
    const waiting = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    expect(boxes(waiting.host)).toBeNull();
  });

  it('owner Q12: before the escrow is secured the boxes show but Send is closed and says why; nothing is sent', async () => {
    current = snap({ role: 'seller', paySecured: false });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    const form = boxes(host)!;
    expect(form).not.toBeNull();
    const send = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(send.disabled).toBe(true);
    const why = host.querySelector<HTMLElement>('[data-pay-block="not-secured"]')!;
    expect(why.textContent).toBe('You can send these once the escrow is secured.');
    expect(send.getAttribute('aria-describedby')).toBe(why.id);
    fill(field(host, 'name')!, 'Jane Doe');
    fill(field(host, 'email')!, 'jane@example.ca');
    submit(form);
    await flush();
    expect(client.sendPay).not.toHaveBeenCalled();
    expect(host.querySelector('[data-pay-error]')).toBeNull();
    // Secured (the next sync says so): Send opens, the typed boxes are kept, and the why-line goes.
    current = snap({ role: 'seller', paySecured: true });
    act(() => emitChatLive(CHAT));
    await flush();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(host.querySelector('[data-pay-block]')).toBeNull();
    expect(field(host, 'name')!.value).toBe('Jane Doe');
    submit(form);
    await flush();
    expect(client.sendPay).toHaveBeenCalledTimes(1);
  });

  it('a gift card or cash method: the seller sees no boxes, only the nothing-to-send line (payee fields, 10 Nov 2026)', async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'STEAM_GIFT_CARD' }} />);
    await flush();
    expect(boxes(host)).toBeNull();
    expect(host.querySelector('[data-pay-field]')).toBeNull();
    expect(host.querySelector('[data-pay-nothing]')?.textContent).toBe('Nothing to send: the buyer sends the card or cash details here in the chat.');
    // The text composer stays, and the buyer sees neither.
    expect(host.querySelector('textarea.x2f-chat__input')).not.toBeNull();
    current = snap({ role: 'buyer' });
    const buyer = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'F2F' }} />);
    await flush();
    expect(buyer.host.querySelector('[data-pay-nothing]')).toBeNull();
  });

  it('review F1: before the escrow is secured a gift card or cash seller sees neither the nothing-to-send line nor boxes', async () => {
    current = snap({ role: 'seller', paySecured: false });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'STEAM_GIFT_CARD' }} />);
    await flush();
    expect(host.querySelector('[data-pay-nothing]')).toBeNull();
    expect(boxes(host)).toBeNull();
    expect(host.querySelector('[data-pay-field]')).toBeNull();
    // Secured: the line comes.
    current = snap({ role: 'seller', paySecured: true });
    act(() => emitChatLive(CHAT));
    await flush();
    expect(host.querySelector('[data-pay-nothing]')).not.toBeNull();
  });

  it("the 12 Nov recheck: a method's note for the payee shows with its boxes (Monese), and ATM cash now has an optional phone box", async () => {
    current = snap({ role: 'seller' });
    const monese = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'MONESE' }} />);
    await flush();
    expect(boxes(monese.host)!.querySelector('[data-pay-note]')?.textContent).toMatch(/Monese ID/);
    const interac = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    expect(interac.host.querySelector('[data-pay-note]')).toBeNull();
    const atm = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'CASH_AT_ATM' }} />);
    await flush();
    expect(atm.host.querySelector('[data-pay-nothing]')).toBeNull();
    expect([...boxes(atm.host)!.querySelectorAll('[data-pay-field]')].map((e) => e.getAttribute('data-pay-field'))).toEqual(['phone']);
  });

  it('review payee-fields-2 m-3: every box optional and none filled (ATM cash, Amazon) shows the nothing-to-send line and no Send; typing brings Send back', async () => {
    current = snap({ role: 'seller' });
    for (const methodId of ['CASH_AT_ATM', 'AMAZON_GIFT_CARD']) {
      const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId }} />);
      await flush();
      const form = boxes(host)!;
      expect(form.querySelector('[data-pay-nothing]')?.textContent, methodId).toBe('Nothing to send: the buyer sends the card or cash details here in the chat.');
      expect(form.querySelector('button[type="submit"]'), methodId).toBeNull();
      const box = form.querySelector<HTMLInputElement>('[data-pay-field]')!;
      fill(box, methodId === 'CASH_AT_ATM' ? '+525512345678' : 'me@example.com');
      expect(form.querySelector('[data-pay-nothing]'), methodId).toBeNull();
      expect(form.querySelector('button[type="submit"]'), methodId).not.toBeNull();
      fill(box, '   ');
      expect(form.querySelector('button[type="submit"]'), methodId).toBeNull();
    }
    // A method with a required box keeps its Send from the start.
    const interac = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    expect(boxes(interac.host)!.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("review payee-fields-2 m-4: the payer sees a neutral line for the other side's package that could not be shown", async () => {
    current = snap({ role: 'buyer', lines: [{ id: '7', from: 'seller', text: '', at: null, mine: false, gapBefore: false, unreadablePay: true }] });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    const line = host.querySelector('[data-pay-unreadable]');
    expect(line?.textContent).toBe("Their payment details couldn't be shown. Ask them to send again.");
    expect(host.querySelector('[data-missing]')).toBeNull();
  });

  it('a mailing address is a multi-line box', async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={{ methodId: 'PAY_BY_MAIL' }} />);
    await flush();
    expect(field(host, 'address')).toBeInstanceOf(HTMLTextAreaElement);
    expect(field(host, 'name')).toBeInstanceOf(HTMLInputElement);
  });

  it('Send packages the filled boxes through the chat client (never fetch) and clears them; the sent line is a card', async () => {
    current = snap({ role: 'seller' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    fill(field(host, 'name')!, ' Jane Doe ');
    fill(field(host, 'email')!, 'jane@example.ca');
    client.sendPay.mockResolvedValueOnce(snap({ role: 'seller', lines: [{ id: '1', from: 'seller', text: TEXT, pay: PAY, at: null, mine: true, gapBefore: false }] }));
    submit(boxes(host)!);
    await flush();
    expect(client.sendPay).toHaveBeenCalledWith(CHAT, PAY);
    expect(client.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(field(host, 'name')!.value).toBe('');
    const card = host.querySelector('li[data-mine] [data-pay-card]')!;
    expect(card.getAttribute('data-pay-card')).toBe('INTERAC_E_TRANSFER');
    expect([...card.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Full name', 'Email']);
    expect([...card.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Jane Doe', 'jane@example.ca']);
  });

  it('says which box is missing, and sends nothing, when a required box or the one-of group is empty', async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    fill(field(host, 'email')!, 'jane@example.ca');
    submit(boxes(host)!);
    await flush();
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe('Fill in Full name.');
    fill(field(host, 'name')!, 'Jane Doe');
    fill(field(host, 'email')!, '');
    submit(boxes(host)!);
    await flush();
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe('Fill in at least one of: Email, Mobile number.');
    expect(client.sendPay).not.toHaveBeenCalled();
    // A refusal from the engine (hidden characters) is said too.
    fill(field(host, 'phone')!, '+1 416 555 0100');
    client.sendPay.mockRejectedValueOnce(new ChatFailed('bad-text'));
    submit(boxes(host)!);
    await flush();
    expect(client.sendPay).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe('Leave out hidden characters.');
    expect(field(host, 'name')!.value).toBe('Jane Doe');
  });

  it('review M6 (pay details): a tab or a hidden character in an account box is refused on the page, by box, and nothing is sent', async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    fill(field(host, 'name')!, 'Jane Doe');
    fill(field(host, 'email')!, 'jane\u200d@example.ca');
    submit(boxes(host)!);
    await flush();
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe("Email can't have tabs or hidden characters.");
    fill(field(host, 'email')!, '');
    fill(field(host, 'phone')!, '+1 416\t555 0100');
    submit(boxes(host)!);
    await flush();
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe("Mobile number can't have tabs or hidden characters.");
    expect(client.sendPay).not.toHaveBeenCalled();
  });

  it("review M2 (pay details): the worker's own refusal of a package before the escrow is secured (not-ready) is said as the secured line", async () => {
    current = snap({ role: 'seller' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    fill(field(host, 'name')!, 'Jane Doe');
    fill(field(host, 'email')!, 'jane@example.ca');
    client.sendPay.mockRejectedValueOnce(new ChatFailed('not-ready'));
    submit(boxes(host)!);
    await flush();
    expect(client.sendPay).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-pay-error]')?.textContent).toBe('You can send these once the escrow is secured.');
    expect(field(host, 'name')!.value).toBe('Jane Doe');
  });

  it("the payer sees the seller's package as a card with the boxes, and the announcement reads its plain text", async () => {
    current = snap({ role: 'buyer' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    current = snap({ role: 'buyer', lines: [{ id: '7', from: 'seller', text: TEXT, pay: PAY, at: null, mine: false, gapBefore: false }] });
    act(() => emitChatLive(CHAT));
    await flush();
    const line = host.querySelector('li[data-from="seller"]')!;
    const card = line.querySelector('[data-pay-card]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('.x2f-chat__paycard-title')?.textContent).toBe('Payment details');
    expect([...card.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Full name', 'Email']);
    expect([...card.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Jane Doe', 'jane@example.ca']);
    expect(line.querySelector('.x2f-chat__who')?.textContent).toBe('Sam: ');
    expect(host.querySelector('[data-chat-announce]')?.textContent).toBe(`Sam: ${TEXT}`);
    // The buyer never gets the boxes, even with the method known.
    expect(boxes(host)).toBeNull();
  });

  it("review R1: the screen reader reads a package with this reader's own labels, never the line's text", async () => {
    current = snap({ role: 'buyer' });
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" pay={INTERAC} />);
    await flush();
    const spoofed = 'Payment details\nFull name: Jane Doe\nIBAN DE00999 instead of Email: jane@example.ca';
    current = snap({ role: 'buyer', lines: [{ id: '8', from: 'seller', text: spoofed, pay: PAY, at: null, mine: false, gapBefore: false }] });
    act(() => emitChatLive(CHAT));
    await flush();
    expect(host.querySelector('[data-chat-announce]')?.textContent).toBe(`Sam: ${TEXT}`);
    expect(host.textContent).not.toContain('DE00999');
  });
});

describe('ChatPanel: one sync in flight (review rev-small-fu, 21 Nov)', () => {
  const said = (id: string, text: string) => ({ id, from: 'seller' as const, text, at: null, mine: false, gapBefore: false });
  let pending: Array<(s: ChatSnapshot) => void>;

  beforeEach(() => {
    pending = [];
    client.sync = vi.fn(() => new Promise<ChatSnapshot>((res) => pending.push(res)));
  });

  it('live events during an in-flight sync coalesce into exactly one sync after it, whose result shows', async () => {
    const { host } = render(<ChatPanel chat={CHAT} name="Sam" />);
    await flush();
    act(() => emitChatLive(CHAT));
    act(() => emitChatLive(CHAT));
    await flush();
    expect(client.sync).toHaveBeenCalledTimes(1);
    pending[0]!(snap({ lines: [said('1', 'old')] }));
    await flush();
    // The live events asked for another sync while the first was out (ChatPanel's `again.current = true`).
    expect(client.sync).toHaveBeenCalledTimes(2);
    pending[1]!(snap({ lines: [said('1', 'old'), said('2', 'new')] }));
    await flush();
    expect(client.sync).toHaveBeenCalledTimes(2);
    expect([...host.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['Sam: old', 'Sam: new']);
  });
});
