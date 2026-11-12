/**
 * DEMO ONLY: lets the seeded demo accounts in from a fresh browser with password + authenticator.
 *
 * Hold model v3 (apps/api auth/approval.ts `traderLogin`): with no device logged in to approve it, a
 * login on a browser the account does not know gets in only with a passkey, security key or PGP key;
 * a password with its authenticator code is refused (403 `approval-unavailable`). The seeded accounts
 * have only a password and an authenticator, and nobody holds a session of theirs, so without this no
 * demo login would ever work.
 *
 * So when a seeded account's password step passes (`POST /v1/login/password` answers
 * `second-factor` with a `pendingId`), the gateway calls `knowThisBrowser` before the browser sees
 * the answer: the pending challenge names the account and this browser's device hash, and that
 * browser is recorded as known for the account (`trusted_devices`, as a finished login would do),
 * but only while the account has no logged-in full session. The code is then checked by the API as
 * usual. With a session open somewhere, nothing is written, so a second device still waits for
 * approval with number matching, as in production. Accounts made in the demo by hand get none of
 * this: only the ids the seeder listed (`SEEDED_FILE`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { SECRETS_DIR } from './config.js';
import { UUID } from './door-parse.js';

/** The seeded accounts' ids, written by seed.ts. */
export const SEEDED_FILE = join(SECRETS_DIR, 'seeded-accounts.json');

function seededIds(): string[] {
  if (!existsSync(SEEDED_FILE)) return [];
  try {
    const ids = JSON.parse(readFileSync(SEEDED_FILE, 'utf8')) as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
  } catch {
    return [];
  }
}

export function createDoor(databaseUrl: string): (pendingId: string) => Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  return async (pendingId) => {
    const ids = seededIds();
    if (ids.length === 0) return;
    await pool.query(
      `insert into trusted_devices (account_id, device_hash, created_at, last_used_at)
       select c.account_id, c.device_hash, now(), now() from challenges c
        where c.id = $1 and c.purpose = 'second-factor' and c.used_at is null and c.expires_at > now()
          and c.device_hash is not null and c.account_id = any($2::uuid[])
          and not exists (select 1 from sessions s where s.account_id = c.account_id and s.level = 'full'
                            and s.revoked_at is null and s.expires_at > now() and s.member_id is null)
       on conflict (account_id, device_hash) do update set last_used_at = excluded.last_used_at`,
      [pendingId, ids],
    );
  };
}
