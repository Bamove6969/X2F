// Design build task 6: opening a dispute on a trade whose chat has a key. The API answers 400
// grant-required; the page asks the escrow worker for this trader's signed grant and sends the
// dispute once more with it. A trade with no keyed chat is sent once, with no grant.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDispute } from '../src/screens/dispute/api.js';

const view = {
  openedBy: 'buyer', reason: 'paid', openedAt: '2026-11-18T11:00:00.000Z', afterRefund: false, dueAt: null,
  status: 'open', moderator: null, ruling: null, appeal: null, serverNow: '2026-11-18T12:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CODE = 'AAAA-BBBB-CCCC-DDDD';

afterEach(() => vi.unstubAllGlobals());

describe('openDispute and the chat key grant', () => {
  it('grant-required: makes the grant in the worker for the trade\'s chat and sends the dispute again with it', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      return b.grant === undefined ? json({ error: 'grant-required' }, 400) : json(view);
    }));
    const grant = vi.fn(async (chat: string, at: string) => ({ chat, at, sig: 'x' }));
    const chatOf = vi.fn(async () => 'CHAT-CODE-0000-0001');
    const d = await openDispute(CODE, 'paid', 'note', { chatOf, grant });
    expect(d.status).toBe('open');
    expect(chatOf).toHaveBeenCalledWith(CODE);
    expect(grant).toHaveBeenCalledWith('CHAT-CODE-0000-0001', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(bodies).toEqual([
      { reason: 'paid', note: 'note' },
      { reason: 'paid', note: 'note', grant: { chat: 'CHAT-CODE-0000-0001', at: expect.any(String), sig: 'x' } },
    ]);
  });

  it('no keyed chat: one request, no grant, no worker', async () => {
    const f = vi.fn(async () => json(view));
    vi.stubGlobal('fetch', f);
    const grant = vi.fn();
    await openDispute(CODE, 'paid', '', { chatOf: async () => 'x', grant });
    expect(f).toHaveBeenCalledTimes(1);
    expect(grant).not.toHaveBeenCalled();
  });

  it('any other refusal is thrown as it is, with no grant made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'wrong-state' }, 409)));
    const grant = vi.fn();
    await expect(openDispute(CODE, 'paid', '', { chatOf: async () => 'x', grant })).rejects.toMatchObject({ code: 'wrong-state' });
    expect(grant).not.toHaveBeenCalled();
  });
});
