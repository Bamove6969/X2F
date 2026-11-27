// @vitest-environment happy-dom
// Design build task 9 on the ModCase screen (review lead-mod-chat t7-9): the full chat opened on a
// confirmed device, and messages to both traders. Review N1: the chat key is wiped when the screen
// goes away, never after a message (the second message used to find a wiped key). Design build task
// 10: the screen talks to the chat key worker (its keeper runs here behind a copying message pair),
// which alone holds the key.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatKeys } from '../src/chat/client.js';
import type { OpenedChat } from '../src/keys/reader.js';
import type { ChatKeeper } from '../src/keys/keeper.js';
import { ModCase } from '../src/screens/ModCase.js';
import { button, cleanup, click, fakeApi, field, refused, render, settle, typeInto } from './helpers.js';
import { memory, MOD_PUB, workerPair, world } from './chatWorld.js';

const opened = vi.hoisted(() => [] as OpenedChat[]);
vi.mock('../src/keys/reader.js', async (orig) => {
  const m = await orig<typeof import('../src/keys/reader.js')>();
  return {
    ...m,
    openCaseChat: async (...a: Parameters<typeof m.openCaseChat>) => {
      const o = await m.openCaseChat(...a);
      opened.push(o);
      return o;
    },
  };
});

const H = 3_600_000;
const CODE = '7RWD3MXEKQ84HN2T';
const kase = (traders: { buyer: unknown; seller: unknown } = { buyer: null, seller: null }) => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '1320.00', overLimit: false, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders,
  escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
});

const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
/** Lets real crypto (libsodium, WebCrypto) and the renders after it finish: until `ok`, or fails after ~5 s. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !ok(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  await settle();
}

beforeAll(async () => {
  await MOD_PUB();
});
afterEach(() => {
  opened.splice(0);
});

/** A world whose device key the in-process worker holds too (one backend). */
async function setup(): Promise<{ w: Awaited<ReturnType<typeof world>>; keeper: ChatKeeper; keys: ChatKeys }> {
  const backend = memory();
  const w = await world({ backend });
  return { w, ...(await workerPair({ backend })) };
}

async function screen(w: Awaited<ReturnType<typeof world>>, keys: ChatKeys, o: { chat?: Parameters<typeof fakeApi>[0][string]; traders?: Parameters<typeof kase>[0]; role?: 'mod' | 'senior'; assigned?: boolean } = {}) {
  let sent = 0;
  const api = fakeApi({
    'GET /staff/v1/disputes/:code': { body: { ...kase(o.traders), assignedToYou: o.assigned ?? true } },
    'GET /staff/v1/devices': { body: { accountId: 'me', devices: [{ deviceKeyId: w.device.deviceKeyId, signPublic: w.device.signPublic, boxPublic: w.device.boxPublic, certifiedAt: 'x', expiresAt: 'y' }] } },
    'POST /staff/v1/disputes/:code/chat': o.chat ?? { body: w.answer },
    'POST /staff/v1/disputes/:code/messages': () => ({ status: 201, body: { id: `m${++sent}` } }),
  });
  render(
    <MemoryRouter initialEntries={[`/disputes/${CODE}`]}>
      <Routes>
        <Route path="/disputes/:code" element={<ModCase role={o.role ?? 'mod'} keys={keys} />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return api;
}

describe('ModCase: the full chat and messages (design build task 9)', () => {
  it('review N1: two messages in a row both go out; the chat key is wiped only when the screen goes away', async () => {
    const { w, keeper, keys } = await setup();
    const api = await screen(w, keys);
    await until(() => part('device-certified') !== null);
    expect(part('device-certified')).not.toBeNull();
    await click(button('Open the full chat'));
    await until(() => part('chat-lines') !== null);
    expect(part('chat-lines')?.textContent).toContain('I paid.');
    expect(opened).toHaveLength(1);
    for (const text of ['Please send your bank statement.', 'And the time of the transfer.']) {
      typeInto(field('Message both traders'), text);
      await click(button('Send'));
      await until(() => /Sent and logged|could not/.test(part('message')?.textContent ?? ''));
      expect(part('message')?.textContent, text).toContain('Sent and logged.');
    }
    const sends = api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(sends.map((c) => (c.body as { seq: number }).seq)).toEqual([0, 1]);
    // The page holds no key: what it got back from the worker is lines and a handle.
    expect(JSON.stringify(sends.map((c) => c.body))).not.toContain(Buffer.from(w.tk).toString('hex'));
    // Still the chat's key, in the worker, while the screen is up.
    expect(keeper.size).toBe(1);
    expect(opened[0]!.tk.some((x) => x !== 0)).toBe(true);
    cleanup();
    await new Promise((r) => setTimeout(r, 20));
    expect(keeper.size).toBe(0);
    expect(opened[0]!.tk.every((x) => x === 0)).toBe(true);
  });

  it('review N2: a line the server dropped is shown as missing where it was', async () => {
    const { w, keys } = await setup();
    // The buyer's seq 1 is withheld: their seq 2 follows one missing message.
    w.answer.envelopes = [
      { id: '1', senderRole: 'buyer', envelope: await w.seal('buyer', 0, 'I paid.'), at: 'a' },
      { id: '2', senderRole: 'buyer', envelope: await w.seal('buyer', 2, 'Here is the receipt.'), at: 'b' },
    ];
    await screen(w, keys);
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('chat-lines') !== null);
    const items = [...part('chat-lines')!.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['the buyer: I paid.', '1 message(s) missing here', 'the buyer: Here is the receipt.']);
  });

  it('review N4: a device the moderation process does not know as certified (403 device-not-certified) goes back to "Confirm this device"', async () => {
    const { w, keys } = await setup();
    await screen(w, keys, { chat: refused(403, 'device-not-certified') });
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('device-uncertified') !== null);
    expect(part('device-certified')).toBeNull();
    expect(button('Confirm this device')).toBeDefined();
    expect(button('Open the full chat')?.disabled).toBe(true);
    expect(part('chat-lines')).toBeNull();
  });
});

