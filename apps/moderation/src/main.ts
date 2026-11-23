import { grantPass } from './grants.js';
import { noticePass } from './notices.js';
import { normalizeTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import type { PartyHandle, Transport } from '@x2f/escrow';
import { CHAT_AFTER_DISPUTE_DAYS, CHAT_PRETRADE_IDLE_DAYS, CLOSED_STATES, channelFor, TRADE_KEEP_DAYS, WATCH_INTERVAL_MS, watchShowsEmpty, type Attestation, type ModPartyArgs, type Trade } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { AttestRefused, attestChat, attestTrade, BadTerms } from './attest.js';
import { loadChatIdentity, loadEscrow, loadParty, saveChatIdentity, saveParty, sweepTag, walletPassword } from './keystore.js';
import { createLink, type ChatShredOrder, type ChatWorkItem, type Fetch, type Link, type TradeShredOrder, type WatchItem, type WorkItem } from './link.js';
import { defaultPartyIO, startModParty, type PartyIO } from './party.js';
import { deskShadow, openDesk } from './desk.js';
import { createWatcher, reviveWatchState } from './watcher.js';
import type { DeskArmed, RulingExecutor } from './execute.js';
import type { AfterRefundSigner } from './afterRefund.js';
import { startCheckpoints, type CheckpointOptions } from './checkpoint.js';
import { recordedTerms, type GateContext, type RecordedTerms } from './gate/verify.js';
import type { GateSource, StoredRulings } from './gate/registry.js';
import type { GateStore } from './gate/store.js';

/**
 * The shred pass's own clock (design 2026-11-08 section 5): no purge the API may make comes sooner
 * than a pre-trade chat's 7 idle days after it was made, so a chat this service attested more
 * recently is never shredded, whatever the API says.
 */
export const CHAT_SHRED_MIN_AGE_DAYS = CHAT_PRETRADE_IDLE_DAYS;
/**
 * How long a `mod_dispute_seen` or `mod_chat_trade` row is kept after it was last seen (review M8):
 * the owner's 90 days after a dispute closes. A dispute row older than that holds nothing anyway.
 */
export const MOD_DISPUTE_SEEN_DAYS = CHAT_AFTER_DISPUTE_DAYS;
/**
 * The trade shred's own clock (Plan 7 Task 2 follow-up): no trade purge the API may make comes
 * sooner than TRADE_KEEP_DAYS after the trade closed, which is after this service attested it, so a
 * trade attested here more recently is never shredded, whatever the API says.
 */
export const TRADE_SHRED_MIN_AGE_DAYS = TRADE_KEEP_DAYS;
/**
 * Every moderation table with a `trade` column whose rows the trade shred deletes (tradeShredTick),
 * in one transaction: the signed terms (both addresses and the deal), the sealed party state (the
 * moderator's trade identity), the wallet password (R27), the escrow state (the multisig wallet),
 * the watch state, the desk record, the counted sweeps, the dispute record and the chat links of the
 * trade (whose chats the chat shred has already destroyed). test/tradeShred.test.ts holds this list
 * and TRADE_SHRED_KEPT to the schema.
 */
export const TRADE_SHRED_TABLES = [
  'signed_terms',
  'mod_party_state',
  'mod_wallet_secrets',
  'mod_escrow_state',
  'mod_watch',
  'mod_trade_desk',
  'mod_sweeps',
  'mod_dispute_seen',
  'mod_chat_trade',
  'mod_chat_access',
  'mod_chat_notices',
] as const;
/**
 * Moderation tables with a `trade` column the trade shred keeps, each by a rule:
 * - used_log_entries (007): an API activity-log entry authorises exactly one internal call, so its id
 *   stays used for good (a deleted row would let the same entry be used again). Only the id is read;
 *   the shred blanks the trade code (lead call on review Q-B, 22 Nov).
 * Also kept, holding no trade code: mod_sweeps_spent (022), the keyed tags of the trade's counted
 * sweeps (review M2), and the gate's used nonces.
 */
export const TRADE_SHRED_KEPT = ['used_log_entries'] as const;
/** Why the trade shred keeps a purged trade's records this pass (logged `trade-shred-held-<why>`). */
type TradeShredHold = 'unknown' | 'listed' | 'running' | 'young' | 'dispute' | 'chat' | 'watching' | 'escrow' | 'ruling';
/** The reports by which this service itself puts a trade in dispute (the API applies them as `escalate`). */
const ESCALATIONS: ReadonlySet<string> = new Set(['late-funds', 'spend-unshown', 'alert-unseen', 'alert-late', 'refund-unverified']);
const DAY_MS = 86_400_000;

/** The instance lock's advisory key ("x2mi"; the migrator's is "x2mo"): one moderation process per database. */
export const MOD_INSTANCE_LOCK = 0x7832_6d69;
/** How long the per-pass lock check waits for the lock connection (re-verify R3: a half-open one never answers). */
export const LOCK_CHECK_TIMEOUT_MS = 5_000;

/**
 * Does this connection still hold the instance lock (re-verify R3)? Asked every watch pass: a
 * connection the server dropped (failover, a half-open TCP session that never errors) answers
 * false, an error, or nothing within `timeoutMs`; each counts as lost.
 */
export async function instanceLockHeld(client: { query: (sql: string, values: unknown[]) => Promise<{ rows: Array<{ held?: boolean }> }> }, timeoutMs = LOCK_CHECK_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const check = client
    .query(
      `select exists (select 1 from pg_locks where locktype = 'advisory' and classid = 0 and objid = $1 and objsubid = 1 and granted and pid = pg_backend_pid()) as held`,
      [MOD_INSTANCE_LOCK],
    )
    .then((r) => r.rows[0]?.held === true, () => false);
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export { AttestRefused, attestChat, attestTrade, BadTerms, checkChatWork, checkWork, signAttestation, type Attested } from './attest.js';
export { loadChatIdentity, saveChatIdentity, type ChatModIdentity } from './keystore.js';
export { loadParty, migrateModeration, modSubkey, open, saveParty, seal, WALLET_PASSWORD_BYTES, walletPassword } from './keystore.js';
export { createLink, relayCloseMessage, relayRegisterMessage, type ChatShredOrder, type ChatWorkItem, type Fetch, type Link, type TradeShredOrder, type WatchItem, type WorkItem } from './link.js';
export { defaultPartyIO, escrowStore, startModParty, type PartyIO } from './party.js';
export { autoRefundStep, REFUND_UNVERIFIED_MS, type AutoRefundInputs, type AutoRefundStep } from './autoRefund.js';
export { buyerCancelStep, type BuyerCancelInputs, type BuyerCancelStep } from './buyerCancel.js';
export { openDesk, type Desk, type DeskRecord, type DeskStep } from './desk.js';
export { CHECKPOINT_INTERVAL_MS, startCheckpoints, VERIFY_EVERY_MS, type CheckpointOptions, type Checkpoints } from './checkpoint.js';
export { rulingExecutor, RULING_WAIT_REPORT_MS, RULING_WINNER_WAIT_MS, type RulingExecutor, type RulingWait, type RulingExecutorOptions, type RulingSource, type RulingStepInput, type RulingStepResult } from './execute.js';
export * from './gate/index.js';
export { newShadow } from './shadow.js';
export { readSignal, sealAck, termsMatch, type ModSignal } from './signals.js';
export { createWatcher, dumpWatchState, reviveWatchState, spendEvidence, SETTLE_BACKOFF_MS, type SweepContext, type Watcher } from './watcher.js';

/**
 * The moderation service: a SEPARATE process that holds the moderator keystore (MOD_KEYSTORE_KEY)
 * and the long-term moderation signing key (MOD_SIGNING_SECRET). It opens no TCP listener and
 * depends on neither fastify nor `@x2f/api`: it makes outbound, signed requests, and (Plan 4 Task 11)
 * answers the API's (dev-only) moderator message calls only on a Unix socket (`internal/server.ts`). Its own
 * database (`x2f_moderation`) is unreadable to the API's database role.
 *
 * Each loop it pulls `GET <api-internal>/internal/v1/work`. For every trade with both traders
 * registered it re-checks both proofs of possession, mints the moderator's trade identity, signs
 * the participant attestation, stores all of it sealed BEFORE anything leaves the process,
 * registers the trade's escrow and signals channels with the relay, posts the attestation with
 * `POST /internal/v1/reports`, and starts the moderator party with the trade's own random wallet
 * password (R27). Channels are registered before the report is posted, so a trader never sees an
 * attestation for a channel that does not exist yet, and a failed post simply comes back as work
 * (a repeat registration answers 409 `exists`, which counts as done).
 */
export interface ModerationOptions {
  apiInternalUrl: string;
  relayAdminUrl: string;
  daemonUri: string;
  db: pg.Pool;
  /** MOD_KEYSTORE_KEY: 32 bytes. */
  keystoreKey: Uint8Array;
  /** MOD_SIGNING_SECRET: the 64-byte Ed25519 secret key. */
  signingSecret: Uint8Array;
  feeWallet: string;
  /** RELAY_URL: the relay's public WebSocket URL, which the moderator party joins (Task 9). */
  relayUrl: string;
  /** MONERO_NETWORK: the escrow wallets' network. */
  network: 'regtest' | 'stagenet' | 'mainnet';
}

export interface ModerationDeps {
  fetch?: Fetch;
  /**
   * Replaces the whole moderator party hook (Task 8's tests record it). Default: the Task 9
   * watcher's, which registers the trade in `mod_watch` and starts the party.
   */
  runParty?: (a: ModPartyArgs) => void | Promise<void>;
  /** Starts one moderator party. Default: `startModParty` with the production I/O (`partyIO`). */
  startParty?: (a: ModPartyArgs) => Promise<PartyHandle>;
  /** The party's I/O for the default `startParty`. Default: monero-ts and the relay (`defaultPartyIO`). */
  partyIO?: PartyIO;
  /**
   * The signals channel transport for one trade's desk (Task 10), on `channelFor(code, 'signals')`
   * as `mod`. Default: the production relay transport (`wsTransport`), but only when `startParty`
   * is not replaced either; a caller that replaces `startParty` without this runs no desks.
   */
  signalsTransport?: (a: { channel: string; me: Identity }) => Transport | Promise<Transport>;
  /** Watcher period; 0 runs no watcher loop (callers drive `watch`). Default WATCH_INTERVAL_MS (15 s). */
  watchIntervalMs?: number;
  /** The per-pass instance-lock check (tests); default `instanceLockHeld` on the lock connection (re-verify R3). */
  lockHeld?: () => Promise<boolean>;
  newIdentity?: () => Promise<Identity>;
  now?: () => Date;
  /** Loop period; 0 runs no loop (callers drive `tick`). Default 5 s. */
  intervalMs?: number;
  /** Reasons only, never keys, codes or addresses. */
  log?: (e: { reason: string }) => void;
  /**
   * Plan 4 Task 14: the ruling executor (`rulingExecutor` on the gate's store), run for every trade
   * each watcher pass. Absent (no gate configured): no ruling is ever settled.
   */
  rulings?: Pick<RulingExecutor, 'step' | 'kindFor'>;
  /**
   * Plan 4 Task 14: the activity log's checkpoints (`startCheckpoints`), on the gate's store and the
   * API database's read-only role; reported over this service's own signed link. Absent: none.
   */
  checkpoints?: Pick<CheckpointOptions, 'store' | 'reader'> & Partial<Pick<CheckpointOptions, 'intervalMs' | 'verifyEveryMs'>>;
  /**
   * Security review 2026-11-12 M1: the ruling gate (its store, its registry sync, the executor and
   * the checkpoints), made only once this process holds the instance lock, so a refused second
   * process never opens or saves gate.bin. Its `rulings` and `checkpoints` stand for the two above;
   * `stop` runs before the lock is released. A factory that throws refuses the start.
   */
  gate?: () => Promise<GateRun>;
}

/** What `ModerationDeps.gate` starts (security review 2026-11-12 M1). */
export interface GateRun {
  rulings?: ModerationDeps['rulings'];
  checkpoints?: ModerationDeps['checkpoints'];
  /**
   * Plan 7 Task 2 follow-up: the gate's own per-trade records (the ruling payout record with its
   * addresses, the rulings seen). `pending` while a recorded payout has not finished (the trade shred
   * then holds the trade); `forget` deletes them once the trade's rows are gone (store.ts forgetTrade).
   */
  tradeRecords?: { pending(code: string): boolean; forget(code: string): Promise<void> };
  /**
   * Review p4t22 M2: the after-refund statement pass (afterRefund.ts) on the gate's store and
   * source: the current after-refund disputes, their stored rulings, and the signer.
   */
  afterRefund?: { codes(): Promise<string[]>; stored(code: string): Promise<StoredRulings>; signer: AfterRefundSigner };
  stop(): Promise<void>;
}

export interface ModerationHandle {
  /** One pass over the API's work list; resolves with the trades attested and started this pass. */
  tick(): Promise<string[]>;
  /** One pass over the API's chat work list (Task 20); resolves with the chats attested this pass. */
  chatTick(): Promise<string[]>;
  /**
   * One pass over the API's chat shred orders (design 2026-11-08 section 5, task 1); resolves with
   * the chats whose keys are gone here and whose shred the API recorded this pass.
   */
  shredTick(): Promise<string[]>;
  /**
   * One pass over the API's trade shred orders (Plan 7 Task 2 follow-up); resolves with the trades
   * whose records are gone here and whose shred the API recorded this pass.
   */
  tradeShredTick(): Promise<string[]>;
  /** One pass over the API's unaccepted dispute grants (design build task 6); resolves with the chats accepted. */
  grantTick(): Promise<string[]>;
  /** One pass signing dispute notices (design build task 7, T2); resolves with the chats noticed. */
  noticeTick(): Promise<string[]>;
  /** Review p4t22 M2: one after-refund statement pass; resolves with the trades whose statement the API took. */
  afterRefundTick(): Promise<string[]>;
  /** One chain-watcher pass (Task 9). */
  watch(): Promise<void>;
  /** Stops the loops, then every running moderator party. */
  stop(): Promise<void>;
  /**
   * Resolves once the instance lock was lost (re-verify R3); the service has then stopped itself.
   * The process entry exits 1 on it, so a supervisor restarts it (and the new one waits for the lock).
   */
  lockLost: Promise<void>;
}

/** The moderator's party state as sealed into `mod_party_state` (never the wallet password). */
interface SealedParty {
  v: 1;
  trade: string;
  role: 'mod';
  me: { signPublic: string; boxPublic: string; signSecret: string; boxSecret: string };
  participants: Participants;
}

const toHexIdentity = (i: Identity): SealedParty['me'] => ({
  signPublic: i.signPublic,
  boxPublic: i.boxPublic,
  signSecret: sodium.to_hex(i.signSecret),
  boxSecret: sodium.to_hex(i.boxSecret),
});
const fromHexIdentity = (m: SealedParty['me']): Identity => ({
  signPublic: m.signPublic,
  boxPublic: m.boxPublic,
  signSecret: sodium.from_hex(m.signSecret),
  boxSecret: sodium.from_hex(m.boxSecret),
});

/** Review p4t22 M2: how often the work loop runs the after-refund statement pass. */
export const AFTER_REFUND_INTERVAL_MS = 60_000;

/** The longest one call to the API's internal listener or the relay admin may take (headers and body). */
export const LINK_FETCH_TIMEOUT_MS = 15_000;

// Bounded: the watcher's pass (and so `settled`) waits on these; one that never answers fails and
// is tried again on the next pass, never a pass that waits for good.
const defaultFetch: Fetch = async (url, init) => {
  const res = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(LINK_FETCH_TIMEOUT_MS) });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

export async function startModeration(o: ModerationOptions, deps: ModerationDeps = {}): Promise<ModerationHandle> {
  await sodium.ready;
  if (!(o.keystoreKey instanceof Uint8Array) || o.keystoreKey.length !== 32) throw new TypeError('moderation: keystoreKey must be 32 bytes');
  if (!(o.signingSecret instanceof Uint8Array) || o.signingSecret.length !== sodium.crypto_sign_SECRETKEYBYTES) {
    throw new TypeError('moderation: signingSecret must be a 64-byte Ed25519 secret key');
  }
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  if (typeof o.relayUrl !== 'string' || !/^wss?:\/\//.test(o.relayUrl)) throw new TypeError('moderation: relayUrl must be a ws:// or wss:// URL');
  if (!['regtest', 'stagenet', 'mainnet'].includes(o.network)) throw new TypeError('moderation: network must be regtest, stagenet or mainnet');
  // Security review 7 Nov 2026, finding 2: one moderation process per database. The lock is held on
  // its own connection for the life of the process; a second process refuses to start.
  const lock = await o.db.connect();
  let locked = false;
  try {
    locked = (await lock.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [MOD_INSTANCE_LOCK])).rows[0]?.ok === true;
  } catch (e) {
    lock.release();
    throw e;
  }
  if (!locked) {
    lock.release();
    log({ reason: 'moderation-instance-locked' });
    throw new Error('moderation: another moderation process holds the instance lock on this database');
  }
  // A lost lock connection releases the lock: stop working rather than run beside a new process
  // (re-verify R3: the error event, and the per-pass check for a half-open connection that never errors).
  let lost = false;
  let onLost!: () => void;
  const lockLost = new Promise<void>((resolve) => {
    onLost = resolve;
  });
  let stopForLoss: (() => Promise<void>) | null = null;
  const loseLock = (): void => {
    if (lost) return;
    lost = true;
    log({ reason: 'moderation-instance-lock-lost' });
    void (stopForLoss?.() ?? Promise.resolve()).finally(onLost);
  };
  const onLockError = (): void => loseLock();
  lock.on('error', onLockError);
  // The lock is Postgres's until the session that took it has ended on the server. A lost lock's
  // client hears of it first (a terminated backend sends its FATAL before it exits and frees its
  // locks; a destroyed client only starts closing), so `stop` waits for the connection's end
  // before it resolves, and a new process started on `lockLost` finds the lock free.
  let lockEnded = false;
  let onLockEnd!: () => void;
  const lockEnd = new Promise<void>((resolve) => {
    onLockEnd = () => {
      lockEnded = true;
      resolve();
    };
  });
  lock.once('end', onLockEnd);
  // Security review 2026-11-12 M1: the gate starts only now that the lock is held.
  let gate: GateRun | null = null;
  if (deps.gate) {
    try {
      gate = await deps.gate();
    } catch (e) {
      lock.off('error', onLockError);
      lock.off('end', onLockEnd);
      await lock.query('select pg_advisory_unlock($1)', [MOD_INSTANCE_LOCK]).catch(() => undefined);
      lock.release();
      throw e;
    }
  }
  const rulingsDep = gate?.rulings ?? deps.rulings;
  const checkpointsDep = gate?.checkpoints ?? deps.checkpoints;
  const lockHeld = deps.lockHeld ?? (() => instanceLockHeld(lock));
  const rawLink: Link = createLink({
    apiInternalUrl: o.apiInternalUrl,
    relayAdminUrl: o.relayAdminUrl,
    signingSecret: o.signingSecret,
    fetch: deps.fetch ?? defaultFetch,
    now: () => now().getTime(),
  });
  // The shred pass's own facts (recordingLink): every watch list read and every escalation report.
  const link: Link = recordingLink(rawLink, o.db, now);
  const checkpoints = checkpointsDep ? startCheckpoints({ ...checkpointsDep, link, now, log }) : null;
  let io: PartyIO | undefined = deps.partyIO;
  const startParty =
    deps.startParty ??
    (async (a: ModPartyArgs) => startModParty(a, (io ??= await defaultPartyIO({ relayUrl: o.relayUrl, network: o.network })), o.db, o.keystoreKey));
  const signalsTransport =
    deps.signalsTransport ??
    (deps.startParty
      ? undefined
      : async (a: { channel: string; me: Identity }) => {
          io ??= await defaultPartyIO({ relayUrl: o.relayUrl, network: o.network });
          return io.transport({ url: io.relayUrl, code: a.channel, role: 'mod', me: a.me });
        });
  const watcher = createWatcher({
    db: o.db,
    keystoreKey: o.keystoreKey,
    link,
    startParty,
    argsFor: (code) => partyArgsFor(o, code),
    now,
    log,
    ...(signalsTransport
      ? {
          openDesk: async (a: ModPartyArgs) =>
            openDesk({
              db: o.db,
              args: a,
              feeWallet: o.feeWallet,
              transport: await signalsTransport({ channel: await channelFor(a.trade, 'signals'), me: a.me }),
              link,
              now,
              log,
            }),
        }
      : {}),
    ...(rulingsDep
      ? {
          rulingKind: (code: string) => rulingsDep.kindFor(code),
          executeRuling: (x: { code: string; handle: PartyHandle; api: WatchItem; funds: { balance: bigint; unlocked: bigint }; args: ModPartyArgs; shadow: Trade | null; deskArmed: DeskArmed; escrowAddress: string | null }) =>
            rulingsDep.step({
              code: x.code,
              handle: x.handle,
              api: x.api,
              funds: x.funds,
              recorded: recordedFor(x.args, x.shadow, log),
              deskArmed: x.deskArmed,
              escrowAddress: x.escrowAddress,
              // Haveno finding 2: the signed ruling statement goes to the API over this service's signed link.
              announce: async (r) => {
                const res = await link.report({ kind: 'ruling-statement', trade: x.code, statement: r.statement, sig: r.sig });
                if (res.status !== 201 && res.status !== 200) log({ reason: `ruling-statement-refused-${res.status}` });
                return res.status === 201 || res.status === 200;
              },
              // Review p4t22 M1 (d): the gate's refusal of the ruling, for the staff case view.
              reportRefusal: async (r) => {
                const res = await link.report({ kind: 'ruling-refused', trade: x.code, rulingId: r.rulingId, reason: r.reason });
                if (res.status !== 201 && res.status !== 200) log({ reason: `ruling-refused-report-refused-${res.status}` });
                return res.status === 201 || res.status === 200;
              },
              // Ruling-winner reasons (lead 22 Nov): why the payout waits on its winner, for the staff case view.
              reportWait: async (reason) => {
                const res = await link.report({ kind: 'ruling-wait', trade: x.code, reason });
                if (res.status !== 201 && res.status !== 200) log({ reason: `ruling-wait-refused-${res.status}` });
                return res.status === 201 || res.status === 200;
              },
            }),
        }
      : {}),
  });
  const runParty = deps.runParty ?? ((a: ModPartyArgs) => watcher.runParty(a));
  const started = new Set<string>();

  /** The trade's signed attestation and party, minted once and sealed before anything is sent. */
  const prepare = async (w: WorkItem, code: string): Promise<{ attestation: Attestation; sig: string; party: SealedParty }> => {
    const { rows } = await o.db.query<{ attestation: Attestation; sig: string }>('select attestation, sig from signed_terms where trade = $1', [code]);
    const existing = rows[0];
    const party = await loadParty<SealedParty>(o.db, o.keystoreKey, code);
    if (existing && party) return { attestation: existing.attestation, sig: existing.sig, party };

    const a = await attestTrade({ ...w, trade: code }, o.signingSecret, now(), deps.newIdentity ?? generateIdentity);
    const sealed: SealedParty = { v: 1, trade: code, role: 'mod', me: toHexIdentity(a.mod), participants: a.participants };
    const client = await o.db.connect();
    try {
      await client.query('begin');
      // Stamped with this service's clock (review lead-mod-purge m3): the trade shred's `young` compares it with the same clock.
      await client.query('insert into signed_terms (trade, attestation, sig, created_at) values ($1, $2, $3, $4)', [code, a.attestation, a.sig, now()]);
      await saveParty(client, o.keystoreKey, code, sealed);
      await walletPassword(client, o.keystoreKey, code);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return { attestation: a.attestation, sig: a.sig, party: sealed };
  };

  const tick = async (): Promise<string[]> => {
    const done: string[] = [];
    let work: WorkItem[];
    try {
      work = await link.pullWork();
    } catch {
      log({ reason: 'work-unavailable' });
      return done;
    }
    for (const w of work) {
      const code = typeof w?.trade === 'string' ? normalizeTradeCode(w.trade) : null;
      try {
        if (code === null) {
          log({ reason: 'bad-work' });
          continue;
        }
        const { attestation, sig, party } = await prepare(w, code);
        const signPublics = Object.fromEntries(
          (['buyer', 'seller', 'mod'] as const).map((r) => [r, party.participants[r].signPublic]),
        ) as Record<Role, string>;
        let registered = true;
        for (const kind of ['escrow', 'signals'] as const) {
          const status = await link.registerChannel(await channelFor(code, kind), signPublics);
          if (status !== 201 && status !== 409) registered = false;
        }
        if (!registered) {
          log({ reason: 'relay-register-failed' });
          continue;
        }
        const posted = await link.postReport({ kind: 'attestation', attestation, sig });
        if (posted !== 201) {
          log({ reason: `report-refused-${posted}` });
          continue;
        }
        await o.db.query('update signed_terms set posted_at = now() where trade = $1', [code]);
        const terms = attestation.terms;
        if (terms === undefined) {
          // Unreachable: the API stores no attestation without terms (400). A pre-terms record.
          log({ reason: 'bad-terms' });
          continue;
        }
        if (!started.has(code)) {
          started.add(code);
          await runParty({
            trade: code,
            role: 'mod',
            me: fromHexIdentity(party.me),
            participants: party.participants,
            password: await walletPassword(o.db, o.keystoreKey, code),
            daemonUri: o.daemonUri,
            feeWallet: o.feeWallet,
            // What this service signed (signed_terms), never the work item's or a later API read.
            terms,
          });
        }
        log({ reason: 'attested' });
        done.push(code);
      } catch (e) {
        if (e instanceof BadTerms) {
          log({ reason: 'bad-terms' });
          continue;
        }
        if (!(e instanceof AttestRefused) || code === null) {
          log({ reason: 'trade-failed' });
          continue;
        }
        // A refusal is final (the proofs or keys will never change), so the API is told and drops
        // the trade from work; otherwise refused trades would pile up at the front of the list.
        log({ reason: `refused-${e.reason}` });
        try {
          const status = await link.postReport({ kind: 'refused', trade: code, reason: e.reason });
          if (status !== 201) log({ reason: `refusal-not-recorded-${status}` });
        } catch {
          log({ reason: 'refusal-not-recorded' });
        }
      }
    }
    return done;
  };

  /**
   * Chats (Task 20): mint the moderator's chat identity, seal it and the signed attestation BEFORE
   * anything leaves the process, then post it. The chat runs over the API (no relay channel). A
   * restart re-posts the same attestation; a bad proof is refused for good.
   */
  const chatTick = async (): Promise<string[]> => {
    const done: string[] = [];
    let work: ChatWorkItem[];
    try {
      work = await link.pullChatWork();
    } catch {
      log({ reason: 'chat-work-unavailable' });
      return done;
    }
    for (const w of work) {
      const chat = typeof w?.chat === 'string' ? normalizeTradeCode(w.chat) : null;
      if (chat === null) {
        log({ reason: 'bad-chat-work' });
        continue;
      }
      try {
        const { rows } = await o.db.query<{ attestation: Attestation; sig: string }>('select attestation, sig from signed_chats where chat = $1', [chat]);
        let signed = rows[0] && (await loadChatIdentity(o.db, o.keystoreKey, chat)) ? rows[0] : null;
        if (!signed) {
          const a = await attestChat({ ...w, chat }, o.signingSecret, now(), deps.newIdentity ?? generateIdentity);
          const client = await o.db.connect();
          try {
            await client.query('begin');
            await client.query('insert into signed_chats (chat, attestation, sig) values ($1, $2, $3)', [chat, a.attestation, a.sig]);
            await saveChatIdentity(client, o.keystoreKey, chat, a.mod);
            await client.query('commit');
          } catch (e) {
            await client.query('rollback');
            throw e;
          } finally {
            client.release();
          }
          signed = { attestation: a.attestation, sig: a.sig };
        }
        const posted = await link.postReport({ kind: 'chat-attestation', attestation: signed.attestation, sig: signed.sig });
        if (posted !== 201) {
          log({ reason: `chat-report-refused-${posted}` });
          continue;
        }
        await o.db.query('update signed_chats set posted_at = now() where chat = $1', [chat]);
        log({ reason: 'chat-attested' });
        done.push(chat);
      } catch (e) {
        if (!(e instanceof AttestRefused)) {
          log({ reason: 'chat-failed' });
          continue;
        }
        log({ reason: `chat-refused-${e.reason}` });
        try {
          const status = await link.postReport({ kind: 'chat-refused', chat, reason: e.reason });
          if (status !== 201) log({ reason: `chat-refusal-not-recorded-${status}` });
        } catch {
          log({ reason: 'chat-refusal-not-recorded' });
        }
      }
    }
    return done;
  };

  /**
   * The shred pass (design 2026-11-08 section 5, task 1): for each chat the API purged, delete its
   * sealed mod identity and the signed attestation in one transaction, then report `chat-shredded`
   * (the API keeps the order until it hears so, and a repeat is harmless: the deletes find nothing).
   * The order is only a trigger. A chat is held, and asked again next pass, when this service's own
   * records say it may still be evidence:
   * - attested less than CHAT_SHRED_MIN_AGE_DAYS ago (`chat-shred-held-young`);
   * - seen disputed by this service within CHAT_AFTER_DISPUTE_DAYS (`chat-shred-held-dispute`): the
   *   trade this service recorded the chat linked to, or the order's trade. Looked up by the chat
   *   (review I1), so an order naming no trade, or another one, does not skip the hold;
   * - the order's trade not the one this service recorded the chat linked to (`chat-shred-held-mismatch`);
   * - its trade on the watch list in an open state, anything but CLOSED_STATES (`chat-shred-held-open`),
   *   or the watch list unreadable this pass (`chat-shred-held-unknown`).
   * A held order is skipped, never a stop: the orders after it are still done this pass, and the API
   * serves the least recently served first (review M4).
   */
  const shredTick = async (): Promise<string[]> => {
    const done: string[] = [];
    let orders: ChatShredOrder[];
    try {
      orders = await link.pullChatShred();
    } catch {
      log({ reason: 'chat-shred-unavailable' });
      return done;
    }
    const at = now();
    const cutoff = new Date(at.getTime() - MOD_DISPUTE_SEEN_DAYS * DAY_MS);
    await o.db.query('delete from mod_dispute_seen where last_seen_at < $1', [cutoff]);
    // A link goes only once its trade has no dispute record left (review N1): the list can stop naming
    // the chat while the dispute is still being seen, and dispute records go at the same cutoff.
    await o.db.query('delete from mod_chat_trade m where m.last_seen_at < $1 and not exists (select 1 from mod_dispute_seen d where d.trade = m.trade)', [cutoff]);
    if (orders.length === 0) return done;
    // Read every pass with orders: it also records the links and disputes the holds go by.
    let watch: Map<string, WatchItem> | null = null;
    try {
      watch = await link.pullWatch();
    } catch {
      watch = null;
    }
    for (const x of orders) {
      const chat = normalizeTradeCode(x.chat);
      const trade = x.trade === null ? null : normalizeTradeCode(x.trade);
      if (chat === null || (x.trade !== null && trade === null)) {
        log({ reason: 'bad-chat-shred' });
        continue;
      }
      try {
        const held = await shredHold(o.db, chat, trade, watch, at);
        if (held !== null) {
          log({ reason: `chat-shred-held-${held}` });
          continue;
        }
        const client = await o.db.connect();
        try {
          await client.query('begin');
          await client.query('delete from mod_chat_identities where chat = $1', [chat]);
          await client.query('delete from signed_chats where chat = $1', [chat]);
          await client.query('delete from mod_chat_trade where chat = $1', [chat]);
          // Design section 5: this process's own staff-access record for the chat (design task 9 groundwork).
          await client.query('delete from mod_chat_access where chat = $1', [chat]);
          await client.query('delete from mod_chat_grants where chat = $1', [chat]);
          await client.query('delete from mod_chat_notices where chat = $1', [chat]);
          await client.query('delete from mod_countersign_requests where chat = $1', [chat]);
          // Review lead-mod-purge m5: the moderator's next chat seq for the chat.
          await client.query('delete from mod_chat_seq where chat = $1', [chat]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        } finally {
          client.release();
        }
        const status = await link.postReport({ kind: 'chat-shredded', chat });
        if (status !== 201) {
          log({ reason: `chat-shred-report-refused-${status}` });
          continue;
        }
        log({ reason: 'chat-shredded' });
        done.push(chat);
      } catch {
        log({ reason: 'chat-shred-failed' });
      }
    }
    return done;
  };

  /**
   * The trade shred (Plan 7 Task 2, lead follow-up): for each trade the API purged, delete every row
   * this service keeps for it (TRADE_SHRED_TABLES: the signed terms, all key material, the watch
   * state and the rest) in one transaction, forget the gate's own records of it, then report
   * `trade-shredded` (the API keeps the order until it hears so; a repeat is harmless: the deletes
   * find nothing). The order is only a trigger. A trade is held, and asked again next pass, while
   * this service's own records say it may still matter:
   * - the watch list unreadable this pass (`unknown`), or still listing the trade (`listed`: the API
   *   lists every open attested trade, and a closed one for its watch window);
   * - its moderator party running or starting in this process (`running`);
   * - attested here less than TRADE_SHRED_MIN_AGE_DAYS ago (`young`);
   * - seen disputed here within CHAT_AFTER_DISPUTE_DAYS (`dispute`);
   * - a chat linked to it whose keys are still here (`chat`: the chat shred, with its own holds, goes first);
   * - its watch still running (`watching`), or its escrow never shown EMPTY by that watch
   *   (`escrow`: watchShowsEmpty; an escrow state with no watch row, or a watch state that does not
   *   read back, counts as never shown empty). The key material is never destroyed on the API's word
   *   (review-p7-retention round 2, R2-I2): unknown means coins may remain;
   * - a ruling payout the gate recorded and has not finished (`ruling`).
   * Each trade's check and delete run between two watcher passes (`between`), never during one. A
   * held order is skipped, never a stop. Kept by rule: TRADE_SHRED_KEPT, and the gate's used nonces.
   */
  const tradeShredTick = async (): Promise<string[]> => {
    const done: string[] = [];
    let orders: TradeShredOrder[];
    try {
      orders = await link.pullTradeShred();
    } catch {
      log({ reason: 'trade-shred-unavailable' });
      return done;
    }
    if (orders.length === 0) return done;
    let watch: Map<string, WatchItem> | null = null;
    try {
      watch = await link.pullWatch();
    } catch {
      watch = null;
    }
    const records = gate?.tradeRecords;
    for (const x of orders) {
      const trade = normalizeTradeCode(x.trade);
      if (trade === null) {
        log({ reason: 'bad-trade-shred' });
        continue;
      }
      try {
        const held = await watcher.between(async (): Promise<TradeShredHold | null> => {
          const at = now();
          const why =
            watch === null ? 'unknown'
            : watch.has(trade) ? 'listed'
            : watcher.active(trade) ? 'running'
            : records?.pending(trade) ? 'ruling'
            : await tradeShredHold(o.db, o.keystoreKey, trade, at);
          if (why !== null) return why;
          const client = await o.db.connect();
          try {
            await client.query('begin');
            // The table names are the constant list above, never input.
            // Review lead-mod-purge M2: each counted sweep leaves its keyed tag, so no other trade can
            // ever count it, before the trade's mod_sweeps rows go.
            const sweeps = await client.query<{ tx_hash: string }>('select tx_hash from mod_sweeps where trade = $1', [trade]);
            for (const r of sweeps.rows) {
              await client.query('insert into mod_sweeps_spent (tag) values ($1) on conflict (tag) do nothing', [sweepTag(o.keystoreKey, r.tx_hash)]);
            }
            for (const t of TRADE_SHRED_TABLES) await client.query(`delete from ${t} where trade = $1`, [trade]);
            // Q-B (lead 22 Nov): the used API log entries keep their ids (one use each) and lose the code.
            await client.query(`update used_log_entries set trade = '' where trade = $1`, [trade]);
            await client.query('commit');
          } catch (e) {
            await client.query('rollback');
            throw e;
          } finally {
            client.release();
          }
          started.delete(trade);
          return null;
        });
        if (held !== null) {
          log({ reason: `trade-shred-held-${held}` });
          continue;
        }
        await records?.forget(trade);
        const status = await link.postReport({ kind: 'trade-shredded', trade });
        if (status !== 201) {
          log({ reason: `trade-shred-report-refused-${status}` });
          continue;
        }
        log({ reason: 'trade-shredded' });
        done.push(trade);
      } catch {
        log({ reason: 'trade-shred-failed' });
      }
    }
    return done;
  };

  /**
   * Review p4t22 M2: one pass over the current after-refund disputes: for a `seller-sends-xmr`
   * ruling in force that the gate authorises, the signed after-refund statement goes to the API
   * (`after-refund-statement`); a refusal is reported for the staff case view (`ruling-refused`).
   * Resolves with the trades whose statement the API took this pass.
   */
  let afterRefundAt = -Infinity;
  const afterRefundTick = async (): Promise<string[]> => {
    const ar = gate?.afterRefund;
    if (!ar) return [];
    // At most once a minute from the work loop (each check syncs the gate's registry first).
    const t = now().getTime();
    if (t - afterRefundAt < AFTER_REFUND_INTERVAL_MS) return [];
    afterRefundAt = t;
    let codes: string[];
    try {
      codes = await ar.codes();
    } catch {
      log({ reason: 'after-refund-unavailable' });
      return [];
    }
    const done: string[] = [];
    for (const code of codes) {
      try {
        const { rows } = await o.db.query<{ attestation: Attestation }>('select attestation from signed_terms where trade = $1 and posted_at is not null', [code]);
        const terms = rows[0]?.attestation.terms;
        const recorded = terms === undefined ? null : recordedFor({ terms, feeWallet: o.feeWallet } as ModPartyArgs, await deskShadow(o.db, code), log);
        const r = await ar.signer.step({
          code,
          stored: await ar.stored(code),
          recorded,
          announce: async (x) => {
            const res = await link.report({ kind: 'after-refund-statement', trade: code, statement: x.statement, sig: x.sig });
            if (res.status !== 201 && res.status !== 200) log({ reason: `after-refund-statement-refused-${res.status}` });
            return res.status === 201 || res.status === 200;
          },
          reportRefusal: async (x) => {
            const res = await link.report({ kind: 'ruling-refused', trade: code, rulingId: x.rulingId, reason: x.reason });
            return res.status === 201 || res.status === 200;
          },
        });
        if (r === 'announced') done.push(code);
      } catch {
        log({ reason: 'after-refund-step-failed' });
      }
    }
    return done;
  };

  const grantTick = (): Promise<string[]> => grantPass({ link, db: o.db, keystoreKey: o.keystoreKey, now, log });
  const noticeTick = (): Promise<string[]> => noticePass({ link, db: o.db, keystoreKey: o.keystoreKey, now, log });

  const intervalMs = deps.intervalMs ?? 5_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> = Promise.resolve();
  const loop = (): void => {
    if (stopped) return;
    // A throw that escapes a pass is logged and the loop goes on (review M3): an unhandled rejection
    // would end the process, and the chain watcher with it.
    running = tick()
      .then(chatTick)
      .then(shredTick)
      .then(tradeShredTick)
      .then(grantTick)
      .then(noticeTick)
      .then(afterRefundTick)
      .catch(() => log({ reason: 'work-pass-failed' }))
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, intervalMs);
      });
  };
  if (intervalMs > 0) loop();

  const watchIntervalMs = deps.watchIntervalMs ?? WATCH_INTERVAL_MS;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let watching: Promise<unknown> = Promise.resolve();
  const watchLoop = (): void => {
    if (stopped) return;
    watching = lockHeld()
      .then((held) => {
        if (!held) return loseLock();
        return watcher.tick();
      })
      .catch(() => log({ reason: 'watch-pass-failed' }))
      .finally(() => {
        if (!stopped) watchTimer = setTimeout(watchLoop, watchIntervalMs);
      });
  };
  if (watchIntervalMs > 0) watchLoop();

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (watchTimer) clearTimeout(watchTimer);
      await running.catch(() => undefined);
      await watching.catch(() => undefined);
      await watcher.stop();
      await checkpoints?.stop();
      // The gate's sync stops (and saves) while this process still holds the lock (review M1).
      await gate?.stop().catch(() => log({ reason: 'gate-stop-failed' }));
      if (!lost) await lock.query('select pg_advisory_unlock($1)', [MOD_INSTANCE_LOCK]).catch(() => undefined);
      lock.off('error', onLockError);
      // A lost connection is destroyed, never handed back to the pool, and waited for until it has
      // ended (bounded: a half-open one that never answers is cut after LOCK_CHECK_TIMEOUT_MS; its
      // server session then ends on keepalive, and a new process waits for the lock meanwhile).
      lock.release(lost ? true : undefined);
      if (lost && !lockEnded) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cut = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, LOCK_CHECK_TIMEOUT_MS);
        });
        await Promise.race([lockEnd, cut]);
        clearTimeout(timer);
      }
      lock.off('end', onLockEnd);
    })());
  stopForLoss = stop;

  return {
    tick,
    chatTick,
    shredTick,
    tradeShredTick,
    grantTick,
    noticeTick,
    afterRefundTick,
    // Through the watcher's own queue: never a pass alongside the loop's (finding 2).
    watch: () => watcher.tick(),
    stop,
    lockLost,
  };
}

