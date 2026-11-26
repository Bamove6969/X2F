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
 * The staff app too (apps/staff-web, apps/staff-web/dist-demo): built into its own .next beside the
 * web one, swapped in the same step and served by the same API restart (the staff API is that
 * process's second listener, X2F_STAFF_WEB_ROOT). A demo started before the staff origin existed
 * (its API env has no X2F_STAFF_WEB_ROOT) gets the web app only, and says so. The staff build's
 * old assets are not carried: its pages are never cached (`no-store`), so a reload loads the new
 * build whole.
 *
 * With DEMO_PORT_OFFSET, the offset demo's folders and ports (config.ts).
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_FILE, PORTS, HOST, SECRETS_DIR, STAFF_WEB_DIST, WEB_DIST } from './config.js';
import { assertDemoFlag } from './guard.js';
import { readPids, restartTs } from './procs.js';
import { buildStaffWeb, buildWeb, carriedAssets, redeployFolders, type Swap } from './web-build.js';

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

  const swaps = redeployFolders(apiEnv, WEB_DIST, STAFF_WEB_DIST);
  const [web, staff] = swaps as [Swap, Swap | undefined];
  step('building apps/web');
  buildWeb(web.next, secrets);
  const oldAssets = join(WEB_DIST, 'assets');
  const newAssets = join(web.next, 'assets');
  const carried = existsSync(oldAssets) ? carriedAssets(readdirSync(oldAssets), readdirSync(newAssets)) : [];
  for (const n of carried) cpSync(join(oldAssets, n), join(newAssets, n));
  step(`built; ${carried.length} earlier asset(s) kept for open tabs`);
  if (staff) {
    step('building apps/staff-web');
    buildStaffWeb(staff.next, secrets);
    step('built the staff app');
  } else {
    console.log('demo:web: this demo was started without the staff origin (no X2F_STAFF_WEB_ROOT): the staff app is not redeployed; restart the demo to get it');
  }

  const swapIn = (w: Swap): void => {
    rmSync(w.prev, { recursive: true, force: true });
    if (existsSync(w.live)) renameSync(w.live, w.prev);
    renameSync(w.next, w.live);
  };
  const swapBack = (w: Swap): void => {
    rmSync(w.next, { recursive: true, force: true });
    renameSync(w.live, w.next);
    if (existsSync(w.prev)) renameSync(w.prev, w.live);
  };
  for (const w of swaps) swapIn(w);
  step(`swapped ${swaps.length === 2 ? 'both builds' : 'the web build'}; restarting the API only`);
  await restartTs('api', 'apps/api/src/main.ts', apiEnv);
  if (await apiUp(120_000)) {
    step(`live: the API serves the new ${swaps.length === 2 ? 'web and staff builds' : 'build'} (Postgres, chain, sessions and comments untouched)`);
    return;
  }
  console.error('demo:web: the API did not come back on the new build; putting the old one back');
  for (const w of swaps) swapBack(w);
  await restartTs('api', 'apps/api/src/main.ts', apiEnv);
  if (!(await apiUp(120_000))) throw new Error('the API did not come back on the old build either: see .demo/logs/api.log');
  throw new Error(`rolled back to the old build (the failed one is in ${web.next}; see .demo/logs/api.log)`);
}

main().then(() => process.exit(0), (e: unknown) => {
  console.error(`demo:web: failed: ${(e as Error).message}`);
  process.exit(1);
});
