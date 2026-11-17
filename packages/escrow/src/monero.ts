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
import { useFetchForInProcessWallets } from './inProcessHttp.js';
import { checkPayouts, checkTxSet, feeBearers, feeCeiling, feeSplitLayout, parseFeeEstimate, sumPayouts, type DescribedTx, type FeeEstimate } from './verify.js';

export type EscrowNetwork = 'regtest' | 'stagenet' | 'mainnet';

const THRESHOLD = 2;
const SIGNERS = 3;

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

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Monero base58: 8-byte blocks of 11 characters; a short last block of n characters holds DECODED[n] bytes. */
const DECODED = [0, -1, 1, 2, -1, 3, 4, 5, -1, 6, 7, 8];

function base58Decode(s: string): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 11) {
    const block = s.slice(i, i + 11);
    const n = DECODED[block.length] ?? -1;
    if (n < 0) return null;
    let v = 0n;
    for (const c of block) {
      const d = BASE58.indexOf(c);
      if (d < 0) return null;
      v = v * 58n + BigInt(d);
    }
    if (v >> BigInt(8 * n) !== 0n) return null; // overflows its block
    const bytes: number[] = [];
    for (let k = 0; k < n; k++) {
      bytes.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

/** wallet2's first multisig kex message (prepare_multisig): this magic, then base58 of 128 bytes. */
const KEX_ROUND1 = 'MultisigxV2R1';

/**
 * The signer key a round-1 kex message (prepare_multisig) names, as lower-case hex; null for
 * anything else. wallet2 lays the message out as msg privkey (32) | signing pubkey (32) |
 * signature (64). The signing pubkey is the signer's base key in the multisig: wallet2 derives it
 * from the wallet's spend secret (blinded with a hash), so it is not the public spend key, but the
 * same wallet always names the same one. Only its shape is read here; wallet2 checks the
 * signature in makeMultisig.
 */
export function kexSignerKey(message: string): string | null {
  if (typeof message !== 'string' || !message.startsWith(KEX_ROUND1)) return null;
  const raw = base58Decode(message.slice(KEX_ROUND1.length));
  if (!raw || raw.length !== 128) return null;
  let hex = '';
  for (const b of raw.subarray(32, 64)) hex += b.toString(16).padStart(2, '0');
  return hex;
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

/**
 * Where monerod's `/get_transactions` answer puts `txHash`: 'block' only for that exact hash, out
 * of the pool and at a block height; 'pool' for that hash in the pool; 'none' only when the daemon
 * names the hash in `missed_tx` (it does not have it). Every other answer, an OK one that names the
 * hash nowhere or in an entry of another shape included, is EscrowError('daemon-unavailable')
 * (retried), never 'none' (security review L1, 10 Nov).
 */
export function txStatusOf(body: unknown, txHash: string): TxStatus {
  const r = body as { status?: unknown; txs?: unknown; missed_tx?: unknown } | null;
  if (typeof r !== 'object' || r === null || r.status !== 'OK') throw new EscrowError('daemon-unavailable', 'tx lookup: no OK answer');
  if (r.txs !== undefined && !Array.isArray(r.txs)) throw new EscrowError('daemon-unavailable', 'tx lookup: malformed answer');
  if (r.missed_tx !== undefined && !Array.isArray(r.missed_tx)) throw new EscrowError('daemon-unavailable', 'tx lookup: malformed answer');
  const tx = ((r.txs ?? []) as unknown[]).find((t): t is { tx_hash: string; in_pool?: unknown; block_height?: unknown } =>
    typeof t === 'object' && t !== null && (t as { tx_hash?: unknown }).tx_hash === txHash,
  );
  if (tx) {
    if (tx.in_pool === true) return 'pool';
    if (tx.in_pool === false && typeof tx.block_height === 'number' && Number.isSafeInteger(tx.block_height) && tx.block_height > 0) return 'block';
    throw new EscrowError('daemon-unavailable', 'tx lookup: the tx is neither in the pool nor in a block');
  }
  if (((r.missed_tx ?? []) as unknown[]).includes(txHash)) return 'none';
  throw new EscrowError('daemon-unavailable', 'tx lookup: the answer does not name the tx');
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

  /**
   * Review multisig-vs-RetoSwap F3 (12 Nov): exactly two peers, whose round-1 messages name signer
   * keys distinct from each other and from this wallet's own, or EscrowError('bad-multisig') before
   * the wallet becomes multisig (so no escrow address ever comes of it). wallet2 refuses duplicate
   * signers too; this does not rely on it.
   */
  async make(peers: string[]): Promise<string> {
    if (!Array.isArray(peers) || peers.length !== SIGNERS - 1) throw new EscrowError('bad-multisig', `expected ${SIGNERS - 1} peers, got ${Array.isArray(peers) ? peers.length : 0}`);
    const keys = peers.map(kexSignerKey);
    if (keys.some((k) => k === null)) throw new EscrowError('bad-multisig', 'a peer setup message is not a round-1 kex message');
    // This wallet's own signer key, from its own round-1 message: get_multisig_first_kex_msg is
    // const and deterministic in the key it names, so asking again changes nothing.
    const own = kexSignerKey(await this.wallet.prepareMultisig());
    if (own === null) throw new EscrowError('bad-multisig', 'this wallet gives no round-1 kex message');
    if (new Set([own, ...keys]).size !== SIGNERS) throw new EscrowError('bad-multisig', 'two signers share a key');
    return this.wallet.makeMultisig(peers, THRESHOLD, this.password);
  }

  async exchange(peers: string[]): Promise<{ hex: string; ready: boolean }> {
    const result = await this.wallet.exchangeMultisigKeys(peers, this.password);
    const ready = (await this.wallet.getMultisigInfo()).getIsReady();
    return { hex: result.getMultisigHex() ?? '', ready };
  }

  /**
   * Review F3: the address only of a finished wallet that is exactly a 2-of-3 multisig; any other
   * shape is EscrowError('bad-multisig') and its address is never read, so never shown.
   */
  async address(): Promise<string> {
    const info = await this.wallet.getMultisigInfo();
    if (!info.getIsReady()) throw new EscrowError('not-ready');
    if (info.getIsMultisig() !== true || info.getThreshold() !== THRESHOLD || info.getNumParticipants() !== SIGNERS) {
      throw new EscrowError('bad-multisig', `not a ${THRESHOLD}-of-${SIGNERS} multisig wallet`);
    }
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
      const fee = tx.getFee();
      out.push({
        txHash,
        height: typeof height === 'number' && tx.getIsConfirmed() === true ? height : null,
        spentAtomic: (tx.getOutgoingAmount() ?? 0n) + (fee ?? 0n),
        ...(typeof fee === 'bigint' && fee >= 0n ? { feeAtomic: fee } : {}),
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
      // The receivers marked bearsNetworkFee pay the network fee (owner 16 Nov), else payout 0. The
      // list goes to the wallet in the order where wallet2's pay order and monero-ts agree on which
      // outputs those are (feeSplitLayout); checkTxSet matches outputs by address.
      const layout = feeSplitLayout(feeBearers(payouts));
      txs = await timed(this.wallet.createTxs(new MoneroTxConfig({
        accountIndex: 0,
        destinations: layout.order.map((i) => new MoneroDestination(payouts[i]!.address, payouts[i]!.amountAtomic)),
        subtractFeeFrom: layout.subtractFrom,
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

  /**
   * The co-signer's check. The network fee is bounded by feeCeiling (review F4): a multiple of the
   * daemon's normal-priority fee for the tx's estimated weight, never above 0.01 XMR. The sweep
   * spends every output the escrow holds (inputs = the balance), and nothing else ever spends them,
   * so the count of the escrow's outputs is the input count (an upper bound at worst, which only
   * raises the bound); outputs are the payouts, at least 2 (wallet2 adds a dummy to a 1-output tx).
   * Resolves with the bound it checked against. With `maxFee` (the bound of an earlier check of
   * the same set, review M3) the daemon is not asked: that bound is used, under MAX_NETWORK_FEE.
   */
  async checkRelease(txSet: string, expected: Payout[], maxFee?: bigint): Promise<bigint> {
    let txs: DescribedTx[];
    try {
      txs = (await this.wallet.describeMultisigTxSet(txSet)).getTxs().map(describe);
    } catch {
      throw new EscrowError('payout-mismatch', 'tx set could not be decoded');
    }
    const balance = await this.sweepableBalance();
    let bound = maxFee;
    if (bound === undefined) {
      const inputs = Math.max(1, (await this.wallet.getOutputs({ accountIndex: 0 })).length);
      const outputs = Math.max(2, txs[0]?.destinations.length ?? 0);
      bound = feeCeiling(await this.feeEstimate(), inputs, outputs);
    }
    checkTxSet(txs, expected, balance, bound);
    return bound;
  }

  /**
   * monerod's json_rpc `get_fee_estimate` (10 grace blocks, as wallet2 asks), read with a plain
   * `fetch` like txStatus (the node proxy allows it). No answer, or no usable one, is
   * EscrowError('daemon-unavailable'): the check runs again later, it never passes without a bound.
   */
  private async feeEstimate(): Promise<FeeEstimate> {
    let body: unknown;
    try {
      body = await timed((async () => {
        const res = await fetch(`${this.daemonUri.replace(/\/+$/, '')}/json_rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_fee_estimate', params: { grace_blocks: 10 } }),
          signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
      })(), 'fee estimate');
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('daemon-unavailable', `fee estimate failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    return parseFeeEstimate(body);
  }

  async signRelease(txSet: string, expected: Payout[], maxFee?: bigint): Promise<{ signedHex: string; txHash: string }> {
    // Review M3: the co-signer passes the bound of its first check, so this re-check is offline.
    await this.checkRelease(txSet, expected, maxFee);
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

  /**
   * monero-ts's daemon client, in-process, on the same URI as the wallet. Only proveTx (the
   * moderator, in Node) uses it: in the web app's bundle its HTTP cannot send (see txStatus).
   */
  private daemonClient(): Promise<MoneroDaemonRpc> {
    this.daemon ??= MoneroDaemonRpc.connectToDaemonRpc({ server: { uri: this.daemonUri, timeoutMs: DAEMON_TIMEOUT_MS }, proxyToWorker: false });
    this.daemon.catch(() => {
      this.daemon = undefined;
    });
    return this.daemon;
  }

  /**
   * The daemon's own view of one tx: monerod's `/get_transactions`, read with a plain `fetch` (the
   * node proxy allows that path), never monero-ts's in-process HTTP client. In the web app's bundle
   * that client cannot send at all: its Node `http`/`https` imports resolve to an empty module, so
   * `new http.Agent()` throws before any request ("o.default.Agent is not a constructor"). Every
   * lookup in the escrow worker was then 'daemon-unavailable', retried every tick and never
   * answered, so a builder never saw its release in a block (P0, 8 Nov; seen in the demo's seller
   * worker on 10 Nov). The wallet's own calls run in monero-ts's prebuilt worker, whose HTTP works.
   * The request is aborted after DAEMON_TIMEOUT_MS, and `timed` bounds the reading of the body too.
   */
  async txStatus(txHash: string): Promise<TxStatus> {
    if (!TX_HASH.test(txHash)) return 'none';
    let body: unknown;
    try {
      body = await timed((async () => {
        const res = await fetch(`${this.daemonUri.replace(/\/+$/, '')}/get_transactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txs_hashes: [txHash], decode_as_json: false, prune: true }),
          signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
          // Only the configured daemon answers, fresh, and nothing of this origin is sent (review L3).
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
      })(), 'tx lookup');
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('daemon-unavailable', `tx lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    return txStatusOf(body, txHash);
  }

  async txSeen(txHash: string): Promise<boolean> {
    return (await this.txStatus(txHash)) === 'block';
  }

  async spentBy(txHash: string): Promise<boolean> {
    if (!TX_HASH.test(txHash)) return false;
    try {
      const txs = await timed(this.wallet.getTxs({ hashes: [txHash], isOutgoing: true, isConfirmed: true }), 'spent by');
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
    // resumed regtest wallet runs in-process. Other networks keep the worker. In-process, its
    // daemon requests go through a plain fetch (inProcessHttp.ts): in the web app's bundle
    // monero-ts's own in-process client cannot send, so a reloaded page never synced (10 Nov).
    if (this.opts.network === 'regtest') {
      config.setProxyToWorker(false);
      await useFetchForInProcessWallets(o.daemonUri);
    }
    let wallet: MoneroWalletFull;
    try {
      wallet = await MoneroWalletFull.openWallet(config);
    } catch {
      throw new EscrowError('bad-saved-session', 'could not open (corrupt data or wrong password)');
    }
    return new MoneroMultisigSession(wallet, o.daemonUri, o.password);
  }
}
