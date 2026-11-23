/**
 * DEMO ONLY: the demo's web build (apps/web with Vite), shared by `npm run demo` and the web-only
 * redeploy (web-redeploy.ts), so both build the same thing: regtest, the demo's moderation key and
 * fee wallet, and the self-origin placeholders the gateway fills per request (self-origin.ts).
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
