import { randomBytes } from 'node:crypto';
import { access, mkdir, open as openFile, readFile, rename, rm } from 'node:fs/promises';
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
  /** Task 14's log checkpoints (NEEDS_TASK_14). */
  checkpoints: Array<{ id: string; hash: string; at: string }>;
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
    invites: {},
    removedIds: [],
    stopped: false,
    applied: {},
  };
}

/** The clock skew allowed between the API (which stamps a tap's issuedAt) and this gate: 2 minutes (lead call). */
export const SWITCH_ON_SKEW_MS = 2 * 60_000;
/** Re-verify N4 (lead call): a registry tap first seen more than this long after its issuedAt is refused. */
export const MAX_TAP_AGE_MS = 24 * 3_600_000;
/** Re-verify N6 (lead call): the two `add-owner-key` taps are issued within this long of each other. */
export const ADD_OWNER_KEY_PAIR_MS = 10 * 60_000;

export const GATE_FILE = 'gate.bin';
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
 * Opens `dir/gate.bin`. A missing file is an error (re-verify P6): a deleted or moved gate must
 * never come back as an empty, re-pinnable one. Only `init: true` (the `init-gate` command, after
 * the operator's "yes", `initGate`) starts a fresh gate, and only where none exists yet.
 */
export async function openGateStore(dir: string, keystoreKey: Uint8Array, o: { init?: boolean } = {}): Promise<GateStore> {
  const key = modSubkey(keystoreKey, 'gate');
  const path = join(dir, GATE_FILE);
  let sealed: Buffer | null = null;
  try {
    sealed = await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (sealed === null && o.init !== true) throw new Error(`gate: ${GATE_FILE} is missing (a new gate is made only by init-gate)`);
  if (sealed === null) await mkdir(dir, { recursive: true, mode: 0o700 });
  let state: GateState = sealed === null ? emptyGate() : fromJson(new TextDecoder().decode(open(key, AAD, sealed)));
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
  };
  return store;
}

export type InitResult = 'created' | 'declined' | 'exists';

/**
 * `init-gate` (re-verify P6): makes a new, empty, unpinned `gate.bin` only where none exists, and
 * only after the operator types `yes`. Then `pin-owner` pins the owner's keys.
 */
export async function initGate(o: { dir: string; keystoreKey: Uint8Array; print: (line: string) => void; confirm: (q: string) => Promise<string> }): Promise<InitResult> {
  const path = join(o.dir, GATE_FILE);
  const exists = await access(path).then(() => true, () => false);
  if (exists) return 'exists';
  o.print(`No ruling gate at ${path}. A new gate trusts nobody until pin-owner pins the owner's keys.`);
  o.print('If a gate was here before, it was deleted or moved: find out why before you make a new one.');
  if ((await o.confirm('Type yes to make a new, empty gate: ')).trim() !== 'yes') return 'declined';
  // Created with O_EXCL (round 3): a gate.bin that appeared while this asked is never replaced.
  await mkdir(o.dir, { recursive: true, mode: 0o700 });
  let f;
  try {
    f = await openFile(path, 'wx', 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw e;
  }
  try {
    await f.writeFile(seal(modSubkey(o.keystoreKey, 'gate'), AAD, new TextEncoder().encode(toJson(emptyGate()))));
    await f.sync();
  } finally {
    await f.close();
  }
  const d = await openFile(o.dir, 'r');
  try {
    await d.sync();
  } finally {
    await d.close();
  }
  return 'created';
}
