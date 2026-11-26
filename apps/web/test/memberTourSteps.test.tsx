// @vitest-environment happy-dom
// The team member's tour (src/tour/memberSteps.ts, design's tour-stops.md §4): each stop shows only
// with its ability, and every live target renders on its page in the real app, signed in as a
// member with those boxes ticked. Review 12 Nov, S2: the tour is the engine's own TourDef.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { TradeView } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { refreshSession } from '../src/session/useSession.js';
import type { TourDef } from '../src/tour/engine.js';
import { MEMBER_STOPS, PENDING_MEMBER_STOPS, memberTour } from '../src/tour/memberSteps.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MIN = 60_000;
const iso = (m: number) => new Date(Date.parse(SERVER_NOW) + m * MIN).toISOString();
const TRADE = sellerView({ payBy: iso(25), nextDeadline: iso(25) }) as TradeView;
const OFFER = {
  id: '00000000-0000-4000-8000-0000000000a1', side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33000',
  pricing: { mode: 'market', marginBps: 200 }, minFiatCents: '5000', maxFiatCents: '100000', minTrades: null, status: 'live', createdAt: '2026-10-29T10:00:00.000Z',
};
let abilities: string[];
const has = (a: string) => abilities.includes(a);
const rolesOf = () => [...(has('offers-post') ? ['offers'] : []), ...(has('trades-see-active') ? ['trades'] : [])];

beforeEach(() => {
  setEscrowClient({ start: vi.fn<EscrowClient['start']>(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input).split('?')[0]!;
      if (url === '/v1/account/me') {
        return json(200, {
          kind: 'trader', level: 'full', termsCurrent: true, displayName: 'Calcium', methods: ['pgp', 'totp'], accountType: 'vendor',
          member: { name: 'Aurora', chatLabel: 'Calcium Assistant 1', abilities, preset: null, roles: rolesOf() },
        });
      }
      if (url === '/v1/site') return json(200, { maintenance: null });
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

/** A tour's steps with the page each is on, flat. */
type Flat = { route: string; target: string | null; title?: string; body: string; placement: string; id: string };
const flat = (t: TourDef): Flat[] => t.pages.flatMap((p) => p.steps.map((s) => ({ ...s, route: p.path as string })));
/** The member's tour for these boxes, with a trade to open (the Trade room page needs one). */
const tourFor = (set: readonly string[]) => flat(memberTour(set, TRADE.code));

async function missingTargets(steps: readonly Flat[], as: string[]): Promise<string[]> {
  abilities = as;
  const missing: string[] = [];
  for (const s of steps) {
    document.body.innerHTML = '';
    refreshSession();
    const r = render(
      <MemoryRouter initialEntries={[s.route]}>
        <App />
      </MemoryRouter>,
    );
    await flush();
    if (s.target !== null && document.querySelector(s.target) === null) missing.push(`${s.route} ${s.target}`);
    r.unmount();
  }
  return missing;
}

const ALL = ['offers-see', 'offers-pause', 'offers-delete', 'offers-post', 'trades-see-active', 'disputes-answer', 'feedback-send'];

describe("the team member's tour (design tour-stops.md §4)", () => {
  it('every member gets the three Find a trade stops, and nothing else without boxes', () => {
    expect(tourFor([]).map((s) => s.title)).toEqual(['Whose account this is', 'Browse offers', 'Your tabs']);
  });

  it('each stop shows only with its box', () => {
    expect(tourFor(['offers-see']).map((s) => s.title)).toEqual(['Whose account this is', 'Browse offers', 'Your tabs', "The account's offers"]);
    expect(tourFor(['trades-see-active']).some((s) => s.title === 'If it goes wrong')).toBe(false);
    expect(tourFor(['trades-see-active', 'disputes-answer']).slice(-2).map((s) => s.title)).toEqual(['Following a trade', 'If it goes wrong']);
    expect(tourFor(['offers-pause']).some((s) => s.route.startsWith('/trade/'))).toBe(false);
    expect(tourFor(ALL)).toHaveLength(MEMBER_STOPS.length);
  });

  it("is the engine's TourDef: page by page, in design's page order, unique ids, the engine's placements", () => {
    const t = memberTour(ALL, TRADE.code);
    expect(t.flow).toBe('screens');
    expect(t.pages.map((p) => p.name)).toEqual(['Find a trade', 'My offers', 'Trade room', 'Feedback']);
    expect(t.pages.map((p) => p.path)).toEqual(['/buy', '/profile/offers', `/trade/${TRADE.code}`, '/feedback']);
    const steps = flat(t);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) expect(['auto', 'above', 'below', 'center'], s.id).toContain(s.placement);
    // A page with no stop for these boxes is left out; so is the Trade room with no trade to open.
    expect(memberTour([]).pages.map((p) => p.id)).toEqual(['find']);
    expect(memberTour(['trades-see-active']).pages.map((p) => p.id)).toEqual(['find']);
  });

  it("design's stops whose screen does not work for members yet are in no tour, each saying what it waits for", () => {
    const live = new Set(tourFor(ALL).map((s) => s.title));
    for (const p of PENDING_MEMBER_STOPS) {
      if (p.title !== '') expect(live.has(p.title), p.title).toBe(false);
      expect(p.waitsFor.length, p.page).toBeGreaterThan(3);
    }
  });

  it('no 3D or isometric wording anywhere (owner 12 Nov)', () => {
    expect(JSON.stringify([MEMBER_STOPS, PENDING_MEMBER_STOPS])).not.toMatch(/\b3d\b|isometric|\biso\b/i);
  });

  for (const set of [[], ['offers-see', 'offers-pause', 'offers-delete', 'offers-post'], ['trades-see-active', 'disputes-answer'], ['feedback-send'], ALL]) {
    it(`boxes [${set.join(', ')}]: every target renders on its route`, async () => {
      expect(await missingTargets(tourFor(set), set)).toEqual([]);
    });
  }
});