/**
 * The link with the shred pass's own records kept on the way (design 2026-11-08 section 5, review I1),
 * on this service's clock:
 * - every watch list read (the watcher's and the shred pass's) records each trade's chat
 *   (`mod_chat_trade`, kept as first seen) and the trades it shows disputed (`mod_dispute_seen`);
 * - every escalation report this service makes records its trade as disputed, before it is sent.
 * A failed record fails the read or the report, so nothing goes on without it.
 */
export function recordingLink(raw: Link, db: pg.Pool, now: () => Date): Link {
  const escalating = async (report: unknown): Promise<void> => {
    const r = report as { kind?: unknown; trade?: unknown } | null;
    if (typeof r?.kind !== 'string' || !ESCALATIONS.has(r.kind) || typeof r.trade !== 'string') return;
    const trade = normalizeTradeCode(r.trade);
    if (trade !== null) await recordDisputes(db, [trade], now());
  };
  return {
    ...raw,
    pullWatch: async () => {
      const items = await raw.pullWatch();
      const at = now();
      await recordLinks(db, items, at);
      await recordDisputes(db, [...items].filter(([, w]) => w.state === 'disputed').map(([code]) => code), at);
      return items;
    },
    postReport: async (report) => {
      await escalating(report);
      return raw.postReport(report);
    },
    report: async (report) => {
      await escalating(report);
      return raw.report(report);
    },
  };
}

