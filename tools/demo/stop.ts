/** DEMO ONLY: `npm run demo:stop`. Stops every demo process, removes the demo Postgres container and deletes .demo/secrets. */
import { rmSync } from 'node:fs';
import { SECRETS_DIR } from './config.js';
import { stopAll } from './procs.js';

await stopAll((s) => console.log(`demo: ${s}`));
// The throwaway secrets die with the demo; the logs stay in .demo/logs.
rmSync(SECRETS_DIR, { recursive: true, force: true });
console.log('demo: stopped');
