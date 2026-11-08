/**
 * DEMO ONLY: the demo's moderation process, the regtest miner and a fake-money faucet.
 *
 * It runs the real moderation service (`startModeration` from apps/moderation: attestation,
 * relay channel registration, sealed keystore) and fills in, for the demo only, the pieces the
 * production service does not have yet:
 *  - the moderator's escrow party (`runParty` as `mod`, the real 2-of-3 multisig over the relay),
 *    because apps/moderation's party hook is still deferred (Task 9);
 *  - a chain watcher that applies the system events `setup-done`, `chain` and `settled` to the
 *    API's trade store (the API has no route for them yet), and the API timer loop (`tick`,
 *    `pause`, `resume`, `escalate` from @x2f/trade's timerEvents), also not wired in production yet;
 *  - a regtest miner (a block every few seconds, so confirmations happen) and a faucet: when a
 *    seller taps "Fund escrow" the faucet pays the escrow exactly what the trade asks, standing in
 *    for the seller's own wallet app.
 *
 * It refuses to start unless X2F_DEMO=1 and the daemon is a regtest node on 127.0.0.1
 * (guard.ts), and nothing in apps/ or packages/ imports it.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MoneroMultisigEngine, runParty, wsTransport, type PartyHandle, type PartyState, type PartyStore } from '@x2f/escrow';
import { startModeration, migrateModeration } from '@x2f/moderation';
import { modPartyArgs, timerEvents, type ModPartyArgs, type TradeEvent } from '@x2f/trade';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import pg from 'pg';
import { applyEvent, loadTradeRow, rowToTrade, type TradeRow } from '../../apps/api/src/trades/store.js';
import { assertDemo, assertDemoFlag } from './guard.js';

const env = process.env;
// The flag first, before anything is read or opened.
assertDemoFlag(env);
const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`demo moderator: ${k} is missing`);
  return v;
};
const DAEMON = need('MONERO_DAEMON_URI');
await assertDemo(env, DAEMON);

const STATE = need('DEMO_STATE_DIR');
const RELAY_WS = need('DEMO_RELAY_WS');
const MINE_EVERY_MS = Number(env.DEMO_MINE_EVERY_MS || '3000');
const log = (o: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);
};

const apiDb = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 4 });
const modDb = new pg.Pool({ connectionString: need('MOD_DATABASE_URL'), max: 4 });
apiDb.on('error', () => log({ reason: 'api-db-idle-error' }));
modDb.on('error', () => log({ reason: 'mod-db-idle-error' }));
await migrateModeration(modDb);

// ── regtest RPC ─────────────────────────────────────────────────────────────

async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${DAEMON}/json_rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }),
  });
  const b = (await res.json()) as { result?: T; error?: { message?: string } };
  if (b.error || b.result === undefined) throw new Error(`${method}: ${b.error?.message ?? res.status}`);
  return b.result;
}
async function other<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${DAEMON}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}
const height = async (): Promise<number> => (await rpc<{ count: number }>('get_block_count')).count;
const mine = (address: string, blocks: number) => rpc('generateblocks', { wallet_address: address, amount_of_blocks: blocks });

// ── faucet wallet and miner ─────────────────────────────────────────────────

const faucet = await MoneroWalletFull.createWallet(new MoneroWalletConfig({
  networkType: MoneroNetworkType.MAINNET,
  regtest: true,
  server: { uri: DAEMON },
  password: 'demo-faucet',
  proxyToWorker: false,
}));
const faucetAddress = await faucet.getPrimaryAddress();
// Coinbase outputs unlock after 60 blocks: mine enough to fund many trades.
if ((await height()) < 120) await mine(faucetAddress, 130);
await faucet.setDaemonConnection({ uri: DAEMON });
await faucet.sync();
log({ reason: 'faucet-ready', unlocked: (await faucet.getUnlockedBalance()).toString() });

/** Txs the faucet sent: never mistaken for an escrow's settlement. */
const faucetTxs = new Set<string>();
let faucetBusy: Promise<unknown> = Promise.resolve();
/** Runs wallet work one at a time (monero-ts wallets are not re-entrant). */
function faucetDo<T>(f: () => Promise<T>): Promise<T> {
  const p = faucetBusy.then(f, f);
  faucetBusy = p.catch(() => undefined);
  return p;
}

