import type { Queryable } from '../db/pool.js';
import type { LiveEvent } from './bus.js';

/**
 * The accounts column holding the PUBLIC display name, the only name an event may carry (FU-A,
 * migration 009; events.test.ts pins it). Never point it at the private login name.
 */
export const PUBLIC_NAME_COLUMN = 'display_name';

/** The account's public display name, or null for an unknown account. */
export async function publicName(db: Queryable, accountId: string): Promise<string | null> {
  // The column name is the constant above, never input.
  const { rows } = await db.query<{ name: string }>(`select ${PUBLIC_NAME_COLUMN} as name from accounts where id = $1`, [accountId]);
  return rows[0]?.name ?? null;
}

/**
 * The `accepted` event for the poster: "<display name> accepted your offer". Task 5 calls it
 * after a take commits and publishes it to the poster.
 */
export async function acceptedEvent(db: Queryable, code: string, takerAccountId: string): Promise<LiveEvent> {
  const by = await publicName(db, takerAccountId);
  if (by === null) throw new Error('acceptedEvent: unknown account');
  return { type: 'accepted', code, by };
}
