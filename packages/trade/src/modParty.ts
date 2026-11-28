/**
 * The moderator party's decisions (Task 9), pure. The moderation service (apps/moderation, Task
 * 8) runs `runParty` as `mod` for each attested trade, reports `setup-done { escrowAddress }`
 * on `ready()`, and keeps the party (the watcher reads the escrow only through its `funds()`) until
 * the watch of a closed escrow ends.
 */
import { normalizeTradeCode } from '@x2f/core';
import type { EscrowEngine, PartyArgs, PartyStore, Transport } from '@x2f/escrow';
import { isAttestedTerms, type AttestedTerms } from './attestation.js';
import { channelFor } from './channels.js';
import { isClosed, type TradeState } from './machine.js';

/**
 * What the moderation service's loop (apps/moderation/src/main.ts, Task 8) hands to its `runParty`
 * hook once a trade is attested and sealed. Defined here once; apps/moderation imports it.
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
  /** X2F's payroll wallet (`X2F_PAYROLL_WALLET`): the other half of every 1% (owner 26 Nov). */
  payrollWallet: string;
  /**
   * The terms this service attested (review M5): from its own `signed_terms` record, never a later
   * API read. The watcher and the settle checks (e.g. the mod's derived refund payout) use these.
   */
  terms: AttestedTerms;
}

const PASSWORD = /^[0-9a-f]{64}$/;

/**
 * The `runParty` arguments for the moderator: role `mod`, on `channelFor(code, 'escrow')` (never
 * the trade code), with the attested participants and the trade's R27 wallet secret. The transport
 * is built by `io.transport` on that same channel (the wrapper passes e.g.
 * `(channel) => wsTransport({ url, code: channel, role: 'mod', me })`), and the channel is returned
 * too. Refuses, before building anything, a password that is not 32 bytes as lower-case hex, any
 * role but `mod`, terms that are not the attested terms shape, a bad code, and keys that are not the
 * attested mod slot.
 */
export async function modPartyArgs(
  a: ModPartyArgs,
  io: { transport: (channel: string) => Transport; engine: EscrowEngine; store: PartyStore },
): Promise<{ args: PartyArgs; channel: string }> {
  if (a.role !== 'mod') throw new RangeError('moderator party: role must be mod');
  if (!isAttestedTerms(a.terms)) throw new RangeError('moderator party: bad attested terms');
  if (typeof a.password !== 'string' || !PASSWORD.test(a.password)) throw new RangeError('moderator party: bad wallet secret');
  const code = typeof a.trade === 'string' ? normalizeTradeCode(a.trade) : null;
  if (code === null) throw new RangeError('moderator party: bad trade code');
  const slot = a.participants.mod;
  if (slot.signPublic !== a.me.signPublic || slot.boxPublic !== a.me.boxPublic) throw new RangeError('moderator party: not the attested mod');
  const channel = await channelFor(code, 'escrow');
  const args: PartyArgs = {
    role: 'mod',
    trade: channel,
    me: a.me,
    participants: a.participants,
    transport: io.transport(channel),
    engine: io.engine,
    daemonUri: a.daemonUri,
    password: a.password,
    store: io.store,
  };
  return { args, channel };
}

export interface ModPartyFacts {
  /** Task 8 has attested the trade and sealed the mod party (`mod_party_state`). */
  attested: boolean;
  /** This process has a running party handle for the trade. */
  running: boolean;
  /**
   * The PERSISTED escrow address: the one `ready()` resolved with (all three parties confirmed it)
   * as saved in `mod_party_state`, or the API trade's `escrowAddress`; never only an in-memory value,
   * so a restarted process still knows the trade has an escrow to watch. Null when none exists yet.
   */
  escrowAddress: string | null;
  setupDoneReported: boolean;
  /** The trade's state from the API work list. */
  apiState: TradeState;
  /** The API's record is closed (the watch list's `closed`; finding F1: a coinless `lapsed` trade). Absent reads as false. */
  apiClosed?: boolean;
  /** The watcher's verdict: false once a closed escrow has been watched for 30 days (and the trade is still closed). */
  watching: boolean;
}

export interface ModPartyPlan {
  /** Start (or, after a restart, resume from `mod_party_state`) the party. */
  start: boolean;
  /** Report `setup-done { escrowAddress }` with this address. */
  reportSetupDone: string | null;
  stop: boolean;
}

export function modPartyPlan(f: ModPartyFacts): ModPartyPlan {
  const hasAddress = typeof f.escrowAddress === 'string' && f.escrowAddress !== '';
  const closed = isClosed(f.apiState, f.apiClosed);
  // A trade that closed before any escrow existed has nothing to watch. The 30-day watch ends a
  // party only while the trade is closed: one escalated by late funds keeps it.
  const needed = (f.watching || !closed) && !(closed && !hasAddress);
  return {
    start: f.attested && !f.running && needed,
    reportSetupDone: f.running && hasAddress && !f.setupDoneReported && f.apiState === 'setup' ? f.escrowAddress : null,
    stop: f.running && !needed,
  };
}
