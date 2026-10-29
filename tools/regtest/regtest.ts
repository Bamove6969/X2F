import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REGTEST_DIR = join(ROOT, '.regtest');
// Must match DIR_NAME in fetch-monerod.sh for each CPU it supports.
const MONERO_DIRS: Partial<Record<NodeJS.Architecture, string>> = {
  x64: 'monero-x86_64-linux-gnu-v0.18.5.3',
  arm64: 'monero-aarch64-linux-gnu-v0.18.5.3',
};
const MONERO_DIR = MONERO_DIRS[process.arch];
const MONEROD = MONERO_DIR === undefined ? undefined : join(REGTEST_DIR, 'bin', MONERO_DIR, 'monerod');

export interface Regtest {
  rpcUri: string;
  /**
   * With `restrictedRpc`, a second RPC port in monerod's restricted mode (what `--restricted-rpc` gives
   * the main port). The main port stays unrestricted so tests can still mine with generateblocks.
   */
  restrictedRpcUri: string | undefined;
  pid: number;
  dataDir: string;
  stop(): Promise<void>;
}

/** Blocks mined to fund a wallet; coinbase outputs unlock after 60 blocks. */
const FUNDING_BLOCKS = 80;
/** Extra blocks after funding so the last funded outputs reach the 10-block spend lock. */
const CONFIRMATION_BLOCKS = 12;

const children = new Set<ChildProcess>();
function killChildren(): void {
  for (const c of children) c.kill('SIGKILL');
}
process.on('exit', killChildren);
// Handling a signal suppresses its default exit, so re-raise it once the children are gone.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    killChildren();
    process.kill(process.pid, sig);
  });
}

const reserved = new Set<number>();

/** Ask the OS for a free port; never hand out the same port twice in one process. */
async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
    if (port > 0 && !reserved.has(port)) {
      reserved.add(port);
      return port;
    }
  }
}

function spawnFailure(child: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', (e) => reject(new Error(`could not start monerod: ${e.message}`)));
  });
}

async function waitForInfo(rpcUri: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`monerod exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${rpcUri}/get_info`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('monerod did not answer /get_info within 60s');
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
}

export async function startRegtest(o: { restrictedRpc?: boolean } = {}): Promise<Regtest> {
  if (MONEROD === undefined) throw new Error(`regtest supports x64 and arm64 Linux only, not ${process.arch}`);
  if (!existsSync(MONEROD)) throw new Error(`monerod missing at ${MONEROD}; run tools/regtest/fetch-monerod.sh`);
  mkdirSync(REGTEST_DIR, { recursive: true });
  const dataDir = mkdtempSync(join(REGTEST_DIR, 'node-'));
  const rpcPort = await freePort();
  const p2pPort = await freePort();
  const restrictedPort = o.restrictedRpc ? await freePort() : undefined;
  const rpcUri = `http://127.0.0.1:${rpcPort}`;
  const restrictedRpcUri = restrictedPort === undefined ? undefined : `http://127.0.0.1:${restrictedPort}`;
  const child = spawn(
    MONEROD,
    [
      '--regtest',
      '--offline',
      '--fixed-difficulty', '1',
      '--no-zmq',
      '--rpc-bind-ip', '127.0.0.1',
      '--rpc-bind-port', String(rpcPort),
      '--p2p-bind-ip', '127.0.0.1',
      '--p2p-bind-port', String(p2pPort),
      '--data-dir', dataDir,
      '--non-interactive',
      '--disable-rpc-ban',
      ...(restrictedPort === undefined ? [] : ['--rpc-restricted-bind-ip', '127.0.0.1', '--rpc-restricted-bind-port', String(restrictedPort)]),
    ],
    { stdio: 'ignore' },
  );
  children.add(child);
  const failed = spawnFailure(child);
  failed.catch(() => undefined); // surfaced through the race below; avoid an unhandled rejection after start

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited(child);
      clearTimeout(timer);
    }
    children.delete(child);
    reserved.delete(rpcPort);
    reserved.delete(p2pPort);
    if (restrictedPort !== undefined) reserved.delete(restrictedPort);
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await Promise.race([waitForInfo(rpcUri, child), failed]);
    if (restrictedRpcUri !== undefined) await Promise.race([waitForInfo(restrictedRpcUri, child), failed]);
  } catch (e) {
    await stop();
    throw e;
  }
  return { rpcUri, restrictedRpcUri, pid: child.pid ?? -1, dataDir, stop };
}

export async function mine(rpcUri: string, blocks: number, address: string): Promise<void> {
  const res = await fetch(`${rpcUri}/json_rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method: 'generateblocks',
      params: { wallet_address: address, amount_of_blocks: blocks },
    }),
  });
  const body = (await res.json()) as { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(`generateblocks failed: ${body.error?.message ?? res.status}`);
}

export async function newTestWallet(rpcUri: string): Promise<MoneroWalletFull> {
  const wallet = await MoneroWalletFull.createWallet(new MoneroWalletConfig({
    networkType: MoneroNetworkType.MAINNET,
    regtest: true,
    server: { uri: rpcUri },
  }));
  return wallet;
}

export async function fundedWallet(rpcUri: string): Promise<MoneroWalletFull> {
  const wallet = await newTestWallet(rpcUri);
  try {
    const address = await wallet.getPrimaryAddress();
    await mine(rpcUri, FUNDING_BLOCKS, address);
    await mine(rpcUri, CONFIRMATION_BLOCKS, address);
    // The wallet caches the daemon height at creation; refresh it before syncing.
    await wallet.setDaemonConnection({ uri: rpcUri });
    await wallet.sync();
    if ((await wallet.getUnlockedBalance()) <= 0n) throw new Error('funded wallet has no unlocked balance');
    return wallet;
  } catch (e) {
    await wallet.close();
    throw e;
  }
}
