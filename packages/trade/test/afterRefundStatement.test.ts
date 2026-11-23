// Review p4t22 M2: the after-refund "seller sends XMR" ruling is bound to the moderation key. The
// seller's app shows the pay form only for a statement that verifies against the pinned key, for
// this trade, this device's own amount and the buyer's attested address. A forged one gets nothing.
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  afterRefundStatementValid,
  rulingStatementBytes,
  signAfterRefundStatement,
  signRulingStatement,
  verifyAfterRefundStatement,
  type AfterRefundStatement,
  type RulingStatement,
} from '../src/index.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const BUYER = '4'.padEnd(95, 'B');
let mod: { publicKey: Uint8Array; privateKey: Uint8Array };
let pub: string;
beforeAll(async () => {
  await sodium.ready;
  mod = sodium.crypto_sign_keypair();
  pub = sodium.to_hex(mod.publicKey);
});
const statement = (o: Partial<AfterRefundStatement> = {}): AfterRefundStatement => ({
  v: 1, kind: 'after-refund', trade: CODE, round: 1, rulingId: '7f0c1f9e-0000-4000-8000-000000000001', outcome: 'seller-sends-xmr',
  amountAtomic: '1250000000000', buyerPayout: BUYER, issuedAt: '2026-11-23T10:00:00.000Z', ...o,
});
const want = { trade: CODE, amountAtomic: 1_250_000_000_000n, buyerPayout: BUYER };

describe('the after-refund ruling statement (review p4t22 M2)', () => {
  it('verifies under the pinned moderation key for this trade, amount and address (round 1 or 2)', async () => {
    for (const round of [1, 2] as const) {
      const s = statement({ round });
      expect(await verifyAfterRefundStatement(s, await signAfterRefundStatement(s, mod.privateKey), pub, want)).toEqual({ ok: true, statement: s });
    }
  });

  it('a forged statement gets nothing: another key, altered bytes, malformed', async () => {
    const s = statement();
    const other = sodium.crypto_sign_keypair();
    expect(afterRefundStatementValid(s, await signAfterRefundStatement(s, other.privateKey), pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
    const sig = await signAfterRefundStatement(s, mod.privateKey);
    expect(afterRefundStatementValid({ ...s, amountAtomic: '1' }, sig, pub, { ...want, amountAtomic: 1n })).toEqual({ ok: false, reason: 'bad-signature' });
    expect(afterRefundStatementValid({ ...s, extra: 1 }, sig, pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(afterRefundStatementValid({ ...s, outcome: 'no-action' }, sig, pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(afterRefundStatementValid(s, 'zz', pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(afterRefundStatementValid(null, sig, pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('an escrow ruling statement never passes for one (own domain), nor the reverse', async () => {
    const s = statement();
    const sig = await signAfterRefundStatement(s, mod.privateKey);
    // The same key over the escrow statement's domain is no after-refund signature.
    const escrow: RulingStatement = {
      v: 1, trade: CODE, escrowAddress: '5'.padEnd(95, 'E'), round: 1, rulingId: s.rulingId, outcome: 'release-to-buyer', winner: 'buyer',
      payouts: [{ address: BUYER, amountAtomic: s.amountAtomic }], issuedAt: s.issuedAt,
    };
    const escrowSig = await signRulingStatement(escrow, mod.privateKey);
    expect(afterRefundStatementValid(s, escrowSig, pub, want)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(sig), rulingStatementBytes(escrow), mod.publicKey)).toBe(false);
  });

  it('another trade, another amount or another address is refused, though validly signed', async () => {
    const s = statement();
    const sig = await signAfterRefundStatement(s, mod.privateKey);
    expect(afterRefundStatementValid(s, sig, pub, { ...want, trade: 'AAAA-BBBB-CCCC-DDDD' })).toEqual({ ok: false, reason: 'wrong-trade' });
    expect(afterRefundStatementValid(s, sig, pub, { ...want, amountAtomic: 1_250_000_000_001n })).toEqual({ ok: false, reason: 'wrong-amount' });
    expect(afterRefundStatementValid(s, sig, pub, { ...want, buyerPayout: '4'.padEnd(95, 'Z') })).toEqual({ ok: false, reason: 'wrong-address' });
  });
});
