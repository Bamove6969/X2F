import type { Outcome, Payout } from '@x2f/escrow';
import { escrowPlan, payoutsFor, rulingStatementBytes, type RulingKind, type RulingStatement, type SettleKind, type TradeState } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { cosignPolicy, deviceAmount, outcomeFor, type Deal, type PolicyContext } from '../src/escrow/policy.js';

const BUYER = '4BuyerPayoutAddress';
const SELLER = '4SellerRefundAddress';
const FEE = '4FeeWalletAddress';
const ATTACKER = '4SomeoneElse';
const AMOUNT = 1_250_000_000_000n;

const CODE = 'AB12-CD34-EF56-GH78';
const ESCROW = '5EscrowMultisigAddress';
let mod: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
  await sodium.ready;
  mod = sodium.crypto_sign_keypair();
});

/**
 * Haveno review 2026-11-12, finding 2: the moderation service's signed ruling statement for this
 * trade and escrow, paying `to` (default: this side's ruling set worked out on this device).
 */
function statementFor(c: Omit<PolicyContext, 'ruling'>, o: { to?: Payout[]; winner?: 'buyer' | 'seller'; over?: Partial<RulingStatement>; key?: Uint8Array } = {}): NonNullable<PolicyContext['ruling']> {
  const winner = o.winner ?? c.role;
  const to = o.to ?? expected(winner === 'buyer' ? 'dispute-buyer' : 'dispute-seller', c as PolicyContext);
  const statement: RulingStatement = {
    v: 1, trade: CODE, escrowAddress: ESCROW, round: 1, rulingId: '7f0c1f9e-0000-4000-8000-000000000001',
    outcome: winner === 'buyer' ? 'release-to-buyer' : 'refund-to-seller', winner,
    payouts: to.map((p) => ({ address: p.address, amountAtomic: p.amountAtomic.toString() })), issuedAt: '2026-11-12T10:00:00.000Z', ...o.over,
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(rulingStatementBytes(statement), o.key ?? mod.privateKey));
  return { code: CODE, escrowAddress: ESCROW, modSigningPublic: sodium.to_hex(mod.publicKey), statement, sig };
}

/** A context; while disputed it carries this side's verified ruling statement unless `ruling` says otherwise. */
function ctx(role: 'buyer' | 'seller', o: { poster?: 'seller' | 'buyer'; balance?: bigint; state?: TradeState; paidAt?: string | null; settling?: string | null; ruling?: PolicyContext['ruling'] } = {}): PolicyContext {
  const poster = o.poster ?? 'seller';
  const { sellerFundsAtomic } = escrowPlan({ amountAtomic: AMOUNT, poster });
  const c: PolicyContext = {
    role,
    own: role === 'buyer' ? { payout: BUYER } : { refund: SELLER },
    balance: o.balance ?? sellerFundsAtomic,
    trade: { state: o.state ?? 'secured', poster, amountAtomic: AMOUNT, feeWallet: FEE, paidAt: o.paidAt ?? null, settling: o.settling ?? null },
    deal: { poster, amountAtomic: AMOUNT },
    signedTerms: { payout: BUYER, refund: SELLER },
  };
  if (o.ruling !== undefined) return { ...c, ruling: o.ruling };
  return c.trade.state === 'disputed' ? { ...c, ruling: statementFor(c) } : c;
}

