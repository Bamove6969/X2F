import { normalizeTradeCode } from '@x2f/core';
import type { StaffRole } from './roles.js';

/** The fields of an activity-log entry that decide involvement (Task 3's `activity_log`). */
export interface InvolvementEntry {
  /** The log id (a bigint as a decimal string): ids are the chain order; `at` is not monotonic. */
  id: string;
  tradeCode: string | null;
  actorKind: 'staff' | 'trader' | 'system';
  actorId: string | null;
  action: string;
}

const LOG_ID = /^[0-9]{1,20}$/;
const logId = (id: string): bigint => {
  if (typeof id !== 'string' || !LOG_ID.test(id)) throw new RangeError('involvedIn: invalid log id');
  return BigInt(id);
};

/**
 * The staff involved in round 1 of a dispute (R37, owner 2026-10-29: "decided, assisted, or
 * commented"; lead default: any activity-log entry by them on that trade counts). Only entries
 * before `beforeId` count: the id of the appeal's own `appeal.opened` entry, so a reviewer's own
 * round-2 entries never make them ineligible (I3). Every seq of the trade counts (conservative).
 * The code is normalised, so it may be given with or without dashes; an invalid code matches
 * nothing; an invalid id throws RangeError. The API builds the appeal event's `involved` from this.
 */
export function involvedIn(log: Iterable<InvolvementEntry>, code: string, opts: { beforeId: string }): Set<string> {
  const before = logId(opts.beforeId);
  const want = normalizeTradeCode(code);
  const out = new Set<string>();
  if (want === null) return out;
  for (const e of log) {
    if (e.actorKind !== 'staff' || e.actorId === null || e.tradeCode === null) continue;
    if (logId(e.id) >= before) continue;
    if (normalizeTradeCode(e.tradeCode) === want) out.add(e.actorId);
  }
  return out;
}

/**
 * Who may decide an appeal (Task 24, replacing A4): senior moderators and the owner who are not
 * involved, in the order given. There is no fallback: when nobody is eligible the list is empty,
 * the appeal waits and the owner is alerted. A staff member with `active: false` (switched off)
 * is left out.
 */
export function appealReviewers(
  staff: Iterable<{ id: string; role: StaffRole; active?: boolean }>,
  involved: Iterable<string>,
): string[] {
  const out = new Set(involved);
  const ids: string[] = [];
  for (const s of staff) {
    if (s.active === false) continue;
    if (s.role !== 'senior' && s.role !== 'owner') continue;
    if (!out.has(s.id)) ids.push(s.id);
  }
  return ids;
}
