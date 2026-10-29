/** One output of a release: an address and an amount in atomic units. */
export interface Payout {
  address: string;
  amountAtomic: bigint;
}

export type EscrowErrorCode =
  | 'payout-mismatch'
  | 'bad-payouts'
  | 'not-ready'
  | 'build-failed'
  | 'bad-saved-session'
  /** The daemon did not answer in time (DAEMON_TIMEOUT_MS) or could not be reached: retry later. */
  | 'daemon-unavailable';

/** Every daemon call (wallet sync, tx lookup, submit, building a tx) gives up after this long. */
export const DAEMON_TIMEOUT_MS = 15_000;

/** One transaction paying the escrow, as the escrow's own wallet sees it (pool included). */
export interface Incoming {
  txHash: string;
  amountAtomic: bigint;
  /** 0 while in the pool. */
  confirmations: number;
  /** Spendable: the wallet's 10-block unlock has passed. */
  unlocked: boolean;
}

/** Where the daemon has a transaction: nowhere, in the pool, or in a block. */
export type TxStatus = 'none' | 'pool' | 'block';

export class EscrowError extends Error {
  readonly code: EscrowErrorCode;
  constructor(code: EscrowErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EscrowError';
    this.code = code;
  }
}

/** A session's wallet as saved bytes: base64 keys (encrypted by the password) and cache. */
export interface SavedSession {
  v: 1;
  keys: string;
  cache: string;
}

export interface EscrowEngine {
  create(o: { daemonUri: string; password: string }): Promise<EscrowSession>;
  resume(saved: SavedSession, o: { daemonUri: string; password: string }): Promise<EscrowSession>;
}

/**
 * One party's side of a 2-of-3 escrow. Setup is prepare → make → exchange (repeat until
 * ready). Spending needs exportState/importState with the co-signer first.
 */
export interface EscrowSession {
  prepare(): Promise<string>;
  make(peers: string[]): Promise<string>;
  exchange(peers: string[]): Promise<{ hex: string; ready: boolean }>;
  address(): Promise<string>;
  /** Throws EscrowError('daemon-unavailable') when the daemon times out or can't be reached. */
  sync(): Promise<{ balance: bigint; unlocked: bigint }>;
  /** Every transaction paying the escrow, from the last sync (pool included). */
  incoming(): Promise<Incoming[]>;
  exportState(): Promise<string>;
  /** Import every peer's state in one call; importing them separately leaves stale data. */
  importState(peers: string[]): Promise<void>;
  /** Sweep the whole escrow to `payouts`; the network fee comes off payouts[0]. */
  buildRelease(payouts: Payout[]): Promise<{ txSet: string; payouts: Payout[] }>;
  /** Check the tx set against `expected`, then sign exactly that set and broadcast it. */
  cosign(txSet: string, expected: Payout[]): Promise<string>;
  /** Decode and check a tx set without signing. Any failure is EscrowError('payout-mismatch'). */
  checkRelease(txSet: string, expected: Payout[]): Promise<void>;
  /** cosign's first half: check, then sign. Nothing is signed if the check fails. */
  signRelease(txSet: string, expected: Payout[]): Promise<{ signedHex: string; txHash: string }>;
  /** cosign's second half: broadcast a signed set; returns its tx hash. */
  submit(signedHex: string): Promise<string>;
  /** Where the daemon has this tx. Throws EscrowError('daemon-unavailable') on a timeout. */
  txStatus(txHash: string): Promise<TxStatus>;
  /** True only for a tx in a block, never one that is only in the pool. */
  txSeen(txHash: string): Promise<boolean>;
  /**
   * True only when this wallet, as of its last sync, records txHash as a confirmed tx that
   * spent the escrow's own outputs (it holds the key images after the export round). A real
   * tx that paid the escrow, or any other tx, is false.
   */
  spentBy(txHash: string): Promise<boolean>;
  /**
   * Save after every step so a paused or reloaded app can resume without redoing it.
   * Never resume a save older than the last cosign, and run a fresh exportState/importState
   * round after any resume: the cache holds signing nonces, and reusing one leaks the key (R26).
   */
  save(): Promise<SavedSession>;
  close(): Promise<void>;
}
