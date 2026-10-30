import {
  MoneroDaemonRpc,
  MoneroDestination,
  MoneroNetworkType,
  MoneroTxConfig,
  MoneroWalletConfig,
  MoneroWalletFull,
  type MoneroTxWallet,
} from 'monero-ts';
import {
  DAEMON_TIMEOUT_MS,
  EscrowError,
  type EscrowEngine,
  type EscrowSession,
  type Incoming,
  type Outgoing,
  type Payout,
  type SavedSession,
  type TxStatus,
} from './engine.js';
import { fromBase64, toBase64 } from './base64.js';
import { checkPayouts, checkTxSet, sumPayouts, type DescribedTx } from './verify.js';

export type EscrowNetwork = 'regtest' | 'stagenet' | 'mainnet';

const THRESHOLD = 2;

const TX_HASH = /^[0-9a-f]{64}$/;

/**
 * Give up on a daemon call after DAEMON_TIMEOUT_MS. The call itself may still finish later
 * (monero-ts serialises wallet calls, so later ones wait behind it); its result is dropped.
 */
async function timed<T>(p: Promise<T>, what: string, code: 'daemon-unavailable' | 'not-ready' = 'daemon-unavailable'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => undefined);
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EscrowError(code, `${what}: no answer from the daemon in ${DAEMON_TIMEOUT_MS / 1000} s`)), DAEMON_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The ed25519 group order: a secret key is a 32-byte little-endian scalar below it (monero sc_check). */
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