/** Records the trades seen disputed (mod_dispute_seen). */
async function recordDisputes(db: pg.Pool, trades: string[], at: Date): Promise<void> {
  if (trades.length === 0) return;
  await db.query(
    `insert into mod_dispute_seen (trade, first_seen_at, last_seen_at)
     select t, $2, $2 from unnest($1::text[]) t
     on conflict (trade) do update set last_seen_at = greatest(mod_dispute_seen.last_seen_at, excluded.last_seen_at)`,
    [trades, at],
  );
}

/**
 * Records each listed trade's chat (mod_chat_trade). A chat's first recorded trade is kept: a later
 * list naming another trade for it only refreshes `last_seen_at`, and an item with no chat (none
 * linked, or the chat already purged) records nothing.
 */
async function recordLinks(db: pg.Pool, items: Map<string, WatchItem>, at: Date): Promise<void> {
  const chats: string[] = [];
  const trades: string[] = [];
  for (const [code, w] of items) {
    const chat = w.chat === null ? null : normalizeTradeCode(w.chat);
    const trade = normalizeTradeCode(code);
    if (chat === null || trade === null) continue;
    chats.push(chat);
    trades.push(trade);
  }
  if (chats.length === 0) return;
  await db.query(
    `insert into mod_chat_trade (chat, trade, first_seen_at, last_seen_at)
     select c, t, $3, $3 from unnest($1::text[], $2::text[]) as x(c, t)
     on conflict (chat) do update set last_seen_at = greatest(mod_chat_trade.last_seen_at, excluded.last_seen_at)`,
    [chats, trades, at],
  );
}

