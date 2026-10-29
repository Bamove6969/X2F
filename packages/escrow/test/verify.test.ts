import { describe, expect, it } from 'vitest';
import { EscrowError, MAX_NETWORK_FEE, checkTxSet, type DescribedTx, type Payout } from '../src/index.js';

const BUYER = 'buyer-address';
const FEE_WALLET = 'fee-address';
const BALANCE = 1_250_000_000_000n;
const NET_FEE = 1_795_200_000n;
const expected: Payout[] = [
  { address: BUYER, amountAtomic: 1_237_500_000_000n },
  { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
];

function goodTx(): DescribedTx {
  return {
    fee: NET_FEE,
    unlockTime: 0n,
    changeAmount: 0n,
    inputSum: BALANCE,
    outputSum: BALANCE - NET_FEE,
    destinations: [
      { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
      { address: BUYER, amountAtomic: 1_237_500_000_000n - NET_FEE },
    ],
  };
}

function refused(txs: DescribedTx[], exp: Payout[] = expected, balance = BALANCE): void {
  let err: unknown;
  try {
    checkTxSet(txs, exp, balance);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(EscrowError);
  expect((err as EscrowError).code).toBe('payout-mismatch');
}

describe('checkTxSet', () => {
  it('accepts the exact sweep, whatever order the outputs come in', () => {
    expect(() => checkTxSet([goodTx()], expected, BALANCE)).not.toThrow();
  });

  it('refuses a set with two transactions', () => {
    refused([goodTx(), goodTx()]);
  });

  it('refuses an empty set', () => {
    refused([]);
  });

  it('refuses a swapped payout address', () => {
    const tx = goodTx();
    tx.destinations[1] = { address: 'attacker', amountAtomic: tx.destinations[1]!.amountAtomic };
    refused([tx]);
  });

  it('refuses a fee output raised by 1 atomic unit', () => {
    const tx = goodTx();
    tx.destinations[0] = { address: FEE_WALLET, amountAtomic: 12_500_000_001n };
    tx.destinations[1] = { address: BUYER, amountAtomic: tx.destinations[1]!.amountAtomic - 1n };
    refused([tx]);
  });

  it('refuses an extra 1-atomic output to an attacker', () => {
    const tx = goodTx();
    tx.destinations.push({ address: 'attacker', amountAtomic: 1n });
    tx.destinations[1] = { address: BUYER, amountAtomic: tx.destinations[1]!.amountAtomic - 1n };
    refused([tx]);
  });

  it('refuses any change output', () => {
    const tx = goodTx();
    tx.changeAmount = 1n;
    refused([tx]);
    tx.changeAmount = undefined;
    refused([tx]);
  });

  it('refuses any unlock time', () => {
    const tx = goodTx();
    tx.unlockTime = 1n;
    refused([tx]);
    tx.unlockTime = 10_000_000n;
    refused([tx]);
    tx.unlockTime = undefined;
    refused([tx]);
  });

  it('refuses a network fee above the cap', () => {
    const fee = MAX_NETWORK_FEE + 1n;
    const tx = goodTx();
    tx.fee = fee;
    tx.outputSum = BALANCE - fee;
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n - fee };
    refused([tx]);
  });

  it('accepts a network fee exactly at the cap', () => {
    const fee = MAX_NETWORK_FEE;
    const tx = goodTx();
    tx.fee = fee;
    tx.outputSum = BALANCE - fee;
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n - fee };
    expect(() => checkTxSet([tx], expected, BALANCE)).not.toThrow();
  });

  it('refuses a missing or zero fee', () => {
    const tx = goodTx();
    tx.fee = undefined;
    refused([tx]);
    tx.fee = 0n;
    refused([tx]);
  });

  it('refuses when the network fee comes off the X2F fee output', () => {
    const tx = goodTx();
    tx.destinations[0] = { address: FEE_WALLET, amountAtomic: 12_500_000_000n - NET_FEE };
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n };
    refused([tx]);
  });

  it('refuses inputs that are not the whole escrow', () => {
    const tx = goodTx();
    tx.inputSum = BALANCE + 1n;
    refused([tx]);
  });

  it('refuses expected payouts that do not sweep the escrow', () => {
    refused([goodTx()], expected, BALANCE + 1n);
  });

  it('refuses a duplicated output address', () => {
    const tx = goodTx();
    tx.destinations.push({ address: BUYER, amountAtomic: 0n });
    refused([tx]);
  });

  it('refuses sums that do not balance', () => {
    const tx = goodTx();
    tx.outputSum = BALANCE;
    refused([tx]);
  });

  it('rejects bad expected payouts before looking at the set', () => {
    expect(() => checkTxSet([goodTx()], [], BALANCE)).toThrow(/bad-payouts/);
    expect(() => checkTxSet([goodTx()], [{ address: BUYER, amountAtomic: 0n }], BALANCE)).toThrow(/bad-payouts/);
    expect(() => checkTxSet([goodTx()], [expected[0]!, expected[0]!], BALANCE)).toThrow(/bad-payouts/);
  });
});
