import type { Outcome, Payout } from '@x2f/escrow';
import { escrowPlan, payoutsFor, type SettleKind, type TradeState } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { cosignPolicy, outcomeFor, type PolicyContext } from '../src/escrow/policy.js';

const BUYER = '4BuyerPayoutAddress';
const SELLER = '4SellerRefundAddress';
const FEE = '4FeeWalletAddress';
const ATTACKER = '4SomeoneElse';
const AMOUNT = 1_250_000_000_000n;

function ctx(role: 'buyer' | 'seller', o: { poster?: 'seller' | 'buyer'; balance?: bigint; state?: TradeState } = {}): PolicyContext {
  const poster = o.poster ?? 'seller';
  const { sellerFundsAtomic } = escrowPlan({ amountAtomic: AMOUNT, poster });
  return {
    role,
    own: role === 'buyer' ? { payout: BUYER } : { refund: SELLER },
    balance: o.balance ?? sellerFundsAtomic,
    trade: { state: o.state ?? 'secured', poster, amountAtomic: AMOUNT, feeWallet: FEE },
    signedTerms: { payout: BUYER, refund: SELLER },
  };
}

function expected(kind: SettleKind, c: PolicyContext): Payout[] {
  const plan = escrowPlan({ amountAtomic: c.trade.amountAtomic, poster: c.trade.poster });
  return payoutsFor({
    kind,
    amountAtomic: c.trade.amountAtomic,
    feeAtomic: plan.feeAtomic,
    poster: c.trade.poster,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic: c.balance,
    buyerPayout: BUYER,
    sellerRefund: SELLER,
    feeWallet: FEE,
  });
}

const out = (to: Payout[], builder: Outcome['builder'], cosigner: Outcome['cosigner']): Outcome => ({ kind: 'release', to, builder, cosigner });

describe('cosignPolicy: the shapes each side may settle', () => {
  it.each(['seller', 'buyer'] as const)('buyer co-signs a seller-built release equal to payoutsFor(release) (poster %s)', (poster) => {
    const c = ctx('buyer', { poster });
    const to = expected('release', c);
    expect(to[0]!.address).toBe(BUYER);
    expect(cosignPolicy(c, out(to, 'seller', 'buyer'))).toBe(true);
  });

  it('buyer co-signs a seller-built lapse refund on a lapsed, underfunded escrow', () => {
    const c = ctx('buyer', { state: 'lapsed', balance: 400_000_000_000n });
    expect(cosignPolicy(c, out(expected('lapse-refund', c), 'seller', 'buyer'))).toBe(true);
  });

  it('buyer builds its own buyer-cancel with the moderator as co-signer', () => {
    const c = ctx('buyer', { state: 'paid' });
    expect(cosignPolicy(c, out(expected('buyer-cancel', c), 'buyer', 'mod'))).toBe(true);
  });

  it('buyer builds a mutual cancel for the seller to co-sign', () => {
    const c = ctx('buyer');
    expect(cosignPolicy(c, out(expected('mutual-cancel', c), 'buyer', 'seller'))).toBe(true);
  });

  it('seller co-signs a buyer-built mutual cancel', () => {
    const c = ctx('seller');
    expect(cosignPolicy(c, out(expected('mutual-cancel', c), 'buyer', 'seller'))).toBe(true);
  });

  it('seller builds the release, the lapse refund and the no-show refund', () => {
    expect(cosignPolicy(ctx('seller', { state: 'paid' }), out(expected('release', ctx('seller')), 'seller', 'buyer'))).toBe(true);
    const lapsed = ctx('seller', { state: 'lapsed', balance: 1n });
    expect(cosignPolicy(lapsed, out(expected('lapse-refund', lapsed), 'seller', 'buyer'))).toBe(true);
    const noShow = ctx('seller', { state: 'refund_requested' });
    expect(cosignPolicy(noShow, out(expected('auto-refund', noShow), 'seller', 'mod'))).toBe(true);
  });

  it('either side co-signs a mod-built tx that pays its own side in full to its own address', () => {
    const b = ctx('buyer', { state: 'disputed' });
    expect(cosignPolicy(b, out(expected('release', b), 'mod', 'buyer'))).toBe(true);
    const s = ctx('seller', { state: 'disputed' });
    expect(cosignPolicy(s, out(expected('mutual-cancel', s), 'mod', 'seller'))).toBe(true);
  });

  it('a late surplus is re-derived: the outcome for the new balance is allowed, the old one is not', () => {
    const before = ctx('buyer');
    const after = ctx('buyer', { balance: before.balance + 100_000_000n });
    const old = out(expected('release', before), 'seller', 'buyer');
    expect(cosignPolicy(after, old)).toBe(false);
    expect(cosignPolicy(after, out(expected('release', after), 'seller', 'buyer'))).toBe(true);
    // The surplus is its own output to the seller (Revision 2026-10-20).
    expect(expected('release', after).at(-1)).toEqual({ address: SELLER, amountAtomic: 100_000_000n });
  });
});

