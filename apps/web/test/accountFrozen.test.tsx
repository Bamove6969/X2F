// @vitest-environment happy-dom
// D-016 (build spec j33a section 6): the AccountFrozen notice. Its words, its one primary, the route
// that reads the API's frozen state (GET /v1/account/freeze, D-013..D-016), and the watch that opens
// the notice once after a freeze.
import { act } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountFrozen, AccountFrozenRoute, FROZEN_PATH, FrozenWatch, parseFreeze, setFrozenSource, type FrozenState } from '../src/screens/account/AccountFrozen.js';
import { fire, render } from './render.js';

const STATE: FrozenState = {
  since: '2026-11-09T10:12:00.000Z',
  dispute: { code: '7F3A-9C21-4FTR-8WPN', incidentId: 'K7QM4T2X9', side: 'selling', amountAtomic: '500000000000', counterparty: 'nightowl_44' },
};

function Where() {
  return <output data-where={useLocation().pathname} />;
}

function mount(node: React.ReactNode, at = '/x') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/x" element={node} />
        <Route path={FROZEN_PATH} element={<AccountFrozenRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => setFrozenSource(null));

/** What GET /v1/account/freeze answers for STATE's freeze. */
const API_FROZEN = {
  freezes: [{ since: STATE.since, dispute: { code: STATE.dispute.code, incidentId: 'K7QM4T2X9', side: 'seller', amountAtomic: '500000000000', counterparty: 'nightowl_44' } }],
};

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