/**
 * Why the shred pass keeps a purged chat's keys this pass, from this service's own records (and the
 * watch list), or null when nothing holds it. See `shredTick`.
 */
async function shredHold(db: pg.Pool, chat: string, trade: string | null, watch: Map<string, WatchItem> | null, at: Date): Promise<'young' | 'dispute' | 'mismatch' | 'open' | 'unknown' | null> {
  const { rows } = await db.query<{ made: Date | null; linked: string | null }>(
    `select least((select created_at from signed_chats where chat = $1), (select created_at from mod_chat_identities where chat = $1)) as made,
            (select trade from mod_chat_trade where chat = $1) as linked`,
    [chat],
  );
  const made = rows[0]?.made ?? null;
  const linked = rows[0]?.linked ?? null;
  if (made !== null && at.getTime() - made.getTime() < CHAT_SHRED_MIN_AGE_DAYS * DAY_MS) return 'young';
  // By the chat (review I1): the trade this service recorded it linked to, and the order's own.
  const candidates = [...new Set([linked, trade].filter((t): t is string => t !== null))];
  if (candidates.length > 0) {
    const seen = await db.query('select 1 from mod_dispute_seen where trade = any($1::text[]) and last_seen_at >= $2', [candidates, new Date(at.getTime() - CHAT_AFTER_DISPUTE_DAYS * DAY_MS)]);
    if (seen.rows.length > 0) return 'dispute';
  }
  if (linked !== null && trade !== linked) return 'mismatch';
  if (trade === null) return null;
  if (watch === null) return 'unknown';
  const item = watch.get(trade);
  if (item !== undefined && !CLOSED_STATES.includes(item.state as (typeof CLOSED_STATES)[number])) return 'open';
  return null;
}

