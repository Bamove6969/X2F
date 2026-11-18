// @vitest-environment happy-dom
/**
 * J-08 (S-090): the payer's "Send exactly" card gets the seller's details from the newest package
 * in the trade's encrypted chat (closing paySeams.ts's GAP). The feed syncs the chat through the
 * worker's engine itself, so the card fills even while the chat sheet is closed.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChatClient, type ChatClient, type ChatSnapshot } from '../src/chat/client.js';
import { emitChatLive } from '../src/chat/live.js';
import { ChatPanel } from '../src/chat/ChatPanel.js';
import { PAY_FEED_POLL_MS, chatPaymentDetailsSource, panelPublishing, payRowsOf, publishPaySnapshot } from '../src/chat/payDetailsFeed.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const CHAT = 'Q2W3-E4R5-T6Y7-U8I9';
const PAY = { v: 2 as const, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };
const TEXT = 'Payment details\nFull name: Jane Doe\nEmail: jane@example.ca';
const ROWS = [
  { label: 'Full name', value: 'Jane Doe' },
  { label: 'Email', value: 'jane@example.ca' },
];

const snap = (over: Partial<ChatSnapshot> = {}): ChatSnapshot => ({ phase: 'ready', problem: null, role: 'buyer', counterparty: 'Sam', disputeOpen: false, paySecured: true, lines: [], more: false, ...over });
const line = (id: string, from: 'buyer' | 'seller', pay: typeof PAY | null = PAY) => ({ id, from, text: pay ? TEXT : 'hi', ...(pay ? { pay } : {}), at: null, mine: from === 'buyer', gapBefore: false });

let current: ChatSnapshot;
let client: { sync: ReturnType<typeof vi.fn<ChatClient['sync']>>; send: ReturnType<typeof vi.fn<ChatClient['send']>>; sendPay: ReturnType<typeof vi.fn<ChatClient['sendPay']>>; sendProof: ReturnType<typeof vi.fn<ChatClient['sendProof']>>; sendNotice: ReturnType<typeof vi.fn<ChatClient['sendNotice']>> };
let fetchMock: ReturnType<typeof vi.fn>;

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  current = snap();
  client = { sync: vi.fn(async () => current), send: vi.fn(async () => current), sendPay: vi.fn(async () => current), sendProof: vi.fn(async () => current), sendNotice: vi.fn(async () => current) };
  setChatClient(client);
  fetchMock = vi.fn(async (url: string) => {
    if (url === `/v1/trades/${CODE}/chat`) return new Response(JSON.stringify({ chat: CHAT }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setChatClient(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('payRowsOf', () => {
  it("is the newest package from the seller (the payee), as labelled rows; the buyer's own and plain lines never count", () => {
    expect(payRowsOf(snap())).toBeNull();
    expect(payRowsOf(snap({ lines: [line('1', 'seller', null), line('2', 'buyer')] }))).toBeNull();
    const older = { ...PAY, fields: [{ key: 'name', value: 'Old Name' }, { key: 'phone', value: '+1 416 555 0100' }] };
    expect(payRowsOf(snap({ lines: [line('1', 'seller', older), line('2', 'seller'), line('3', 'seller', null)] }))).toEqual(ROWS);
    expect(payRowsOf(snap({ lines: [line('3', 'seller'), line('1', 'seller', older)] }))).toEqual(ROWS);
  });
});

describe('chatPaymentDetailsSource', () => {
  it("resolves the trade's chat, syncs it through the worker and hands the card the rows; then follows live events and the poll", async () => {
    current = snap({ lines: [line('1', 'seller')] });
    const on = vi.fn();
    const off = chatPaymentDetailsSource(CODE, on);
    await tick();
    expect(fetchMock).toHaveBeenCalledWith(`/v1/trades/${CODE}/chat`, expect.objectContaining({ method: 'POST' }));
    expect(client.sync).toHaveBeenCalledWith(CHAT);
    expect(on).toHaveBeenLastCalledWith(ROWS);
    // A newer package arrives (the live event for the chat): the card follows.
    const fixed = { ...PAY, fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane.doe@example.ca' }] };
    current = snap({ lines: [line('1', 'seller'), line('2', 'seller', fixed)] });
    emitChatLive(CHAT);
    await tick();
    expect(on).toHaveBeenLastCalledWith([ROWS[0], { label: 'Email', value: 'jane.doe@example.ca' }]);
    // And on the timer, with no event.
    current = snap({ lines: [line('1', 'seller')] });
    const n = client.sync.mock.calls.length;
    vi.advanceTimersByTime(PAY_FEED_POLL_MS);
    await tick();
    expect(client.sync.mock.calls.length).toBe(n + 1);
    expect(on).toHaveBeenLastCalledWith(ROWS);
    // Unsubscribed: nothing more.
    off();
    const calls = on.mock.calls.length;
    emitChatLive(CHAT);
    vi.advanceTimersByTime(PAY_FEED_POLL_MS * 2);
    await tick();
    expect(on.mock.calls.length).toBe(calls);
  });

  it('an open chat panel on the same page feeds it at once (publishPaySnapshot), and no package means null, never a guess', async () => {
    const on = vi.fn();
    const off = chatPaymentDetailsSource(CODE, on);
    await tick();
    expect(on).toHaveBeenLastCalledWith(null);
    publishPaySnapshot(CODE, snap({ lines: [line('1', 'seller')] }));
    expect(on).toHaveBeenLastCalledWith(ROWS);
    // Another trade's panel is not this card's.
    publishPaySnapshot('AAAA-BBBB-CCCC-DDDD', snap({ lines: [line('9', 'seller', { ...PAY, fields: [{ key: 'name', value: 'Other' }, { key: 'email', value: 'o@x.ca' }] })] }));
    expect(on).toHaveBeenLastCalledWith(ROWS);
    off();
  });

  it("review M5 (pay details): the feed's own poll pauses while a panel for the same trade is publishing, and follows the panel's snapshots instead; another trade's panel does not pause it", async () => {
    const on = vi.fn();
    const off = chatPaymentDetailsSource(CODE, on);
    await tick();
    const n = client.sync.mock.calls.length;
    const release = panelPublishing(CODE);
    const other = panelPublishing('AAAA-BBBB-CCCC-DDDD');
    vi.advanceTimersByTime(PAY_FEED_POLL_MS * 3);
    await tick();
    expect(client.sync.mock.calls.length).toBe(n);
    publishPaySnapshot(CODE, snap({ lines: [line('1', 'seller')] }));
    expect(on).toHaveBeenLastCalledWith(ROWS);
    // The panel closes: the poll goes on.
    release();
    release();
    vi.advanceTimersByTime(PAY_FEED_POLL_MS);
    await tick();
    expect(client.sync.mock.calls.length).toBe(n + 1);
    other();
    off();
  });

  it('review M5 (pay details): an open ChatPanel for the trade is such a panel: while it is mounted only it polls the chat; once it unmounts the feed polls again', async () => {
    const on = vi.fn();
    const off = chatPaymentDetailsSource(CODE, on);
    await tick();
    const panel = render(<ChatPanel chat={CHAT} name="Sam" tradeCode={CODE} />);
    await act(tick);
    const n = client.sync.mock.calls.length;
    // One poll interval (the panel's ready poll and the feed's are the same 15 s): the panel's sync alone.
    await act(async () => {
      vi.advanceTimersByTime(PAY_FEED_POLL_MS);
      await tick();
    });
    expect(client.sync.mock.calls.length).toBe(n + 1);
    panel.unmount();
    const m = client.sync.mock.calls.length;
    vi.advanceTimersByTime(PAY_FEED_POLL_MS);
    await tick();
    expect(client.sync.mock.calls.length).toBe(m + 1);
    off();
  });

  it('a chat that cannot be opened leaves the card at null (the screen says "Ask in the chat") and never throws', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'chat-unavailable' }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const on = vi.fn();
    const off = chatPaymentDetailsSource(CODE, on);
    await tick();
    expect(on).toHaveBeenCalledWith(null);
    expect(on.mock.calls.every((c) => c[0] === null)).toBe(true);
    off();
  });
});
