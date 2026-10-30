import { normalizeTradeCode } from '@x2f/core';
import type { StaffRole } from './roles.js';

/** The fields of an activity-log entry that decide involvement (Task 3's `activity_log`). */
export interface InvolvementEntry {
  tradeCode: string | null;
  actorKind: 'staff' | 'trader' | 'system';
  actorId: string | null;
  action: string;
}

/**
 * The staff involved in a dispute (R37, owner 2026-10-29: "decided, assisted, or commented"; lead
 * default: any activity-log entry by them on that trade counts). The code is normalised, so it may
 * be given with or without dashes; an invalid code matches nothing.
 */
export function involvedIn(log: Iterable<InvolvementEntry>, code: string): Set<string> {
  const want = normalizeTradeCode(code);
  const out = new Set<string>();
  if (want === null) return out;
  for (const e of log) {
    if (e.actorKind !== 'staff' || e.actorId === null || e.tradeCode === null) continue;
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
