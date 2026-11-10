// `npm run rewrap-jabber -w @x2f/api` (review M4): reseals every Jabber address, queued notice and
// X2F's OMEMO identity key and bundle under the current X2F_JABBER_KEYS key (jabber/rewrap.ts). Run it after
// putting a new key first, and again before removing the old one. Prints counts only.
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { rewrapJabberSecrets } from '../jabber/rewrap.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await rewrapJabberSecrets({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