/** The escrow party's setup messages that carry or confirm the escrow address (packages/escrow party.ts). */
const SETUP_ADDRESS_KEYS = ['msig.addr:0', 'msig.ready:0'] as const;

/**
 * Review lead-mod-purge M1: whether this moderator's sealed escrow state shows its multisig was never
 * finalised: no state at all, or one with no address, no address or ready message ever sent to the
 * peers and no release. Peers fund only after all three confirmed the address (msig.ready), so such
 * an escrow never had an address anyone was shown. A state that does not open or read is never this.
 */
async function escrowNeverFinalised(db: pg.Pool, keystoreKey: Uint8Array, trade: string): Promise<boolean> {
  let st: { address?: unknown; sent?: unknown; release?: unknown; releases?: unknown; shown?: unknown } | null;
  try {
    st = await loadEscrow(db, keystoreKey, trade);
  } catch {
    return false;
  }
  if (st === null) return true;
  if (typeof st !== 'object' || st.address !== null) return false;
  if (typeof st.sent !== 'object' || st.sent === null) return false;
  if (SETUP_ADDRESS_KEYS.some((k) => Object.hasOwn(st!.sent as object, k))) return false;
  if ((st.release ?? null) !== null || (Array.isArray(st.releases) && st.releases.length > 0) || (Array.isArray(st.shown) && st.shown.length > 0)) return false;
  return true;
}

