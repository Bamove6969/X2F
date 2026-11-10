// `npm run seal-tickets -w @x2f/api` (J-14 review J6): once, after migration 451, with the API
// stopped. Seals every ticket message still stored in plaintext under the current X2F_TICKET_KEYS
// key and nulls the plaintext in the same update (tickets/seal.ts). Needs the API's full settings.
// Prints counts only, never text. Then, as a database superuser, run
// `VACUUM FULL ticket_messages; CHECKPOINT;` before starting the API (docs/dev-setup.md).
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { sealPlaintextTickets } from '../tickets/seal.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await sealPlaintextTickets({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
