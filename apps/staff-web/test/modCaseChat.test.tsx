// @vitest-environment happy-dom
// Design build task 9 on the ModCase screen (review lead-mod-chat t7-9): the full chat opened on a
// confirmed device, and messages to both traders. Review N1: the chat key is wiped when the screen
// goes away, never after a message (the second message used to find a wiped key).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OpenedChat } from '../src/chat/reader.js';
import { ModCase } from '../src/screens/ModCase.js';
import { button, cleanup, click, fakeApi, field, refused, render, settle, typeInto } from './helpers.js';
import { MOD_PUB, world } from './chatWorld.js';

const opened = vi.hoisted(() => [] as OpenedChat[]);
vi.mock('../src/chat/reader.js', async (orig) => {
  const m = await orig<typeof import('../src/chat/reader.js')>();
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
const kase = () => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '1320.00', overLimit: false, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: null, seller: null },
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
  vi.stubEnv('VITE_MOD_SIGNING_PUBLIC', await MOD_PUB());
});
afterEach(() => {
  opened.splice(0);
});

async function screen(w: Awaited<ReturnType<typeof world>>, o: { chat?: Parameters<typeof fakeApi>[0][string] } = {}) {
  let sent = 0;
  const api = fakeApi({
    'GET /staff/v1/disputes/:code': { body: kase() },
    'GET /staff/v1/devices': { body: { accountId: 'me', devices: [{ deviceKeyId: w.device.deviceKeyId, signPublic: w.device.signPublic, boxPublic: w.device.boxPublic, certifiedAt: 'x', expiresAt: 'y' }] } },
    'POST /staff/v1/disputes/:code/chat': o.chat ?? { body: w.answer },
    'POST /staff/v1/disputes/:code/messages': () => ({ status: 201, body: { id: `m${++sent}` } }),
  });
  render(
    <MemoryRouter initialEntries={[`/disputes/${CODE}`]}>
      <Routes>
        <Route path="/disputes/:code" element={<ModCase role="mod" loadDevice={async () => w.device} />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return api;
}

describe('ModCase: the full chat and messages (design build task 9)', () => {
  it('review N1: two messages in a row both go out; the chat key is wiped only when the screen goes away', async () => {
    const w = await world();
    const api = await screen(w);
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
    // Still the chat's key while the screen is up.
    expect(opened[0]!.tk.some((x) => x !== 0)).toBe(true);
    cleanup();
    expect(opened[0]!.tk.every((x) => x === 0)).toBe(true);
  });

  it('review N2: a line the server dropped is shown as missing where it was', async () => {
    const w = await world();
    // The buyer's seq 1 is withheld: their seq 2 follows one missing message.
    w.answer.envelopes = [
      { id: '1', senderRole: 'buyer', envelope: await w.seal('buyer', 0, 'I paid.'), at: 'a' },
      { id: '2', senderRole: 'buyer', envelope: await w.seal('buyer', 2, 'Here is the receipt.'), at: 'b' },
    ];
    await screen(w);
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('chat-lines') !== null);
    const items = [...part('chat-lines')!.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['the buyer: I paid.', '1 message(s) missing here', 'the buyer: Here is the receipt.']);
  });

  it('review N4: a device the moderation process does not know as certified (403 device-not-certified) goes back to "Confirm this device"', async () => {
    const w = await world();
    await screen(w, { chat: refused(403, 'device-not-certified') });
    await until(() => part('device-certified') !== null);
    await click(button('Open the full chat'));
    await until(() => part('device-uncertified') !== null);
    expect(part('device-certified')).toBeNull();
    expect(button('Confirm this device')).toBeDefined();
    expect(button('Open the full chat')?.disabled).toBe(true);
    expect(part('chat-lines')).toBeNull();
  });
});