/** Review M1: the watch state reads back and its watch never saw chain facts, a close or a sweep. */
function watchSawNothing(state: unknown): boolean {
  try {
    const w = reviveWatchState(state);
    return w.lastChain === null && w.closedAt === null && w.settledTx === null && w.sweepTxs.length === 0 && w.lateReported.length === 0;
  } catch {
    return false;
  }
}

/**
 * Why the trade shred keeps a purged trade's records this pass, from this service's own records
 * only, or null when nothing holds it. See `tradeShredTick` (the list, the process and the gate
 * holds are checked there first). `young` goes by the attestation's own stamp, written with this
 * service's clock (review m3).
 *
 * Review M1: a trade cancelled in setup before any escrow address existed has nothing that could
 * hold coins: its watch row (watching or not: after a restart modPartyPlan never stops it) has no
 * escrow address and no setup-done, its watch state reads back and never saw a chain fact, a close
 * or a sweep, and its sealed escrow state is absent or never finalised. Such
 * a row is not held. A trade that ever had an address (in the watch row, in the sealed state, or
 * sent to the peers) or reported setup-done never takes this path. A watching row of this kind is
 * past its own TRADE_SHRED_MIN_AGE_DAYS (young, above), far beyond the setup window (TIMERS.setupMin),
 * and its party does not run here (`running` is checked first).
 */