let mining = false;
setInterval(() => {
  if (mining) return;
  mining = true;
  mine(faucetAddress, 1)
    .then(() => faucetDo(() => faucet.sync()))
    .catch(() => log({ reason: 'mine-failed' }))
    .finally(() => {
      mining = false;
    });
}, MINE_EVERY_MS);

// ── the moderator's escrow party (demo stand-in for Task 9) ─────────────────

function fileStore(code: string): PartyStore {
  const dir = join(STATE, 'mod-party');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${code}.json`);
  return {
    load: async () => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PartyState) : null),
    save: async (s) => writeFileSync(path, JSON.stringify(s), { mode: 0o600 }),
  };
}

interface Watched {
  code: string;
  party: PartyHandle;
  address: string | null;
  funded: boolean;
  /** Global output indices of the escrow's incoming coins. */
  outputs: Set<number>;
  scannedTo: number;
}
const watched = new Map<string, Watched>();
const engine = new MoneroMultisigEngine({ network: 'regtest' });

async function system(code: string, e: TradeEvent): Promise<void> {
  try {
    await applyEvent({ db: apiDb, clock: () => new Date() }, code, e, 'system');
    log({ reason: 'event', trade: code, type: e.type });
  } catch (err) {
    const c = (err as { code?: string }).code ?? (err as Error).message;
    if (c !== 'wrong-state') log({ reason: 'event-refused', trade: code, type: e.type, why: c });
  }
}

async function demoRunParty(a: ModPartyArgs): Promise<void> {
  const code = a.trade;
  const { args } = await modPartyArgs(a, {
    transport: (channel) => wsTransport({ url: RELAY_WS, code: channel, role: 'mod', me: a.me }),
    engine,
    store: fileStore(code),
  });
  const party = runParty(args);
  const w: Watched = { code, party, address: null, funded: false, outputs: new Set(), scannedTo: 0 };
  watched.set(code, w);
  log({ reason: 'mod-party-started', trade: code });
  party.ready().then(
    async (address) => {
      w.address = address;
      w.scannedTo = await height();
      log({ reason: 'escrow-ready', trade: code });
      await system(code, { type: 'setup-done', escrowAddress: address });
    },
    (e: unknown) => log({ reason: 'mod-party-failed', trade: code, why: (e as Error).message }),
  );
}

// ── the chain watcher ───────────────────────────────────────────────────────

interface DecodedTx {
  vin?: { key?: { key_offsets?: number[] } }[];
}

/** The first tx in a block since `w.scannedTo` that uses one of the escrow's coins as a ring member. */
async function findSpend(w: Watched): Promise<{ txHash: string } | null> {
  const top = await height();
  for (let h = w.scannedTo; h < top; h++) {
    const block = await rpc<{ tx_hashes?: string[] }>('get_block', { height: h });
    const hashes = (block.tx_hashes ?? []).filter((x) => !faucetTxs.has(x));
    if (hashes.length > 0) {
      const got = await other<{ txs?: { tx_hash: string; as_json: string }[] }>('get_transactions', { txs_hashes: hashes, decode_as_json: true });
      for (const tx of got.txs ?? []) {
        const j = JSON.parse(tx.as_json) as DecodedTx;
        for (const vin of j.vin ?? []) {
          let abs = 0;
          for (const off of vin.key?.key_offsets ?? []) {
            abs += off;
            if (w.outputs.has(abs)) return { txHash: tx.tx_hash };
          }
        }
      }
    }
    w.scannedTo = h + 1;
  }
  return null;
}

async function noteOutputs(w: Watched, txHashes: string[]): Promise<void> {
  const fresh = txHashes;
  if (fresh.length === 0) return;
  const got = await other<{ txs?: { tx_hash: string; output_indices?: number[]; block_height?: number; in_pool?: boolean }[] }>('get_transactions', {
    txs_hashes: fresh,
  });
  for (const tx of got.txs ?? []) for (const i of tx.output_indices ?? []) w.outputs.add(i);
}

const OPEN = new Set(['funding', 'securing', 'secured', 'paid', 'refund_requested']);

async function watchOne(w: Watched): Promise<void> {
  const row: TradeRow | null = await loadTradeRow(apiDb, w.code);
  if (!row || w.address === null) return;
  const t = rowToTrade(row);
  if (t.state === 'released' || t.state === 'refunded' || t.state === 'cancelled') return;

  // The faucet stands in for the seller's wallet app once they tap "Fund escrow".
  if (t.state === 'funding' && t.fundStartedAt !== null && !w.funded) {
    w.funded = true;
    const address = w.address;
    try {
      const tx = await faucetDo(() => faucet.createTx({ accountIndex: 0, address, amount: t.sellerFundsAtomic, relay: true }));
      const hash = tx.getHash();
      faucetTxs.add(hash);
      log({ reason: 'faucet-funded', trade: w.code, atomic: t.sellerFundsAtomic.toString() });
    } catch (e) {
      w.funded = false;
      log({ reason: 'faucet-failed', trade: w.code, why: (e as Error).message });
    }
  }

  const f = await w.party.funds();
  if (f.incoming.length > 0) await noteOutputs(w, f.incoming.filter((i) => i.confirmations > 0).map((i) => i.txHash));
  if (OPEN.has(t.state) && f.incoming.length > 0) {
    const confirmations = Math.min(...f.incoming.map((i) => i.confirmations));
    await system(w.code, { type: 'chain', receivedAtomic: f.balance, unlockedAtomic: f.unlocked, confirmations });
  }
  if (t.state === 'settling' && t.settling !== null && w.outputs.size > 0) {
    const spend = await findSpend(w);
    if (spend) await system(w.code, { type: 'settled', kind: t.settling, txHash: spend.txHash });
  }
}

let watching = false;
setInterval(() => {
  if (watching) return;
  watching = true;
  (async () => {
    for (const w of watched.values()) {
      try {
        await watchOne(w);
      } catch (e) {
        log({ reason: 'watch-failed', trade: w.code, why: (e as Error).message });
      }
    }
  })().finally(() => {
    watching = false;
  });
}, 4000);

// ── the API timer loop (demo stand-in) ──────────────────────────────────────

setInterval(() => {
  (async () => {
    const { rows } = await apiDb.query<TradeRow>(`select * from trades where closed_at is null or state = 'refunded'`);
    const flags = await apiDb.query<{ maintenance_since: Date | null }>('select maintenance_since from site_flags limit 1');
    const now = new Date();
    const pass = timerEvents(rows.map(rowToTrade), flags.rows[0]?.maintenance_since ?? null, now);
    for (const e of pass.events) {
      try {
        await applyEvent({ db: apiDb, clock: () => e.at }, e.code, e.event, 'system');
        log({ reason: 'timer', trade: e.code, type: e.event.type });
      } catch {
        log({ reason: 'timer-refused', trade: e.code, type: e.event.type });
      }
    }
  })().catch((e: unknown) => log({ reason: 'timer-loop-failed', why: (e as Error).message }));
}, 5000);

// ── the real moderation service ─────────────────────────────────────────────

const handle = await startModeration(
  {
    apiInternalUrl: need('X2F_API_INTERNAL_URL'),
    relayAdminUrl: need('RELAY_ADMIN_URL'),
    daemonUri: DAEMON,
    db: modDb,
    keystoreKey: new Uint8Array(Buffer.from(need('MOD_KEYSTORE_KEY'), 'base64')),
    signingSecret: new Uint8Array(Buffer.from(need('MOD_SIGNING_SECRET'), 'base64')),
    feeWallet: need('X2F_FEE_WALLET'),
  },
  { runParty: demoRunParty, intervalMs: 2000, log: (e) => log(e) },
);
log({ reason: 'demo-moderator-ready' });

const shutdown = async () => {
  await handle.stop();
  for (const w of watched.values()) await w.party.stop().catch(() => undefined);
  await faucet.close().catch(() => undefined);
  await apiDb.end();
  await modDb.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