describe('AccountFrozen (D-016)', () => {
  it("the caution hero: chip, title, lead and the facts, in the board's words", () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const hero = host.querySelector('section.x2f-hero')!;
    expect(hero.getAttribute('data-tone')).toBe('caution');
    expect(hero.querySelector('.x2f-chip')?.textContent).toBe('Trading frozen');
    expect(host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    expect(hero.textContent).toContain('Open your dispute to see what you need to do to get it back.');
    const facts = [...hero.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')?.textContent, d.querySelector('dd')?.textContent]);
    expect(facts).toEqual([
      ['Frozen since', '9 Nov 2026, 10:12 UTC'],
      ['Ends', 'When a moderator lifts it'],
      ['Dispute', '#K7QM4T2X9 · Selling 0.500000 XMR to nightowl_44'],
    ]);
    expect(hero.querySelector('[data-username]')?.textContent).toBe('nightowl_44');
  });

  it('what still works, and what is paused until it is lifted', () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const list = (h: string) => [...[...host.querySelectorAll('h2')].find((x) => x.textContent === h)!.parentElement!.querySelectorAll('li')].map((l) => l.textContent);
    expect(list('What still works')).toEqual([
      'You can log in and use your wallets.',
      "You can chat in your dispute. When you've done what the moderator asks, tell them there and they'll check and lift the freeze.",
      'Trades you already started carry on.',
      "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins.",
    ]);
    expect(list("Paused until it's lifted")).toEqual(['Starting or joining new trades.', 'Posting offers. Your offers are hidden for now.']);
  });

  it('"Go to your dispute" is the one primary and opens the dispute; Not now and Close go home', () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Go to your dispute');
    expect(primary[0]!.getAttribute('href')).toBe('/trade/7F3A-9C21-4FTR-8WPN/dispute');
    expect(host.querySelector('a[aria-label="Close"]')?.getAttribute('href')).toBe('/');
    fire([...host.querySelectorAll('a, button')].find((b) => b.textContent === 'Not now')!, new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
  });

  it("the incident ID is the dispute's, as the API gives it (G37), never derived from the trade code; none given, none shown", () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const dd = () => [...host.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === 'Dispute')!.querySelector('dd')!;
    expect(dd().querySelector('.x2f-frozen__mono')?.textContent).toBe('#K7QM4T2X9');
    expect(dd().textContent).not.toContain('7F3A');
    const none = mount(<AccountFrozen state={{ ...STATE, dispute: { ...STATE.dispute, incidentId: null } }} />);
    const noneDd = [...none.host.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === 'Dispute')!.querySelector('dd')!;
    expect(noneDd.textContent).toBe('Selling 0.500000 XMR to nightowl_44');
    expect(noneDd.textContent).not.toContain('#');
  });

  it('the route shows the frozen state a test source gives, and goes home while there is none', () => {
    setFrozenSource(() => null);
    const none = mount(<Where />, FROZEN_PATH);
    expect(none.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
    none.unmount();
    setFrozenSource(() => STATE);
    const { host } = mount(<Where />, FROZEN_PATH);
    expect(host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
  });
});

describe('parseFreeze: the API answer as the notice reads it', () => {
  it('the oldest freeze that still names its dispute, the side as the board words it', () => {
    expect(parseFreeze(API_FROZEN)).toEqual(STATE);
    const buying = { freezes: [{ ...API_FROZEN.freezes[0]!, dispute: { ...API_FROZEN.freezes[0]!.dispute, side: 'buyer', incidentId: null } }] };
    expect(parseFreeze(buying)).toEqual({ ...STATE, dispute: { ...STATE.dispute, side: 'buying', incidentId: null } });
    // A freeze whose trade record is gone (dispute null) is passed over for one that names its dispute.
    expect(parseFreeze({ freezes: [{ since: '2026-11-01T00:00:00.000Z', dispute: null }, ...API_FROZEN.freezes] })).toEqual(STATE);
  });

  it('null when not frozen, when no freeze names its dispute, and for anything malformed', () => {
    expect(parseFreeze({ freezes: [] })).toBeNull();
    expect(parseFreeze({ freezes: [{ since: STATE.since, dispute: null }] })).toBeNull();
    for (const bad of [null, {}, { freezes: 'x' }, { freezes: [{ since: 'not a date', dispute: API_FROZEN.freezes[0]!.dispute }] },
      { freezes: [{ since: STATE.since, dispute: { ...API_FROZEN.freezes[0]!.dispute, side: 'mod' } }] },
      { freezes: [{ since: STATE.since, dispute: { ...API_FROZEN.freezes[0]!.dispute, amountAtomic: '-1' } }] }]) {
      expect(parseFreeze(bad)).toBeNull();
    }
  });
});

describe('the frozen state from the API', () => {
  let answer: { status: number; body: unknown };
  let calls: string[];
  beforeEach(() => {
    answer = { status: 200, body: API_FROZEN };
    calls = [];
    vi.stubGlobal('fetch', async (input: string) => {
      calls.push(input);
      if (input === '/v1/account/freeze') return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
    });
    try {
      sessionStorage.clear();
    } catch {
      // no storage: the watch still works for the page load
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the route reads GET /v1/account/freeze and shows the notice; not frozen, it goes home', async () => {
    const { host, unmount } = mount(<Where />, FROZEN_PATH);
    await settle();
    expect(calls).toContain('/v1/account/freeze');
    expect(host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    expect(host.textContent).toContain('#K7QM4T2X9');
    unmount();
    answer = { status: 200, body: { freezes: [] } };
    const none = mount(<Where />, FROZEN_PATH);
    await settle();
    expect(none.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
  });

  it('the route goes home when the API refuses or fails', async () => {
    answer = { status: 500, body: { error: 'internal' } };
    const { host } = mount(<Where />, FROZEN_PATH);
    await settle();
    expect(host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
  });

  it('the watch opens the notice once after a freeze, never while not frozen, and not for a session it is off for', async () => {
    const watched = (enabled: boolean, at = '/x') => mount(<><FrozenWatch enabled={enabled} /><Where /></>, at);
    // Off (signed out, a team member): it never asks.
    const off = watched(false);
    await settle();
    expect(calls).toEqual([]);
    off.unmount();
    // Frozen: once.
    const first = watched(true);
    await settle();
    expect(first.host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    first.unmount();
    const again = watched(true);
    await settle();
    expect(again.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/x');
    again.unmount();
    // A new freeze (a later one, another since) opens it again.
    answer = { status: 200, body: { freezes: [{ ...API_FROZEN.freezes[0]!, since: '2026-11-10T08:00:00.000Z' }] } };
    const later = watched(true);
    await settle();
    expect(later.host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    later.unmount();
    // Not frozen: it stays where it is.
    answer = { status: 200, body: { freezes: [] } };
    try {
      sessionStorage.clear();
    } catch {
      // as above
    }
    const not = watched(true);
    await settle();
    expect(not.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/x');
  });

  it('F2: the watch never pulls someone off a trade page (the dispute, the trade room, its chat), and opens the notice on a later page', async () => {
    // A freeze no earlier test opened the notice for.
    answer = { status: 200, body: { freezes: [{ ...API_FROZEN.freezes[0]!, since: '2026-11-11T09:30:00.000Z' }] } };
    const watchAt = (at: string) =>
      render(
        <MemoryRouter initialEntries={[at]}>
          <FrozenWatch enabled />
          <Routes>
            <Route path={FROZEN_PATH} element={<AccountFrozenRoute />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>,
      );
    for (const at of ['/trade/7F3A-9C21-4FTR-8WPN/dispute', '/trade/7F3A-9C21-4FTR-8WPN', '/trade/7F3A-9C21-4FTR-8WPN?view=chat', '/trade/OTHER-CODE']) {
      const { host, unmount } = watchAt(at);
      await settle();
      expect(calls.at(-1), at).toBe('/v1/account/freeze');
      expect(host.querySelector('[data-where]')?.getAttribute('data-where'), at).toBe(at.split('?')[0]);
      unmount();
    }
    // Not marked as shown: going on from the trade page to one that is not opens it.
    const room = render(
      <MemoryRouter initialEntries={['/trade/7F3A-9C21-4FTR-8WPN']}>
        <FrozenWatch enabled />
        <Routes>
          <Route path={FROZEN_PATH} element={<AccountFrozenRoute />} />
          <Route path="/trade/:code" element={<Link to="/sell">Leave</Link>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(room.host.querySelector('a')?.textContent).toBe('Leave');
    fire(room.host.querySelector('a')!, new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();
    expect(room.host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    room.unmount();
    // Once shown, a later page load does not open it again.
    const later = watchAt('/sell');
    await settle();
    expect(later.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/sell');
  });
});
