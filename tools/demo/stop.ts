/** DEMO ONLY: `npm run demo:stop`. Stops every demo process and removes the demo Postgres container. */
import { stopAll } from './procs.js';

await stopAll((s) => console.log(`demo: ${s}`));
console.log('demo: stopped');
