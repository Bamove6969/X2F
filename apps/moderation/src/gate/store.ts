import { randomBytes } from 'node:crypto';
import { mkdir, open as openFile, readFile, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { modSubkey, open, seal } from '../keystore.js';

/**
 * The ruling gate's own state (Plan 4 Task 13), `MOD_STATE_DIR/gate.bin`: JSON sealed with
 * AES-256-GCM under the `gate` subkey of MOD_KEYSTORE_KEY (HKDF, `keystore.ts`), never in any
 * database. Nothing the API can write reaches it except through `syncRegistry`, which accepts only
 * what the owner's pinned keys signed, and `authorizeRuling`, which records only what it verified.
 * A file that does not open (another key, a flipped byte) is an error, never an empty gate.
 */

/** A security key the gate trusts: its WebAuthn credential id and COSE public key (both base64url). */
export interface PinnedCred {
  credentialId: string;
  publicKey: string;
  aaguid: string | null;
  /**
   * The highest WebAuthn signature counter this gate has accepted from the key (review M1). A
   * registry tap by the key at or below it is an older tap held back and released late, and is
   * refused. 0: none seen yet.
   */
  counter?: number;
}

export type InvitableRole = 'senior' | 'mod' | 'helper';

export interface StaffEntry {
  role: InvitableRole;
  creds: PinnedCred[];
  /** Switched off (as the API shows it, no signature needed) and not switched on again by an owner tap since. */
  revoked: boolean;
  /** Removed for good: nothing restores them. */
  removed: boolean;
  /** The API has shown their staff row (the invite was finished); before that they sign nothing. */
  joined: boolean;
  /**
   * When this gate first saw their latest switch-off (or removal, or their row gone), by its own
   * clock (lead call on review P4). Only an owner switch-on signed as issued after it, less
   * `SWITCH_ON_SKEW_MS`, switches them on again.
   */
  offSeenAt?: string;
  /** The invite that brought them in; no key is taken from it once it is closed. */
  inviteId: string;
  inviteClosed: boolean;
}

export interface RulingSeen {
  code: string;
  round: 1 | 2;
  /** Who signed it (proposer, and approver when there was one), as this gate verified. R37 reads it. */
  signers: string[];
  /** When this gate first authorised it (its own clock). */
  publishedSeenAt: string;
  firstSeenFinalAt?: string;
}

export interface GateState {
  v: 1;
  /** The owner's account and pinned keys (`pin-owner`, then `add-owner-key` taps by both keys only). */
  ownerAccountId: string | null;
  ownerCreds: PinnedCred[];
  staff: Record<string, StaffEntry>;
  /** From the latest owner `settings` tap the gate saw; until one, the API's own defaults (US$1,000, 48 h). */
  limitUsdCents: bigint;
  appealWindowH: number;
  /** Every tap nonce (hex) the gate has relied on, with what it was used for. */
  usedNonces: Record<string, string>;
  rulingsSeen: Record<string, RulingSeen>;
  /** Task 14's log checkpoints (checkpoint.ts): the head's id and hash, sealed here when taken. */
  checkpoints: Array<{ id: string; hash: string; at: string }>;
  /**
   * Security review 2026-11-12, M3 re-verify (C): the last successful verification of the log (or
   * when the checkpoints first started, before any), and when the overdue alarm was raised since;
   * sealed here so a restart never resets the overdue clock. ISO times, or null.
   */
  logVerifiedAt: string | null;
  logOverdueAlarmAt: string | null;
  /**
   * Each owner invite the gate has acted on (review B1): the account it was bound to the first time
   * (never re-pointed by the database), and whether it is closed (the person joined, or it expired):
   * a closed invite adds no key.
   */
  invites: Record<string, { accountId: string; closed: boolean }>;
  /** Accounts the owner removed with a tapped `remove-staff` (review I1): never staff again. */
  removedIds: string[];
  /** The owner's tapped emergency stop (review I1): while set, no ruling is authorised. */
  stopped: boolean;
  /** Review M1: the last tap applied per subject (`settings`, `role:<id>`, `stop`), by key and counter. */
  applied: Record<string, { credentialId: string; counter: number; issuedAt?: string }>;
  /**
   * Plan 4 Task 14: each trade's ruling payout, per trade code, recorded BEFORE the moderator's party
   * is first asked and again once it finished (`execute.ts`). A trade has at most one; nothing else
   * is ever settled for it. Empty in a gate.bin written before Task 14.
   */
  executions: Record<string, RulingExecution>;
}

/** One trade's ruling payout as the executor recorded it (amounts as decimal strings). */
export interface RulingExecution {
  /** The round-1 ruling it pays (round 1 pays even after an appeal, Note 2026-10-30 M3). */
  rulingId: string;
  winner: 'buyer' | 'seller';
  /** Exactly the payouts the gate authorised, in order. */
  payouts: Array<{ address: string; amountAtomic: string }>;
  /** When it was recorded (this process's clock), before the party was asked. */
  recordedAt: string;
  /** When the party's settle() finished (the release is done); null until then. */
  settledAt: string | null;
  /** The tx hash settle() answered with: the co-signer submits, so the moderator as builder often has none. */
  settledTx: string | null;
}

/** The API's defaults (`settings` in migration 206) until the owner taps a change. */
export const DEFAULT_LIMIT_USD_CENTS = 100_000n;
export const DEFAULT_APPEAL_WINDOW_H = 48;

export function emptyGate(): GateState {
  return {
    v: 1,
    ownerAccountId: null,
    ownerCreds: [],
    staff: {},
    limitUsdCents: DEFAULT_LIMIT_USD_CENTS,
    appealWindowH: DEFAULT_APPEAL_WINDOW_H,
    usedNonces: {},
    rulingsSeen: {},
    checkpoints: [],
    logVerifiedAt: null,
    logOverdueAlarmAt: null,
    invites: {},
    removedIds: [],
    stopped: false,
    applied: {},
    executions: {},
  };
}

/** The clock skew allowed between the API (which stamps a tap's issuedAt) and this gate: 2 minutes (lead call). */
export const SWITCH_ON_SKEW_MS = 2 * 60_000;

export const GATE_FILE = 'gate.bin';
/** The gate store's lock file in MOD_STATE_DIR (`openGateStore(…, { lock: true })`): the holder's pid. */
export const GATE_LOCK_FILE = 'gate.lock';
const AAD = 'x2f/mod/gate/v1';

export interface GateStore {
  state: GateState;
  /**
   * Seals the state and replaces `gate.bin` atomically: a temp file of its own (unique name, 0600),
   * fsync, rename, fsync of the directory. Saves run one at a time (review M2).
   */
  save(): Promise<void>;
  /** Runs `fn` alone: one critical section (sync, authorize, save) on this gate at a time (review M2). */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Waits for any save under way, then refuses every later one (`gate store closed`) and gives up
   * the lock file, if this store holds it. Idempotent.
   */
  close(): Promise<void>;
}

/** True while a process with this pid runs (EPERM: it runs as someone else). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Security review 2026-11-12, M1 residual: `dir/gate.lock`, made exclusively (`wx`) with this
 * process's pid, for the store's life. Another live holder (this process included) refuses the
 * open; a lock left by a process that no longer runs is taken over. Node has no flock(2), so the
 * file and the holder's liveness are the lock: it fences a successor started on the same host
 * while this process still stops (a lost instance lock), the case the database lock cannot.
 */
async function lockDir(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, GATE_LOCK_FILE);
  const mine = `${process.pid}\n`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const f = await openFile(path, 'wx', 0o600);
      try {
        await f.writeFile(mine);
        await f.sync();
      } finally {
        await f.close();
      }
      return async () => {
        const now = await readFile(path, 'utf8').catch(() => null);
        if (now === mine) await unlink(path).catch(() => undefined);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = Number.parseInt((await readFile(path, 'utf8').catch(() => '')).trim(), 10);
      if (Number.isInteger(held) && held > 0 && alive(held)) throw new Error(`gate: ${GATE_LOCK_FILE} is locked by process ${held} (another moderation process uses this state directory)`);
      await unlink(path).catch(() => undefined);
    }
  }
  throw new Error(`gate: ${GATE_LOCK_FILE} could not be taken`);
}

