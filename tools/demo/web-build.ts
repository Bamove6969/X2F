/**
 * DEMO ONLY: the demo's web build (apps/web with Vite), shared by `npm run demo` and the web-only
 * redeploy (web-redeploy.ts), so both build the same thing: regtest, the demo's moderation key and
 * fee wallet, and the self-origin placeholders the gateway fills per request (self-origin.ts).
 *
 * And the staff build (apps/staff-web), the production build exactly as the regtest e2e stack makes
 * it (tools/regtest/e2e/staffStack.ts): only the moderation signing key is pinned
 * (VITE_MOD_SIGNING_PUBLIC, vite.config's checkBuildEnv). It carries no placeholder and nothing is
 * filled or injected into it: the staff API serves it as built, under STAFF_CSP.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { SELF_HTTP, SELF_WS } from './self-origin.js';

export function buildWeb(outDir: string, s: { modSigningPublic: string; feeWallet: string }): void {
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: join(ROOT, 'apps/web'),
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      VITE_MONERO_NETWORK: 'regtest',
      VITE_MOD_SIGNING_PUBLIC: s.modSigningPublic,
      VITE_FEE_WALLET: s.feeWallet,
      VITE_RELAY_URL: `${SELF_WS}/relay`,
      VITE_NODE_PROXY_URL: SELF_HTTP,
    },
  });
}

/** Assets a page built earlier may still ask for: every old hashed file but the escrow worker. */
export function carriedAssets(oldNames: string[], newNames: string[]): string[] {
  const have = new Set(newNames);
  return oldNames.filter((n) => !have.has(n) && !/^escrow-worker-/.test(n));
}

/** The staff build's command (a pure value, so the tests can check it without building). */
export function staffBuildCommand(outDir: string, s: { modSigningPublic: string }, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  if (!/^[0-9a-f]{64}$/.test(s.modSigningPublic)) throw new Error('demo: the moderation signing public key must be 64 lower-case hex');
  return {
    cmd: 'npx',
    args: ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'],
    cwd: join(ROOT, 'apps/staff-web'),
    env: { ...env, VITE_MOD_SIGNING_PUBLIC: s.modSigningPublic },
  };
}

export function buildStaffWeb(outDir: string, s: { modSigningPublic: string }): void {
  const c = staffBuildCommand(outDir, s);
  execFileSync(c.cmd, c.args, { cwd: c.cwd, stdio: ['ignore', 'ignore', 'inherit'], env: c.env });
}

/** One build folder of a redeploy: built into `next`, swapped to `live`, the old one kept as `prev`. */
export interface Swap {
  live: string;
  next: string;
  prev: string;
}

/**
 * The folders `npm run demo:web` builds and swaps, from the running API's environment: always the
 * web build; the staff build too when the API serves one (X2F_STAFF_WEB_ROOT), and only the one it
 * serves (a running API serving another folder is refused, as for the web build).
 */
export function redeployFolders(apiEnv: Record<string, string | undefined>, webDist: string, staffDist: string): Swap[] {
  const swap = (live: string): Swap => ({ live, next: `${live}.next`, prev: `${live}.prev` });
  if (apiEnv.X2F_WEB_ROOT !== webDist) throw new Error(`the running API serves ${apiEnv.X2F_WEB_ROOT}, not ${webDist}`);
  const staffRoot = apiEnv.X2F_STAFF_WEB_ROOT;
  if (staffRoot === undefined || staffRoot === '') return [swap(webDist)];
  if (staffRoot !== staffDist) throw new Error(`the running API serves the staff app from ${staffRoot}, not ${staffDist}`);
  return [swap(webDist), swap(staffDist)];
}
