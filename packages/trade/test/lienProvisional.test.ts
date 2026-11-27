import { MAX_NETWORK_FEE } from '@x2f/escrow';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LIEN_BUYER_KEEPS_ATOMIC,
  LIEN_DEFAULT_RATE_BPS,
  LIEN_RECOVERY_MAX_BPS,
  LIEN_RECOVERY_MIN_ATOMIC,
  escrowPlan,
  expectedRecovery,
  lienRecoveryCap,
  lienStatementValid,
  payoutsFor,
  recoveryAddressValid,
  signLienStatement,
  signRecoveryAddress,
  type LienStatement,
  type RecoveryAddressStatement,
} from '../src/index.js';

/**
 * Lien recovery limits (docs/lien-recovery.md "Owner answers"): Q1 (owner, 26 Nov 2026) a rate of at
 * most 100%, 100% by default, and the buyer's output always keeps MAX_NETWORK_FEE + 1 atomic unit
 * (what the payout needs to work); Q5 a recovery below 0.01 XMR is never paid (the remainder carries
 * forward); Q2 the creditor's device signs the address its recoveries go to; B1 the moderation
 * service signs the lien it checked.
 */
const XMR = 1_000_000_000_000n;
const BUYER = '4Buyer';
const SELLER = '4Seller';
const FEE = '4Fee';
const CREDITOR = '4Creditor';

const release = (amount: bigint, recovery: bigint) => {
  const plan = escrowPlan({ amountAtomic: amount, poster: 'seller' });
  return payoutsFor({
    kind: 'release', amountAtomic: amount, feeAtomic: plan.feeAtomic, poster: 'seller', sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic: plan.sellerFundsAtomic, buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: '4Payroll',
    lienRecovery: { address: CREDITOR, amountAtomic: recovery },
  });
};

describe('Q1/Q5: the limits (one constant each)', () => {
  it('owner 26 Nov 2026: 100% at most and by default; the buyer keeps MAX_NETWORK_FEE + 1; nothing under 0.01 XMR is paid', () => {
    expect(LIEN_RECOVERY_MAX_BPS).toBe(10_000);
    expect(LIEN_DEFAULT_RATE_BPS).toBe(10_000);
    expect(LIEN_BUYER_KEEPS_ATOMIC).toBe(MAX_NETWORK_FEE + 1n);
    expect(LIEN_RECOVERY_MIN_ATOMIC).toBe(XMR / 100n);
  });

  it('lienRecoveryCap: all of the proceeds less the buyer\'s floor; 0 when nothing fits', () => {
    expect(lienRecoveryCap(XMR)).toBe(XMR - LIEN_BUYER_KEEPS_ATOMIC);
    expect(lienRecoveryCap(XMR / 10n)).toBe(XMR / 10n - LIEN_BUYER_KEEPS_ATOMIC);
    expect(lienRecoveryCap(LIEN_BUYER_KEEPS_ATOMIC)).toBe(0n);
    expect(lienRecoveryCap(0n)).toBe(0n);
  });

  it('expectedRecovery = min(floor(proceeds × rate / 10000), what is left, the cap); below 0.01 XMR it is 0 (carried forward)', () => {
    // The default: everything left, up to the cap.
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: LIEN_DEFAULT_RATE_BPS, leftAtomic: 10n * XMR })).toBe(XMR - LIEN_BUYER_KEEPS_ATOMIC);
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: LIEN_DEFAULT_RATE_BPS, leftAtomic: XMR / 4n })).toBe(XMR / 4n);
    expect(expectedRecovery({ proceedsAtomic: XMR / 10n, rateBps: LIEN_DEFAULT_RATE_BPS, leftAtomic: XMR })).toBe(XMR / 10n - LIEN_BUYER_KEEPS_ATOMIC);
    // A lower rate a senior approved.
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 5000, leftAtomic: 10n * XMR })).toBe(XMR / 2n);
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 5000, leftAtomic: XMR / 4n })).toBe(XMR / 4n);
    expect(expectedRecovery({ proceedsAtomic: 3n, rateBps: 5000, leftAtomic: XMR })).toBe(0n);
    // A remainder smaller than 0.01 XMR is never paid: it carries forward.
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 5000, leftAtomic: XMR / 100n - 1n })).toBe(0n);
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 5000, leftAtomic: XMR / 100n })).toBe(XMR / 100n);
    // Nothing fits (or less than 0.01 XMR does): skipped.
    expect(expectedRecovery({ proceedsAtomic: LIEN_BUYER_KEEPS_ATOMIC + 1n, rateBps: 10_000, leftAtomic: XMR })).toBe(0n);
    expect(expectedRecovery({ proceedsAtomic: LIEN_BUYER_KEEPS_ATOMIC, rateBps: 10_000, leftAtomic: XMR })).toBe(0n);
    // A rate above the cap is never applied (fails closed), nor a malformed one.
    expect(() => expectedRecovery({ proceedsAtomic: XMR, rateBps: 10_001, leftAtomic: XMR })).toThrow(RangeError);
    expect(() => expectedRecovery({ proceedsAtomic: XMR, rateBps: 0, leftAtomic: XMR })).toThrow(RangeError);
    expect(() => expectedRecovery({ proceedsAtomic: XMR, rateBps: 5000, leftAtomic: -1n })).toThrow(RangeError);
  });

  it('PROBE-B3 as a test: payoutsFor (every co-signer and the gate) refuses a set that leaves the buyer no more than the largest network fee, or under 0.01 XMR', () => {
    // The review's probe: an approved 10000 bps reserved XMR - 1 for a 1 XMR trade.
    expect(() => release(XMR, XMR - 1n)).toThrow(/bad recovery amount/);
    expect(() => release(XMR, XMR - MAX_NETWORK_FEE)).toThrow(/bad recovery amount/);
    expect(release(XMR, XMR - LIEN_BUYER_KEEPS_ATOMIC)[0]).toEqual({ address: BUYER, amountAtomic: LIEN_BUYER_KEEPS_ATOMIC, bearsNetworkFee: true });
    const small = XMR / 10n;
    expect(release(small, small - LIEN_BUYER_KEEPS_ATOMIC)[0]).toEqual({ address: BUYER, amountAtomic: LIEN_BUYER_KEEPS_ATOMIC, bearsNetworkFee: true });
    expect(() => release(small, small - LIEN_BUYER_KEEPS_ATOMIC + 1n)).toThrow(/bad recovery amount/);
    expect(() => release(XMR, XMR / 100n - 1n)).toThrow(/bad recovery amount/);
    expect(release(XMR, XMR / 100n)[3]).toEqual({ address: CREDITOR, amountAtomic: XMR / 100n, bearsNetworkFee: true });
  });
});

