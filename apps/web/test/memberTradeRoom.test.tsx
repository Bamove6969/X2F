// @vitest-environment happy-dom
// Owner Jess, 26 Nov 2026: team members the lead grants boxes act in the account's trades, each a
// separate box (trades-fund, trades-release, trades-upload-proof, trades-mark-paid), each also with
// "Hold trade keys" (trades-escrow-keys). A box missing: that action is not shown. A 403 from the
// API: the team CantDoThat. The keys load on the member's device with their own key (memberKey.ts).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { loadMemberTrade, storeHolds } from '../src/escrow/memberKey.js';
import type { TradeView } from '../src/api/trade.js';
import '../src/screens/trade/screens.js';
import { actsOf, boxesOf, confirmedEvent, memberStep, NO_ACTS } from '../src/screens/trade/memberActs.js';
import { MEMBER_ROOM_COPY } from '../src/screens/trade/memberCopy.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { CANT_DO_TITLE } from '../src/ui/cantDoCodes.js';
import { refreshSession } from '../src/session/useSession.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MIN = 60_000;
const iso = (offsetMin: number) => new Date(Date.parse(SERVER_NOW) + offsetMin * MIN).toISOString();
const MEMBER_ME = { kind: 'trader', level: 'full', tradeTag: 'Calcium', member: { name: 'Aurora', roles: ['trades'] } };
const access = (boxes: string[]) => ({
  name: 'Aurora',
  chatLabel: 'Calcium Assistant 1',
  lead: { tradeTag: 'Calcium' },
  preset: null,
  groups: [{ id: 'trades', label: 'Trades', boxes: boxes.map((id) => ({ id, label: id, does: id, always: false, ready: true })) }],
  serverNow: SERVER_NOW,
});
const KEYS = 'trades-escrow-keys';

const buyerSecured = (over: Partial<TradeView> = {}): TradeView => ({ ...sellerView({ payBy: iso(25), nextDeadline: iso(25) }), role: 'buyer', ...over }) as TradeView;
const sellerFunding = (over: Partial<TradeView> = {}): TradeView =>
  ({ ...sellerView(), state: 'funding', fundStartedAt: null, fundBy: iso(30), nextDeadline: iso(30), ...over }) as TradeView;

let tradeView: TradeView;
let boxes: string[];
let calls: string[];
let eventAnswer: ((type: string, body: Record<string, unknown>) => Response | null) | null;
let start: ReturnType<typeof vi.fn<EscrowClient['start']>>;
let holds: boolean;

