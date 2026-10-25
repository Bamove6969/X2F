import { checkUsername } from '@x2f/accounts';
import type { Queryable } from '../db/pool.js';

/**
 * The PUBLIC name column and its lower-cased key: the name shown on offers and in chats, never
 * the private login name. wip/lead-p2-fua renames these to `display_name` / `display_key`; that
 * rename is this one line (test/nudge.test.ts has a tripwire for it).
 */
export const [PUBLIC_NAME, PUBLIC_NAME_KEY] = ['username', 'username_key'] as const;

/** An account found by its public name, case-insensitively; null for a name that is malformed or unknown. */
export async function findByPublicName(
  db: Queryable,
  raw: string,
): Promise<{ id: string; name: string; disabled: boolean } | null> {
  const check = checkUsername(raw);
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
