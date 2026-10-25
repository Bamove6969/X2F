// `npm run rewrap-totp -w @x2f/api` (FU-C): reseals every TOTP secret under the current X2F_TOTP_KEYS key.
// Needs the API's full settings (it opens format-0 secrets with X2F_SERVER_KEY). Prints counts only.
import { rewrapTotpSecrets } from '../auth/totp.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl, 1);
try {
  const result = await rewrapTotpSecrets({ db, config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
