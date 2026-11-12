// D-017 (owner Q15, 6 Nov 2026): the ban rule list. Each offence on the pre-written list says what
// kind of ban it brings; for now the moderator picks the length; some offences (scamming) can be a
// lifetime ban from the very first time; the third offence is always a lifetime ban.
import { describe, expect, it } from 'vitest';
import { BAN_REASON_CODES, BAN_RULES, LIFETIME_AT_OFFENCE, banRule, banTermFor, checkBanTerm } from '../src/index.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const LATER = '2026-12-12T12:00:00.000Z';

describe('the ban rule list (D-017)', () => {
  it('every rule has a unique id, a general reason code the trader sees, and a staff label', () => {
    const ids = BAN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of BAN_RULES) {
      expect(BAN_REASON_CODES).toContain(r.reasonCode);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('scamming is on the list and can be a lifetime ban from the first offence', () => {
    expect(banRule('scamming')).toMatchObject({ lifetimeFromFirst: true });
    expect(banTermFor('scamming', 0)).toBe('length-or-lifetime');
  });

  it('an unknown rule id is refused', () => {
    expect(banRule('nope')).toBeNull();
    expect(checkBanTerm({ ruleId: 'nope', priorOffences: 0, until: LATER }, NOW)).toEqual({ ok: false, error: 'unknown-rule' });
  });

  it('the third offence is a lifetime ban whatever the rule', () => {
    expect(LIFETIME_AT_OFFENCE).toBe(3);
    for (const r of BAN_RULES) {
      expect(banTermFor(r.id, 2)).toBe('lifetime');
      expect(banTermFor(r.id, 5)).toBe('lifetime');
      expect(checkBanTerm({ ruleId: r.id, priorOffences: 2, until: LATER }, NOW)).toEqual({ ok: false, error: 'lifetime-required' });
      expect(checkBanTerm({ ruleId: r.id, priorOffences: 2, until: null }, NOW)).toEqual({ ok: true });
    }
  });

  it('first and second offences: the moderator picks the length; lifetime only where the rule allows it', () => {
    const plain = BAN_RULES.find((r) => !r.lifetimeFromFirst)!;
    expect(banTermFor(plain.id, 0)).toBe('length');
    expect(banTermFor(plain.id, 1)).toBe('length');
    expect(checkBanTerm({ ruleId: plain.id, priorOffences: 0, until: LATER }, NOW)).toEqual({ ok: true });
    expect(checkBanTerm({ ruleId: plain.id, priorOffences: 1, until: '2027-06-01T00:00:00.000Z' }, NOW)).toEqual({ ok: true });
    expect(checkBanTerm({ ruleId: plain.id, priorOffences: 0, until: null }, NOW)).toEqual({ ok: false, error: 'lifetime-not-allowed' });
    expect(checkBanTerm({ ruleId: 'scamming', priorOffences: 0, until: null }, NOW)).toEqual({ ok: true });
    expect(checkBanTerm({ ruleId: 'scamming', priorOffences: 1, until: LATER }, NOW)).toEqual({ ok: true });
  });

  it('a set length must end after now, as an exact ISO instant', () => {
    const plain = BAN_RULES.find((r) => !r.lifetimeFromFirst)!;
    for (const until of [NOW.toISOString(), '2026-11-01T00:00:00.000Z', '2026-12-12', 'soon', '2026-12-12T12:00:00Z']) {
      expect(checkBanTerm({ ruleId: plain.id, priorOffences: 0, until }, NOW)).toEqual({ ok: false, error: 'bad-until' });
    }
  });

  it('a negative or fractional offence count is refused', () => {
    expect(() => banTermFor('scamming', -1)).toThrow(RangeError);
    expect(() => banTermFor('scamming', 1.5)).toThrow(RangeError);
  });
});
