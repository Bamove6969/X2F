// `npm run rewrap-tickets -w @x2f/api` (J-14 review J6, ported): reseals every support-ticket message
// under the current X2F_TICKET_KEYS key (tickets/store.ts). Run it after migration 861, after putting
// a new key first, and again before removing the old one: only a re-run reporting
// {"rewrapped":0,"failed":0} leaves nothing under the old key (or under X2F_SERVER_KEY's
// subkey('ticket-body'), format 0). Needs the API's full settings. Prints counts only, never text.
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { rewrapTicketSecrets } from '../tickets/store.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await rewrapTicketSecrets({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
