// @vitest-environment happy-dom
// The owner's trade-status audit (owner 26 Nov 2026): GET /staff/v1/trades/status, by status, newest
// first, 50 a page with a `before` cursor; an open (active or suspended) lien can be written off as
// uncollectible with a `lien-uncollectible` tap (POST /staff/v1/liens/:id/uncollectible). Under Overview.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { button, click, fakeApi, honestTapStart, render, settle } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const ends = () => new Date(Date.now() + 3600_000).toISOString();
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };
const TAPS = { 'POST /staff/v1/taps/start': honestTapStart('tap-1'), 'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } } };
const LIEN = '3a1f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const LIEN2 = '4b2f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';

const lien = (id: string, status: string) => ({ id, status, amountAtomic: '1000000000', recoveredAtomic: '0', endedAt: status === 'active' || status === 'suspended' ? null : '2026-11-20T00:00:00.000Z' });
const trade = (code: string, status: string, o: Record<string, unknown> = {}) => ({
  code, state: status, status, takenAt: '2026-11-01T10:00:00.000Z', closedAt: null, amountAtomic: '12500000000', deleteAt: null, liens: [], ...o,
});
const COUNTS = { lien: 2, uncollectible: 1, disputed: 0, open: 3, completed: 4, closed: 0 };
const page = (trades: unknown[], next: string | null = null, counts = COUNTS) => ({ counts, trades, next });

const statusCalls = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === 'GET' && c.path.startsWith('/staff/v1/trades/status')).map((c) => c.path);
const rows = () => [...document.querySelectorAll('table[aria-label="Trades"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
const tapIntents = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body as Record<string, unknown>);

async function open(path = '/overview/trades') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('Trade status (owner audit)', () => {
  it('renders the rows and the counts per filter (All is the sum)', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/trades/status': {
        body: page([
          trade('AAAA1111BBBB2222', 'lien', { liens: [lien(LIEN, 'active')] }),
          trade('CCCC3333DDDD4444', 'completed', { closedAt: '2026-11-02T10:00:00.000Z', deleteAt: '2027-01-31T10:00:00.000Z' }),
          trade('EEEE5555FFFF6666', 'open'),
        ]),
      },
    });
    await open();
    expect(document.querySelector('[data-screen="trade-status"]')).not.toBeNull();
    expect(statusCalls(api.calls)).toEqual(['/staff/v1/trades/status']);
    const filters = [...document.querySelectorAll('[role="group"][aria-label="Status"] button')].map((b) => b.textContent);
    expect(filters).toEqual(['All (10)', 'Lien unpaid (2)', 'Uncollectible (1)', 'In dispute (0)', 'Open (3)', 'Completed (4)', 'Refunded or cancelled (0)']);
    expect(button('All (10)')?.getAttribute('aria-pressed')).toBe('true');
    const r = rows();
    expect(r).toHaveLength(3);
    expect(r[0]!.slice(0, 3)).toEqual(['AAAA1111BBBB2222', 'Lien unpaid', '2026-11-01']);
    expect(r[0]![5]).toBe('Not while the lien is unpaid');
    expect(r[0]![6]).toBe('Mark uncollectible');
    expect(r[1]!.slice(0, 4)).toEqual(['CCCC3333DDDD4444', 'Completed', '2026-11-01', '2026-11-02']);
    expect(r[1]![5]).toBe('2027-01-31');
    expect(r[2]![5]).toBe('No date yet');
    expect(r[0]![4]).toContain('XMR');
  });

  it('changing the filter reads that status', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/trades/status': (_b, path) =>
        path.includes('status=uncollectible')
          ? { body: page([trade('UUUU1111UUUU2222', 'uncollectible', { liens: [lien(LIEN, 'uncollectible')] })]) }
          : { body: page([trade('AAAA1111BBBB2222', 'open')]) },
    });
    await open();
    await click(button(/^Uncollectible \(/));
    expect(statusCalls(api.calls)).toEqual(['/staff/v1/trades/status', '/staff/v1/trades/status?status=uncollectible']);
    expect(button(/^Uncollectible \(/)?.getAttribute('aria-pressed')).toBe('true');
    expect(rows().map((r) => r[0])).toEqual(['UUUU1111UUUU2222']);
  });

  it('Older trades passes the cursor (and the filter) and appends the next page', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/trades/status': (_b, path) =>
        path.includes('before=')
          ? { body: page([trade('OLD0000000000001', 'completed')], null) }
          : { body: page([trade('NEW0000000000001', 'completed')], 'cursor-1') },
    });
    await open();
    await click(button(/^Completed \(/));
    await click(button('Older trades'));
    expect(statusCalls(api.calls)).toEqual([
      '/staff/v1/trades/status',
      '/staff/v1/trades/status?status=completed',
      '/staff/v1/trades/status?status=completed&before=cursor-1',
    ]);
    expect(rows().map((r) => r[0])).toEqual(['NEW0000000000001', 'OLD0000000000001']);
    expect(button('Older trades')).toBeUndefined();
  });

  it('Mark uncollectible goes through the lien-uncollectible key tap, writes the lien off, then reads again', async () => {
    let written = false;
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/trades/status': () =>
        written
          ? { body: page([trade('AAAA1111BBBB2222', 'uncollectible', { liens: [lien(LIEN, 'uncollectible')], deleteAt: '2027-02-24T00:00:00.000Z' })]) }
          : { body: page([trade('AAAA1111BBBB2222', 'lien', { liens: [lien(LIEN, 'active')] })]) },
      ...TAPS,
      'POST /staff/v1/liens/:id/uncollectible': () => {
        written = true;
        return { body: { status: 'uncollectible' } };
      },
    });
    await open();
    await click(button('Mark uncollectible'));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Write off the lien on AAAA1111BBBB2222');
    expect(dialog?.textContent).toContain('Any ban stays as it is.');
    // Nothing written before the tap.
    expect(api.calls.some((c) => c.path.includes('/uncollectible'))).toBe(false);
    await click(button('Tap security key'));
    await settle();
    expect(tapIntents(api.calls)).toEqual([{ kind: 'lien-uncollectible', lienId: LIEN }]);
    expect(api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/uncollectible'))).toMatchObject({
      path: `/staff/v1/liens/${LIEN}/uncollectible`,
      body: { tapId: 'tap-1' },
    });
    expect(statusCalls(api.calls)).toEqual(['/staff/v1/trades/status', '/staff/v1/trades/status']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button('Mark uncollectible')).toBeUndefined();
    expect(rows()[0]!.slice(1)).toContain('Uncollectible');
    expect(rows()[0]![5]).toBe('2027-02-24');
  });

  it('a suspended lien can be written off too; ended liens show no button, only their status', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/trades/status': {
        body: page([
          trade('SUSP000000000001', 'lien', { liens: [lien(LIEN2, 'suspended')] }),
          trade('DONE000000000001', 'uncollectible', { liens: [lien(LIEN, 'uncollectible')] }),
          trade('REPA000000000001', 'completed', { liens: [lien('5c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f', 'repaid')] }),
          trade('NONE000000000001', 'open'),
        ]),
      },
      ...TAPS,
      'POST /staff/v1/liens/:id/uncollectible': { body: { status: 'uncollectible' } },
    });
    await open();
    const lienCells = [...document.querySelectorAll('table[aria-label="Trades"] tbody tr')].map((tr) => tr.querySelectorAll('td')[6]!);
    expect(lienCells.map((td) => td.querySelector('button')?.textContent ?? null)).toEqual(['Mark uncollectible', null, null, null]);
    expect(lienCells.map((td) => td.textContent)).toEqual(['Mark uncollectible', 'Written off', 'Repaid', '']);
    expect([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Mark uncollectible')).toHaveLength(1);
    await click(button('Mark uncollectible'));
    await click(button('Tap security key'));
    await settle();
    expect(tapIntents(api.calls)).toEqual([{ kind: 'lien-uncollectible', lienId: LIEN2 }]);
    expect(api.calls.some((c) => c.path === `/staff/v1/liens/${LIEN2}/uncollectible`)).toBe(true);
  });
});