async function tradeShredHold(db: pg.Pool, keystoreKey: Uint8Array, trade: string, at: Date): Promise<'young' | 'dispute' | 'chat' | 'watching' | 'escrow' | null> {
  const { rows } = await db.query<{
    made: Date | null; disputed: Date | null; chat: boolean; escrow: boolean; watching: boolean | null; state: unknown; address: string | null; setup_done: Date | null;
  }>(
    `select (select created_at from signed_terms where trade = $1) as made,
            (select last_seen_at from mod_dispute_seen where trade = $1) as disputed,
            exists (select 1 from (select chat from mod_chat_trade where trade = $1
                                   union select chat from mod_chat_access where trade = $1
                                   union select chat from mod_chat_notices where trade = $1) c
                     where exists (select 1 from mod_chat_identities i where i.chat = c.chat)
                        or exists (select 1 from signed_chats s where s.chat = c.chat)) as chat,
            exists (select 1 from mod_escrow_state where trade = $1) as escrow,
            (select watching from mod_watch where trade = $1) as watching,
            (select state from mod_watch where trade = $1) as state,
            (select escrow_address from mod_watch where trade = $1) as address,
            (select setup_done_at from mod_watch where trade = $1) as setup_done`,
    [trade],
  );
  const r = rows[0]!;
  if (r.made !== null && at.getTime() - r.made.getTime() < TRADE_SHRED_MIN_AGE_DAYS * DAY_MS) return 'young';
  if (r.disputed !== null && at.getTime() - r.disputed.getTime() < CHAT_AFTER_DISPUTE_DAYS * DAY_MS) return 'dispute';
  if (r.chat) return 'chat';
  if (r.watching !== null && r.address === null && r.setup_done === null && watchSawNothing(r.state) && (await escrowNeverFinalised(db, keystoreKey, trade))) return null;
  if (r.watching === true) return 'watching';
  if (r.watching === false) {
    let empty = false;
    try {
      empty = watchShowsEmpty(reviveWatchState(r.state));
    } catch {
      empty = false;
    }
    if (!empty) return 'escrow';
  } else if (r.escrow) {
    // An escrow state with no watch row was never watched, so never shown empty. With neither, no
    // moderator party ever ran from this database (runParty records the watch row first), so no
    // escrow holds this moderator's key.
    return 'escrow';
  }
  return null;
}

/**
 * A trade's ModPartyArgs after a restart, from this service's own records only: the sealed mod
 * identity and participants (`mod_party_state`), the R27 wallet password (`mod_wallet_secrets`)
 * and the terms it signed (`signed_terms`). Never from the API. Null when any is missing.
 */
/**
 * Plan 4 Task 14: the terms the gate checks a ruling against, from this service's own records only:
 * the attested terms in the trade's party args and the desk's shadow trade (fed by its own watcher
 * and signals). Null, logged, when there is no shadow or it is not the attested deal (review I3).
 */
export function recordedFor(args: ModPartyArgs, shadow: Trade | null, log: (e: { reason: string }) => void): RecordedTerms | null {
  if (shadow === null) return null;
  try {
    return recordedTerms({
      terms: args.terms,
      trade: { amountAtomic: shadow.amountAtomic, feeAtomic: shadow.feeAtomic, sellerFundsAtomic: shadow.sellerFundsAtomic, poster: shadow.poster },
      feeWallet: args.feeWallet,
    });
  } catch {
    log({ reason: 'ruling-terms-unavailable' });
    return null;
  }
}

async function partyArgsFor(o: ModerationOptions, code: string): Promise<ModPartyArgs | null> {
  const party = await loadParty<SealedParty>(o.db, o.keystoreKey, code);
  const { rows } = await o.db.query<{ attestation: Attestation }>('select attestation from signed_terms where trade = $1 and posted_at is not null', [code]);
  const terms = rows[0]?.attestation.terms;
  if (!party || terms === undefined) return null;
  return {
    trade: code,
    role: 'mod',
    me: fromHexIdentity(party.me),
    participants: party.participants,
    password: await walletPassword(o.db, o.keystoreKey, code),
    daemonUri: o.daemonUri,
    feeWallet: o.feeWallet,
    terms,
  };
}

/** Base64 of exactly `len` bytes from the environment; errors name the variable, never the value. */
function envBytes(env: Record<string, string | undefined>, name: string, len: number): Uint8Array {
  const v = env[name];
  if (!v) throw new Error(`moderation: ${name} is missing`);
  const b = new Uint8Array(Buffer.from(v, 'base64'));
  if (b.length !== len) throw new Error(`moderation: ${name} is malformed (base64 of ${len} bytes)`);
  return b;
}

function envString(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`moderation: ${name} is missing`);
  return v;
}

/**
 * Plan 4 Task 11: the internal API's settings. `MOD_INTERNAL_SOCKET` (an absolute path) unset: the
 * internal API does not start. Set, it needs `MOD_INTERNAL_SOCKET_GID` (the numeric id of the
 * dedicated group the API's user is in, never 0; review 8 Nov I-3), `MOD_INTERNAL_SECRET` (base64 of
 * 32 bytes, shared with the API only) and `MOD_API_READER_DATABASE_URL` (the API's database as a
 * member of the read-only role `x2f_mod_reader`, migration 208). Design build task 9: the
 * moderator's message is a countersign now, so the old dev-only switch `X2F_DEV_MOD_CHAT` is gone
 * and refused if still set (a stale setting is told, never silently ignored). Errors name the
 * variable, never the value.
 */
export function internalFromEnv(
  env: Record<string, string | undefined>,
): { socketPath: string; gid: number; secret: Uint8Array; apiReaderUrl: string } | null {
  const socketPath = env.MOD_INTERNAL_SOCKET;
  if (socketPath === undefined || socketPath === '') return null;
  if (!socketPath.startsWith('/')) throw new Error('moderation: MOD_INTERNAL_SOCKET is malformed (an absolute Unix socket path)');
  const gidText = env.MOD_INTERNAL_SOCKET_GID ?? '';
  if (!/^[1-9][0-9]{0,9}$/.test(gidText)) throw new Error('moderation: MOD_INTERNAL_SOCKET_GID is malformed (the dedicated group\'s numeric id, not 0)');
  if ((env.X2F_DEV_MOD_CHAT ?? '') !== '') throw new Error('moderation: X2F_DEV_MOD_CHAT is no longer used (the moderator\'s message is countersigned by a staff device); unset it');
  return {
    socketPath,
    gid: Number(gidText),
    secret: envBytes(env, 'MOD_INTERNAL_SECRET', 32),
    apiReaderUrl: envString(env, 'MOD_API_READER_DATABASE_URL'),
  };
}

function envNetwork(env: Record<string, string | undefined>): ModerationOptions['network'] {
  const v = envString(env, 'MONERO_NETWORK');
  if (v !== 'regtest' && v !== 'stagenet' && v !== 'mainnet') throw new Error('moderation: MONERO_NETWORK must be regtest, stagenet or mainnet');
  return v;
}

/**
 * Plan 4 Task 13: the ruling gate's settings. `MOD_STATE_DIR` (an absolute path) unset: no gate
 * runs, and nothing is ever co-signed for a ruling. Set, it needs the staff site's relying party
 * (`MOD_STAFF_ORIGIN`, an https origin, and `MOD_STAFF_RP_ID`), the FIDO metadata snapshot
 * (`MOD_FIDO_MDS_DIR`) and the read-only API role (`MOD_API_READER_DATABASE_URL`).
 */
