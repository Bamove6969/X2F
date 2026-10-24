import { normalizeTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { channelFor, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { attestTrade } from './attest.js';
import { loadParty, saveParty, walletPassword } from './keystore.js';
import { createLink, type Fetch, type Link, type WorkItem } from './link.js';

export { AttestRefused, attestTrade, checkWork, signAttestation, type Attested } from './attest.js';
export { loadParty, migrateModeration, modSubkey, open, saveParty, seal, WALLET_PASSWORD_BYTES, walletPassword } from './keystore.js';
export { createLink, relayRegisterMessage, type Fetch, type Link, type WorkItem } from './link.js';

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
}

/** What the moderator party is started with (Task 9 runs `@x2f/escrow`'s `runParty` with it). */
export interface ModPartyArgs {
  trade: string;
  role: 'mod';
  me: Identity;
  participants: Participants;
  /** R27: the trade's own escrow wallet password, 32 random bytes as hex, from `mod_wallet_secrets`. */
  password: string;
  daemonUri: string;
  feeWallet: string;
}

export interface ModerationDeps {
  fetch?: Fetch;
  /** Starts the moderator party for a trade. Task 9 supplies the real one; until then it is deferred. */
  runParty?: (a: ModPartyArgs) => void | Promise<void>;
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
  const runParty = deps.runParty ?? (() => log({ reason: 'party-deferred' }));
  const link: Link = createLink({
    apiInternalUrl: o.apiInternalUrl,
    relayAdminUrl: o.relayAdminUrl,
    signingSecret: o.signingSecret,
    fetch: deps.fetch ?? defaultFetch,
    now: () => now().getTime(),
  });
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
      try {
        const code = typeof w?.trade === 'string' ? normalizeTradeCode(w.trade) : null;
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
          });
        }
        log({ reason: 'attested' });
        done.push(code);
      } catch (e) {
        log({ reason: e instanceof Error && e.name === 'AttestRefused' ? `refused-${e.message}` : 'trade-failed' });
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

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running.catch(() => undefined);
    },
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
