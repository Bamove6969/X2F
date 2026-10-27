// Pure checks behind TradeFund (Task 22): the integrity guard, the amount to send, the view parser.
import { describe, expect, it } from 'vitest';
import { parseTradeView, TradeShapeError } from '../src/api/trade.js';
import { fundedForGood } from '../src/screens/trade/fund.js';
import { amountToSend, integrityFailed } from '../src/screens/trade/seams.js';

const ADDRESS = '4' + 'A'.repeat(94);

describe('integrityFailed', () => {
  it('runs the amount guard even before this device has its deal (review 2026-10-27, Minor 5)', () => {
    const e = { error: null, escrowAddress: ADDRESS, deal: null } as const;
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1.25' } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '' } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1'.repeat(31) } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1250000000000' } })).toBe(false);
  });
});

describe('amountToSend', () => {
  const funds = 1_250_000_000_000n;
  it('is the whole funding while nothing has arrived anywhere', () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: null }, 0n)).toBe(funds);
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 0n }, 0n)).toBe(funds);
  });
  it("is the remainder of this device's own reading", () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 1_000_000_000_000n }, 0n)).toBe(250_000_000_000n);
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 1_000_000_000_000n }, 1_000_000_000_000n)).toBe(250_000_000_000n);
  });
  it('is nothing while only the API says part arrived, or once the device reading covers the funding', () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: null }, 1_000_000_000_000n)).toBeNull();
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 0n }, 1_000_000_000_000n)).toBeNull();
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: funds }, 0n)).toBeNull();
  });
  it('is nothing while the API has seen MORE than this device (a lagging reading never asks for too much; re-review 2026-10-27)', () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 500_000_000_000n }, 1_000_000_000_000n)).toBeNull();
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 500_000_000_000n }, funds)).toBeNull();
    // The API behind the device is fine: the device's reading rules.
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 1_000_000_000_000n }, 500_000_000_000n)).toBe(250_000_000_000n);
  });
});

describe('fundedForGood (re-review 2026-10-27, Minor 2)', () => {
  const view = (over: Record<string, unknown> = {}) =>
    ({ state: 'funding', receivedAtomic: '0', confirmations: 0, amountAtomic: '1250000000000', funding: { sellerFundsAtomic: '1250000000000', escrowAddress: null, uri: null, walletApp: null }, ...over }) as Parameters<typeof fundedForGood>[0];
  const funds = 1_250_000_000_000n;
  it("never from this device's 0-conf reading", () => {
    expect(fundedForGood(view(), { confirmedAtomic: 0n, fundsAtomic: funds })).toBe(false);
    expect(fundedForGood(view(), { confirmedAtomic: null, fundsAtomic: funds })).toBe(false);
  });
  it('from a confirmed device balance, API confirmations >= 1, or a state past funding', () => {
    expect(fundedForGood(view(), { confirmedAtomic: funds, fundsAtomic: funds })).toBe(true);
    expect(fundedForGood(view({ receivedAtomic: '1250000000000', confirmations: 1 }), { confirmedAtomic: null, fundsAtomic: null })).toBe(true);
    expect(fundedForGood(view({ receivedAtomic: '1250000000000', confirmations: 0 }), { confirmedAtomic: null, fundsAtomic: null })).toBe(false);
    expect(fundedForGood(view({ state: 'securing', funding: null }), { confirmedAtomic: null, fundsAtomic: null })).toBe(true);
  });
});

describe('parseTradeView (review 2026-10-27, Minor 5)', () => {
  const view = {
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '50000',
    grown: null,
    receivedAtomic: '0',
    funding: { sellerFundsAtomic: '1250000000000', escrowAddress: ADDRESS, uri: null, walletApp: null },
  };
  it('accepts plain digit strings and returns the view', () => {
    expect(parseTradeView(view)).toBe(view);
    expect(parseTradeView({ ...view, fee: { atomic: '0' }, grown: { at: 'x', fromAtomic: '1', fromFiatCents: '2' }, funding: null })).toBeDefined();
  });
  for (const [name, bad] of [
    ['non-digits', { receivedAtomic: '1_000' }],
    ['a sign', { fiatCents: '+1' }],
    ['a decimal point', { amountAtomic: '1.0' }],
    ['empty', { maxFiatCents: '' }],
    ['31 digits', { amountAtomic: '1'.repeat(31) }],
    ['a number instead of a string', { receivedAtomic: 0 }],
    ['a bad fee', { fee: { atomic: 'free' } }],
    ['a bad grown', { grown: { at: 'x', fromAtomic: 'a', fromFiatCents: '2' } }],
    ['a bad funding amount', { funding: { ...view.funding, sellerFundsAtomic: '0x10' } }],
    ['a bad rate', { lockedRate: { currency: 'USD', centsPerXmr: 'NaN' } }],
    ['no body', null],
  ] as [string, unknown][]) {
    it(`refuses ${name} with TradeShapeError`, () => {
      const v = bad !== null && typeof bad === 'object' ? { ...view, ...bad } : bad;
      expect(() => parseTradeView(v)).toThrow(TradeShapeError);
    });
  }
});

describe('one QR library in the web app (re-review 2026-10-27, item 4)', () => {
  it("TradeFund's QR code uses Task 30's qrcode-generator, and qrcode is gone from the dependencies", async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as Record<string, Record<string, string>>;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all)).not.toContain('qrcode');
    expect(Object.keys(all)).not.toContain('@types/qrcode');
    expect(all['qrcode-generator']).toBeDefined();
    const src = readFileSync(fileURLToPath(new URL('../src/screens/trade/FundFallback.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/from 'qrcode-generator'/);
  });

  it('qrPath draws the code with the standard 4-module quiet zone', async () => {
    const { qrPath } = await import('../src/screens/trade/FundFallback.js');
    const p = qrPath('monero:4' + 'A'.repeat(94) + '?tx_amount=1.2625');
    // Version sizes are 17 + 4v modules; plus 8 for the quiet zone.
    expect((p.size - 8 - 17) % 4).toBe(0);
    expect(p.d.startsWith('M4 4h1v1h-1z')).toBe(true); // the top-left finder starts at the quiet zone's edge
  });
});
