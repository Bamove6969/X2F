/**
 * The moderator party's decisions (Task 9), pure. The moderation service (apps/moderation, after
 * Task 8) runs `runParty` as `mod` for each attested trade, reports `setup-done { escrowAddress }`
 * on `ready()`, and keeps the party (the watcher reads the escrow only through its `funds()`) until
 * the watch of a closed escrow ends.
 */
import { normalizeTradeCode } from '@x2f/core';
import type { EscrowEngine, PartyArgs, PartyStore, Transport } from '@x2f/escrow';
import { channelFor } from './channels.js';
import type { TradeState } from './machine.js';

/**
 * SEAM (Task 8 not merged yet; tripwire in test/task8-tripwire.test.ts): a copy of `ModPartyArgs`
 * as exported by apps/moderation/src/main.ts on wip/t3-p3-task8, what Task 8's loop hands to its
 * `runParty` hook once a trade is attested and sealed. Replace with Task 8's type when it lands.
 */
export interface ModPartyArgs {
  trade: string;
  role: 'mod';
  me: PartyArgs['me'];
  participants: PartyArgs['participants'];
  /** R27: the trade's own escrow wallet password, 32 random bytes as hex, from `mod_wallet_secrets`. */
  password: string;
  daemonUri: string;
  feeWallet: string;
}

const PASSWORD = /^[0-9a-f]{64}$/;

/**
 * The `runParty` arguments for the moderator: role `mod`, on `channelFor(code, 'escrow')` (never
 * the trade code), with the attested participants and the trade's R27 wallet secret. Refuses a
 * password that is not 32 bytes as lower-case hex, any role but `mod`, a bad code, and keys that
 * are not the attested mod slot.
 */
export async function modPartyArgs(
  a: ModPartyArgs,
  io: { transport: Transport; engine: EscrowEngine; store: PartyStore },
): Promise<PartyArgs> {
  if (a.role !== 'mod') throw new RangeError('moderator party: role must be mod');
  if (typeof a.password !== 'string' || !PASSWORD.test(a.password)) throw new RangeError('moderator party: bad wallet secret');
  const code = typeof a.trade === 'string' ? normalizeTradeCode(a.trade) : null;
  if (code === null) throw new RangeError('moderator party: bad trade code');
  const slot = a.participants.mod;
  if (slot.signPublic !== a.me.signPublic || slot.boxPublic !== a.me.boxPublic) throw new RangeError('moderator party: not the attested mod');
  return {
    role: 'mod',
    trade: await channelFor(code, 'escrow'),
    me: a.me,
    participants: a.participants,
    transport: io.transport,
    engine: io.engine,
    daemonUri: a.daemonUri,
    password: a.password,
    store: io.store,
  };
}

export interface ModPartyFacts {
  /** Task 8 has attested the trade and sealed the mod party (`mod_party_state`). */
  attested: boolean;
  /** This process has a running party handle for the trade. */
  running: boolean;
  /** The address `ready()` resolved with (all three parties confirmed it), or null. */
  escrowAddress: string | null;
  setupDoneReported: boolean;
  /** The trade's state from the API work list. */
  apiState: TradeState;
  /** The watcher's verdict: false once a closed escrow has been watched for 30 days. */
  watching: boolean;
}

export interface ModPartyPlan {
  /** Start (or, after a restart, resume from `mod_party_state`) the party. */
  start: boolean;
  /** Report `setup-done { escrowAddress }` with this address. */
  reportSetupDone: string | null;
  stop: boolean;
}

const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];

export function modPartyPlan(f: ModPartyFacts): ModPartyPlan {
  const hasAddress = typeof f.escrowAddress === 'string' && f.escrowAddress !== '';
  // A trade that closed before any escrow existed has nothing to watch.
  const needed = f.watching && !(CLOSED.includes(f.apiState) && !hasAddress);
  return {
    start: f.attested && !f.running && needed,
    reportSetupDone: f.running && hasAddress && !f.setupDoneReported && f.apiState === 'setup' ? f.escrowAddress : null,
    stop: f.running && !needed,
  };
}