/** 64 lower-case hex chars encoding a non-zero, reduced scalar. */
export function isScalar(hex: string): boolean {
  if (!TX_HASH.test(hex)) return false;
  let v = 0n;
  for (let i = 31; i >= 0; i--) v = (v << 8n) | BigInt(parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  return v !== 0n && v < GROUP_ORDER;
}

/**
 * A tx secret key as wallet2's get_tx_key gives it (review round 2, R2-I2): the main key, then one
 * additional key per output when the tx pays a subaddress among other destinations
 * (`need_additional_txkeys`), concatenated. A tx has at most 16 outputs, so 1 to 17 chunks.
 */
export const TX_KEY = /^(?:[0-9a-f]{64}){1,17}$/;

/** A TX_KEY whose every 32-byte chunk is a reduced, non-zero scalar (each one reaches the derivation). */
export function isTxKey(hex: string): boolean {
  if (!TX_KEY.test(hex)) return false;
  for (let i = 0; i < hex.length; i += 64) if (!isScalar(hex.slice(i, i + 64))) return false;
  return true;
}

/** key_offsets as the daemon gives them (the first absolute, each next one relative) → absolute output indices. */
function absoluteRing(offsets: readonly (number | bigint)[]): bigint[] {
  const out: bigint[] = [];
  let at = 0n;
  for (const o of offsets) {
    at += BigInt(o);
    out.push(at);
  }
  return out;
}

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
    unlockTime: tx.getUnlockTime(),
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
    try {
      await timed((async () => {
        // The wallet caches the daemon height; refresh the connection so sync sees new blocks.
        await this.wallet.setDaemonConnection({ uri: this.daemonUri, timeoutMs: DAEMON_TIMEOUT_MS });
        await this.wallet.sync();
      })(), 'sync');
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('daemon-unavailable', `sync failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    return { balance: await this.wallet.getBalance(), unlocked: await this.wallet.getUnlockedBalance() };
  }

  async incoming(): Promise<Incoming[]> {
    const byTx = new Map<string, Incoming>();
    for (const t of await this.wallet.getTransfers({ isIncoming: true, accountIndex: 0 })) {
      const tx = t.getTx();
      const txHash = tx.getHash();
      const height = tx.getHeight();
      const cur = byTx.get(txHash) ?? {
        txHash,
        amountAtomic: 0n,
        confirmations: tx.getNumConfirmations() ?? 0,
        unlocked: tx.getIsLocked() === false,
        height: typeof height === 'number' && tx.getIsConfirmed() === true ? height : null,
      };
      cur.amountAtomic += t.getAmount();
      byTx.set(txHash, cur);
    }
    return [...byTx.values()];
  }

  async chainHeight(): Promise<number> {
    return this.wallet.getHeight();
  }

  async outgoing(): Promise<Outgoing[]> {
    const out: Outgoing[] = [];
    for (const tx of await this.wallet.getTxs({ isOutgoing: true })) {
      const txHash = tx.getHash();
      if (!TX_HASH.test(txHash) || tx.getIsOutgoing() !== true) continue;
      const height = tx.getHeight();
      out.push({
        txHash,
        height: typeof height === 'number' && tx.getIsConfirmed() === true ? height : null,
        spentAtomic: (tx.getOutgoingAmount() ?? 0n) + (tx.getFee() ?? 0n),
      });
    }
    return out;
  }

  async txKey(txHash: string): Promise<string | null> {
    if (!TX_HASH.test(txHash)) return null;
    try {
      const k = await this.wallet.getTxKey(txHash);
      return typeof k === 'string' && TX_KEY.test(k) ? k : null;
    } catch {
      return null; // "No tx secret key is stored for this tx"
    }
  }

  async proveTx(txHash: string, txKey: string, addresses: string[]): Promise<{ inBlock: boolean; feeAtomic: bigint; received: bigint[]; spendsEscrow: boolean } | null> {
    // A key that is not a reduced scalar aborts monero-ts's WebAssembly (an assertion in
    // generate_key_derivation), which breaks every later wallet call: refuse it here. Every chunk of
    // a key with additional tx keys (a subaddress payout, R2-I2) is checked the same way.
    if (!TX_HASH.test(txHash) || !isTxKey(txKey)) return null;
    let tx: Awaited<ReturnType<MoneroDaemonRpc['getTx']>>;
    try {
      tx = await timed((async () => (await this.daemonClient()).getTx(txHash))(), 'tx lookup');
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('daemon-unavailable', `tx lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    if (!tx || tx.getHash() !== txHash) return null;
    const fee = tx.getFee();
    const received: bigint[] = [];
    for (const address of addresses) {
      try {
        const c = await timed(this.wallet.checkTxKey(txHash, txKey, address), 'check tx key');
        if (c.getIsGood() !== true) return null;
        received.push(c.getReceivedAmount() ?? 0n);
      } catch (e) {
        if (e instanceof EscrowError) throw e;
        return null; // a key that does not fit, or an address of another network
      }
    }
    return {
      inBlock: tx.getIsConfirmed() === true && tx.getInTxPool() !== true,
      feeAtomic: typeof fee === 'bigint' ? fee : 0n,
      received,
      spendsEscrow: await this.spendsOwnOutput(tx),
    };
  }

  /**
   * Review round 2 (R2-I1): does `tx` spend one of THIS wallet's (the escrow's) outputs? True only
   * when some input's key image is the key image this wallet holds for one of its outputs AND that
   * output (by global index) is a member of that input's ring; and no input carries one of this
   * wallet's key images with a ring that lacks the output (that can only be a forged key image).
   * What it proves: this escrow's output is a ring member of the input whose key image this wallet
   * holds. A replay mined before the escrow was funded can never pass (a ring cannot hold a later
   * output), nor can a tx whose builder chose honest decoys.
   * What it does NOT prove: that the input really spends the escrow. A ring hides which member is
   * real, and wallet2 takes a peer's partial key images unchecked, so the key image matched here is
   * whatever a trade party's forged partials made it. Whoever builds a tx chooses its decoys: a
   * seller who builds ANOTHER trade's release (or a fresh tx from its own money) can put this
   * escrow's output in a ring and make this check true for it (review round 3, R3-I1). The
   * moderation watcher therefore counts an import-only sweep only when BOTH trade parties' sealed
   * spend.info name its hash (apps/moderation/src/watcher.ts, `proven`), and proveSweep's payout
   * check must also pass.
   */
  private async spendsOwnOutput(tx: Awaited<ReturnType<MoneroDaemonRpc['getTx']>>): Promise<boolean> {
    const inputs = tx?.getInputs() ?? [];
    if (inputs.length === 0) return false;
    const mine = new Map<string, bigint>();
    for (const o of await this.wallet.getOutputs({ accountIndex: 0 })) {
      const ki = o.getKeyImage()?.getHex();
      const index = o.getIndex();
      if (typeof ki === 'string' && /^[0-9a-f]{64}$/.test(ki) && (typeof index === 'number' || typeof index === 'bigint')) mine.set(ki, BigInt(index));
    }
    let bound = 0;
    for (const input of inputs) {
      const own = mine.get(input.getKeyImage()?.getHex() ?? '');
      if (own === undefined) continue;
      if (!absoluteRing(input.getRingOutputIndices() ?? []).includes(own)) return false;
      bound++;
    }
    return bound > 0;
  }

  exportState(): Promise<string> {
    return this.wallet.exportMultisigHex();
  }

  async importState(peers: string[]): Promise<void> {
    await this.wallet.importMultisigHex(peers);
  }

  /** The whole escrow, refusing while any of it is still locked so a release is a full sweep. */
  private async sweepableBalance(): Promise<bigint> {
    const [balance, unlocked] = [await this.wallet.getBalance(), await this.wallet.getUnlockedBalance()];
    if (balance !== unlocked) throw new EscrowError('not-ready', 'part of the escrow is still locked');
    return unlocked;
  }

  async buildRelease(payouts: Payout[]): Promise<{ txSet: string; payouts: Payout[] }> {
    checkPayouts(payouts);
    const balance = await this.sweepableBalance();
    if (sumPayouts(payouts) !== balance) throw new EscrowError('bad-payouts', 'payouts must sweep the whole escrow');
    let txs: MoneroTxWallet[];
    try {
      // A timeout here is a refused attempt (not-ready): the next attempt exports afresh.
      txs = await timed(this.wallet.createTxs(new MoneroTxConfig({
        accountIndex: 0,
        destinations: payouts.map((p) => new MoneroDestination(p.address, p.amountAtomic)),
        subtractFeeFrom: [0],
        relay: false,
      })), 'build', 'not-ready');
    } catch (e) {
      // e.g. multisig state not yet imported: a fresh attempt can recover.
      throw new EscrowError('not-ready', `could not build: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    if (txs.length !== 1) throw new EscrowError('build-failed', `expected 1 transaction, got ${txs.length}`);
    const txSet = txs[0]!.getTxSet()?.getMultisigTxHex();
    if (!txSet) throw new EscrowError('build-failed', 'no multisig tx set');
    const decoded = (await this.wallet.describeMultisigTxSet(txSet)).getTxs().map(describe);
    checkTxSet(decoded, payouts, balance);
    const txKey = txs[0]!.getKey();
    return { txSet, payouts: decoded.flatMap((tx) => tx.destinations), ...(typeof txKey === 'string' && TX_KEY.test(txKey) ? { txKey } : {}) };
  }

  async checkRelease(txSet: string, expected: Payout[]): Promise<void> {
    let txs: DescribedTx[];
    try {
      txs = (await this.wallet.describeMultisigTxSet(txSet)).getTxs().map(describe);
    } catch {
      throw new EscrowError('payout-mismatch', 'tx set could not be decoded');
    }
    checkTxSet(txs, expected, await this.sweepableBalance());
  }

  async signRelease(txSet: string, expected: Payout[]): Promise<{ signedHex: string; txHash: string }> {
    await this.checkRelease(txSet, expected);
    // Sign the exact hex that was checked; never re-fetch or rebuild it. In monero v0.18,
    // signing rebuilds the tx from the same construction data that describe decoded and
    // compares it with the stored tx, so what was checked is what gets signed.
    let signed: Awaited<ReturnType<MoneroWalletFull['signMultisigTxHex']>>;
    try {
      signed = await this.wallet.signMultisigTxHex(txSet);
    } catch (e) {
      // The wallet refused to sign (e.g. the set was built on stale nonces): nothing was signed,
      // so this is a refused attempt, not a fatal error.
      throw new EscrowError('payout-mismatch', `wallet refused to sign: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    const signedHex = signed.getSignedMultisigTxHex();
    const hashes = signed.getTxHashes() ?? [];
    if (!signedHex || hashes.length !== 1) throw new EscrowError('build-failed', 'signing produced no single tx');
    return { signedHex, txHash: hashes[0]! };
  }

  async submit(signedHex: string): Promise<string> {
    const hashes = await timed(this.wallet.submitMultisigTxHex(signedHex), 'submit');
    if (hashes.length !== 1) throw new EscrowError('build-failed', `expected 1 tx hash, got ${hashes.length}`);
    return hashes[0]!;
  }

  async cosign(txSet: string, expected: Payout[]): Promise<string> {
    const { signedHex, txHash } = await this.signRelease(txSet, expected);
    const broadcast = await this.submit(signedHex);
    if (broadcast !== txHash) throw new EscrowError('build-failed', 'broadcast tx differs from the signed tx');
    return txHash;
  }

  private daemon: Promise<MoneroDaemonRpc> | undefined;

  /** monero-ts's daemon client, in-process, on the same URI as the wallet (the node proxy in browsers). */
  private daemonClient(): Promise<MoneroDaemonRpc> {
    this.daemon ??= MoneroDaemonRpc.connectToDaemonRpc({ server: { uri: this.daemonUri, timeoutMs: DAEMON_TIMEOUT_MS }, proxyToWorker: false });
    this.daemon.catch(() => {
      this.daemon = undefined;
    });
    return this.daemon;
  }

  async txStatus(txHash: string): Promise<TxStatus> {
    if (!TX_HASH.test(txHash)) return 'none';
    let tx: Awaited<ReturnType<MoneroDaemonRpc['getTx']>>;
    try {
      tx = await timed((async () => (await this.daemonClient()).getTx(txHash))(), 'tx lookup');
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('daemon-unavailable', `tx lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    if (!tx || tx.getHash() !== txHash) return 'none';
    if (tx.getIsConfirmed() === true && tx.getInTxPool() !== true) return 'block';
    return tx.getInTxPool() === true ? 'pool' : 'none';
  }

  async txSeen(txHash: string): Promise<boolean> {
    return (await this.txStatus(txHash)) === 'block';
  }

  async spentBy(txHash: string): Promise<boolean> {
    if (!TX_HASH.test(txHash)) return false;
    try {
      const txs = await this.wallet.getTxs({ hashes: [txHash], isOutgoing: true, isConfirmed: true });
      return txs.length === 1 && txs[0]!.getHash() === txHash && txs[0]!.getIsOutgoing() === true && txs[0]!.getIsConfirmed() === true;
    } catch {
      return false;
    }
  }

  async save(): Promise<SavedSession> {
    const [keys, cache] = await this.wallet.getData();
    if (!keys || !cache) throw new EscrowError('bad-saved-session', 'wallet returned no data to save');
    return { v: 1, keys: toBase64(keys), cache: toBase64(cache) };
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

  async resume(saved: SavedSession, o: { daemonUri: string; password: string }): Promise<MoneroMultisigSession> {
    if (saved?.v !== 1 || typeof saved.keys !== 'string' || typeof saved.cache !== 'string') {
      throw new EscrowError('bad-saved-session');
    }
    const config = walletConfig(this.opts.network, o.daemonUri, o.password);
    try {
      config.setKeysData(fromBase64(saved.keys));
      config.setCacheData(fromBase64(saved.cache));
    } catch {
      throw new EscrowError('bad-saved-session', 'not base64');
    }
    // monero-ts 0.11.16 drops the regtest flag when a worker reopens wallet data, so a
    // resumed regtest wallet runs in-process. Other networks keep the worker.
    if (this.opts.network === 'regtest') config.setProxyToWorker(false);
    let wallet: MoneroWalletFull;
    try {
      wallet = await MoneroWalletFull.openWallet(config);
    } catch {
      throw new EscrowError('bad-saved-session', 'could not open (corrupt data or wrong password)');
    }
    return new MoneroMultisigSession(wallet, o.daemonUri, o.password);
  }
}
