import {
  MoneroDestination,
  MoneroNetworkType,
  MoneroTxConfig,
  MoneroWalletConfig,
  MoneroWalletFull,
  type MoneroTxWallet,
} from 'monero-ts';
import { EscrowError, type EscrowEngine, type EscrowSession, type Payout } from './engine.js';
import { checkPayouts, checkTxSet, sumPayouts, type DescribedTx } from './verify.js';

export type EscrowNetwork = 'regtest' | 'stagenet' | 'mainnet';

const THRESHOLD = 2;

function walletConfig(network: EscrowNetwork, daemonUri: string, password: string): MoneroWalletConfig {
  return new MoneroWalletConfig({
    // regtest uses the mainnet address format
    networkType: network === 'stagenet' ? MoneroNetworkType.STAGENET : MoneroNetworkType.MAINNET,
    regtest: network === 'regtest',
    password,
    server: { uri: daemonUri },
  });
}

function describe(tx: MoneroTxWallet): DescribedTx {
  const dests = tx.getOutgoingTransfer()?.getDestinations() ?? [];
  return {
    fee: tx.getFee(),
    changeAmount: tx.getChangeAmount(),
    inputSum: tx.getInputSum(),
    outputSum: tx.getOutputSum(),
    destinations: dests.map((d) => ({ address: d.getAddress(), amountAtomic: d.getAmount() })),
  };
}

export class MoneroMultisigSession implements EscrowSession {
  constructor(
    /** Exposed for tests that build hostile tx sets; product code never touches it. */
    readonly wallet: MoneroWalletFull,
    private readonly daemonUri: string,
    private readonly password: string,
  ) {}

  prepare(): Promise<string> {
    return this.wallet.prepareMultisig();
  }

  make(peers: string[]): Promise<string> {
    return this.wallet.makeMultisig(peers, THRESHOLD, this.password);
  }

  async exchange(peers: string[]): Promise<{ hex: string; ready: boolean }> {
    const result = await this.wallet.exchangeMultisigKeys(peers, this.password);
    const ready = (await this.wallet.getMultisigInfo()).getIsReady();
    return { hex: result.getMultisigHex() ?? '', ready };
  }

  async address(): Promise<string> {
    if (!(await this.wallet.getMultisigInfo()).getIsReady()) throw new EscrowError('not-ready');
    return this.wallet.getPrimaryAddress();
  }

  async sync(): Promise<{ balance: bigint; unlocked: bigint }> {
    // The wallet caches the daemon height; refresh the connection so sync sees new blocks.
    await this.wallet.setDaemonConnection({ uri: this.daemonUri });
    await this.wallet.sync();
    return { balance: await this.wallet.getBalance(), unlocked: await this.wallet.getUnlockedBalance() };
  }

  exportState(): Promise<string> {
    return this.wallet.exportMultisigHex();
  }

  async importState(peers: string[]): Promise<void> {
    await this.wallet.importMultisigHex(peers);
  }

  async buildRelease(payouts: Payout[]): Promise<{ txSet: string; payouts: Payout[] }> {
    checkPayouts(payouts);
    const unlocked = await this.wallet.getUnlockedBalance();
    if (sumPayouts(payouts) !== unlocked) throw new EscrowError('bad-payouts', 'payouts must sweep the whole escrow');
    const txs = await this.wallet.createTxs(new MoneroTxConfig({
      accountIndex: 0,
      destinations: payouts.map((p) => new MoneroDestination(p.address, p.amountAtomic)),
      subtractFeeFrom: [0],
      relay: false,
    }));
    if (txs.length !== 1) throw new EscrowError('build-failed', `expected 1 transaction, got ${txs.length}`);
    const txSet = txs[0]!.getTxSet()?.getMultisigTxHex();
    if (!txSet) throw new EscrowError('build-failed', 'no multisig tx set');
    const decoded = await this.wallet.describeMultisigTxSet(txSet);
    return { txSet, payouts: decoded.getTxs().flatMap((tx) => describe(tx).destinations) };
  }

  async cosign(txSet: string, expected: Payout[]): Promise<string> {
    const decoded = await this.wallet.describeMultisigTxSet(txSet);
    checkTxSet(decoded.getTxs().map(describe), expected, await this.wallet.getUnlockedBalance());
    // Sign the exact hex that was checked; never re-fetch or rebuild it.
    const signed = await this.wallet.signMultisigTxHex(txSet);
    const hex = signed.getSignedMultisigTxHex();
    if (!hex) throw new EscrowError('build-failed', 'signing produced no tx');
    const hashes = await this.wallet.submitMultisigTxHex(hex);
    if (hashes.length !== 1) throw new EscrowError('build-failed', `expected 1 tx hash, got ${hashes.length}`);
    return hashes[0]!;
  }

  close(): Promise<void> {
    return this.wallet.close();
  }
}

export class MoneroMultisigEngine implements EscrowEngine {
  constructor(private readonly opts: { network: EscrowNetwork }) {}

  async create(o: { daemonUri: string; password: string }): Promise<MoneroMultisigSession> {
    const wallet = await MoneroWalletFull.createWallet(walletConfig(this.opts.network, o.daemonUri, o.password));
    return new MoneroMultisigSession(wallet, o.daemonUri, o.password);
  }
}
