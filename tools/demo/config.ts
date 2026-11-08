/** DEMO ONLY: fixed ports and paths of the local demo stack (docs/demo.md). Everything binds to 127.0.0.1. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Gitignored: secrets, logs, pids, chain and state of the running demo. */
export const DEMO_DIR = join(ROOT, '.demo');
export const SECRETS_DIR = join(DEMO_DIR, 'secrets');
export const LOG_DIR = join(DEMO_DIR, 'logs');
export const STATE_DIR = join(DEMO_DIR, 'state');
export const PIDS_FILE = join(DEMO_DIR, 'pids.json');
export const ENV_FILE = join(SECRETS_DIR, 'env.json');
export const WEB_DIST = join(ROOT, 'apps/web/dist-demo');

export const HOST = '127.0.0.1';
export const PORTS = {
  gateway: 4400,
  gatewayTls: 4443,
  api: 18080,
  apiInternal: 18081,
  staff: 18082,
  relay: 18787,
  relayAdmin: 18788,
  nodeProxy: 18789,
  postgres: 54329,
  monerodRpc: 18481,
  monerodRestricted: 18482,
  monerodP2p: 18480,
} as const;

export const PG_CONTAINER = 'x2f-demo-postgres';
export const PG_IMAGE = 'postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';

export const MONEROD_RPC = `http://${HOST}:${PORTS.monerodRpc}`;
export const MONEROD_RESTRICTED = `http://${HOST}:${PORTS.monerodRestricted}`;

/** Every demo account's password (fake money, local only). */
export const DEMO_PASSWORD = 'Demo-Monero-2026!';
