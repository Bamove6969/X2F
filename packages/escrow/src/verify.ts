import { EscrowError, type Payout } from './engine.js';

/**
 * The highest network fee a co-signer accepts whatever the daemon says: 0.01 XMR. A backstop under
 * the bound relative to the network (feeCeiling), never above it.
 */
export const MAX_NETWORK_FEE = 10_000_000_000n;

/**
 * How many times the network's normal-priority fee for the tx's estimated weight a co-signer accepts
 * (review multisig-vs-RetoSwap F4, 12 Nov). Why 4:
 * - The builder never sets a priority, so wallet2 pays the low rate (priority 1) or, when the pool
 *   has a backlog, the normal rate (priority 2 = 4 x low). Those pass with a 16x and a 4x margin,
 *   which covers this side's weight estimate (within a few %) and the estimate moving between the
 *   build and the co-sign (it follows the block reward and median weight, which change slowly).
 * - The elevated rate (priority 3, 16 x low) still passes at about the bound; the highest (priority
 *   4, about 200 x low) does not.
 * - On mainnet a normal 1-input sweep is about 0.0001 XMR, so the most a builder can make the
 *   payout-0 party pay is about 0.0005 XMR instead of 0.01 XMR.
 */
export const FEE_ESTIMATE_MULTIPLIER = 4n;

/**
 * The least the fee bound ever is, whatever the daemon says: 0.0002 XMR (review lead-escrow-harden
 * M2). A node that reports a near-zero fee would otherwise push the bound under any real fee and
 * make every honest release refused. An honest mainnet sweep at priority 2 is about 0.00013 XMR, so
 * the floor never refuses one; it is the most a builder can make the payout-0 party pay when the
 * co-signer's node lies low.
 */
// OWNER: value
export const FEE_BOUND_FLOOR = 200_000_000n;

/**
 * The largest quantization mask taken from the daemon (review M2): monerod's is 10^4. A larger one
 * is capped here, so a lying mask cannot round the bound up to the 0.01 XMR backstop.
 */
export const MAX_QUANTIZATION_MASK = 100_000_000n;

/** Ring size, fixed by consensus since v0.18 (HF 15). */
const RING_SIZE = 16;

/**
 * wallet2's estimate_tx_weight for a CLSAG + Bulletproofs+ tx with view tags (v0.18), with room for
 * a tx public key, one additional public key per output (a subaddress payout) and the dummy
 * encrypted payment id. An estimate, never under the real weight by more than a few bytes.
 */
export function estimateTxWeight(inputs: number, outputs: number): bigint {
  if (!Number.isSafeInteger(inputs) || !Number.isSafeInteger(outputs) || inputs < 1 || outputs < 1 || inputs > 1000 || outputs > 16) {
    throw new EscrowError('payout-mismatch', 'no fee bound for this tx shape');
  }
  const extra = 1 + 32 + 2 + 32 * outputs + 11;
  let log = 0;
  while (1 << log < outputs) log++;
  let size = 1 + 6; // version, unlock time
  size += inputs * (1 + 6 + RING_SIZE * 2 + 32); // vin: type, amount, key offsets, key image
  size += outputs * (6 + 32 + 1); // vout with a view tag
  size += extra;
  size += 1; // rct type
  size += (2 * (6 + log) + 6) * 32 + 3; // one aggregate BP+ range proof
  size += inputs * (32 * RING_SIZE + 64); // CLSAGs
  size += 32 * inputs; // pseudo outs
  size += 8 * outputs; // ecdh info
  size += 32 * outputs; // out commitments
  size += 4; // fee
  if (outputs > 2) {
    // Bulletproof clawback: more than 2 outputs weigh more than their bytes.
    let padded = 2;
    while (1 << padded < outputs) padded++;
    const base = (32 * (6 + 7 * 2)) / 2;
    const proof = 32 * (6 + 2 * (6 + padded));
    size += Math.floor(((base * (1 << padded) - proof) * 4) / 5);
  }
  return BigInt(size);
}

/** The daemon's fee estimate (get_fee_estimate): the normal-priority fee per byte, and the rounding mask. */
export interface FeeEstimate {
  perByteNormal: bigint;
  quantizationMask: bigint;
}

const positive = (x: unknown): bigint | null =>
  typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? BigInt(x) : typeof x === 'bigint' && x > 0n ? x : null;

/**
 * Reads monerod's json_rpc `get_fee_estimate` answer. The normal rate is `fees[1]` (priority 2);
 * a daemon that gives no per-priority fees gives `fee`, the low rate, and normal is 4 x that, as
 * wallet2's 2021 fee scaling has it. Anything else is EscrowError('daemon-unavailable'): retried,
 * never read as "no bound".
 */
