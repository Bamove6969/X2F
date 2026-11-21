import { join } from 'node:path';
import { ROOT, startStack } from './stack.js';

/**
 * Plan 3 Task 31: starts the regtest stack once for the run and hands its addresses to the
 * workers in X2F_E2E_STACK; the returned function (Playwright's teardown) stops it.
 */
export default async function setup(): Promise<() => Promise<void>> {
  // A stack already running (started by hand with the same startStack) is reused as it is.
  if (process.env.X2F_E2E_STACK) return async () => undefined;
  const logDir = process.env.X2F_E2E_LOG_DIR ?? join(ROOT, '.regtest', 'e2e-logs');
  const stack = await startStack({ logDir });
  const { stop, ...info } = stack;
  process.env.X2F_E2E_STACK = JSON.stringify(info);
  return stop;
}
