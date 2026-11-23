/** DEMO ONLY: fixed ports and paths of the local demo stack (docs/demo.md). Everything binds to 127.0.0.1. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/**
 * DEMO_PORT_OFFSET (demo r6): added to every port below, so a second demo (another worktree) can
 * be built and checked beside a running one, e.g. 10 for 4410/4411 while one serves 4400/4401. It
 * also names its own Postgres container, .demo folder and web build, so starting or stopping one
 * never touches the other's, even from the same worktree.
 * Unset or 0: the usual ports and container.
 */
export function portOffset(env: Record<string, string | undefined>): number {
  const raw = (env.DEMO_PORT_OFFSET ?? '').trim();
  if (raw === '') return 0;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 0 || n > 900 || n % 10 !== 0) {
    throw new Error('demo: DEMO_PORT_OFFSET must be a multiple of 10 from 0 to 900');
  }
  return n;
}
export const PORT_OFFSET = portOffset(process.env);
/** Gitignored: secrets, logs, pids, chain and state of the running demo (.demo-<offset> for an offset demo, so two can run from one worktree). */
export const DEMO_DIR = join(ROOT, PORT_OFFSET === 0 ? '.demo' : `.demo-${PORT_OFFSET}`);
export const SECRETS_DIR = join(DEMO_DIR, 'secrets');
export const LOG_DIR = join(DEMO_DIR, 'logs');
export const STATE_DIR = join(DEMO_DIR, 'state');
export const PIDS_FILE = join(DEMO_DIR, 'pids.json');
export const ENV_FILE = join(SECRETS_DIR, 'env.json');
/** The demo's web build (its own for an offset demo: the running one's API serves the other). */
export const WEB_DIST = join(ROOT, PORT_OFFSET === 0 ? 'apps/web/dist-demo' : `apps/web/dist-demo-${PORT_OFFSET}`);

export const HOST = '127.0.0.1';

const at = (p: number): number => p + PORT_OFFSET;

export const PORTS = {
  gateway: at(4400),
  gatewayTls: at(4443),
  /** The node proxy's own origin (monero-ts drops any path in a daemon URI). */
  gatewayNode: at(4401),
  gatewayNodeTls: at(4444),
  api: at(18080),
  apiInternal: at(18081),
  staff: at(18082),
  relay: at(18787),
  relayAdmin: at(18788),
  nodeProxy: at(18789),
  postgres: at(54329),
  monerodRpc: at(18481),
  monerodRestricted: at(18482),
  monerodP2p: at(18480),
} as const;

export const PG_CONTAINER = PORT_OFFSET === 0 ? 'x2f-demo-postgres' : `x2f-demo-postgres-${PORT_OFFSET}`;
/** The container this demo started (written at start), so demo:stop removes that one whatever the shell's offset. */
export const PG_CONTAINER_FILE = join(DEMO_DIR, 'pg-container');
export const PG_IMAGE = 'postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';

export const MONEROD_RPC = `http://${HOST}:${PORTS.monerodRpc}`;
export const MONEROD_RESTRICTED = `http://${HOST}:${PORTS.monerodRestricted}`;

/** Every demo account's password (fake money, local only). */
export const DEMO_PASSWORD = 'Demo-Monero-2026!';
