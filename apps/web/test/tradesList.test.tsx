// @vitest-environment happy-dom
// My trades (/trades; lead job, register D-005): the account's own trades from GET /v1/trades
// (apps/api/src/trades/list.ts `TradeListPage`), in an Open and a Completed tab, against a stubbed API.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Trades, TRADES_PATH } from '../src/screens/Trades.js';
import { parseTradeList, type TradeListItem } from '../src/screens/trades/api.js';
import { STATE_LABEL, sideLine, whenLine } from '../src/screens/trades/model.js';
import { TRADE_STATES } from '../src/api/trade.js';
import { BottomNav } from '../src/ui/BottomNav.js';
import { DesktopRail, railPageName } from '../src/ui/DesktopShell.js';
import { teamCantDoText } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

const OPEN = {
  code: 'K7M2-9QXA-4FTR-8WPN', role: 'buyer', state: 'secured', amountAtomic: '1250000000000', fiatCents: '41250', currency: 'USD',
  counterparty: { displayName: 'satoshi_ghost' }, takenAt: '2026-11-10T09:30:00.000Z', closedAt: null,
};
const OPEN2 = { ...OPEN, code: 'AB2C-3DEF-4GHJ-5KMN', role: 'seller', state: 'paid', counterparty: { displayName: 'moneta' }, takenAt: '2026-11-09T08:00:00.000Z' };
const DONE = {
  ...OPEN, code: 'Z9Y8-X7W6-V5T4-S3R2', role: 'seller', state: 'released', fiatCents: '9900', currency: 'EUR', amountAtomic: '300000000000',
  counterparty: { displayName: 'oldfriend' }, takenAt: '2026-11-01T10:00:00.000Z', closedAt: '2026-11-01T12:15:00.000Z',
};

type Answer = { status: number; json: unknown };
let answer: (url: URL) => Answer;
let urls: URL[];

