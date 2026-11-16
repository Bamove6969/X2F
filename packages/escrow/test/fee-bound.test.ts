// Review multisig-vs-RetoSwap F4 (12 Nov): the co-signer bounds a release's network fee by a multiple of
// the daemon's own fee estimate for the tx's weight, with the flat 0.01 XMR kept as a backstop. No
// daemon: the session takes the wallet, and the fee estimate is read with a plain fetch, stubbed here.
import type { MoneroWalletFull } from 'monero-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EscrowError,
  FEE_BOUND_FLOOR,
  MAX_NETWORK_FEE,
  MAX_QUANTIZATION_MASK,
  MoneroMultisigSession,
  checkTxSet,
  feeCeiling,
  parseFeeEstimate,
  type DescribedTx,
  type Payout,
} from '../src/index.js';

const XMR = 1_000_000_000_000n;
const BUYER = 'buyer-address';
const FEE_WALLET = 'fee-address';

/** Mainnet's get_fee_estimate at the minimum penalty-free block weight: per-byte fees for priorities 1-4. */
const MAINNET = { status: 'OK', fee: 20_000, fees: [20_000, 80_000, 320_000, 4_000_000], quantization_mask: 10_000 };
/** What wallet2 weighs a 1-input, 2-output CLSAG/BP+ sweep at (about 1.5 kB). */
const SWEEP_WEIGHT = 1_540n;
const quantized = (perByte: bigint): bigint => ((SWEEP_WEIGHT * perByte + 9_999n) / 10_000n) * 10_000n;

function release(amountAtomic: bigint, fee: bigint) {
  const toFee = amountAtomic / 100n;
  const balance = amountAtomic + toFee;
  const expected: Payout[] = [
    { address: BUYER, amountAtomic },
    { address: FEE_WALLET, amountAtomic: toFee },
  ];
  const tx: DescribedTx = {
    fee,
    unlockTime: 0n,
    changeAmount: 0n,
    inputSum: balance,
    outputSum: balance - fee,
    destinations: [
      { address: BUYER, amountAtomic: amountAtomic - fee },
      { address: FEE_WALLET, amountAtomic: toFee },
    ],
  };
  return { expected, tx, balance };
}

const SIGNED_HASH = 'ab'.repeat(32);

/** A wallet double with just what checkRelease reads: the decoded set, the balance and its outputs. */
function walletFor(tx: DescribedTx, balance: bigint, outputs = 1) {
  const wallet = {
    describeMultisigTxSet: async () => ({
      getTxs: () => [
        {
          getFee: () => tx.fee,
          getUnlockTime: () => tx.unlockTime,
          getChangeAmount: () => tx.changeAmount,
          getInputSum: () => tx.inputSum,
          getOutputSum: () => tx.outputSum,
          getOutgoingTransfer: () => ({
            getDestinations: () => tx.destinations.map((d) => ({ getAddress: () => d.address, getAmount: () => d.amountAtomic })),
          }),
        },
      ],
    }),
    getBalance: async () => balance,
    getUnlockedBalance: async () => balance,
    getOutputs: async () => Array.from({ length: outputs }, () => ({ getAmount: () => balance / BigInt(outputs) })),
    signMultisigTxHex: async () => ({ getSignedMultisigTxHex: () => 'signed-hex', getTxHashes: () => [SIGNED_HASH] }),
  };
  return new MoneroMultisigSession(wallet as unknown as MoneroWalletFull, 'http://node.test', 'pw');
}

function stubDaemon(answer: unknown, ok = true) {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    return { ok, status: ok ? 200 : 502, json: async () => answer } as unknown as Response;
  });
  return calls;
}

