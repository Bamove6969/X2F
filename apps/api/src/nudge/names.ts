import { checkDisplayName } from '@x2f/accounts';
import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';

/**
 * The PUBLIC name column and its lower-cased key: the display name shown on offers and in chats,
 * NEVER the private login name (`login_name` / `login_key`). The column is events/publicName.ts's
 * PUBLIC_NAME_COLUMN, so a nudge's `from` and every other live event name come from one place
 * (test/nudge.test.ts and test/events.test.ts pin both).
 */
export const PUBLIC_NAME = PUBLIC_NAME_COLUMN;
export const PUBLIC_NAME_KEY = 'display_key';

/**
 * The stored key of a display name taken as is (no shape or reserved-word check): NFC, then lower
 * case, exactly as `checkDisplayName` makes it (signup round 3: the database's lower() is not used,
 * migration 610).
 */
export const displayKeyOf = (raw: string): string => raw.normalize('NFC').toLowerCase();

/** An account found by its public name, case-insensitively; null for a name that is malformed or unknown. */
export async function findByPublicName(
  db: Queryable,
  raw: string,
): Promise<{ id: string; name: string; disabled: boolean } | null> {
  const check = checkDisplayName(raw);
  // A malformed or reserved name can belong to nobody (sign-up refuses them).
  if (!check.ok) return null;
  const { rows } = await db.query<{ id: string; name: string; disabled: boolean }>(
    `select id, ${PUBLIC_NAME} as name, disabled_at is not null as disabled from accounts where ${PUBLIC_NAME_KEY} = $1`,
    [check.key],
  );
  return rows[0] ?? null;
}

/** The account's public name (for the recipient's in-app "Wake up, <name> wants to trade"). */
export async function publicNameOf(db: Queryable, accountId: string): Promise<string> {
  const { rows } = await db.query<{ name: string }>(`select ${PUBLIC_NAME} as name from accounts where id = $1`, [accountId]);
  return rows[0]!.name;
}