describe('B1: the moderation service\'s signed lien statement', () => {
  let mod: { publicKey: Uint8Array; privateKey: Uint8Array };
  const S: LienStatement = {
    v: 1, lienId: '6f1c1f9e-0b1a-4a51-9a1b-0c2d3e4f5a6b', fromCode: 'ABCD-EFGH-JKMN-PQRS', creditorSide: 'seller',
    debtor: '11111111-1111-4111-8111-111111111111', creditor: '22222222-2222-4222-8222-222222222222',
    amountAtomic: '1000000000000', rateBps: 5000, issuedAt: '2026-11-17T10:00:00.000Z',
  };
  beforeAll(async () => {
    await sodium.ready;
    mod = sodium.crypto_sign_keypair();
  });

  it('verifies only under the moderation key, unchanged; a rate above 100% is never a statement', async () => {
    const sig = await signLienStatement(S, mod.privateKey);
    const pub = sodium.to_hex(mod.publicKey);
    expect(lienStatementValid(S, sig, pub)).toBe(true);
    expect(lienStatementValid({ ...S, amountAtomic: '1000000000001' }, sig, pub)).toBe(false);
    expect(lienStatementValid({ ...S, debtor: S.creditor }, sig, pub)).toBe(false);
    expect(lienStatementValid(S, sig, sodium.to_hex(sodium.crypto_sign_keypair().publicKey))).toBe(false);
    expect(lienStatementValid({ ...S, rateBps: 10_000 }, await signLienStatement({ ...S, rateBps: 10_000 }, mod.privateKey), pub)).toBe(true);
    await expect(signLienStatement({ ...S, rateBps: 10_001 }, mod.privateKey)).rejects.toThrow(TypeError);
    await expect(signLienStatement({ ...S, extra: 1 } as unknown as LienStatement, mod.privateKey)).rejects.toThrow(TypeError);
  });
});

describe('Q2: the creditor\'s signed "pay my recoveries to X"', () => {
  let id: { publicKey: Uint8Array; privateKey: Uint8Array };
  const A: RecoveryAddressStatement = { v: 1, fromCode: 'ABCD-EFGH-JKMN-PQRS', creditorSide: 'buyer', address: CREDITOR, issuedAt: '2026-11-17T10:00:00.000Z' };
  beforeAll(async () => {
    await sodium.ready;
    id = sodium.crypto_sign_keypair();
  });

  it('is signed by the creditor\'s own trade identity from the disputed trade, bound to that trade, that side and that address', async () => {
    const sig = await signRecoveryAddress(A, id.privateKey);
    const pub = sodium.to_hex(id.publicKey);
    expect(recoveryAddressValid(A, sig, pub)).toBe(true);
    expect(recoveryAddressValid({ ...A, address: '4Attacker' }, sig, pub)).toBe(false);
    expect(recoveryAddressValid({ ...A, creditorSide: 'seller' }, sig, pub)).toBe(false);
    expect(recoveryAddressValid({ ...A, fromCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, sig, pub)).toBe(false);
    expect(recoveryAddressValid(A, sig, sodium.to_hex(sodium.crypto_sign_keypair().publicKey))).toBe(false);
    expect(recoveryAddressValid({ ...A, address: '' }, sig, pub)).toBe(false);
  });
});
