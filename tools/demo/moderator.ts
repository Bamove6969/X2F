/**
 * DEMO ONLY: the demo's moderation process, the regtest miner and a fake-money faucet.
 *
 * It runs the real moderation service (`startModeration` from apps/moderation) with its production
 * defaults: attestation, relay channel registration, the sealed keystore, the moderator's escrow
 * party (`startModParty` over the relay), the chain watcher (`setup-done`, `chain`, `settled`
 * through the API's internal reports) and the moderator desks. The API runs its own timer loop.
 * The only demo choices are a shorter watcher period, so a trade moves at demo speed.
 *
 * What this file adds, for the demo only:
 *  - a regtest miner (a block every few seconds, so confirmations happen), and
 *  - a faucet: when a seller taps "Fund escrow" (the trade records `fund_started_at`) the faucet
 *    pays the escrow exactly what the trade asks, standing in for the seller's own wallet app.
 *
 * It refuses to start unless X2F_DEMO=1 and the daemon is a regtest node on 127.0.0.1
 * (guard.ts), and nothing in apps/ or packages/ imports it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateModeration, startModeration } from '@x2f/moderation';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import pg from 'pg';
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
const MINE_EVERY_MS = Number(env.DEMO_MINE_EVERY_MS || '3000');
const WATCH_EVERY_MS = Number(env.DEMO_WATCH_EVERY_MS || '4000');
const log = (o: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);
};

// The API's database is read for one thing only: which escrows the faucet should pay.
const apiDb = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 2 });
const modDb = new pg.Pool({ connectionString: need('MOD_DATABASE_URL'), max: 5, keepAlive: true });
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

let faucetBusy: Promise<unknown> = Promise.resolve();
/** Runs wallet work one at a time (monero-ts wallets are not re-entrant). */
function faucetDo<T>(f: () => Promise<T>): Promise<T> {
  const p = faucetBusy.then(f, f);
  faucetBusy = p.catch(() => undefined);
  return p;
}

let mining = false;
const minerTimer = setInterval(() => {
  if (mining) return;
  mining = true;
  mine(faucetAddress, 1)
    .then(() => faucetDo(() => faucet.sync()))
    .catch(() => log({ reason: 'mine-failed' }))
    .finally(() => {
      mining = false;
    });
}, MINE_EVERY_MS);

// ── the faucet pays escrows whose seller tapped "Fund escrow" ───────────────

/** Trades the faucet already paid, kept across a moderator restart (never pay twice). */
mkdirSync(STATE, { recursive: true, mode: 0o700 });
const FUNDED_PATH = join(STATE, 'faucet-funded.json');
const funded = new Set<string>(existsSync(FUNDED_PATH) ? (JSON.parse(readFileSync(FUNDED_PATH, 'utf8')) as string[]) : []);
const saveFunded = (): void => writeFileSync(FUNDED_PATH, JSON.stringify([...funded]), { mode: 0o600 });

let paying = false;
const faucetTimer = setInterval(() => {
  if (paying) return;
  paying = true;
  (async () => {
    const { rows } = await apiDb.query<{ code: string; escrow_address: string; seller_funds_atomic: string }>(
      `select code, escrow_address, seller_funds_atomic from trades
        where state = 'funding' and fund_started_at is not null and escrow_address is not null`,
    );
    for (const r of rows) {
      if (funded.has(r.code)) continue;
      funded.add(r.code);
      saveFunded();
      try {
        await faucetDo(() => faucet.createTx({ accountIndex: 0, address: r.escrow_address, amount: BigInt(r.seller_funds_atomic), relay: true }));
        log({ reason: 'faucet-funded', trade: r.code, atomic: r.seller_funds_atomic });
      } catch (e) {
        funded.delete(r.code);
        saveFunded();
        log({ reason: 'faucet-failed', trade: r.code, why: (e as Error).message });
      }
    }
  })()
    .catch((e: unknown) => log({ reason: 'faucet-pass-failed', why: (e as Error).message }))
    .finally(() => {
      paying = false;
    });
}, 3000);

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
    relayUrl: need('DEMO_RELAY_WS'),
    network: 'regtest',
  },
  { intervalMs: 2000, watchIntervalMs: WATCH_EVERY_MS, log: (e) => log(e) },
);
log({ reason: 'demo-moderator-ready' });

const shutdown = async () => {
  clearInterval(minerTimer);
  clearInterval(faucetTimer);
  await handle.stop();
  await faucet.close().catch(() => undefined);
  await apiDb.end();
  await modDb.end();
  process.exit(0);
};
void handle.lockLost.then(() => process.exit(1));
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