export function parseFeeEstimate(body: unknown): FeeEstimate {
  const r = (typeof body === 'object' && body !== null ? (body as { result?: unknown }).result : undefined) as
    | { status?: unknown; fee?: unknown; fees?: unknown; quantization_mask?: unknown }
    | undefined;
  if (typeof r !== 'object' || r === null || r.status !== 'OK') throw new EscrowError('daemon-unavailable', 'fee estimate: no OK answer');
  const low = positive(r.fee);
  const normal = Array.isArray(r.fees) && r.fees.length >= 2 ? positive(r.fees[1]) : low === null ? null : 4n * low;
  if (low === null || normal === null) throw new EscrowError('daemon-unavailable', 'fee estimate: malformed answer');
  const mask = positive(r.quantization_mask) ?? 1n;
  return { perByteNormal: normal, quantizationMask: mask < MAX_QUANTIZATION_MASK ? mask : MAX_QUANTIZATION_MASK };
}

/**
 * The highest network fee a co-signer accepts for a sweep of `inputs` escrow outputs to `outputs`
 * outputs: FEE_ESTIMATE_MULTIPLIER x the normal-priority fee for its estimated weight (rounded up
 * as the daemon rounds, with the mask capped at MAX_QUANTIZATION_MASK), never below
 * FEE_BOUND_FLOOR and never above MAX_NETWORK_FEE (review M2). A daemon that lies high can still
 * lift it up to MAX_NETWORK_FEE through the per-byte fee: a cap relative to the payout is an open
 * owner question.
 */
export function feeCeiling(estimate: FeeEstimate, inputs: number, outputs: number): bigint {
  const mask = estimate.quantizationMask < MAX_QUANTIZATION_MASK ? estimate.quantizationMask : MAX_QUANTIZATION_MASK;
  const normal = ((estimateTxWeight(inputs, outputs) * estimate.perByteNormal + mask - 1n) / mask) * mask;
  const est = FEE_ESTIMATE_MULTIPLIER * normal;
  const bound = est > FEE_BOUND_FLOOR ? est : FEE_BOUND_FLOOR;
  return bound < MAX_NETWORK_FEE ? bound : MAX_NETWORK_FEE;
}

/** What the co-signer learns from decoding a tx set; mirrors monero-ts describeMultisigTxSet. */
export interface DescribedTx {
  fee: bigint | undefined;
  unlockTime: bigint | undefined;
  changeAmount: bigint | undefined;
  inputSum: bigint | undefined;
  outputSum: bigint | undefined;
  destinations: Payout[];
}

function fail(detail: string): never {
  throw new EscrowError('payout-mismatch', detail);
}

/** Payouts a release may be built for: non-empty, positive amounts, distinct addresses. */
export function checkPayouts(payouts: readonly Payout[]): void {
  if (payouts.length === 0) throw new EscrowError('bad-payouts', 'no payouts');
  const seen = new Set<string>();
  for (const p of payouts) {
    if (typeof p.address !== 'string' || p.address.length === 0) throw new EscrowError('bad-payouts', 'missing address');
    if (typeof p.amountAtomic !== 'bigint' || p.amountAtomic <= 0n) throw new EscrowError('bad-payouts', 'amount must be positive');
    if (seen.has(p.address)) throw new EscrowError('bad-payouts', 'duplicate address');
    seen.add(p.address);
  }
}

export function sumPayouts(payouts: readonly Payout[]): bigint {
  return payouts.reduce((s, p) => s + p.amountAtomic, 0n);
}

/**
 * Fail closed unless the decoded set is exactly one transaction that sweeps the whole
 * escrow to `expected`: same addresses, every amount exact except payouts[0], which is
 * short by exactly the network fee; no change output at all; no unlock time; fee within
 * `maxFee` (the co-signer passes feeCeiling) and always within MAX_NETWORK_FEE.
 * A change output is refused because a builder can hide a payment to itself as "change".
 */
export function checkTxSet(txs: readonly DescribedTx[], expected: readonly Payout[], escrowBalance: bigint, maxFee: bigint = MAX_NETWORK_FEE): void {
  checkPayouts(expected);
  if (txs.length !== 1) fail(`expected 1 transaction, got ${txs.length}`);
  const tx = txs[0]!;
  const { fee, changeAmount, inputSum, outputSum } = tx;
  if (fee === undefined || fee <= 0n) fail('missing network fee');
  if (fee > MAX_NETWORK_FEE) fail('network fee too high');
  if (fee > maxFee) fail("network fee too high for the network's fee estimate");
  if (changeAmount !== 0n) fail('change output present');
  // A non-zero unlock time would lock the payouts for as long as the builder chose.
  if (tx.unlockTime !== 0n) fail('unlock time set');
  if (sumPayouts(expected) !== escrowBalance) fail('payouts do not sweep the escrow');
  if (inputSum !== escrowBalance) fail('inputs are not the escrow balance');
  if (tx.destinations.length !== expected.length) fail('wrong number of outputs');

  const byAddress = new Map(tx.destinations.map((d) => [d.address, d.amountAtomic]));
  if (byAddress.size !== tx.destinations.length) fail('duplicate output address');
  let total = 0n;
  expected.forEach((p, i) => {
    const got = byAddress.get(p.address);
    if (got === undefined) fail('missing payout address');
    const want = i === 0 ? p.amountAtomic - fee : p.amountAtomic;
    if (got !== want) fail('payout amount differs');
    total += got;
  });
  if (outputSum !== total || total + fee !== inputSum) fail('amounts do not balance');
}