/** A promise-chain mutex: each call runs after the previous one settled. */
function serial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

function toJson(s: GateState): string {
  return JSON.stringify({ ...s, limitUsdCents: s.limitUsdCents.toString() });
}

function fromJson(text: string): GateState {
  const o = JSON.parse(text) as Omit<GateState, 'limitUsdCents'> & { limitUsdCents: string };
  if (o.v !== 1 || typeof o.limitUsdCents !== 'string' || !/^[0-9]{1,20}$/.test(o.limitUsdCents)) throw new Error('gate: gate.bin is not a v1 gate');
  return { ...emptyGate(), ...o, limitUsdCents: BigInt(o.limitUsdCents) };
}

/**
 * Opens `dir/gate.bin` (a fresh gate when there is none yet; the directory is made, 0700). With
 * `lock`, the store holds `dir/gate.lock` until `close()` (the process entry's gate does; tests and
 * read-only tools open without it).
 */
export async function openGateStore(dir: string, keystoreKey: Uint8Array, o: { lock?: boolean } = {}): Promise<GateStore> {
  const key = modSubkey(keystoreKey, 'gate');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let closed = false;
  const path = join(dir, GATE_FILE);
  // Taken before the file is read, so the state read is the last holder's final save.
  const unlock = o.lock === true ? await lockDir(dir) : null;
  let state: GateState;
  try {
    let sealed: Buffer | null = null;
    try {
      sealed = await readFile(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    state = sealed === null ? emptyGate() : fromJson(new TextDecoder().decode(open(key, AAD, sealed)));
  } catch (e) {
    await unlock?.();
    throw e;
  }
  const saving = serial();
  const store: GateStore = {
    get state() {
      return state;
    },
    set state(s: GateState) {
      state = s;
    },
    save: () =>
      saving(async () => {
        if (closed) throw new Error('gate: the gate store is closed');
        const tmp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
        const f = await openFile(tmp, 'wx', 0o600);
        try {
          await f.writeFile(seal(key, AAD, new TextEncoder().encode(toJson(state))));
          await f.sync();
        } catch (e) {
          await f.close();
          await rm(tmp, { force: true });
          throw e;
        }
        await f.close();
        await rename(tmp, path);
        // The rename is durable only once the directory is: else a crash can bring back an older gate.
        const d = await openFile(dir, 'r');
        try {
          await d.sync();
        } finally {
          await d.close();
        }
      }),
    exclusive: serial(),
    async close() {
      if (closed) return;
      // After any save already queued, never during one.
      await saving(async () => {
        closed = true;
      });
      await unlock?.();
    },
  };
  return store;
}
