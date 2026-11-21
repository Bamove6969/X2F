/**
 * Plan 3 Task 31: starts the regtest stack by hand and keeps it up until SIGTERM, for working on
 * the end-to-end specs without a new stack per run. Usage (under the test lock, it is regtest):
 *   node --import tsx apps/web/e2e/stack-up.ts <log dir> <stack.json>
 *   X2F_E2E_STACK="$(cat <stack.json>)" npx playwright test -c apps/web/e2e/playwright.regtest.config.ts
 */
import { writeFileSync } from 'node:fs';
import { startStack } from './stack.js';

const [logDir, out] = process.argv.slice(2);
if (!logDir || !out) throw new Error('usage: stack-up.ts <log dir> <stack.json>');
const { stop, ...info } = await startStack({ logDir });
writeFileSync(out, JSON.stringify(info, null, 2));
console.log(`stack up: ${info.origin}`);
process.on('SIGTERM', () => void stop().then(() => process.exit(0)));
setInterval(() => undefined, 1 << 30);
