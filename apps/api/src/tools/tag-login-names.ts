// `npm run tag-login-names -w @x2f/api` (FU-D): once, after migration 012, with the API stopped. Stores
// every plaintext login name as its X2F_LOGIN_NAME_KEYS tag and nulls login_name / login_key.
// Needs the API's full settings. Prints counts only, never a name. Then run
// `ANALYZE accounts, name_keys; VACUUM FULL accounts, name_keys, pg_statistic; CHECKPOINT;` as a database superuser before starting
// the API (FU-D review I2 and round-2 N1: dead tuples, index pages, pg_statistic; docs/dev-setup.md).
import { tagLoginNames } from '../accounts.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await tagLoginNames({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
