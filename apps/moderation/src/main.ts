import { normalizeTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import type { PartyHandle, Transport } from '@x2f/escrow';
import { channelFor, WATCH_INTERVAL_MS, type Attestation, type ModPartyArgs } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { AttestRefused, attestTrade, BadTerms } from './attest.js';
import { loadParty, saveParty, walletPassword } from './keystore.js';
import { createLink, type Fetch, type Link, type WorkItem } from './link.js';
import { defaultPartyIO, startModParty, type PartyIO } from './party.js';
import { openDesk } from './desk.js';
import { createWatcher } from './watcher.js';

export { AttestRefused, attestTrade, BadTerms, checkWork, signAttestation, type Attested } from './attest.js';
export { loadParty, migrateModeration, modSubkey, open, saveParty, seal, WALLET_PASSWORD_BYTES, walletPassword } from './keystore.js';
export { createLink, relayCloseMessage, relayRegisterMessage, type Fetch, type Link, type WorkItem } from './link.js';
export { defaultPartyIO, escrowStore, startModParty, type PartyIO } from './party.js';
export { autoRefundStep, REFUND_UNVERIFIED_MS, type AutoRefundInputs, type AutoRefundStep } from './autoRefund.js';
export { buyerCancelStep, type BuyerCancelInputs, type BuyerCancelStep } from './buyerCancel.js';
export { openDesk, type Desk, type DeskRecord, type DeskStep } from './desk.js';
export { verifyRuling } from './rulings.js';
export { newShadow } from './shadow.js';
export { readSignal, sealAck, termsMatch, type ModSignal } from './signals.js';
export { createWatcher, dumpWatchState, reviveWatchState, spendEvidence, SETTLE_BACKOFF_MS, type Watcher } from './watcher.js';

/**
 * The moderation service: a SEPARATE process that holds the moderator keystore (MOD_KEYSTORE_KEY)
 * and the long-term moderation signing key (MOD_SIGNING_SECRET). It opens NO listening socket and
 * depends on neither fastify nor `@x2f/api`: it only makes outbound, signed requests. Its own
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
  newIdentity?: () => Promise<Identity>;
  now?: () => Date;
  /** Loop period; 0 runs no loop (callers drive `tick`). Default 5 s. */
  intervalMs?: number;
  /** Reasons only, never keys, codes or addresses. */
  log?: (e: { reason: string }) => void;
}

export interface ModerationHandle {
  /** One pass over the API's work list; resolves with the trades attested and started this pass. */
  tick(): Promise<string[]>;
  /** One chain-watcher pass (Task 9). */
  watch(): Promise<void>;
  /** Stops both loops, then every running moderator party. */
  stop(): Promise<void>;
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

const defaultFetch: Fetch = async (url, init) => {
  const res = await globalThis.fetch(url, init);
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
  const link: Link = createLink({
    apiInternalUrl: o.apiInternalUrl,
    relayAdminUrl: o.relayAdminUrl,
    signingSecret: o.signingSecret,
    fetch: deps.fetch ?? defaultFetch,
    now: () => now().getTime(),
  });
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
      await client.query('insert into signed_terms (trade, attestation, sig) values ($1, $2, $3)', [code, a.attestation, a.sig]);
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

  const intervalMs = deps.intervalMs ?? 5_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> = Promise.resolve();
  const loop = (): void => {
    if (stopped) return;
    running = tick().finally(() => {
      if (!stopped) timer = setTimeout(loop, intervalMs);
    });
  };
  if (intervalMs > 0) loop();

  const watchIntervalMs = deps.watchIntervalMs ?? WATCH_INTERVAL_MS;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let watching: Promise<unknown> = Promise.resolve();
  const watchLoop = (): void => {
    if (stopped) return;
    watching = watcher
      .tick()
      .catch(() => log({ reason: 'watch-pass-failed' }))
      .finally(() => {
        if (!stopped) watchTimer = setTimeout(watchLoop, watchIntervalMs);
      });
  };
  if (watchIntervalMs > 0) watchLoop();

  return {
    tick,
    watch: () => watcher.tick(),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (watchTimer) clearTimeout(watchTimer);
      await running.catch(() => undefined);
      await watching.catch(() => undefined);
      await watcher.stop();
    },
  };
}

/**
 * A trade's ModPartyArgs after a restart, from this service's own records only: the sealed mod
 * identity and participants (`mod_party_state`), the R27 wallet password (`mod_wallet_secrets`)
 * and the terms it signed (`signed_terms`). Never from the API. Null when any is missing.
 */
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

function envNetwork(env: Record<string, string | undefined>): ModerationOptions['network'] {
  const v = envString(env, 'MONERO_NETWORK');
  if (v !== 'regtest' && v !== 'stagenet' && v !== 'mainnet') throw new Error('moderation: MONERO_NETWORK must be regtest, stagenet or mainnet');
  return v;
}

// `tsx apps/moderation/src/main.ts`: the moderation process. No listening socket of any kind.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const { default: pgMod } = await import('pg');
  const { migrateModeration } = await import('./keystore.js');
  const db = new pgMod.Pool({ connectionString: envString(env, 'MOD_DATABASE_URL'), max: 4 });
  db.on('error', () => process.stderr.write('{"level":50,"msg":"moderation database idle client error"}\n'));
  await migrateModeration(db);
  const handle = await startModeration(
    {
      apiInternalUrl: envString(env, 'X2F_API_INTERNAL_URL'),
      relayAdminUrl: envString(env, 'RELAY_ADMIN_URL'),
      daemonUri: envString(env, 'MONERO_DAEMON_URI'),
      db,
      keystoreKey: envBytes(env, 'MOD_KEYSTORE_KEY', 32),
      signingSecret: envBytes(env, 'MOD_SIGNING_SECRET', 64),
      feeWallet: envString(env, 'X2F_FEE_WALLET'),
      relayUrl: envString(env, 'RELAY_URL'),
      network: envNetwork(env),
    },
    { log: (e) => process.stdout.write(`${JSON.stringify({ level: 30, msg: e.reason })}\n`) },
  );
  const shutdown = async () => {
    await handle.stop();
    await db.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
