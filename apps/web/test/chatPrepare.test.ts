// Regtest e2e gap 5 (Plan 5 Tasks 15 and 20): the escrow worker registers the trade chat's identity
// when the device runs the trade (chat/prepare.ts), so the chat is attested without anyone opening it.
import { describe, expect, it } from 'vitest';
import { httpOpenTradeChat } from '../src/chat/http.js';
import { tradeChatPreparer } from '../src/chat/prepare.js';

const CODE = 'K7Q2-M9XA-3PRT-W8DN';
const CHAT = 'AB12-CD34-EF56-GH78';
const fail = (status: number, code = 'x') => Object.assign(new Error(`api ${status}`), { status, code });

describe('httpOpenTradeChat: POST /v1/trades/:code/chat from the worker', () => {
  it('posts to the trade chat route, same-origin, no redirects, and answers the chat code', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const open = httpOpenTradeChat(async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ chat: CHAT, role: 'seller' }), { status: 200 });
    });
    expect(await open(CODE)).toBe(CHAT);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/v1/trades/${CODE}/chat`);
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', body: '{}' });
  });

  it('a refusal is thrown with its status and code; an answer without a chat code is a 502', async () => {
    const refusing = httpOpenTradeChat(async () => new Response(JSON.stringify({ error: 'chat-unavailable' }), { status: 409 }));
    await expect(refusing(CODE)).rejects.toMatchObject({ status: 409, code: 'chat-unavailable' });
    const odd = httpOpenTradeChat(async () => new Response(JSON.stringify({ chat: 7 }), { status: 200 }));
    await expect(odd(CODE)).rejects.toMatchObject({ status: 502 });
  });
});

describe('tradeChatPreparer: what the escrow runtime calls per trade', () => {
  it("opens the trade's chat and prepares its identity in the worker's one chat engine", async () => {
    const prepared: string[] = [];
    const prepare = tradeChatPreparer({
      openTradeChat: async (code) => (expect(code).toBe(CODE), CHAT),
      engine: async () => ({ prepare: async (chat: string) => (prepared.push(chat), 'registered' as const) }),
    });
    await prepare(CODE);
    expect(prepared).toEqual([CHAT]);
  });

  it('another device holds the role: done, nothing to retry', async () => {
    const prepare = tradeChatPreparer({ openTradeChat: async () => CHAT, engine: async () => ({ prepare: async () => 'other-device' as const }) });
    await expect(prepare(CODE)).resolves.toBeUndefined();
  });

  it.each([400, 403, 404, 409, 410])('a final refusal (%i) resolves: the runtime does not retry it, and opening the chat later still works', async (status) => {
    const viaOpen = tradeChatPreparer({ openTradeChat: async () => Promise.reject(fail(status)), engine: async () => ({ prepare: async () => 'registered' as const }) });
    await expect(viaOpen(CODE)).resolves.toBeUndefined();
    const viaEngine = tradeChatPreparer({ openTradeChat: async () => CHAT, engine: async () => ({ prepare: async () => Promise.reject(fail(status)) }) });
    await expect(viaEngine(CODE)).resolves.toBeUndefined();
  });

  it.each([401, 408, 429, 500, 503])('a passing failure (%i) is thrown, so the runtime tries again', async (status) => {
    const viaOpen = tradeChatPreparer({ openTradeChat: async () => Promise.reject(fail(status)), engine: async () => ({ prepare: async () => 'registered' as const }) });
    await expect(viaOpen(CODE)).rejects.toMatchObject({ status });
    const viaEngine = tradeChatPreparer({ openTradeChat: async () => CHAT, engine: async () => ({ prepare: async () => Promise.reject(fail(status)) }) });
    await expect(viaEngine(CODE)).rejects.toMatchObject({ status });
  });

  it('no answer at all (a network error) and an engine that would not start are thrown too', async () => {
    const offline = tradeChatPreparer({ openTradeChat: async () => Promise.reject(new TypeError('fetch failed')), engine: async () => ({ prepare: async () => 'registered' as const }) });
    await expect(offline(CODE)).rejects.toBeInstanceOf(TypeError);
    const noEngine = tradeChatPreparer({ openTradeChat: async () => CHAT, engine: async () => Promise.reject(new Error('no IndexedDB')) });
    await expect(noEngine(CODE)).rejects.toThrow('no IndexedDB');
  });
});
