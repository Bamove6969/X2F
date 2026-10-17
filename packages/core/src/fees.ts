// 1% in basis points. Amounts are atomic units (1 XMR = 1_000_000_000_000n).
export const X2F_FEE_BPS = 100n;

export function feeFor(amountAtomic: bigint): bigint {
  if (amountAtomic < 0n) throw new RangeError('amount must not be negative');
  return (amountAtomic * X2F_FEE_BPS) / 10_000n;
}
