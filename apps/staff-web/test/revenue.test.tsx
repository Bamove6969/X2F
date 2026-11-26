// @vitest-environment happy-dom
// The owner's books (owner 16 Nov, the payout's network fee: each receiver pays the fee for its
// own payout output, X2F's fee output too): GET /staff/v1/revenue already gives every bucket
// `networkFeeAtomic` and `netAtomic`, and a `toDate` bucket. The page that shows them is not drawn
// (NEEDS_DESIGN_REVENUE); this is the minimal table, under the owner's Overview.
import { NAV, navFor } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { click, fakeApi, refused, render, settle } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const ends = () => new Date(Date.now() + 3600_000).toISOString();
const OWNER = { tradeTag: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const headers = (label: string) => [...document.querySelectorAll(`table[aria-label="${label}"] thead th`)].map((th) => th.textContent);
const rows = (label: string) =>
  [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

const bucket = (period: string, trades: number, total: bigint, netFee: bigint) => ({
  period,
  trades,
  feeAtomic: total.toString(),
  owedCollectedAtomic: '0',
  owedCollections: 0,
  totalAtomic: total.toString(),
  usdEstimateCents: '0',
  networkFeeAtomic: netFee.toString(),
  netAtomic: (total - netFee).toString(),
});

const REPORT = {
  by: 'month',
  from: '2025-12-01',
  to: '2026-11-17',
  buckets: [bucket('2026-10', 2, 25_000_000_000n, 61_440_000n), bucket('2026-11', 1, 12_500_000_000n, 30_720_000n)],
  total: bucket('2025-12-01..2026-11-17', 3, 37_500_000_000n, 92_160_000n),
  byCurrency: [],
  toDate: bucket('to-date', 4, 50_000_000_000n, 122_880_001n),
  treasuryNetworkFeesRecorded: false,
  owedOutstandingAtomic: null,
};

describe('Revenue (owner; network fees paid to date and the net total)', () => {
  it('the owner reaches it from Overview; it shows the fees, the network fees paid and the net, to date and by month, in exact XMR', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': { body: REPORT } });
    await open('/overview');
    // Overview's Earnings card reads the revenue for its own range first; the link is in that card.
    const before = api.calls.filter((c) => c.path.startsWith('/staff/v1/revenue')).length;
    await click(document.querySelector('[data-part="earnings"] a[href="/overview/revenue"]'));
    expect(document.querySelector('[data-screen="revenue"]')).not.toBeNull();
    // The Revenue page reads once, the API's default range (by month).
    const mine = api.calls.filter((c) => c.path.startsWith('/staff/v1/revenue')).slice(before);
    expect(mine.map((c) => c.path)).toEqual(['/staff/v1/revenue?by=month']);
    expect(headers('Revenue to date')).toEqual(['Fees to date', 'Monero network fees paid to date', 'Net to date']);
    expect(rows('Revenue to date')).toEqual([['0.050000000000 XMR', '0.000122880001 XMR', '0.049877119999 XMR']]);
    expect(headers('Revenue by month')).toEqual(['Month', 'Trades', 'Fees', 'Monero network fees paid', 'Net']);
    expect(rows('Revenue by month')).toEqual([
      ['2026-10', '2', '0.025000000000 XMR', '0.000061440000 XMR', '0.024938560000 XMR'],
      ['2026-11', '1', '0.012500000000 XMR', '0.000030720000 XMR', '0.012469280000 XMR'],
    ]);
    // Plan 6: the fee sweep and payroll sends record no network fee yet; the page says so.
    expect(document.querySelector('[data-part="treasury-fees"]')).not.toBeNull();
    // Owner 16-17 Nov: each receiver pays the network fee for its own payout output; never "half".
    expect(document.querySelector('[data-screen="revenue"]')?.textContent ?? '').not.toMatch(/half/i);
  });

  it('no month with revenue reads as such; a refusal shows the fault', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': { body: { ...REPORT, buckets: [], treasuryNetworkFeesRecorded: true } } });
    await open('/overview/revenue');
    expect(rows('Revenue by month')).toEqual([['No revenue yet.']]);
    expect(document.querySelector('[data-part="treasury-fees"]')).toBeNull();
    document.body.innerHTML = '';
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': refused(403, 'forbidden') });
    await open('/overview/revenue');
    expect(document.querySelector('[data-part="revenue-fault"]')).not.toBeNull();
    expect(document.querySelector('table[aria-label="Revenue to date"]')).toBeNull();
  });

  it('is the owner\'s alone, as the API is (earnings.read): no other role has Overview, so no way to it', async () => {
    for (const role of ['senior', 'mod', 'helper'] as const) expect(navFor(role, ['feedback.read', 'tickets.handle'])).not.toContain('overview');
    const api = fakeApi({ 'GET /staff/v1/me': { body: { ...OWNER, role: 'senior', nav: NAV.senior } }, 'GET /staff/v1/revenue': { body: REPORT } });
    await open('/overview/revenue');
    expect(document.querySelector('[data-screen="revenue"]')).toBeNull();
    expect(document.querySelector('[data-part="nothing-for-role"]')).not.toBeNull();
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/revenue'))).toBe(false);
  });
});