beforeEach(() => {
  calls = [];
  holds = true;
  eventAnswer = null;
  start = vi.fn<EscrowClient['start']>();
  setEscrowClient({ start, act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined, holdsTrade: async () => holds, restoreTrades: async () => [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push(`${method} ${url}${init?.body ? ' ' + String(init.body) : ''}`);
      if (url === '/v1/account/me') return json(MEMBER_ME);
      if (url === '/v1/team/me') return json(access(boxes));
      if (url === '/v1/escrow-keys/reader') return json({ id: 'r1', publicKey: 'ab'.repeat(32), unlocks: [{ method: 'prf', ref: 'cred1', salt: 'AA', envelope: 'AA' }] });
      if (url === '/v1/escrow-keys/unlock-methods') return json({ keys: [{ kind: 'passkey', label: 'Phone', credentialId: 'cred1' }], pgp: [] });
      if (String(url).endsWith('/confirmations')) return json({ confirmations: 10, target: 10 });
      if (method === 'POST' && String(url).endsWith('/events')) {
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
        const answer = eventAnswer?.(String(body.type), body);
        if (answer) return answer;
        return json(tradeView);
      }
      return json(tradeView);
    }),
  );
  refreshSession();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setEscrowClient(null);
  refreshSession();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

async function room(v: TradeView, b: string[]) {
  tradeView = v;
  boxes = b;
  const r = render(
    <MemoryRouter initialEntries={[`/trade/${v.code}`]}>
      <Routes>
        <Route path="/trade/:code" element={<TradeRoom />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  return r;
}

const names = (host: HTMLElement) => [...host.querySelectorAll('button, a')].map((b) => b.textContent);
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined;

describe('the boxes', () => {
  it('each act needs its own box and Hold trade keys', () => {
    expect(actsOf(['trades-release', 'trades-fund', 'trades-mark-paid', 'trades-upload-proof'])).toEqual(NO_ACTS);
    expect(actsOf([KEYS, 'trades-release'])).toEqual({ fund: false, release: true, uploadProof: false, markPaid: false, keys: true });
    expect(boxesOf(access([KEYS, 'trades-fund']))).toEqual([KEYS, 'trades-fund']);
    expect(boxesOf({ groups: [{ boxes: [{ id: 'trades-fund', ready: false }] }] })).toEqual([]);
    expect(boxesOf(null)).toEqual([]);
  });

  it('the step follows the role, the state and the box', () => {
    const all = actsOf([KEYS, 'trades-fund', 'trades-release', 'trades-mark-paid', 'trades-upload-proof']);
    expect(memberStep({ role: 'seller', state: 'funding', settling: null }, all)).toBe('fund');
    expect(memberStep({ role: 'seller', state: 'paid', settling: null }, all)).toBe('release');
    expect(memberStep({ role: 'seller', state: 'settling', settling: 'release' }, all)).toBe('release');
    expect(memberStep({ role: 'seller', state: 'settling', settling: 'buyer-cancel' }, all)).toBeNull();
    expect(memberStep({ role: 'seller', state: 'secured', settling: null }, all)).toBeNull();
    expect(memberStep({ role: 'buyer', state: 'secured', settling: null }, all)).toBe('pay');
    expect(memberStep({ role: 'seller', state: 'paid', settling: null }, actsOf([KEYS, 'trades-fund']))).toBeNull();
    expect(memberStep({ role: 'buyer', state: 'secured', settling: null }, actsOf([KEYS, 'trades-release']))).toBeNull();
  });
});

describe('the member key (memberKey.ts)', () => {
  it('a store holds a trade by its normalized code', async () => {
    const code = sellerView().code;
    expect(await storeHolds({ codes: async () => [code] }, code.toLowerCase())).toBe(true);
    expect(await storeHolds({ codes: async () => [] }, code)).toBe(false);
  });

  it('a load restores the copies, wipes the secret and says whether this trade came', async () => {
    const code = sellerView().code;
    const secret = new Uint8Array(32).fill(7);
    expect(await loadMemberTrade({ restoreTrades: async () => [code], holdsTrade: async () => true }, code, { boxPublic: 'ab'.repeat(32), boxSecret: secret })).toBe('loaded');
    expect([...secret].every((x) => x === 0)).toBe(true);
    expect(await loadMemberTrade({ restoreTrades: async () => [], holdsTrade: async () => false }, code, { boxPublic: 'ab'.repeat(32), boxSecret: new Uint8Array(32) })).toBe('not-in-copy');
    expect(await loadMemberTrade({ restoreTrades: async () => null, holdsTrade: async () => true }, code, { boxPublic: 'ab'.repeat(32), boxSecret: new Uint8Array(32) })).toBe('failed');
  });
});

describe('confirmed events (release-trade, fund-trade)', () => {
  it("sends the event, proves on the API's confirm-required, and sends it again with the token", async () => {
    const v = sellerView({ state: 'paid' }) as TradeView;
    tradeView = v;
    eventAnswer = (_type, body) => (body.confirmToken === undefined ? json({ error: 'confirm-required', action: 'release-trade' }, 403) : null);
    const prove = vi.fn(async () => 'tok-1');
    await confirmedEvent(v.code, 'release-trade', 'release-started', prove);
    expect(prove).toHaveBeenCalledWith({ kind: 'release-trade', tradeCode: v.code });
    expect(calls).toEqual([`POST /v1/trades/${v.code}/events {"type":"release-started"}`, `POST /v1/trades/${v.code}/events {"type":"release-started","confirmToken":"tok-1"}`]);
  });

  it('never proves for another kind than the one asked', async () => {
    const v = sellerView({ state: 'funding' }) as TradeView;
    tradeView = v;
    eventAnswer = () => json({ error: 'confirm-required', action: 'release-trade' }, 403);
    const prove = vi.fn(async () => 'tok');
    await expect(confirmedEvent(v.code, 'fund-trade', 'fund-started', prove)).rejects.toThrow();
    expect(prove).not.toHaveBeenCalled();
  });
});

describe("a member's trade room with boxes", () => {
  it('without Hold trade keys the room is as before: no escrow, no step', async () => {
    const { host } = await room(buyerSecured(), ['trades-see-active', 'trades-mark-paid']);
    expect(host.querySelector('[data-member-step]')).toBeNull();
    expect(names(host)).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it("the buyer's member with Mark I've paid gets I've paid and no cancel; the escrow runs here", async () => {
    const { host } = await room(buyerSecured(), [KEYS, 'trades-mark-paid']);
    expect(host.querySelector('[data-member-step="pay"]')).not.toBeNull();
    expect(button(host, "I've paid")).toBeDefined();
    expect(button(host, 'Cancel trade')).toBeUndefined();
    expect(start).toHaveBeenCalled();
  });

  it("with Upload proof only, I've paid is not shown at all", async () => {
    const { host } = await room(buyerSecured(), [KEYS, 'trades-upload-proof']);
    expect(host.querySelector('[data-member-step="pay"]')).not.toBeNull();
    expect(button(host, "I've paid")).toBeUndefined();
    expect(button(host, 'Cancel trade')).toBeUndefined();
  });

  it('a device without the keys offers to load them with the member’s own key, and starts no escrow', async () => {
    holds = false;
    const { host } = await room(buyerSecured(), [KEYS, 'trades-mark-paid']);
    expect(host.querySelector('[data-part="member-keys"]')).not.toBeNull();
    expect(button(host, MEMBER_ROOM_COPY.keysLoad)).toBeDefined();
    await act(async () => button(host, MEMBER_ROOM_COPY.keysLoad)!.click());
    await flush();
    // The member's passkey, never an authenticator code.
    expect(names(host)).toContain('Passkey: Phone');
    expect(host.textContent).not.toMatch(/authenticator code/i);
    expect(start).not.toHaveBeenCalled();
  });

  it('fund: the confirm comes first, and a 403 forbidden is the team CantDoThat', async () => {
    eventAnswer = () => json({ error: 'forbidden' }, 403);
    const { host } = await room(sellerFunding(), [KEYS, 'trades-fund']);
    const go = button(host, MEMBER_ROOM_COPY.fundStart)!;
    expect(go).toBeDefined();
    await act(async () => go.click());
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${tradeView.code}/events {"type":"fund-started"}`]);
    expect(document.body.querySelector('[data-part="cant-do-that"]')?.getAttribute('data-from')).toBe('forbidden');
    expect(document.body.textContent).toContain(CANT_DO_TITLE.teamRole);
  });

  it('release without the Release box: the seller in paid gets no hold to release', async () => {
    const { host } = await room(sellerView({ state: 'paid', paidAt: iso(-10), confirmBy: iso(20) }) as TradeView, [KEYS, 'trades-fund']);
    expect(host.querySelector('[data-member-step]')).toBeNull();
    expect(host.textContent).not.toMatch(/Hold to release/);
  });

  it('release with the box: the press and hold is shown', async () => {
    const { host } = await room(sellerView({ state: 'paid', paidAt: iso(-10), confirmBy: iso(20) }) as TradeView, [KEYS, 'trades-release']);
    expect(host.querySelector('[data-member-step="release"]')).not.toBeNull();
    expect(host.textContent).toMatch(/Hold to release/);
  });
});