function json(a: Answer): Response {
  return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  urls = [];
  answer = (u) => {
    const status = u.searchParams.get('status');
    if (status === 'open') return { status: 200, json: { trades: [OPEN, OPEN2], next: null } };
    if (status === 'completed') return { status: 200, json: { trades: [DONE], next: null } };
    return { status: 400, json: { error: 'bad-request' } };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = new URL(String(input), 'https://x2f.test');
      if (u.pathname !== '/v1/trades') return json({ status: 404, json: { error: 'not-found' } });
      urls.push(u);
      return json(answer(u));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function screen(path = TRADES_PATH, rowAction?: (t: TradeListItem) => React.ReactNode) {
  const r = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trades" element={<Trades {...(rowAction ? { rowAction } : {})} />} />
        <Route path="/trade/:code" element={<p data-at="room">room</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return r;
}

const rows = (host: HTMLElement) => [...host.querySelectorAll('[data-part="trade-row"]')];
const tab = (host: HTMLElement, name: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name)!;

describe('parseTradeList', () => {
  it('reads the API page and refuses a renamed, missing or odd field', () => {
    const p = parseTradeList({ trades: [OPEN, DONE], next: 'abc' });
    expect(p.next).toBe('abc');
    expect(p.trades[0]).toEqual({ ...OPEN, amountAtomic: 1_250_000_000_000n, fiatCents: 41_250n });
    expect(p.trades[1]!.closedAt).toBe(DONE.closedAt);
    for (const bad of [
      null, [], { trades: [] }, { trades: {}, next: null },
      { trades: [{ ...OPEN, role: 'poster' }], next: null },
      { trades: [{ ...OPEN, state: 'gone' }], next: null },
      { trades: [{ ...OPEN, amountAtomic: '1.5' }], next: null },
      { trades: [{ ...OPEN, counterparty: {} }], next: null },
      { trades: [{ ...OPEN, takenAt: 'yesterday' }], next: null },
      { trades: [{ ...OPEN, closedAt: 5 }], next: null },
      { trades: [OPEN], next: 7 },
      // Review m2: only a trade code in its own form, so the row's link cannot lead elsewhere.
      { trades: [{ ...OPEN, code: '../settings' }], next: null },
      { trades: [{ ...OPEN, code: 'k7m2-9qxa-4ftr-8wpn' }], next: null },
      { trades: [{ ...OPEN, code: 'K7M29QXA4FTR8WPN' }], next: null },
      { trades: [{ ...OPEN, code: 'K7M2-9QXA-4FTR' }], next: null },
      { trades: [{ ...OPEN, code: 'K7M2-9QXA-4FTR-8WPN?x=1' }], next: null },
    ]) {
      expect(() => parseTradeList(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('every trade state has words', () => {
    for (const s of TRADE_STATES) expect(STATE_LABEL[s].text.length, s).toBeGreaterThan(0);
    // Re-verify B2 (spec 6.6): the moderator look stays on the dispute screens; a disputed row says
    // "In dispute" in the caution tone with the alert icon.
    expect(STATE_LABEL.disputed).toEqual({ text: 'In dispute', tone: 'caution', icon: 'alert' });
    for (const s of TRADE_STATES) expect(STATE_LABEL[s].tone, s).not.toBe('mod');
  });
});

describe('My trades screen', () => {
  it('opens on Open: one row per trade with code, side, amount, the other side, state and date, each to its room', async () => {
    const { host } = await screen();
    expect(urls.map((u) => u.searchParams.get('status'))).toEqual(['open']);
    expect(host.querySelector('h1')!.textContent).toBe('My trades');
    expect(tab(host, 'Open').getAttribute('aria-selected')).toBe('true');
    expect(tab(host, 'Completed').getAttribute('aria-selected')).toBe('false');
    const [first, second] = rows(host);
    expect(rows(host)).toHaveLength(2);
    expect(first!.textContent).toContain('K7M2-9QXA-4FTR-8WPN');
    expect(first!.textContent).toContain(sideLine(parseTradeList({ trades: [OPEN], next: null }).trades[0]!));
    expect(first!.textContent).toContain('Buying 1.250000 XMR');
    expect(first!.textContent).toContain('$412.50');
    expect(first!.textContent).toContain('satoshi_ghost');
    expect(first!.textContent).toContain(STATE_LABEL.secured.text);
    expect(first!.textContent).toContain('Started 10 Nov 2026, 09:30 UTC');
    expect(second!.textContent).toContain('Selling 1.250000 XMR');
    expect(second!.textContent).toContain('moneta');
    expect(first!.querySelector('a')!.getAttribute('href')).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    // The other side by public name, in the kit's username style.
    expect(first!.querySelector('[data-username]')!.textContent).toBe('satoshi_ghost');
  });

  it('Completed shows the closed trades with their end date, and the tab is kept in the address', async () => {
    const { host } = await screen();
    fire(tab(host, 'Completed'), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(urls.map((u) => u.searchParams.get('status'))).toEqual(['open', 'completed']);
    expect(tab(host, 'Completed').getAttribute('aria-selected')).toBe('true');
    expect(rows(host)).toHaveLength(1);
    const row = rows(host)[0]!;
    expect(row.textContent).toContain('Selling 0.300000 XMR');
    expect(row.textContent).toContain('€99.00');
    expect(row.textContent).toContain(STATE_LABEL.released.text);
    expect(row.textContent).toContain(whenLine(parseTradeList({ trades: [DONE], next: null }).trades[0]!));
    expect(row.textContent).toContain('Ended 1 Nov 2026, 12:15 UTC');
    const direct = await screen('/trades?tab=completed');
    expect(rows(direct.host)[0]!.textContent).toContain('Z9Y8-X7W6-V5T4-S3R2');
  });

  it('Show more follows the cursor and adds the next page', async () => {
    answer = (u) =>
      u.searchParams.get('cursor') === 'p2'
        ? { status: 200, json: { trades: [OPEN2], next: null } }
        : { status: 200, json: { trades: [OPEN], next: 'p2' } };
    const { host } = await screen();
    expect(rows(host)).toHaveLength(1);
    const more = host.querySelector('[data-part="more"]')!;
    fire(more, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(urls.at(-1)!.searchParams.get('cursor')).toBe('p2');
    expect(urls.at(-1)!.searchParams.get('status')).toBe('open');
    expect(rows(host)).toHaveLength(2);
    expect(host.querySelector('[data-part="more"]')).toBeNull();
  });

  it('an empty tab says so; a member without the box gets the team-role refusal; a failure can be retried', async () => {
    answer = () => ({ status: 200, json: { trades: [], next: null } });
    const empty = await screen();
    expect(empty.host.querySelector('[data-part="empty"]')!.textContent).toContain('No open trades');

    // A member with See trade history only: Open is refused in CantDoThat (the team-role words), OK goes to Completed.
    answer = (u) => (u.searchParams.get('status') === 'open' ? { status: 403, json: { error: 'forbidden' } } : { status: 200, json: { trades: [DONE], next: null } });
    const forbidden = await screen();
    const popup = document.querySelector('[data-part="cant-do-that"]')!;
    expect(popup.getAttribute('data-from')).toBe('forbidden');
    expect(popup.textContent).toContain(teamCantDoText('forbidden'));
    expect(rows(forbidden.host)).toEqual([]);
    fire([...popup.querySelectorAll('button')].find((b) => b.textContent === 'OK')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(tab(forbidden.host, 'Completed').getAttribute('aria-selected')).toBe('true');
    expect(rows(forbidden.host)).toHaveLength(1);

    let fail = true;
    answer = () => (fail ? { status: 500, json: { error: 'internal' } } : { status: 200, json: { trades: [OPEN], next: null } });
    const broken = await screen();
    expect(broken.host.querySelector('[data-part="error"]')).not.toBeNull();
    fail = false;
    fire(broken.host.querySelector('[data-part="retry"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(rows(broken.host)).toHaveLength(1);
  });

  it('NEEDS_APPEALS_MERGE: each row has the seam for the File appeal button', async () => {
    // wip/lead-appeals' FileAppeal goes in `rowAction` on Completed rows once both branches are on
    // the line (it needs the dispute's appealUntil, which this list does not carry yet).
    const { host } = await screen('/trades?tab=completed', (t) => <button type="button" data-part="appeal">Appeal {t.code}</button>);
    const row = rows(host)[0]!;
    expect(row.querySelector('[data-part="appeal"]')!.textContent).toBe('Appeal Z9Y8-X7W6-V5T4-S3R2');
    // Outside the room link, so pressing it never opens the trade.
    expect(row.querySelector('a [data-part="appeal"]')).toBeNull();
  });
});

describe('the disputed row (re-verify B2)', () => {
  it('draws "In dispute" as a caution chip with the alert icon, never the moderator tone', async () => {
    answer = () => ({ status: 200, json: { trades: [{ ...OPEN, state: 'disputed' }], next: null } });
    const { host } = await screen();
    const chip = rows(host)[0]!.querySelector('.x2f-chip')!;
    expect(chip.getAttribute('data-tone')).toBe('caution');
    expect(chip.textContent).toContain('In dispute');
    expect(host.querySelector('[data-tone="mod"]')).toBeNull();
  });
});

describe('My trades in the nav', () => {
  it('the phone tab bar and the wide rail lead to /trades, current there', () => {
    const phone = render(
      <MemoryRouter initialEntries={['/trades']}>
        <BottomNav />
      </MemoryRouter>,
    );
    const tabLink = [...phone.host.querySelectorAll('nav a')].find((a) => a.textContent === 'My trades')!;
    expect(tabLink.getAttribute('href')).toBe('/trades');
    expect(tabLink.getAttribute('aria-current')).toBe('page');
    const wide = render(
      <MemoryRouter initialEntries={['/trades']}>
        <DesktopRail />
      </MemoryRouter>,
    );
    const railLink = [...wide.host.querySelectorAll('a.x2f-rail__link')].find((a) => a.textContent === 'My trades')!;
    expect(railLink.getAttribute('href')).toBe('/trades');
    expect(railLink.getAttribute('aria-current')).toBe('page');
    expect(wide.host.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(railPageName('/trades')).toBe('My trades');
  });
});
