// `npm run tag-login-names -w @x2f/api` (FU-D): once, after migration 012, with the API stopped. Stores
// every plaintext login name as its X2F_LOGIN_NAME_KEYS tag and nulls login_name / login_key.
// Needs the API's full settings. Prints counts only, never a name. Then run
// `VACUUM FULL accounts, name_keys;` before starting the API (FU-D review I2; docs/dev-setup.md).
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
