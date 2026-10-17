import { EscrowError, type Payout } from './engine.js';

/** The highest network fee a co-signer accepts: 0.01 XMR. */
export const MAX_NETWORK_FEE = 10_000_000_000n;

/** What the co-signer learns from decoding a tx set; mirrors monero-ts describeMultisigTxSet. */
export interface DescribedTx {
  fee: bigint | undefined;
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
 * short by exactly the network fee; no change output at all; fee within MAX_NETWORK_FEE.
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
