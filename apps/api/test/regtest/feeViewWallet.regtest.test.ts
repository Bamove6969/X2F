// Plan 4 Task 9: the fee wallet read through its view-only key on a real regtest chain
// (staff/feeViewWallet.ts `feeViewWallet`: an in-memory monero-ts wallet from the address and the
// private view key alone). A payment to the fee wallet is listed once it is in a block, with its
// block's time; one still in the pool is not; the wallet opened is view-only.
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { feeViewWallet, feeViewWalletFromEnv } from '../../src/staff/feeViewWallet.js';

const AMOUNT = 250_000_000_000n;

describe('the fee wallet through its view-only key, on regtest (feeViewWallet)', () => {
  let node: Regtest;
  let payer: MoneroWalletFull;
  let fee: MoneroWalletFull;
  let miner: MoneroWalletFull;

  beforeAll(async () => {
    node = await startRegtest();
    payer = await fundedWallet(node.rpcUri);
    fee = await newTestWallet(node.rpcUri);
    miner = await newTestWallet(node.rpcUri);
  });

  afterAll(async () => {
    for (const w of [payer, fee, miner]) await w?.close();
    await node?.stop();
  });

  it('lists a confirmed payment to the fee wallet with its block time, never one still in the pool', async () => {
    const address = await fee.getPrimaryAddress();
    const viewKey = await fee.getPrivateViewKey();
    const cfg = feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: viewKey }, { feeWallet: address, monerod: node.rpcUri, network: 'mainnet' })!;
    const src = feeViewWallet(cfg, { regtest: true });

    const tx = await payer.createTx({ accountIndex: 0, address, amount: AMOUNT, relay: true });
    const inPool = await src.incoming();
    expect(inPool.find((t) => t.txHash === tx.getHash())).toBeUndefined();

    await mine(node.rpcUri, 2, await miner.getPrimaryAddress());
    const listed = await src.incoming();
    const got = listed.filter((t) => t.txHash === tx.getHash());
    expect(got).toHaveLength(1);
    expect(got[0]!.atomic).toBe(AMOUNT);
    expect(got[0]!.at).toBeInstanceOf(Date);
    expect(Math.abs(got[0]!.at.getTime() - Date.now())).toBeLessThan(3_600_000);
  });
});
