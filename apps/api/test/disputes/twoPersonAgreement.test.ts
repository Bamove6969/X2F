// Review p4t22 M1 (security review of the dispute system, 23 Nov; the probe probe-p4t22-eur): the
// API's two-person rule and the moderation ruling gate's must agree, or the API publishes on one
// tap a ruling the gate refuses for good (`needs-second`) and the escrow coins are stranded. For
// every trade in the table, whenever the gate would ask for a second person the API asks too:
// `needsSecond(API) || !gateNeedsSecond(gate)`.
import { escrowPlan } from '@x2f/trade';
import { needsSecond, newDispute } from '@x2f/staff';
import { describe, expect, it } from 'vitest';
import { disputeUsdCents, gateValueOf } from '../../src/disputes/store.js';
import { gateNeedsSecond, recordedTerms } from '../../../moderation/src/gate/verify.js';
import { emptyGate } from '../../../moderation/src/gate/store.js';

const NONE = { kind: 'none' } as const;
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** A market quote: 1 XMR = `centsPerXmr` minor units of the trade's currency and `usd` US cents. */
const prices = (centsPerXmr: bigint, usd: bigint) => ({ quote: () => ({ price: { centsPerXmr }, usdCentsPerXmr: usd }) }) as never;

interface Case {
  name: string;
  currency: string;
  amountAtomic: bigint;
  centsPerXmr: bigint;
  /** The limit in whole dollars when the dispute opened, and now (the gate's, after its sync). */
  limitAtOpenUsd: number;
  limitNowUsd: number;
}

const XMR = 1_000_000_000_000n;
const CASES: Case[] = [
  { name: 'EUR 50 under the limit (the probe)', currency: 'EUR', amountAtomic: 333_333_333_333n, centsPerXmr: 15_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'GBP 900 under the limit', currency: 'GBP', amountAtomic: 3n * XMR, centsPerXmr: 30_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'CAD far under', currency: 'CAD', amountAtomic: XMR / 10n, centsPerXmr: 45_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'USD $412.50 well under', currency: 'USD', amountAtomic: 1_250_000_000_000n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'USD $700, the limit lowered to $500 after opening', currency: 'USD', amountAtomic: 2_121_212_121_212n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 500 },
  { name: 'USD $700, the limit raised to $2,000 after opening', currency: 'USD', amountAtomic: 2_121_212_121_212n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 2000 },
  { name: 'USD 99,999.3 cents: half-up is under, the gate rounds up', currency: 'USD', amountAtomic: 3_030_281_818_181n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'USD exactly at the limit', currency: 'USD', amountAtomic: 3_030_303_030_304n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
  { name: 'USD one cent under', currency: 'USD', amountAtomic: 3_030_272_727_272n, centsPerXmr: 33_000n, limitAtOpenUsd: 1000, limitNowUsd: 1000 },
];

/** The API side: the dispute as `startDispute` opens it, the rule as the propose route applies it. */
function api(c: Case): boolean {
  const fiatCents = (c.amountAtomic * c.centsPerXmr + XMR / 2n) / XMR; // money.ts's half-up fiat total
  const trade = { lockedRate: { currency: c.currency, centsPerXmr: c.centsPerXmr }, fiatCents, amountAtomic: c.amountAtomic };
  const limitAtOpen = BigInt(c.limitAtOpenUsd) * 100n;
  const usdCents = disputeUsdCents(trade as never, prices(c.centsPerXmr, 33_000n), limitAtOpen);
  const d = newDispute({ code: 'ABCDEFGH', openedBy: 'buyer', afterRefund: false, usdCents, limitUsdCents: limitAtOpen, firstResponseH: 4, now: new Date() });
  return needsSecond(d, 'release-to-buyer', NONE, gateValueOf(trade, c.limitNowUsd));
}

/** The gate side: its own recorded terms and its current limit. */
function gate(c: Case): boolean {
  const plan = escrowPlan({ amountAtomic: c.amountAtomic, poster: 'seller' });
  const terms = {
    deal: { poster: 'seller' as const, takeAmountAtomic: c.amountAtomic.toString(), currency: c.currency, centsPerXmr: c.centsPerXmr.toString(), maxFiatCents: '10000000', methodId: 'SEPA', instructionsSha256: SHA },
    payWindowMin: 90, buyerPayout: 'b', sellerRefund: 's',
  };
  const rec = recordedTerms({ terms: terms as never, trade: { amountAtomic: c.amountAtomic, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: 'f', payrollWallet: 'p' });
  return gateNeedsSecond({ ...emptyGate(), limitUsdCents: BigInt(c.limitNowUsd) * 100n }, rec, NONE);
}

describe('the API is never laxer than the ruling gate (review p4t22 M1)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(api(c) || !gate(c), `API ${api(c)}, gate ${gate(c)}`).toBe(true);
    });
  }

  it('the probe: a EUR trade under the limit needs a second person on both sides (lead default, OQ1)', () => {
    expect(api(CASES[0]!)).toBe(true);
    expect(gate(CASES[0]!)).toBe(true);
  });

  it('the same answer where the gate has its own value (USD), except where the snapshot is stricter', () => {
    for (const c of CASES.filter((x) => x.currency === 'USD')) {
      const stricterSnapshot = c.limitNowUsd > c.limitAtOpenUsd;
      if (!stricterSnapshot) expect(api(c), c.name).toBe(gate(c));
    }
  });
});
