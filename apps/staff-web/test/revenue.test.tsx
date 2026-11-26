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

  it('shows what arrived in the fee and payroll wallets by UTC month, beside the books, with each wallet\'s state', async () => {
    const month = (m: string, fee: bigint, payroll: bigint, swept: bigint, trades: number, booked: bigint, usd: string | null) => ({
      month: m, feeWalletAtomic: fee.toString(), sweptInAtomic: swept.toString(), payrollWalletAtomic: payroll.toString(),
      earnedAtomic: (fee + payroll).toString(), usdEstimateCents: usd, trades, bookedNetAtomic: booked.toString(),
    });
    const EARNINGS = {
      feeWallet: { walletEnd: '9Fq2', state: 'ready', syncedAt: '2026-11-20T11:50:00.000Z' },
      payrollWallet: { walletEnd: 'Xk7a', state: 'stale', syncedAt: '2026-11-20T11:40:00.000Z' },
      usdCentsPerXmr: '16501',
      months: [month('2026-10', 12_500_000_000n, 12_499_000_000n, 0n, 2, 24_938_560_000n, '412'), month('2026-11', 6_250_000_000n, 6_249_000_000n, 1_000_000_000n, 1, 12_469_280_000n, '206')],
      allTime: month('all-time', 18_750_000_000n, 18_748_000_000n, 1_000_000_000n, 3, 37_407_840_000n, '618'),
    };
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': { body: REPORT }, 'GET /staff/v1/earnings': { body: EARNINGS } });
    await open('/overview/revenue');
    expect(api.calls.filter((c) => c.path === '/staff/v1/earnings')).toHaveLength(1);
    expect(headers('Arrived by month')).toEqual(['Month (UTC)', 'Fee wallet', 'Payroll wallet', 'Received', "USD at today's price", 'Booked, after network fees', 'Trades', 'Moved from the payroll wallet']);
    expect(rows('Arrived by month')).toEqual([
      ['2026-10', '0.012500000000 XMR', '0.012499000000 XMR', '0.024999000000 XMR', '$4.12', '0.024938560000 XMR', '2', '0.000000000000 XMR'],
      ['2026-11', '0.006250000000 XMR', '0.006249000000 XMR', '0.012499000000 XMR', '$2.06', '0.012469280000 XMR', '1', '0.001000000000 XMR'],
      ['All time', '0.018750000000 XMR', '0.018748000000 XMR', '0.037498000000 XMR', '$6.18', '0.037407840000 XMR', '3', '0.001000000000 XMR'],
    ]);
    expect(document.querySelector('[data-part="fee-wallet-state"]')?.textContent).toBe('Fee wallet ending 9Fq2: read at 2026-11-20 11:50 UTC.');
    expect(document.querySelector('[data-part="payroll-wallet-state"]')?.textContent).toBe('Payroll wallet ending Xk7a: the last read failed. These figures are from 2026-11-20 11:40 UTC.');
    // The revenue tables are still there.
    expect(rows('Revenue by month')).toHaveLength(2);
    expect(document.querySelector('[data-screen="revenue"]')?.textContent ?? '').not.toMatch(/half/i);
  });

  it('no wallet set up says so; nothing yet reads as such; a failed earnings read leaves the revenue in place', async () => {
    const EMPTY = { feeWallet: null, payrollWallet: null, usdCentsPerXmr: null, months: [], allTime: { month: 'all-time', feeWalletAtomic: '0', sweptInAtomic: '0', payrollWalletAtomic: '0', earnedAtomic: '0', usdEstimateCents: null, trades: 0, bookedNetAtomic: '0' } };
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': { body: REPORT }, 'GET /staff/v1/earnings': { body: EMPTY } });
    await open('/overview/revenue');
    expect(document.querySelector('[data-part="fee-wallet-state"]')?.textContent).toMatch(/no view-only key/);
    expect(document.querySelector('[data-part="payroll-wallet-state"]')?.textContent).toMatch(/not connected/);
    expect(rows('Arrived by month')).toEqual([['Nothing has arrived yet.']]);
    document.body.innerHTML = '';
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/revenue': { body: REPORT }, 'GET /staff/v1/earnings': refused(500, 'internal') });
    await open('/overview/revenue');
    expect(document.querySelector('[data-part="earnings-fault"]')).not.toBeNull();
    expect(document.querySelector('[data-part="revenue-fault"]')).toBeNull();
    expect(rows('Revenue to date')).toHaveLength(1);
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
