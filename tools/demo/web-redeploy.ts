/**
 * DEMO ONLY: `npm run demo:web`, a web-only redeploy of the running demo (demo r6). Rebuilds
 * apps/web from this worktree and puts it live without touching Postgres, monerod, the relay, the
 * moderator, the gateway or the comments, so the owner's accounts, sessions and trades stay: copy
 * and UI fixes go live in well under a minute.
 *
 * 1. Builds into apps/web/dist-demo.next (the running site keeps serving the old build meanwhile).
 * 2. Carries the old build's hashed assets over (not the escrow worker: the API allows exactly one),
 *    so a tab opened before the swap can still load its lazy chunks.
 * 3. Swaps the folders (dist-demo -> dist-demo.prev, .next -> dist-demo) and restarts only the API
 *    process, which serves the web files (it lists them when it starts), with the environment it
 *    runs with (.demo/secrets/env.json). Sessions are in Postgres, so logins survive; open live
 *    streams reconnect. If the API does not come back, the old build is put back and the API
 *    restarted on it.
 *
 * With DEMO_PORT_OFFSET, the offset demo's folders and ports (config.ts).
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_FILE, PORTS, HOST, SECRETS_DIR, WEB_DIST } from './config.js';
import { assertDemoFlag } from './guard.js';
import { readPids, restartTs } from './procs.js';
import { buildWeb, carriedAssets } from './web-build.js';

assertDemoFlag(process.env);
const t0 = Date.now();
const step = (s: string): void => console.log(`demo:web: ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiUp(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`http://${HOST}:${PORTS.api}/v1/site`)).status < 500) return true;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  return false;
}

async function main(): Promise<void> {
  const pid = readPids().api;
  if (pid === undefined || !existsSync(ENV_FILE) || !existsSync(WEB_DIST)) throw new Error('no running demo here (npm run demo first)');
  const secrets = JSON.parse(readFileSync(join(SECRETS_DIR, 'secrets.json'), 'utf8')) as { modSigningPublic: string; feeWallet: string };
  const apiEnv = JSON.parse(readFileSync(ENV_FILE, 'utf8')) as Record<string, string>;
  if (apiEnv.X2F_WEB_ROOT !== WEB_DIST) throw new Error(`the running API serves ${apiEnv.X2F_WEB_ROOT}, not ${WEB_DIST}`);

  const next = `${WEB_DIST}.next`;
  const prev = `${WEB_DIST}.prev`;
  step('building apps/web');
  buildWeb(next, secrets);
  const oldAssets = join(WEB_DIST, 'assets');
  const newAssets = join(next, 'assets');
  const carried = existsSync(oldAssets) ? carriedAssets(readdirSync(oldAssets), readdirSync(newAssets)) : [];
  for (const n of carried) cpSync(join(oldAssets, n), join(newAssets, n));
  step(`built; ${carried.length} earlier asset(s) kept for open tabs`);

  rmSync(prev, { recursive: true, force: true });
  renameSync(WEB_DIST, prev);
  renameSync(next, WEB_DIST);
  step('swapped; restarting the API only');
  await restartTs('api', 'apps/api/src/main.ts', apiEnv);
  if (await apiUp(120_000)) {
    step('live: the API serves the new build (Postgres, chain, sessions and comments untouched)');
    return;
  }
  console.error('demo:web: the API did not come back on the new build; putting the old one back');
  rmSync(next, { recursive: true, force: true });
  renameSync(WEB_DIST, next);
  renameSync(prev, WEB_DIST);
  await restartTs('api', 'apps/api/src/main.ts', apiEnv);
  if (!(await apiUp(120_000))) throw new Error('the API did not come back on the old build either: see .demo/logs/api.log');
  throw new Error(`rolled back to the old build (the failed one is in ${next}; see .demo/logs/api.log)`);
}

main().then(() => process.exit(0), (e: unknown) => {
  console.error(`demo:web: failed: ${(e as Error).message}`);
  process.exit(1);
});
