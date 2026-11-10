// `npm run rewrap-tickets -w @x2f/api` (J-14 review J6): reseals every ticket message under the
// current X2F_TICKET_KEYS key (tickets/seal.ts). Run it after putting a new key first, and again
// before removing the old one: only a re-run reporting {"rewrapped":0,"failed":0} leaves nothing
// under the old key. Prints counts only, never text.
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { rewrapTicketSecrets } from '../tickets/seal.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await rewrapTicketSecrets({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
