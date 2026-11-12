// @vitest-environment happy-dom
// The team member's tour (src/tour/memberSteps.ts, design's tour-stops.md §4): each stop shows only
// with its ability, and every live target renders on its route in the real app, signed in as a
// member with those boxes ticked.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { TradeView } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { refreshSession } from '../src/session/useSession.js';
import { MEMBER_STOPS, PENDING_MEMBER_STOPS, memberTour, type TourStep } from '../src/tour/memberSteps.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MIN = 60_000;
const iso = (m: number) => new Date(Date.parse(SERVER_NOW) + m * MIN).toISOString();
const TRADE = sellerView({ payBy: iso(25), nextDeadline: iso(25) }) as TradeView;
const DUE = iso(600);
const OFFER = {
  id: '00000000-0000-4000-8000-0000000000a1', side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33000',
  pricing: { mode: 'market', marginBps: 200 }, minFiatCents: '5000', maxFiatCents: '100000', minTrades: null, status: 'live', createdAt: '2026-10-29T10:00:00.000Z',
};
/** A hold the lead put on, with two changes waiting (holdChanges.test.tsx's member view). */
const holdView = (rights: string) => ({
  accountHold: null,
  changes: {
    count: 2,
    takesEffectAt: DUE,
    items: [
      { id: '11111111-1111-4111-8111-111111111111', kind: 'remove-wallet', label: 'Cake Wallet', addressEnds: ['k3Fzab'], createdAt: DUE, submittedAt: DUE, by: 'Laptop', mine: false },
      { id: '22222222-2222-4222-8222-222222222222', kind: 'team-remove', memberId: 'm1', createdAt: DUE, submittedAt: DUE, by: 'Laptop', mine: false },
    ],
  },
  drafts: [],
  changesWait: false,
  rights,
  lead: 'satoshi_ghost',
});

let abilities: string[];
const has = (a: string) => abilities.includes(a);
const rolesOf = () => [...(has('offers-post') ? ['offers'] : []), ...(has('trades-see-active') ? ['trades'] : []), ...(['hold-see', 'hold-cancel', 'hold-end'] as const).filter(has)];

beforeEach(() => {
  setEscrowClient({ start: vi.fn<EscrowClient['start']>(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input).split('?')[0]!;
      if (url === '/v1/account/me') {
        return json(200, {
          kind: 'trader', level: 'full', termsCurrent: true, displayName: 'Calcium', methods: ['password'], accountType: 'vendor', pendingChanges: null,
          member: { name: 'Aurora', chatLabel: 'Calcium Assistant 1', abilities, preset: null, roles: rolesOf() },
        });
      }
      if (url === '/v1/site') return json(200, { maintenance: null });
      if (url === '/v1/account/hold') {
        const right = has('hold-end') ? 'end' : has('hold-cancel') ? 'cancel' : has('hold-see') ? 'see' : 'none';
        return json(200, holdView(right));
      }
      if (url === `/v1/trades/${TRADE.code}/confirmations`) return json(200, { confirmations: 10, target: 10 });
      if (url === `/v1/trades/${TRADE.code}`) return json(200, TRADE);
      if (url === '/v1/account/offers') return json(200, [OFFER]);
      return json(404, { error: 'not-found' });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setEscrowClient(null);
  refreshSession();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function missingTargets(steps: readonly TourStep[], as: string[]): Promise<string[]> {
  abilities = as;
  const missing: string[] = [];
  for (const s of steps) {
    document.body.innerHTML = '';
    refreshSession();
    const r = render(
      <MemoryRouter initialEntries={[s.route.replace(':code', TRADE.code)]}>
        <App />
      </MemoryRouter>,
    );
    await flush();
    if (document.querySelector(s.target) === null) missing.push(`${s.route} ${s.target}`);
    r.unmount();
  }
  return missing;
}

const ALL = ['offers-see', 'offers-pause', 'offers-delete', 'offers-post', 'trades-see-active', 'disputes-answer', 'hold-end', 'feedback-send'];

describe("the team member's tour (design tour-stops.md §4)", () => {
  it('every member gets the three Find a trade stops, and nothing else without boxes', () => {
    expect(memberTour([]).map((s) => s.title)).toEqual(['Whose account this is', 'Browse offers', 'Your tabs']);
  });

  it('each stop shows only with its box', () => {
    expect(memberTour(['offers-see']).map((s) => s.title)).toEqual(['Whose account this is', 'Browse offers', 'Your tabs', "The account's offers"]);
    expect(memberTour(['trades-see-active']).some((s) => s.title === 'If it goes wrong')).toBe(false);
    expect(memberTour(['trades-see-active', 'disputes-answer']).slice(-2).map((s) => s.title)).toEqual(['Following a trade', 'If it goes wrong']);
    expect(memberTour(['offers-pause']).some((s) => s.route === '/trade/:code')).toBe(false);
    expect(memberTour(ALL)).toHaveLength(MEMBER_STOPS.length);
  });

  it('the hold rights build on each other, as the API grants them', () => {
    expect(memberTour(['hold-see']).slice(3).map((s) => s.title)).toEqual(['Waiting changes']);
    expect(memberTour(['hold-cancel']).slice(3).map((s) => s.title)).toEqual(['Waiting changes', 'Stop a change']);
    expect(memberTour(['hold-end']).slice(3).map((s) => s.title)).toEqual(['Waiting changes', 'Stop a change', 'Apply it now']);
  });

  it("design's stops whose screen does not work for members yet are in no tour, each saying what it waits for", () => {
    const live = new Set(memberTour(ALL).map((s) => s.title));
    for (const p of PENDING_MEMBER_STOPS) {
      if (p.title !== '') expect(live.has(p.title), p.title).toBe(false);
      expect(p.waitsFor.length, p.page).toBeGreaterThan(3);
    }
  });

  it('no 3D or isometric wording anywhere (owner 12 Nov)', () => {
    expect(JSON.stringify([MEMBER_STOPS, PENDING_MEMBER_STOPS])).not.toMatch(/\b3d\b|isometric|\biso\b/i);
  });

  for (const set of [[], ['offers-see', 'offers-pause', 'offers-delete', 'offers-post'], ['trades-see-active', 'disputes-answer'], ['hold-see'], ['hold-cancel'], ['hold-end'], ['feedback-send'], ALL]) {
    it(`boxes [${set.join(', ')}]: every target renders on its route`, async () => {
      expect(await missingTargets(memberTour(set), set)).toEqual([]);
    });
  }
});