function expected(kind: SettleKind | RulingKind, c: PolicyContext): Payout[] {
  const plan = escrowPlan({ amountAtomic: c.deal.amountAtomic, poster: c.deal.poster });
  return payoutsFor({
    kind,
    amountAtomic: c.deal.amountAtomic,
    feeAtomic: plan.feeAtomic,
    poster: c.deal.poster,
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
    const c = ctx('buyer', { state: 'secured' });
    expect(cosignPolicy(c, out(expected('buyer-cancel', c), 'buyer', 'mod'))).toBe(true);
  });

  it("never a buyer-cancel once the trade is paid: no cancel after I've paid (Task 39 review I2)", () => {
    const c = ctx('buyer', { state: 'paid' });
    expect(cosignPolicy(c, out(expected('buyer-cancel', c), 'buyer', 'mod'))).toBe(false);
  });

  it('buyer builds a mutual cancel for the seller to co-sign', () => {
    const c = ctx('buyer');
    expect(cosignPolicy(c, out(expected('mutual-cancel', c), 'buyer', 'seller'))).toBe(true);
  });

  it("never a mutual cancel from the buyer once paid, nor after paid in a later state (review round 2 N4)", () => {
    const paid = ctx('buyer', { state: 'paid', paidAt: '2026-10-30T10:00:00.000Z' });
    expect(cosignPolicy(paid, out(expected('mutual-cancel', paid), 'buyer', 'seller'))).toBe(false);
    const settling = ctx('buyer', { state: 'settling', paidAt: '2026-10-30T10:00:00.000Z' });
    expect(cosignPolicy(settling, out(expected('mutual-cancel', settling), 'buyer', 'seller'))).toBe(false);
  });

  it('seller co-signs a buyer-built mutual cancel', () => {
    const c = ctx('seller');
    expect(cosignPolicy(c, out(expected('mutual-cancel', c), 'buyer', 'seller'))).toBe(true);
  });

  it("seller builds the release, the lapse refund and the refund of its own cancel after the time to pay", () => {
    expect(cosignPolicy(ctx('seller', { state: 'paid' }), out(expected('release', ctx('seller')), 'seller', 'buyer'))).toBe(true);
    const lapsed = ctx('seller', { state: 'lapsed', balance: 1n });
    expect(cosignPolicy(lapsed, out(expected('lapse-refund', lapsed), 'seller', 'buyer'))).toBe(true);
    const noShow = ctx('seller', { state: 'settling', settling: 'auto-refund' });
    expect(cosignPolicy(noShow, out(expected('auto-refund', noShow), 'seller', 'mod'))).toBe(true);
  });

  // Plan 4 Task 15 with Revision 2026-10-29c "Fees on settled disputes" (the poster pays the 1%).
  it.each(['seller', 'buyer'] as const)('the buyer co-signs a mod-built buyer win: its own payout first, then the exact fee (poster %s)', (poster) => {
    const b = ctx('buyer', { state: 'disputed', poster });
    const to = expected('dispute-buyer', b);
    expect(to[0]!.address).toBe(BUYER);
    expect(to[1]).toEqual({ address: FEE, amountAtomic: escrowPlan({ amountAtomic: AMOUNT, poster }).feeAtomic });
    expect(cosignPolicy(b, out(to, 'mod', 'buyer'))).toBe(true);
  });

  // Owner g63 (7 Nov): a full reversal pays no fee, whoever posted.
  it.each(['seller', 'buyer'] as const)('the seller co-signs a mod-built seller win: the whole balance back, no fee (poster %s)', (poster) => {
    const s = ctx('seller', { state: 'disputed', poster });
    expect(expected('dispute-seller', s)).toEqual([{ address: SELLER, amountAtomic: s.balance }]);
    expect(cosignPolicy(s, out(expected('dispute-seller', s), 'mod', 'seller'))).toBe(true);
    // A set that takes the 1% out of the reversal is not the ruling's.
    const fee = escrowPlan({ amountAtomic: AMOUNT, poster }).feeAtomic;
    const withFee = [
      { address: SELLER, amountAtomic: s.balance - fee },
      { address: FEE, amountAtomic: fee },
    ];
    expect(cosignPolicy(s, out(withFee, 'mod', 'seller'))).toBe(false);
  });

  it("refuses the buyer's ruling set with the fee one atomic unit off, either way (the seller's carries no fee, owner g63)", () => {
    const b = ctx('buyer', { state: 'disputed' });
    for (const [c, kind, cosigner] of [[b, 'dispute-buyer', 'buyer']] as const) {
      const to = expected(kind, c);
      for (const d of [1n, -1n]) {
        const off = to.map((p) => (p.address === FEE ? { ...p, amountAtomic: p.amountAtomic + d } : p));
        expect(cosignPolicy(c, out(off, 'mod', cosigner)), `${kind} ${d}`).toBe(false);
        // Even when the difference is moved to this side's own output.
        const moved = off.map((p, i) => (i === 0 ? { ...p, amountAtomic: p.amountAtomic - d } : p));
        expect(cosignPolicy(c, out(moved, 'mod', cosigner)), `${kind} ${d} moved`).toBe(false);
      }
    }
  });

  it('refuses a ruling set paying the other side, and any ruling set outside a dispute', () => {
    const b = ctx('buyer', { state: 'disputed' });
    expect(cosignPolicy(b, out(expected('dispute-seller', b), 'mod', 'buyer'))).toBe(false);
    const s = ctx('seller', { state: 'disputed' });
    expect(cosignPolicy(s, out(expected('dispute-buyer', s), 'mod', 'seller'))).toBe(false);
    for (const state of ['secured', 'paid', 'settling', 'released', 'refunded'] as const) {
      expect(cosignPolicy(ctx('buyer', { state }), out(expected('dispute-buyer', ctx('buyer', { state })), 'mod', 'buyer')), state).toBe(false);
      expect(cosignPolicy(ctx('seller', { state }), out(expected('dispute-seller', ctx('seller', { state })), 'mod', 'seller')), state).toBe(false);
    }
  });

  // Haveno review 2026-11-12, finding 2 (lead call): the API's unsigned "disputed" is not enough.
  it.each(['buyer', 'seller'] as const)('the %s co-signs a ruling set only against the moderator\'s verified statement, never on the API\'s "disputed" alone', (role) => {
    const kind = role === 'buyer' ? 'dispute-buyer' : 'dispute-seller';
    const base = ctx(role, { state: 'disputed', ruling: null });
    const o = out(expected(kind, base), 'mod', role);
    expect(cosignPolicy(base, o)).toBe(false);
    const { ruling: _none, ...noField } = base;
    expect(cosignPolicy(noField, o)).toBe(false);
    expect(cosignPolicy({ ...base, ruling: statementFor(base) }, o)).toBe(true);
  });

  it.each(['buyer', 'seller'] as const)('%s: a forged ruling (another key, or changed after signing) is refused', (role) => {
    const base = ctx(role, { state: 'disputed', ruling: null });
    const o = out(expected(role === 'buyer' ? 'dispute-buyer' : 'dispute-seller', base), 'mod', role);
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { key: sodium.crypto_sign_keypair().privateKey }) }, o)).toBe(false);
    const good = statementFor(base);
    expect(cosignPolicy({ ...base, ruling: { ...good, statement: { ...(good.statement as RulingStatement), issuedAt: '2026-11-13T10:00:00.000Z' } } }, o)).toBe(false);
    // The key the statement names must be the pinned one (this device's build config), never one the API gives.
    expect(cosignPolicy({ ...base, ruling: { ...good, modSigningPublic: sodium.to_hex(sodium.crypto_sign_keypair().publicKey) } }, o)).toBe(false);
  });

  it.each(['buyer', 'seller'] as const)('%s: a ruling replayed from another trade, or for another escrow, is refused', (role) => {
    const base = ctx(role, { state: 'disputed', ruling: null });
    const o = out(expected(role === 'buyer' ? 'dispute-buyer' : 'dispute-seller', base), 'mod', role);
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { over: { trade: 'ZZ12-CD34-EF56-GH78' } }) }, o)).toBe(false);
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { over: { escrowAddress: '5AnotherEscrow' } }) }, o)).toBe(false);
  });

  it.each(['buyer', 'seller'] as const)('%s: a stale round (a round-2 statement) is refused: only round 1 pays', (role) => {
    const base = ctx(role, { state: 'disputed', ruling: null });
    const o = out(expected(role === 'buyer' ? 'dispute-buyer' : 'dispute-seller', base), 'mod', role);
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { over: { round: 2 } }) }, o)).toBe(false);
  });

  it.each(['buyer', 'seller'] as const)('%s: an altered payout is refused: the statement and the set must both equal this device\'s own', (role) => {
    const kind = role === 'buyer' ? 'dispute-buyer' : 'dispute-seller';
    const base = ctx(role, { state: 'disputed', ruling: null });
    const mine = expected(kind, base);
    const o = out(mine, 'mod', role);
    // A statement paying one atomic unit less to this side.
    const shaved = mine.map((p, i) => (i === 0 ? { ...p, amountAtomic: p.amountAtomic - 1n } : p));
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { to: shaved }) }, o)).toBe(false);
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { to: shaved }) }, out(shaved, 'mod', role))).toBe(false);
    // A statement naming the other side the winner.
    expect(cosignPolicy({ ...base, ruling: statementFor(base, { winner: role === 'buyer' ? 'seller' : 'buyer', to: mine }) }, o)).toBe(false);
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

  it("the seller's cancel refund only while the trade settles it (owner 8 Nov), never after I've paid", () => {
    for (const c of [
      ctx('seller', { state: 'secured' }),
      ctx('seller', { state: 'paid' }),
      ctx('seller', { state: 'settling', settling: 'release' }),
      ctx('seller', { state: 'settling', settling: 'buyer-cancel' }),
      ctx('seller', { state: 'settling', settling: 'auto-refund', paidAt: '2026-10-25T13:00:00.000Z' }),
      ctx('seller', { state: 'disputed', settling: 'auto-refund' }),
    ]) {
      expect(cosignPolicy(c, out(expected('auto-refund', c), 'seller', 'mod')), `${c.trade.state}/${c.trade.settling}/${c.trade.paidAt}`).toBe(false);
    }
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

describe('the trade size comes from this device, never the API', () => {
  it('a TradeView with the amount one atomic unit off, or the poster swapped, refuses every outcome', () => {
    const states: TradeState[] = ['secured', 'paid', 'lapsed', 'settling', 'disputed'];
    for (const role of ['buyer', 'seller'] as const) {
      for (const state of states) {
        const c = ctx(role, { state, settling: state === 'settling' ? 'auto-refund' : null });
        const cases: PolicyContext[] = [
          { ...c, trade: { ...c.trade, amountAtomic: AMOUNT + 1n } },
          { ...c, trade: { ...c.trade, amountAtomic: AMOUNT - 1n } },
          { ...c, trade: { ...c.trade, poster: 'buyer' } },
        ];
        for (const kind of ['release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'] as const) {
          for (const lied of cases) {
            // Even an outcome derived from the lied-about view (the API and the counterparty agreeing).
            const fromLie = { ...lied, deal: { poster: lied.trade.poster, amountAtomic: lied.trade.amountAtomic } };
            for (const builder of ['buyer', 'seller', 'mod'] as const) {
              for (const cosigner of ['buyer', 'seller', 'mod'] as const) {
                let to: Payout[];
                try {
                  to = expected(kind, fromLie);
                } catch {
                  continue;
                }
                expect(cosignPolicy(lied, out(to, builder, cosigner)), `${role} ${state} ${kind} ${builder}/${cosigner}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  const deal: Deal = { poster: 'seller', takeAmountAtomic: AMOUNT, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
  const funds = (a: bigint) => escrowPlan({ amountAtomic: a, poster: 'seller' }).sellerFundsAtomic;

  it('deviceAmount: exact funding keeps the take amount; releasable extra within the maximum grows it', () => {
    expect(deviceAmount(deal, AMOUNT, funds(AMOUNT), funds(AMOUNT))).toBe(AMOUNT);
    const grown = 1_300_000_000_000n;
    expect(deviceAmount(deal, AMOUNT, funds(grown), funds(grown))).toBe(grown);
    // The largest A' with A' + fee(A') <= balance; any dust left over stays the seller's.
    const b = funds(grown) + 7n;
    const a = deviceAmount(deal, AMOUNT, b, b);
    expect(funds(a) <= b && funds(a + 1n) > b).toBe(true);
  });

  it('deviceAmount: locked extra never grows it; a dropped extra shrinks it back; above the maximum it keeps its size', () => {
    const grown = 1_300_000_000_000n;
    expect(deviceAmount(deal, AMOUNT, funds(grown), funds(AMOUNT))).toBe(AMOUNT);
    expect(deviceAmount(deal, grown, funds(AMOUNT), funds(AMOUNT))).toBe(AMOUNT);
    expect(deviceAmount(deal, grown, funds(grown) + 5n, funds(grown))).toBe(grown);
    const huge = 2_000_000_000_000n; // $660 > $500 maximum
    expect(deviceAmount(deal, AMOUNT, funds(huge), funds(huge))).toBe(AMOUNT);
    expect(deviceAmount({ ...deal, poster: 'buyer' }, AMOUNT, grown, grown)).toBe(grown);
  });
});

describe('outcomeFor', () => {
  it('derives the outcomes the policy allows, and null when it would not', () => {
    const b = ctx('buyer', { state: 'secured' });
    const cancel = outcomeFor('buyer-cancel', b);
    expect(cancel).toEqual(out(expected('buyer-cancel', b), 'buyer', 'mod'));
    expect(outcomeFor('buyer-cancel', ctx('buyer', { state: 'paid' }))).toBeNull();
    expect(outcomeFor('release', ctx('seller', { state: 'paid' }))).toEqual(out(expected('release', b), 'seller', 'buyer'));
    expect(outcomeFor('buyer-cancel', ctx('seller', { state: 'paid' }))).toBeNull();
    expect(outcomeFor('release', { ...b, balance: 1n })).toBeNull();
  });
});
