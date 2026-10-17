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
  | 'bad-saved-session';

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
  sync(): Promise<{ balance: bigint; unlocked: bigint }>;
  exportState(): Promise<string>;
  /** Import every peer's state in one call; importing them separately leaves stale data. */
  importState(peers: string[]): Promise<void>;
  /** Sweep the whole escrow to `payouts`; the network fee comes off payouts[0]. */
  buildRelease(payouts: Payout[]): Promise<{ txSet: string; payouts: Payout[] }>;
  /** Check the tx set against `expected`, then sign exactly that set and broadcast it. */
  cosign(txSet: string, expected: Payout[]): Promise<string>;
  /**
   * Save after every step so a paused or reloaded app can resume without redoing it.
   * Never resume a save older than the last cosign, and run a fresh exportState/importState
   * round after any resume: the cache holds signing nonces, and reusing one leaks the key (R26).
   */
  save(): Promise<SavedSession>;
  close(): Promise<void>;
}
