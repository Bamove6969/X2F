import { mkdir, open as openFile, readFile, rename } from 'node:fs/promises';
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
  };
}

export const GATE_FILE = 'gate.bin';
const AAD = 'x2f/mod/gate/v1';

export interface GateStore {
  state: GateState;
  /** Seals the state and replaces `gate.bin` atomically (write, fsync, rename), mode 0600. */
  save(): Promise<void>;
}

function toJson(s: GateState): string {
  return JSON.stringify({ ...s, limitUsdCents: s.limitUsdCents.toString() });
}

function fromJson(text: string): GateState {
  const o = JSON.parse(text) as Omit<GateState, 'limitUsdCents'> & { limitUsdCents: string };
  if (o.v !== 1 || typeof o.limitUsdCents !== 'string' || !/^[0-9]{1,20}$/.test(o.limitUsdCents)) throw new Error('gate: gate.bin is not a v1 gate');
  return { ...emptyGate(), ...o, limitUsdCents: BigInt(o.limitUsdCents) };
}

/** Opens `dir/gate.bin` (a fresh gate when there is none yet; the directory is made, 0700). */
export async function openGateStore(dir: string, keystoreKey: Uint8Array): Promise<GateStore> {
  const key = modSubkey(keystoreKey, 'gate');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, GATE_FILE);
  let state: GateState;
  let sealed: Buffer | null = null;
  try {
    sealed = await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  state = sealed === null ? emptyGate() : fromJson(new TextDecoder().decode(open(key, AAD, sealed)));
  const store: GateStore = {
    get state() {
      return state;
    },
    set state(s: GateState) {
      state = s;
    },
    async save() {
      const tmp = `${path}.${process.pid}.tmp`;
      const f = await openFile(tmp, 'w', 0o600);
      try {
        await f.writeFile(seal(key, AAD, new TextEncoder().encode(toJson(state))));
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(tmp, path);
    },
  };
  return store;
}