describe('cosignPolicy refuses', () => {
  it('a lapse refund to another address', () => {
    const c = ctx('buyer', { state: 'lapsed', balance: 400_000_000_000n });
    expect(cosignPolicy(c, out([{ address: ATTACKER, amountAtomic: c.balance }], 'seller', 'buyer'))).toBe(false);
  });

  it('any extra output', () => {
    const c = ctx('buyer');
    const to = expected('release', c);
    const first = to[0]!;
    const extra = [{ ...first, amountAtomic: first.amountAtomic - 1n }, ...to.slice(1), { address: ATTACKER, amountAtomic: 1n }];
    expect(cosignPolicy(c, out(extra, 'seller', 'buyer'))).toBe(false);
    const lapsed = ctx('buyer', { state: 'lapsed', balance: 10n });
    expect(cosignPolicy(lapsed, out([{ address: SELLER, amountAtomic: 9n }, { address: FEE, amountAtomic: 1n }], 'seller', 'buyer'))).toBe(false);
  });

  it('a release whose buyer output differs by one atomic unit', () => {
    const c = ctx('buyer');
    const to = expected('release', c);
    for (const d of [1n, -1n]) {
      const moved = to.map((p, i) => (i === 0 ? { ...p, amountAtomic: p.amountAtomic + d } : i === 1 ? { ...p, amountAtomic: p.amountAtomic - d } : p));
      expect(cosignPolicy(c, out(moved, 'seller', 'buyer'))).toBe(false);
      expect(cosignPolicy(ctx('seller'), out(moved, 'seller', 'buyer'))).toBe(false);
    }
  });

  // The plan's list says "a surplus paid to the taker instead of the poster"; Revision 2026-10-20 sends
  // every surplus to the seller, so the refused shape is a surplus paid to anyone but the seller.
  it('a surplus paid to anyone but the seller (buyer-poster release with the surplus added to the buyer)', () => {
    const exact = escrowPlan({ amountAtomic: AMOUNT, poster: 'buyer' });
    const c = ctx('buyer', { poster: 'buyer', balance: exact.sellerFundsAtomic + 100_000_000n });
    const toBuyer = AMOUNT - exact.feeAtomic + 100_000_000n;
    const wrong = [
      { address: BUYER, amountAtomic: toBuyer },
      { address: FEE, amountAtomic: exact.feeAtomic },
    ];
    expect(cosignPolicy(c, out(wrong, 'seller', 'buyer'))).toBe(false);
    expect(cosignPolicy(ctx('seller', { poster: 'buyer', balance: c.balance }), out(wrong, 'seller', 'buyer'))).toBe(false);
    // ... and a seller-poster release with the surplus paid to the buyer.
    const s = ctx('seller', { balance: escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }).sellerFundsAtomic + 5n });
    expect(cosignPolicy(s, out([{ address: BUYER, amountAtomic: AMOUNT + 5n }, { address: FEE, amountAtomic: exact.feeAtomic }], 'seller', 'buyer'))).toBe(false);
  });

  it('a buyer-cancel outcome from the seller’s app', () => {
    const c = ctx('seller', { state: 'paid' });
    expect(cosignPolicy(c, out(expected('buyer-cancel', c), 'buyer', 'mod'))).toBe(false);
    expect(cosignPolicy(c, out(expected('buyer-cancel', c), 'seller', 'mod'))).toBe(false);
  });

  it('a mod-built tx paying the counterparty from this side’s share', () => {
    const b = ctx('buyer', { state: 'disputed' });
    const rel = expected('release', b);
    const shaved = [{ ...rel[0]!, amountAtomic: rel[0]!.amountAtomic - 1_000_000n }, rel[1]!, { address: SELLER, amountAtomic: 1_000_000n }];
    expect(cosignPolicy(b, out(shaved, 'mod', 'buyer'))).toBe(false);
    const s = ctx('seller', { state: 'disputed' });
    const split = [
      { address: SELLER, amountAtomic: s.balance - 1_000_000n },
      { address: BUYER, amountAtomic: 1_000_000n },
    ];
    expect(cosignPolicy(s, out(split, 'mod', 'seller'))).toBe(false);
    // A mod-built tx paying everything to the counterparty is never co-signed either.
    expect(cosignPolicy(b, out(expected('mutual-cancel', b), 'mod', 'buyer'))).toBe(false);
    expect(cosignPolicy(s, out(expected('release', s), 'mod', 'seller'))).toBe(false);
  });

  it('a lapse refund the buyer is asked to co-sign while the API says lapsed but the escrow is fully funded', () => {
    const c = ctx('buyer', { state: 'lapsed' });
    expect(cosignPolicy(c, out(expected('lapse-refund', c), 'seller', 'buyer'))).toBe(false);
    const notLapsed = ctx('buyer', { state: 'secured', balance: 1n });
    expect(cosignPolicy(notLapsed, out(expected('lapse-refund', notLapsed), 'seller', 'buyer'))).toBe(false);
  });

  it('a no-show refund outside refund_requested', () => {
    const c = ctx('seller', { state: 'secured' });
    expect(cosignPolicy(c, out(expected('auto-refund', c), 'seller', 'mod'))).toBe(false);
  });

  it('own address that is not the one this side signed, a zero or unread balance, or an outcome this side is not part of', () => {
    const c = ctx('buyer');
    const rel = out(expected('release', c), 'seller', 'buyer');
    expect(cosignPolicy({ ...c, own: { payout: ATTACKER } }, rel)).toBe(false);
    expect(cosignPolicy({ ...c, own: {} }, rel)).toBe(false);
    expect(cosignPolicy({ ...c, balance: 0n }, rel)).toBe(false);
    expect(cosignPolicy(c, out(expected('release', c), 'seller', 'mod'))).toBe(false);
    expect(cosignPolicy({ ...c, role: 'mod' as never }, rel)).toBe(false);
    expect(cosignPolicy(c, { ...rel, kind: 'other' as never })).toBe(false);
  });

  it('outputs in another order (index 0 bears the network fee)', () => {
    const c = ctx('buyer');
    const rel = expected('release', c);
    expect(cosignPolicy(c, out([...rel].reverse(), 'seller', 'buyer'))).toBe(false);
  });
});

describe('outcomeFor', () => {
  it('derives the outcomes the policy allows, and null when it would not', () => {
    const b = ctx('buyer', { state: 'paid' });
    const cancel = outcomeFor('buyer-cancel', b);
    expect(cancel).toEqual(out(expected('buyer-cancel', b), 'buyer', 'mod'));
    expect(outcomeFor('release', ctx('seller', { state: 'paid' }))).toEqual(out(expected('release', b), 'seller', 'buyer'));
    expect(outcomeFor('buyer-cancel', ctx('seller', { state: 'paid' }))).toBeNull();
    expect(outcomeFor('release', { ...b, balance: 1n })).toBeNull();
  });
});
