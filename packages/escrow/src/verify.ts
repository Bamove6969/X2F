import { feeSplitLayout, networkFeeShares } from '@x2f/core';
import { EscrowError, type Payout } from './engine.js';

export { feeSplitLayout, networkFeeShares };

/** The highest network fee a co-signer accepts: 0.01 XMR. */
export const MAX_NETWORK_FEE = 10_000_000_000n;

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

/**
 * Which outputs a release's network fee comes off: every payout marked `bearsNetworkFee`, or payout
 * 0 alone when none is (the original rule, kept for refunds).
 */
export function feeBearers(payouts: readonly Payout[]): boolean[] {
  const marked = payouts.map((p) => p.bearsNetworkFee === true);
  return marked.some((m) => m) ? marked : payouts.map((_, i) => i === 0);
}

export function sumPayouts(payouts: readonly Payout[]): bigint {
  return payouts.reduce((s, p) => s + p.amountAtomic, 0n);
}

/**
 * Fail closed unless the decoded set is exactly one transaction that sweeps the whole
 * escrow to `expected`: same addresses, every amount exact except the fee bearers
 * (`feeBearers`: the marked payouts, else payouts[0]), each short by exactly its wallet2 share of
 * the network fee (`networkFeeShares`); no change output at all; no unlock time; fee within
 * MAX_NETWORK_FEE.
 * A change output is refused because a builder can hide a payment to itself as "change".
 */
export function checkTxSet(txs: readonly DescribedTx[], expected: readonly Payout[], escrowBalance: bigint): void {
  checkPayouts(expected);
  if (txs.length !== 1) fail(`expected 1 transaction, got ${txs.length}`);
  const tx = txs[0]!;
  const { fee, changeAmount, inputSum, outputSum } = tx;
  if (fee === undefined || fee <= 0n) fail('missing network fee');
  if (fee > MAX_NETWORK_FEE) fail('network fee too high');
  if (changeAmount !== 0n) fail('change output present');
  // A non-zero unlock time would lock the payouts for as long as the builder chose.
  if (tx.unlockTime !== 0n) fail('unlock time set');
  if (sumPayouts(expected) !== escrowBalance) fail('payouts do not sweep the escrow');
  if (inputSum !== escrowBalance) fail('inputs are not the escrow balance');
  if (tx.destinations.length !== expected.length) fail('wrong number of outputs');

  const byAddress = new Map(tx.destinations.map((d) => [d.address, d.amountAtomic]));
  if (byAddress.size !== tx.destinations.length) fail('duplicate output address');
  const shares = networkFeeShares(fee, feeBearers(expected));
  let total = 0n;
  expected.forEach((p, i) => {
    const got = byAddress.get(p.address);
    if (got === undefined) fail('missing payout address');
    const want = p.amountAtomic - shares[i]!;
    if (got !== want) fail('payout amount differs');
    total += got;
  });
  if (outputSum !== total || total + fee !== inputSum) fail('amounts do not balance');
}
