/**
 * X2F platform fee calculation.
 *
 * All amounts are bigint atomic units (piconero).
 * 1 XMR = 1_000_000_000_000 piconero.
 */

/** X2F platform fee in basis points (1% = 100 bps). */
export const X2F_FEE_BPS = 100n;

/** Basis points per whole (10,000 bps = 100%). */
const BPS_DENOMINATOR = 10_000n;

/**
 * Compute the platform fee for a given amount.
 *
 * Uses bigint division, which floors toward zero for non-negative values.
 * Pure bigint arithmetic, so there is no precision loss above
 * Number.MAX_SAFE_INTEGER.
 *
 * @param amountAtomic - Trade amount in atomic units (must be >= 0).
 * @returns The fee in atomic units (floored).
 * @throws {RangeError} If amountAtomic is negative.
 */
export function feeFor(amountAtomic: bigint): bigint {
  if (amountAtomic < 0n) {
    throw new RangeError('amountAtomic must not be negative');
  }
  return (amountAtomic * X2F_FEE_BPS) / BPS_DENOMINATOR;
}

/**
 * The order in which Monero's wallet2 pays a transfer's destinations: create_transactions_2
 * (src/wallet/wallet2.cpp, v0.18.3.4 to v0.18.5.3) always pays `dsts[0]` and then removes it with
 * `pop_index(dsts, 0)`, which moves the LAST destination into slot 0. So for n destinations the
 * built tx lists them, and counts its `subtract_fee_from_outputs` positions, as 0, n-1, n-2, ..., 1.
 * Returns, for each position in the built tx, the index in the destination list that was passed.
 */
export function wallet2PayOrder(n: number): number[] {
  const left = Array.from({ length: n }, (_, i) => i);
  const order: number[] = [];
  while (left.length > 0) {
    order.push(left[0]!);
    const last = left.pop()!;
    if (left.length > 0) left[0] = last;
  }
  return order;
}

/**
 * How to hand a payout list to wallet2 so that exactly the outputs marked in `bearers` pay the
 * network fee. wallet2 reads `subtract_fee_from_outputs` as positions in its pay order
 * (`wallet2PayOrder`), while monero-ts/monero-cpp read them as indices in the list passed (and
 * refuse a tx where the two differ), so the list is permuted until both name the same outputs
 * (for three outputs with the first two bearing: the third first, then the second, then the first).
 * Of the permutations that work, the first (lexicographic) in which the lowest-indexed bearer is
 * also the first bearer wallet2 pays is taken (it pays the odd atomic unit), else the first that
 * works. `order[k]` is the payout index passed at position k; `subtractFrom` the positions passed
 * as subtractFeeFrom (checked on regtest: monero-ts 0.11.16, tools/regtest and escrow tests).
 */
export function feeSplitLayout(bearers: readonly boolean[]): { order: number[]; subtractFrom: number[] } {
  const n = bearers.length;
  if (n === 0 || n > 6 || !bearers.some((b) => b === true)) throw new RangeError('bad fee bearers');
  const pay = wallet2PayOrder(n);
  const lowest = bearers.indexOf(true);
  let fallback: { order: number[]; subtractFrom: number[] } | null = null;
  const perms = (rest: number[]): number[][] => (rest.length === 0 ? [[]] : rest.flatMap((x) => perms(rest.filter((y) => y !== x)).map((p) => [x, ...p])));
  for (const order of perms(Array.from({ length: n }, (_, i) => i))) {
    const passed = order.flatMap((orig, k) => (bearers[orig] === true ? [k] : []));
    const paid = pay.flatMap((k, pos) => (bearers[order[k]!] === true ? [pos] : []));
    if (passed.length !== paid.length || passed.some((k, i) => k !== paid[i])) continue;
    const layout = { order, subtractFrom: passed };
    if (order[pay[paid[0]!]!] === lowest) return layout;
    fallback ??= layout;
  }
  if (fallback === null) throw new RangeError('no wallet2 layout');
  return fallback;
}

/**
 * What each payout pays of a network fee `fee` when the outputs marked in `bearers` bear it, exactly
 * as wallet2 subtracts it (subtract_fee_from_outputs; src/wallet/wallet2.cpp, TX::get_adjusted_dsts,
 * v0.18.3.4 to v0.18.5.3): it walks the bearers in its pay order taking `max(remaining / n, 1)` from
 * each, re-computed at the start of every pass, until the fee is covered. So every bearer pays
 * floor(fee / n), and the first `fee mod n` bearers in pay order one atomic unit more; with
 * `feeSplitLayout` the first is the lowest-indexed bearer (on a release, the buyer's output). A
 * payout that is not a bearer pays nothing. The payout's network fee is shared by its receiving
 * outputs, one equal share per output (owner, 16 Nov 2026).
 */
export function networkFeeShares(fee: bigint, bearers: readonly boolean[]): bigint[] {
  if (typeof fee !== 'bigint' || fee < 0n) throw new RangeError('fee must not be negative');
  const { order, subtractFrom } = feeSplitLayout(bearers);
  const pay = wallet2PayOrder(bearers.length);
  const passed = new Set(subtractFrom);
  const inPayOrder = pay.filter((k) => passed.has(k)).map((k) => order[k]!);
  const n = BigInt(inPayOrder.length);
  const rest = Number(fee % n);
  const shares: bigint[] = bearers.map(() => 0n);
  inPayOrder.forEach((orig, j) => {
    shares[orig] = fee / n + (j < rest ? 1n : 0n);
  });
  return shares;
}
