import { BAN_REASON_CODES, type BanReasonCode } from './intent.js';

/**
 * D-017 (owner Q15, 6 Nov 2026): "we will have pre-written rules for bans and what kind of
 * punishment comes with that type of ban ... the first time the ban is at the moderator's
 * discretion for how long it is, and the third time it's a lifetime ban. But some things can be a
 * lifetime ban from the very beginning, like scamming. So we need to really write out a rule list
 * when we get to that point."
 *
 * The list below is a LEAD DRAFT that the owner still has to write (register D-017: "write the ban
 * rule list with owner later"). Only `scamming` and its lifetime-from-the-start are the owner's;
 * the other entries mirror the four general reasons a ban shows the trader (`BAN_REASON_CODES`,
 * Revision 2026-10-29b, lead default). Labels are staff-facing and `COPY-UNSIGNED`; the trader only
 * ever sees the rule's general reason, never the rule or the staff note.
 *
 * Lead readings, owner may change (each is only in this file):
 * - every earlier ban of the account counts as an offence, whatever its rule;
 * - a lifetime ban before the third offence is only for a rule marked `lifetimeFromFirst`;
 * - for now no rule fixes a length: the moderator picks it (the owner's "for now").
 */
export interface BanRule {
  /** Stable id, stored with a ban. */
  id: string;
  /** The general reason the trader sees (`BAN_REASON_CODES`). */
  reasonCode: BanReasonCode;
  /** Staff-facing label. COPY-UNSIGNED */
  label: string;
  /** May be a lifetime ban from the first offence (owner: "like scamming"). */
  lifetimeFromFirst: boolean;
}

export const BAN_RULES: readonly BanRule[] = [
  // Owner Q15: scamming can be a lifetime ban from the very beginning.
  { id: 'scamming', reasonCode: 'trade-problems', label: 'Scamming another trader', lifetimeFromFirst: true }, // COPY-UNSIGNED
  { id: 'terms', reasonCode: 'terms', label: 'Breaking the Terms of Service', lifetimeFromFirst: false }, // COPY-UNSIGNED
  { id: 'trade-problems', reasonCode: 'trade-problems', label: 'Problems in trades', lifetimeFromFirst: false }, // COPY-UNSIGNED
  { id: 'abuse', reasonCode: 'abuse', label: 'Abuse of other traders', lifetimeFromFirst: false }, // COPY-UNSIGNED
  { id: 'account-security', reasonCode: 'account-security', label: 'Account security', lifetimeFromFirst: false }, // COPY-UNSIGNED
];

/** Owner Q15: "the third time it's a lifetime ban". */
export const LIFETIME_AT_OFFENCE = 3;

/**
 * What a moderator may set for this offence: `length` (an end time they pick), `length-or-lifetime`
 * (either), `lifetime` (no choice: the third offence or later).
 */
export type BanTermChoice = 'length' | 'length-or-lifetime' | 'lifetime';

export type BanTermError = 'unknown-rule' | 'lifetime-required' | 'lifetime-not-allowed' | 'bad-until';

export function banRule(id: string): BanRule | null {
  return BAN_RULES.find((r) => r.id === id) ?? null;
}

/** `priorOffences`: the account's earlier bans (a whole number from 0). Unknown rule → TypeError. */
export function banTermFor(ruleId: string, priorOffences: number): BanTermChoice {
  if (!Number.isInteger(priorOffences) || priorOffences < 0) throw new RangeError('banTermFor: priorOffences');
  const rule = banRule(ruleId);
  if (rule === null) throw new TypeError('banTermFor: unknown rule');
  if (priorOffences + 1 >= LIFETIME_AT_OFFENCE) return 'lifetime';
  return rule.lifetimeFromFirst ? 'length-or-lifetime' : 'length';
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Checks a ban's term against the rule list: `until` null is a lifetime ban, else an exact ISO
 * instant (milliseconds, `Z`) after `now`, as the ruling's account action carries it.
 */
export function checkBanTerm(
  b: { ruleId: string; priorOffences: number; until: string | null },
  now: Date,
): { ok: true } | { ok: false; error: BanTermError } {
  if (banRule(b.ruleId) === null) return { ok: false, error: 'unknown-rule' };
  const choice = banTermFor(b.ruleId, b.priorOffences);
  if (b.until === null) return choice === 'length' ? { ok: false, error: 'lifetime-not-allowed' } : { ok: true };
  if (!ISO_MS.test(b.until)) return { ok: false, error: 'bad-until' };
  const t = Date.parse(b.until);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== b.until || t <= now.getTime()) return { ok: false, error: 'bad-until' };
  return choice === 'lifetime' ? { ok: false, error: 'lifetime-required' } : { ok: true };
}

// Every rule's reason must be one the trader can be shown.
for (const r of BAN_RULES) if (!(BAN_REASON_CODES as readonly string[]).includes(r.reasonCode)) throw new Error(`ban rule ${r.id}: reason`);
