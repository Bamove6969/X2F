import type { Queryable } from '../db/pool.js';

/**
 * Review N11 (e), design section 7: a revoked device's copies of chat keys (its `chat_members` staff
 * rows, `member_ref` = `accountId/deviceKeyId`) are marked removed, one device's or (null) every
 * device of the person's: with a revoke-device tap, a switch-off, a removal and a security reset, as
 * the gate revokes the devices. A later read files a new row. The wraps stay (the API cannot open
 * them, and the chat's shred deletes them).
 */
export async function retireStaffCopies(q: Queryable, accountId: string, deviceKeyId: string | null, now: Date): Promise<void> {
  if (deviceKeyId === null) {
    await q.query("update chat_members set removed_at = $2 where member_kind = 'staff' and split_part(member_ref, '/', 1) = $1 and removed_at is null", [accountId, now]);
  } else {
    await q.query("update chat_members set removed_at = $3 where member_kind = 'staff' and member_ref = $1 || '/' || $2 and removed_at is null", [accountId, deviceKeyId, now]);
  }
}