describe('ModCase: private lanes (owner 27 Nov)', () => {
  const traders = { buyer: { displayName: 'mira.k', completedTrades: 3, positivePct: 100 }, seller: { displayName: 'nightowl_44', completedTrades: 9, positivePct: 98 } };
  const select = () => part('talking-to') as HTMLSelectElement;
  const choose = async (value: string) => {
    await act(async () => {
      select().value = value;
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
  };

  it('offers "Talking to both" and each trader by username; a private message is sent with `to` at that lane\'s seq and shows with the private marker', async () => {
    const { w, keys } = await setup();
    w.answer.lanes = w.answer.lanes!.map((l) => (l.to === 'seller' ? { ...l, nextSeq: 2 } : l));
    const api = await screen(w, keys, { traders });
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('chat-lines') !== null);
    expect([...select().options].map((x) => x.textContent)).toEqual(['Talking to both', 'Talking to nightowl_44', 'Talking to mira.k']);
    expect(select().value).toBe('both');
    expect(part('message')?.getAttribute('data-private')).toBeNull();

    await choose('seller');
    // The composer says so, three ways: tinted, its label, its button.
    expect(part('message')?.getAttribute('data-private')).toBe('seller');
    expect(part('message')?.className).toContain('x2f-staff-compose--private');
    expect(part('compose-private')?.textContent).toBe('Private: only nightowl_44 sees this. mira.k sees nothing of it.');
    typeInto(field('Message nightowl_44 privately'), 'Did the money arrive?');
    await click(button('Send to nightowl_44 only'));
    await until(() => /Sent|could not/.test(part('message')?.textContent ?? ''));
    expect(part('message')?.textContent).toContain('Sent to nightowl_44 only, and logged.');

    await choose('both');
    typeInto(field('Message both traders'), 'Thanks, both.');
    await click(button('Send'));
    await until(() => (part('message')?.textContent ?? '').includes('Sent and logged.'));

    const sends = api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')).map((c) => c.body as { seq: number; to?: string });
    expect(sends.map((b) => [b.seq, b.to ?? null])).toEqual([[2, 'seller'], [0, null]]);
    expect('to' in sends[1]!).toBe(false);
    const priv = part('chat-lines')!.querySelector('[data-private="seller"]');
    expect(priv?.querySelector('[data-part="chat-private"]')?.textContent).toBe('Private · only nightowl_44 sees this');
    expect(priv?.textContent).toContain('Moderator: Did the money arrive?');
  });

  it('an audit reader (a senior not assigned to the case) sees every lane, in the private colour and marker', async () => {
    const { w, keys } = await setup();
    w.answer.envelopes = [
      { id: '1', senderRole: 'buyer', envelope: await w.seal('buyer', 0, 'I paid.'), at: 'a', to: null },
      { id: '2', senderRole: 'mod', envelope: await w.sealLane('mod', 'buyer', 0, 'Send me the receipt.'), at: 'b', to: 'buyer' },
      { id: '3', senderRole: 'buyer', envelope: await w.sealLane('buyer', 'buyer', 0, 'Here it is.'), at: 'c', to: 'buyer' },
      { id: '4', senderRole: 'mod', envelope: await w.sealLane('mod', 'seller', 0, 'Check your bank.'), at: 'd', to: 'seller' },
    ];
    await screen(w, keys, { traders, role: 'senior', assigned: false });
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('chat-lines') !== null);
    const items = [...part('chat-lines')!.querySelectorAll('li')].map((li) => [li.getAttribute('data-private'), li.querySelector('[data-part="chat-private"]')?.textContent ?? null]);
    expect(items).toEqual([
      [null, null],
      ['buyer', 'Private · only mira.k sees this'],
      ['buyer', 'Private · only mira.k sees this'],
      ['seller', 'Private · only nightowl_44 sees this'],
    ]);
    expect(part('chat-lines')!.querySelectorAll('.x2f-staff-chat__line--private')).toHaveLength(3);
  });
});