export function gateFromEnv(
  env: Record<string, string | undefined>,
): { stateDir: string; origin: string; rpId: string; mdsDir: string; apiReaderUrl: string } | null {
  const stateDir = env.MOD_STATE_DIR;
  if (stateDir === undefined || stateDir === '') return null;
  if (!stateDir.startsWith('/')) throw new Error('moderation: MOD_STATE_DIR is malformed (an absolute path)');
  const origin = envString(env, 'MOD_STAFF_ORIGIN');
  if (!/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(origin)) throw new Error('moderation: MOD_STAFF_ORIGIN is malformed (https://host)');
  const rpId = envString(env, 'MOD_STAFF_RP_ID');
  if (!/^[a-z0-9.-]+$/.test(rpId) || !(new URL(origin).hostname === rpId || new URL(origin).hostname.endsWith(`.${rpId}`))) {
    throw new Error('moderation: MOD_STAFF_RP_ID is malformed (the staff origin\'s host or a parent domain)');
  }
  return { stateDir, origin, rpId, mdsDir: envString(env, 'MOD_FIDO_MDS_DIR'), apiReaderUrl: envString(env, 'MOD_API_READER_DATABASE_URL') };
}

// `tsx apps/moderation/src/main.ts`: the moderation process. Its one listener is the internal Unix socket (Plan 4 Task 11), and only when MOD_INTERNAL_SOCKET is set.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const { default: pgMod } = await import('pg');
  const { migrateModeration } = await import('./keystore.js');
  const db = new pgMod.Pool({ connectionString: envString(env, 'MOD_DATABASE_URL'), max: 5, keepAlive: true });
  db.on('error', () => process.stderr.write('{"level":50,"msg":"moderation database idle client error"}\n'));
  await migrateModeration(db);
  // Plan 4 Tasks 13-14: the ruling gate keeps its registry in step with the owner's taps, and the
  // ruling executor (execute.ts) settles each published round-1 escrow ruling exactly as the gate
  // authorises it. Without MOD_STATE_DIR there is no gate and no ruling is ever co-signed.
  const gateConfig = gateFromEnv(env);
  // Security review 2026-11-12 M1: the gate is a factory startModeration runs only once it holds the
  // instance lock; a refused second process never opens, syncs or saves gate.bin.
  let gateReader: pg.Pool | null = null;
  let gateParts: { store: GateStore; source: GateSource; ctx: GateContext } | null = null;
  // Both the attestations and the gate's ruling statements (Haveno finding 2) are signed with it.
  const signingSecret = envBytes(env, 'MOD_SIGNING_SECRET', 64);
  let handle: ModerationHandle;
  try {
    handle = await startModeration(
    {
      apiInternalUrl: envString(env, 'X2F_API_INTERNAL_URL'),
      relayAdminUrl: envString(env, 'RELAY_ADMIN_URL'),
      daemonUri: envString(env, 'MONERO_DAEMON_URI'),
      db,
      keystoreKey: envBytes(env, 'MOD_KEYSTORE_KEY', 32),
      signingSecret,
      feeWallet: envString(env, 'X2F_FEE_WALLET'),
      relayUrl: envString(env, 'RELAY_URL'),
      network: envNetwork(env),
    },
    {
      log: (e) => process.stdout.write(`${JSON.stringify({ level: 30, msg: e.reason })}\n`),
      ...(gateConfig
        ? {
            gate: async () => {
              const { fileGateAttestation, openGateStore, pgGateSource, startGateSync } = await import('./gate/index.js');
              const { rulingExecutor } = await import('./execute.js');
              const attestation = fileGateAttestation(gateConfig.mdsDir);
              await attestation.init();
              // Re-verify, M1 residual: the store holds MOD_STATE_DIR/gate.lock for its life (a successor on this host waits for it).
              const store = await openGateStore(gateConfig.stateDir, envBytes(env, 'MOD_KEYSTORE_KEY', 32), { lock: true });
              if (store.state.ownerAccountId === null) process.stderr.write('{"level":40,"msg":"ruling gate: owner not pinned (npm run pin-owner -w @x2f/moderation)"}\n');
              // Review M3: a locked or stalled table fails the reader's query instead of stopping the checkpoint loop for good.
              const reader = new pgMod.Pool({ connectionString: gateConfig.apiReaderUrl, max: 2, statement_timeout: 30_000 });
              reader.on('error', () => process.stderr.write('{"level":50,"msg":"gate reader idle client error"}\n'));
              gateReader = reader;
              const gateCtx = {
                rp: { origins: [gateConfig.origin], rpId: gateConfig.rpId },
                attestation,
                now: () => new Date(),
                log: (e: { reason: string }) => process.stderr.write(`${JSON.stringify({ level: 40, msg: e.reason })}\n`),
              };
              const source = pgGateSource(reader);
              const sync = startGateSync(store, source, gateCtx);
              // Review F8: the internal server asks this same gate who is staff and which devices are certified.
              gateParts = { store, source, ctx: gateCtx };
              const rulings = rulingExecutor({ store, source, ctx: gateCtx, signingSecret, log: (e) => process.stdout.write(`${JSON.stringify({ level: 30, msg: e.reason })}\n`) });
              const { afterRefundSigner } = await import('./afterRefund.js');
              const signer = afterRefundSigner({ store, source, ctx: gateCtx, signingSecret, log: (e) => process.stdout.write(`${JSON.stringify({ level: 30, msg: e.reason })}\n`) });
              const { forgetTrade, tradeRulingPending } = await import('./gate/store.js');
              // A save that failed is made again on the next forget, so a forgotten trade never stays in gate.bin.
              let unsaved = false;
              return {
                rulings,
                // Review p4t22 M2: the after-refund statements.
                afterRefund: { codes: () => source.afterRefundCodes(), stored: (code: string) => source.storedRulings(code), signer },
                checkpoints: { store, reader },
                tradeRecords: {
                  pending: (code: string) => tradeRulingPending(store.state, code),
                  forget: (code: string) =>
                    store.exclusive(async () => {
                      if (forgetTrade(store.state, code) || unsaved) {
                        unsaved = true;
                        await store.save();
                        unsaved = false;
                      }
                    }),
                },
                stop: async () => {
                  await sync.stop();
                  await store.close();
                },
              };
            },
          }
        : {}),
    },
    );
  } catch (e) {
    // A refused start (another process holds the instance lock, finding 2) or bad settings: exit non-zero.
    process.stderr.write(`${JSON.stringify({ level: 50, msg: e instanceof Error ? e.message : 'moderation: start failed' })}\n`);
    await (gateReader as pg.Pool | null)?.end().catch(() => undefined);
    await db.end().catch(() => undefined);
    process.exit(1);
  }
  const internal = internalFromEnv(env);
  let apiReader: pg.Pool | null = null;
  let server: { close(): Promise<void> } | null = null;
  if (internal) {
    const { pgApiView } = await import('./internal/apiView.js');
    const { startInternalServer } = await import('./internal/server.js');
    const { gateInternalDeps } = await import('./internal/gateDeps.js');
    apiReader = new pgMod.Pool({ connectionString: internal.apiReaderUrl, max: 2 });
    apiReader.on('error', () => process.stderr.write('{"level":50,"msg":"api reader idle client error"}\n'));
    server = await startInternalServer({ path: internal.socketPath, gid: internal.gid }, {
      secret: internal.secret,
      api: pgApiView(apiReader),
      db,
      keystoreKey: envBytes(env, 'MOD_KEYSTORE_KEY', 32),
      ...(gateParts !== null ? gateInternalDeps(gateParts) : {}),
    });
  }
  const shutdown = async () => {
    await server?.close();
    // Stops the gate's sync (review M1: inside the stop, before the lock goes), then its reader.
    await handle.stop();
    await (gateReader as pg.Pool | null)?.end();
    await apiReader?.end();
    await db.end();
  };
  // Re-verify R3: a lost instance lock ends the process non-zero (the service already stopped), so a
  // supervisor restarts it and the new process waits for the lock.
  void handle.lockLost.then(async () => {
    await (gateReader as pg.Pool | null)?.end().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await apiReader?.end().catch(() => undefined);
    await db.end().catch(() => undefined);
    process.exit(1);
  });
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
