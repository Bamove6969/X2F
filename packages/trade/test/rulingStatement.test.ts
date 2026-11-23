// RetoSwap/Haveno review 2026-11-12, finding 2 (lead call): the ruling a trader's device co-signs
// against is the moderation service's own signed statement, bound to the trade code, the escrow
// address and the dispute round, with the payouts the moderator worked out itself. Each test is
// one of the review's attacks: a forged ruling, a ruling replayed from another trade, a stale
// round, an altered payout.
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  isRulingStatement,
  rulingStatementBytes,
  rulingStatementValid,
  signRulingStatement,
  verifyRulingStatement,
  type RulingStatement,
} from '../src/index.js';

const TRADE = 'AB12-CD34-EF56-GH78';
const OTHER = 'ZZ12-CD34-EF56-GH78';
const ESCROW = '5'.padEnd(95, 'E');
const BUYER = '4'.padEnd(95, 'B');
const FEE = '4'.padEnd(95, 'F');

let mod: { publicKey: Uint8Array; privateKey: Uint8Array };
let modPublic: string;
beforeAll(async () => {
  await sodium.ready;
  mod = sodium.crypto_sign_keypair();
  modPublic = sodium.to_hex(mod.publicKey);
});

const statement = (o: Partial<RulingStatement> = {}): RulingStatement => ({
  v: 1,
  trade: TRADE,
  escrowAddress: ESCROW,
  round: 1,
  rulingId: '7f0c1f9e-0000-4000-8000-000000000001',
  outcome: 'release-to-buyer',
  winner: 'buyer',
  payouts: [
    { address: BUYER, amountAtomic: '249000000000' },
    { address: FEE, amountAtomic: '1000000000' },
  ],
  issuedAt: '2026-11-12T10:00:00.000Z',
  ...o,
});
const want = { trade: TRADE, escrowAddress: ESCROW, winner: 'buyer' as const, payouts: [{ address: BUYER, amountAtomic: 249_000_000_000n }, { address: FEE, amountAtomic: 1_000_000_000n }] };

describe('the ruling statement (Haveno review finding 2)', () => {
  it('signs over a domain-separated canonical encoding and verifies for its own trade, escrow, winner and payouts', async () => {
    const s = statement();
    const sig = await signRulingStatement(s, mod.privateKey);
    expect(new TextDecoder().decode(rulingStatementBytes(s)).startsWith('x2f/ruling-statement/v1\0')).toBe(true);
    expect(isRulingStatement(s)).toBe(true);
    expect(rulingStatementValid(s, sig, modPublic, want)).toEqual({ ok: true, statement: s });
    expect(await verifyRulingStatement(s, sig, modPublic, want)).toEqual({ ok: true, statement: s });
  });

  it('a forged ruling: signed by another key, or the statement changed after signing, is refused', async () => {
    const s = statement();
    const forger = sodium.crypto_sign_keypair();
    expect(rulingStatementValid(s, await signRulingStatement(s, forger.privateKey), modPublic, want)).toEqual({ ok: false, reason: 'bad-signature' });
    const sig = await signRulingStatement(s, mod.privateKey);
    expect(rulingStatementValid({ ...s, winner: 'seller', outcome: 'refund-to-seller' }, sig, modPublic, { ...want, winner: 'seller' })).toEqual({ ok: false, reason: 'bad-signature' });
    // An attestation signature over the same JSON (another domain) is no ruling.
    const attestationSig = sodium.to_hex(sodium.crypto_sign_detached(new TextEncoder().encode(`x2f/attestation/v1\0${new TextDecoder().decode(rulingStatementBytes(s)).slice('x2f/ruling-statement/v1\0'.length)}`), mod.privateKey));
    expect(rulingStatementValid(s, attestationSig, modPublic, want)).toEqual({ ok: false, reason: 'bad-signature' });
    for (const bad of [null, 'x', 42, { ...s, extra: 1 }, { ...s, round: 3 }, { ...s, payouts: [] }, { ...s, payouts: [{ address: BUYER, amountAtomic: '-1' }] }]) {
      expect(rulingStatementValid(bad, sig, modPublic, want)).toEqual({ ok: false, reason: 'bad-signature' });
    }
  });

  it('a ruling replayed from another trade (or another escrow) is refused, though validly signed', async () => {
    const other = statement({ trade: OTHER });
    expect(rulingStatementValid(other, await signRulingStatement(other, mod.privateKey), modPublic, want)).toEqual({ ok: false, reason: 'wrong-trade' });
    const otherEscrow = statement({ escrowAddress: '5'.padEnd(95, 'X') });
    expect(rulingStatementValid(otherEscrow, await signRulingStatement(otherEscrow, mod.privateKey), modPublic, want)).toEqual({ ok: false, reason: 'wrong-escrow' });
  });

  it("review p4t22 m1 (OQ2): round 2's statement verifies (an appeal decided before round 1 paid); no other round is a statement", async () => {
    const r2 = statement({ round: 2 });
    expect(rulingStatementValid(r2, await signRulingStatement(r2, mod.privateKey), modPublic, want)).toEqual({ ok: true, statement: r2 });
    const r3 = { ...statement(), round: 3 };
    expect(rulingStatementValid(r3, 'a'.repeat(128), modPublic, want)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('an altered payout is refused: another split, another address, another order, or the other side as winner', async () => {
    const s = statement();
    const sig = await signRulingStatement(s, mod.privateKey);
    const swapped = [want.payouts[1]!, want.payouts[0]!];
    const moved = [{ address: BUYER, amountAtomic: 248_000_000_000n }, { address: FEE, amountAtomic: 2_000_000_000n }];
    const elsewhere = [{ address: '4'.padEnd(95, 'Z'), amountAtomic: 249_000_000_000n }, want.payouts[1]!];
    for (const payouts of [swapped, moved, elsewhere, want.payouts.slice(0, 1)]) {
      expect(rulingStatementValid(s, sig, modPublic, { ...want, payouts })).toEqual({ ok: false, reason: 'wrong-payouts' });
    }
    expect(rulingStatementValid(s, sig, modPublic, { ...want, winner: 'seller' })).toEqual({ ok: false, reason: 'not-winner' });
  });
});
