// J-23 (S-075) phase 1 groundwork: the worker's chat-key messages (chat/serveKeys.ts) over a fake
// port, with a real keeper on an in-memory store. No key crosses the port.
import { generateBoxKeyPair } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import { createAckKeeper, type AckKeeper } from '../src/chat/ack.js';
import { serveChatKeys, type ChatKeysPort, type FromChatKeysWorker } from '../src/chat/serveKeys.js';
import { memoryChatStore } from '../src/chat/store.js';

/** A port whose `ask` sends one message and resolves with the answer carrying the same id. */
function fakePort() {
  let handler: ((e: { data: unknown }) => void) | null = null;
  const waiting = new Map<number, (m: FromChatKeysWorker) => void>();
  const port: ChatKeysPort = {
    postMessage: (m) => {
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    },
    addEventListener: (_t, cb) => {
      handler = cb;
    },
  };
  let next = 1;
  const ask = (m: Record<string, unknown>): Promise<FromChatKeysWorker> =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      handler!({ data: { ...m, id } });
    });
  const send = (data: unknown) => handler!({ data });
  return { port, ask, send, pending: () => waiting.size };
}

function worker(makeKeeper?: () => Promise<AckKeeper>) {
  const store = memoryChatStore();
  const keeper = createAckKeeper({ store, newBoxKeyPair: generateBoxKeyPair });
  const f = fakePort();
  serveChatKeys(f.port, makeKeeper ?? (async () => keeper));
  return { ...f, store, keeper };
}

describe('serveChatKeys', () => {
  it('answers device, status, make, seal, open and forget; two workers hand a key over through the messages alone', async () => {
    const a = worker();
    const b = worker();
    const devB = await b.ask({ t: 'chat-key-device' });
    expect(devB).toEqual({ t: 'chat-key', id: 1, ok: true, devicePublic: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await a.ask({ t: 'chat-key-status' })).toEqual({ t: 'chat-key', id: 1, ok: true, hasKey: false, epoch: null });
    expect(await a.ask({ t: 'chat-key-seal', recipientPublic: (devB as { devicePublic: string }).devicePublic })).toEqual({ t: 'chat-key', id: 2, ok: false, error: 'no-key' });
    expect(await a.ask({ t: 'chat-key-make', epoch: 0 })).toEqual({ t: 'chat-key', id: 3, ok: true, epoch: 0 });
    const sealed = await a.ask({ t: 'chat-key-seal', recipientPublic: (devB as { devicePublic: string }).devicePublic });
    expect(sealed).toEqual({ t: 'chat-key', id: 4, ok: true, sealed: expect.stringMatching(/^[A-Za-z0-9_-]+$/), epoch: 0 });
    const { sealed: box, epoch } = sealed as { sealed: string; epoch: number };
    expect(await b.ask({ t: 'chat-key-open', sealed: box, epoch })).toEqual({ t: 'chat-key', id: 2, ok: true, result: 'opened' });
    expect(await b.ask({ t: 'chat-key-status' })).toEqual({ t: 'chat-key', id: 3, ok: true, hasKey: true, epoch: 0 });
    const keyOf = (s: ReturnType<typeof memoryChatStore>) => (JSON.parse(s.account!) as { ack: { key: string } }).ack.key;
    expect(keyOf(b.store)).toBe(keyOf(a.store));
    expect(await b.ask({ t: 'chat-key-forget' })).toEqual({ t: 'chat-key', id: 4, ok: true });
    expect(b.store.account).toBeNull();
    // Nothing that crossed the port was the key or a device secret.
    const crossed = JSON.stringify([devB, sealed]);
    expect(crossed).not.toContain(keyOf(a.store));
    expect(crossed).not.toContain((JSON.parse(a.store.account!) as { deviceKey: { boxSecret: string } }).deviceKey.boxSecret);
  });

  it('refuses malformed requests (bad-request) and ignores what is not a chat-key message', async () => {
    const w = worker();
    expect(await w.ask({ t: 'chat-key-make', epoch: -1 })).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await w.ask({ t: 'chat-key-make', epoch: '0' })).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await w.ask({ t: 'chat-key-seal', recipientPublic: 'AB'.repeat(32) })).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await w.ask({ t: 'chat-key-seal' })).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await w.ask({ t: 'chat-key-open', sealed: 42, epoch: 0 })).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await w.ask({ t: 'chat-key-open', sealed: 'x', epoch: '0' })).toMatchObject({ ok: false, error: 'bad-request' });
    // A box that is not one is the keeper's word, not a refusal of the request.
    expect(await w.ask({ t: 'chat-key-open', sealed: 'not base64url!', epoch: 0 })).toMatchObject({ ok: true, result: 'bad-envelope' });
    // Not for this half of the worker: no answer at all.
    w.send({ t: 'chat-sync', id: 99, chat: 'AAAA-BBBB-CCCC-DDDD' });
    w.send({ t: 'chat-key-device' });
    w.send(null);
    w.send('chat-key-device');
    await new Promise((r) => setTimeout(r, 10));
    expect(w.pending()).toBe(0);
    expect(w.store.account).toBeNull();
  });

  it('a keeper that fails to start answers unavailable and is tried again on the next message', async () => {
    let tries = 0;
    const store = memoryChatStore();
    const w = worker(async () => {
      tries++;
      if (tries === 1) throw new Error('no IndexedDB');
      return createAckKeeper({ store, newBoxKeyPair: generateBoxKeyPair });
    });
    expect(await w.ask({ t: 'chat-key-status' })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await w.ask({ t: 'chat-key-status' })).toMatchObject({ ok: true, hasKey: false });
    expect(tries).toBe(2);
  });
});