async function refusal(p: Promise<unknown>): Promise<EscrowError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(EscrowError);
  return e as EscrowError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkRelease: network fee bound by the daemon estimate', () => {
  it('accepts an honest release at low and at normal priority, on a small trade too', async () => {
    for (const amount of [XMR / 20n, 2n * XMR]) {
      for (const perByte of [20_000n, 80_000n]) {
        const r = release(amount, quantized(perByte));
        const calls = stubDaemon({ jsonrpc: '2.0', id: '0', result: MAINNET });
        await expect(walletFor(r.tx, r.balance).checkRelease('set', r.expected)).resolves.toBeUndefined();
        expect(calls).toEqual([{ url: 'http://node.test/json_rpc', body: expect.objectContaining({ method: 'get_fee_estimate' }) }]);
      }
    }
  });

  it('accepts an honest release at the elevated priority (3) too', async () => {
    const r = release(XMR / 20n, quantized(320_000n));
    stubDaemon({ jsonrpc: '2.0', id: '0', result: MAINNET });
    await expect(walletFor(r.tx, r.balance).checkRelease('set', r.expected)).resolves.toBeUndefined();
  });

  it('refuses a fee far above the network rate even under the absolute 0.01 XMR cap', async () => {
    const fee = 9_000_000_000n; // 0.009 XMR: 18 % of a 0.05 XMR payout
    expect(fee).toBeLessThan(MAX_NETWORK_FEE);
    const r = release(XMR / 20n, fee);
    stubDaemon({ jsonrpc: '2.0', id: '0', result: MAINNET });
    const e = await refusal(walletFor(r.tx, r.balance).checkRelease('set', r.expected));
    expect(e.code).toBe('payout-mismatch');
    expect(e.message).toContain('network fee too high');
  });

  it('refuses a release at the highest priority (4), which only a builder that chose it pays', async () => {
    const r = release(XMR / 20n, quantized(4_000_000n));
    stubDaemon({ jsonrpc: '2.0', id: '0', result: MAINNET });
    expect((await refusal(walletFor(r.tx, r.balance).checkRelease('set', r.expected))).code).toBe('payout-mismatch');
  });

  it('allows for every output the escrow holds: a 3-input sweep at normal priority passes', async () => {
    // 3 inputs weigh about 1.4 kB more than 1 (ring, CLSAG, pseudo-out each); this fee assumes 3.8 kB.
    const fee = ((3_800n * 80_000n + 9_999n) / 10_000n) * 10_000n;
    const r = release(XMR / 20n, fee);
    stubDaemon({ jsonrpc: '2.0', id: '0', result: MAINNET });
    await expect(walletFor(r.tx, r.balance, 3).checkRelease('set', r.expected)).resolves.toBeUndefined();
  });

  it('keeps 0.01 XMR as the backstop when the estimate is high', async () => {
    const r = release(2n * XMR, MAX_NETWORK_FEE + 10_000n);
    stubDaemon({ jsonrpc: '2.0', id: '0', result: { ...MAINNET, fee: 2_000_000_000, fees: [2_000_000_000, 8_000_000_000, 8_000_000_000, 8_000_000_000] } });
    expect((await refusal(walletFor(r.tx, r.balance).checkRelease('set', r.expected))).code).toBe('payout-mismatch');
  });

  it('a daemon that gives no usable estimate is daemon-unavailable (retried), never an accept', async () => {
    const r = release(XMR / 20n, quantized(80_000n));
    for (const [answer, ok] of [
      [{ result: MAINNET }, false],
      [{ error: { code: -1, message: 'busy' } }, true],
      [{ result: { ...MAINNET, status: 'BUSY' } }, true],
      [{ result: { ...MAINNET, fee: 0, fees: [] } }, true],
      [{ result: { ...MAINNET, fee: 'x', fees: undefined } }, true],
      [null, true],
    ] as const) {
      stubDaemon(answer, ok);
      expect((await refusal(walletFor(r.tx, r.balance).checkRelease('set', r.expected))).code).toBe('daemon-unavailable');
    }
  });

  it('without fees per priority, uses 4 x the base fee as the normal rate', async () => {
    const r = release(XMR / 20n, quantized(80_000n));
    stubDaemon({ result: { status: 'OK', fee: 20_000, quantization_mask: 10_000 } });
    await expect(walletFor(r.tx, r.balance).checkRelease('set', r.expected)).resolves.toBeUndefined();
    const over = release(XMR / 20n, 9_000_000_000n);
    stubDaemon({ result: { status: 'OK', fee: 20_000, quantization_mask: 10_000 } });
    expect((await refusal(walletFor(over.tx, over.balance).checkRelease('set', over.expected))).code).toBe('payout-mismatch');
  });
});

describe('checkTxSet with a fee ceiling', () => {
  it('refuses a fee above the ceiling passed in, and accepts one at it', () => {
    const r = release(XMR / 20n, 9_000_000_000n);
    expect(() => checkTxSet([r.tx], r.expected, r.balance, 400_000_000n)).toThrow('network fee too high');
    const at = release(XMR / 20n, 400_000_000n);
    expect(() => checkTxSet([at.tx], at.expected, at.balance, 400_000_000n)).not.toThrow();
  });

  it('a ceiling above 0.01 XMR never lifts the backstop', () => {
    const r = release(2n * XMR, MAX_NETWORK_FEE + 1n);
    expect(() => checkTxSet([r.tx], r.expected, r.balance, 10n * MAX_NETWORK_FEE)).toThrow('network fee too high');
  });
});

