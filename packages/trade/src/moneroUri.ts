import { ATOMIC_PER_XMR } from './money.js';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * A `monero:` payment link. The address must be base58 so it cannot smuggle
 * extra URI parameters; the amount is decimal XMR with trailing zeros trimmed.
 */
export function moneroUri(address: string, amountAtomic: bigint): string {
  if (!BASE58.test(address)) throw new RangeError('bad address');
  if (amountAtomic <= 0n) throw new RangeError('amount must be positive');
  const whole = amountAtomic / ATOMIC_PER_XMR;
  const frac = (amountAtomic % ATOMIC_PER_XMR).toString().padStart(12, '0').replace(/0+$/, '');
  return `monero:${address}?tx_amount=${frac === '' ? whole : `${whole}.${frac}`}`;
}