// Review lead-escrow-harden M2 (16 Nov): the node is the operator's, so a lying node must not move
// the bound out of a sane band: a fixed floor (no refusal of every honest release) and a cap on
// the quantization mask (no lift to the 0.01 XMR backstop through rounding).
describe('the fee bound stays in a band a lying node cannot move it out of (review M2)', () => {
  const TINY = { status: 'OK', fee: 1, fees: [1, 1, 1, 1], quantization_mask: 1 };

  it('a node reporting a near-zero fee cannot make every honest release refused: the bound is at least FEE_BOUND_FLOOR', async () => {
    expect(feeCeiling(parseFeeEstimate({ result: TINY }), 1, 2)).toBe(FEE_BOUND_FLOOR);
    for (const perByte of [20_000n, 80_000n]) {
      const r = release(XMR / 20n, quantized(perByte));
      stubDaemon({ result: TINY });
      await expect(walletFor(r.tx, r.balance).checkRelease('set', r.expected)).resolves.toBe(FEE_BOUND_FLOOR);
    }
    // Above the floor, still refused.
    const over = release(XMR / 20n, FEE_BOUND_FLOOR + 1n);
    stubDaemon({ result: TINY });
    expect((await refusal(walletFor(over.tx, over.balance).checkRelease('set', over.expected))).code).toBe('payout-mismatch');
  });

  it('the floor is 0.0002 XMR: above an honest normal-priority sweep, far below the backstop', () => {
    expect(FEE_BOUND_FLOOR).toBe(200_000_000n);
    expect(FEE_BOUND_FLOOR).toBeGreaterThan(quantized(80_000n));
    expect(FEE_BOUND_FLOOR * 10n).toBeLessThan(MAX_NETWORK_FEE);
    // With an honest estimate the bound is the estimate's, the floor only lifts a tiny one.
    expect(feeCeiling(parseFeeEstimate({ result: { ...MAINNET, fees: [20_000, 320_000, 320_000, 320_000] } }), 1, 2)).toBeGreaterThan(FEE_BOUND_FLOOR);
  });

  it('a huge quantization_mask cannot lift the bound to the 0.01 XMR backstop', async () => {
    expect(MAX_QUANTIZATION_MASK).toBe(100_000_000n);
    const lying = { ...MAINNET, quantization_mask: 9e15 };
    // 1602 bytes x 80 000 rounds up to one capped mask (1e8), times 4.
    expect(feeCeiling(parseFeeEstimate({ result: lying }), 1, 2)).toBe(4n * MAX_QUANTIZATION_MASK * 2n);
    const r = release(XMR / 20n, 9_000_000_000n);
    stubDaemon({ result: lying });
    expect((await refusal(walletFor(r.tx, r.balance).checkRelease('set', r.expected))).code).toBe('payout-mismatch');
    // An honest release still passes under the capped mask.
    const ok = release(XMR / 20n, quantized(80_000n));
    stubDaemon({ result: lying });
    await expect(walletFor(ok.tx, ok.balance).checkRelease('set', ok.expected)).resolves.toBeTypeOf('bigint');
  });
});

// Review lead-escrow-harden M3 (16 Nov): once the co-signer checked a set and committed to it, the
// re-check before signing uses the bound of that first check: offline, deterministic, and never
// a second fee estimate that could stall a committed co-signer or refuse the set it just accepted.
describe('signRelease re-checks with the bound of the first check (review M3)', () => {
  it('checkRelease gives the bound it checked against; signRelease with it asks the node nothing', async () => {
    const r = release(XMR / 20n, quantized(80_000n));
    const first = stubDaemon({ result: MAINNET });
    const s = walletFor(r.tx, r.balance);
    const bound = await s.checkRelease('set', r.expected);
    expect(bound).toBe(feeCeiling(parseFeeEstimate({ result: MAINNET }), 1, 2));
    expect(first).toHaveLength(1);
    // The node then stops answering get_fee_estimate, or answers with a much lower one.
    for (const [answer, ok] of [[null, false], [{ result: { ...MAINNET, fee: 1, fees: [1, 1, 1, 1] } }, true]] as const) {
      const later = stubDaemon(answer, ok);
      await expect(s.signRelease('set', r.expected, bound)).resolves.toEqual({ signedHex: 'signed-hex', txHash: SIGNED_HASH });
      expect(later).toEqual([]);
    }
  });

  it('a stored bound still refuses a fee above it, and never lifts the 0.01 XMR backstop', async () => {
    const r = release(XMR / 20n, 9_000_000_000n);
    stubDaemon({ result: MAINNET });
    expect((await refusal(walletFor(r.tx, r.balance).signRelease('set', r.expected, 400_000_000n))).code).toBe('payout-mismatch');
    const big = release(2n * XMR, MAX_NETWORK_FEE + 1n);
    expect((await refusal(walletFor(big.tx, big.balance).signRelease('set', big.expected, 10n * MAX_NETWORK_FEE))).code).toBe('payout-mismatch');
  });

  it('without a stored bound (a state saved before it), signRelease reads the estimate as before', async () => {
    const r = release(XMR / 20n, quantized(80_000n));
    const calls = stubDaemon({ result: MAINNET });
    await expect(walletFor(r.tx, r.balance).signRelease('set', r.expected)).resolves.toEqual({ signedHex: 'signed-hex', txHash: SIGNED_HASH });
    expect(calls).toHaveLength(1);
  });
});
