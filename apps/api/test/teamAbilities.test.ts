import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  ABILITY_GROUPS,
  ABILITY_IDS,
  ALWAYS_ON,
  effectiveAbilities,
  GRANTABLE,
  HARD_OWNER_ONLY,
  hasAbility,
  legacyRoles,
  parseAbilities,
  PRESETS,
  presetOf,
  parseRoles,
  rolesToAbilities,
  TEAM_ROLES,
} from '../src/team/abilities.js';

// Job 1c (J-10; S-087, S-092, S-094, S-097, T-076, D-066): the granular team-member abilities.
// The owner ticks the list in owner-checklists-draft-2026-11-09.md section B; these tests pin the
// owner's hard rules, which no box and no preset may ever grant.

const byNo = (n: number) => ABILITIES.find((a) => a.no === n)!;

describe('the abilities catalogue', () => {
  it('has the 66 abilities of section B, numbered 1..66, in 9 groups, each id unique', () => {
    expect(ABILITIES.map((a) => a.no)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1));
    expect(new Set(ABILITY_IDS).size).toBe(66);
    expect(ABILITY_GROUPS.map((g) => g.id)).toEqual(['offers', 'trades', 'chat', 'proof', 'disputes', 'wallets', 'team', 'security', 'account']);
    for (const a of ABILITIES) {
      expect(ABILITY_GROUPS.map((g) => g.id), a.id).toContain(a.group);
      expect(a.id).toMatch(/^[a-z][a-z-]{1,39}$/);
      expect(['low', 'medium', 'high']).toContain(a.risk);
    }
  });

  it('owner hard rule (p10-2, T-076): no box releases XMR or confirms payment received on the lead\'s sell trades', () => {
    expect(byNo(21).id).toBe('trades-confirm-received');
    expect(byNo(22).id).toBe('trades-release');
    for (const n of [21, 22]) expect(HARD_OWNER_ONLY.has(byNo(n).id)).toBe(true);
  });

  it('owner hard rule: payout wallets, members, account deletion and security settings are owner-only', () => {
    for (const n of [42, 49, 50, 51, 55, 56, 57, 66]) expect(HARD_OWNER_ONLY.has(byNo(n).id), byNo(n).id).toBe(true);
  });

  it('owner hard rule (D-066, p7-7): only trade parties open disputes; the disputes box answers the moderator', () => {
    expect(byNo(36).id).toBe('disputes-open');
    expect(HARD_OWNER_ONLY.has('disputes-open')).toBe(true);
    expect(GRANTABLE.has('disputes-answer')).toBe(true);
  });

  it('owner hard rule (S-094, p7-8): notes on traders can be viewed and added, never deleted, by a box', () => {
    expect(GRANTABLE.has('notes-view')).toBe(true);
    expect(GRANTABLE.has('notes-add')).toBe(true);
    expect(ABILITY_IDS.some((id) => /note/.test(id) && /delete|remove/.test(id))).toBe(false);
  });

  it('a hard owner-only ability is never grantable, never in a preset, and refused by parseAbilities', () => {
    for (const id of HARD_OWNER_ONLY) {
      expect(GRANTABLE.has(id), id).toBe(false);
      for (const p of PRESETS) expect(p.abilities, `${p.id} ${id}`).not.toContain(id);
      expect(() => parseAbilities([id])).toThrow();
      expect(() => parseAbilities(['offers-see', id])).toThrow();
    }
  });

  it('presets Offers, Trades and Manager (and the start set) tick only grantable boxes, from the checklist columns', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['offers', 'trades', 'manager', 'start']);
    for (const p of PRESETS) for (const id of p.abilities) expect(GRANTABLE.has(id), `${p.id} ${id}`).toBe(true);
    const offers = PRESETS.find((p) => p.id === 'offers')!.abilities;
    const trades = PRESETS.find((p) => p.id === 'trades')!.abilities;
    const manager = PRESETS.find((p) => p.id === 'manager')!.abilities;
    expect(offers).toContain('offers-post');
    expect(offers).not.toContain('trades-mark-paid');
    expect(trades).toContain('trades-mark-paid');
    expect(trades).not.toContain('offers-post');
    // Manager is at least both bundles (lead placeholder until the owner ticks it).
    for (const id of [...offers, ...trades]) expect(manager).toContain(id);
  });

  it('parseAbilities: a non-empty set of known grantable ids, returned in catalogue order; anything else is bad-request', () => {
    expect(parseAbilities(['trades-mark-paid', 'offers-see'])).toEqual(['offers-see', 'trades-mark-paid']);
    for (const bad of [[], 'offers-see', ['nope'], ['offers-see', 'offers-see'], [1], ['own-login-methods']]) {
      expect(() => parseAbilities(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ status: 400, code: 'bad-request' }));
    }
  });

  it('the always-on abilities belong to every member, and the account owner has every ability but no box', () => {
    expect([...ALWAYS_ON].sort()).toEqual(['own-login-methods', 'own-recovery-codes', 'own-session-extend']);
    expect(effectiveAbilities(['offers-see'])).toEqual(new Set(['offers-see', ...ALWAYS_ON]));
    expect(hasAbility(['offers-see'], 'offers-see')).toBe(true);
    expect(hasAbility(['offers-see'], 'offers-post')).toBe(false);
    expect(hasAbility(['offers-see'], 'any')).toBe(true);
    expect(hasAbility(['offers-see'], ['offers-post', 'offers-see'])).toBe(true);
    expect(hasAbility(['offers-see'], ['offers-post'])).toBe(false);
    // Even a corrupt stored set never grants a hard owner-only ability.
    expect(hasAbility(['trades-release'], 'trades-release')).toBe(false);
  });

  it('the old two roles map to exactly what each let a member do before (no one widened), inside the Offers and Trades presets, and back', () => {
    const offers = PRESETS.find((p) => p.id === 'offers')!.abilities;
    const trades = PRESETS.find((p) => p.id === 'trades')!.abilities;
    for (const id of rolesToAbilities(['offers'])) expect(offers, id).toContain(id);
    for (const id of rolesToAbilities(['trades'])) expect(trades, id).toContain(id);
    // Opening a dispute left the Trades role (D-066); funding never was a member's (R44).
    expect(rolesToAbilities(['trades'])).not.toContain('disputes-open');
    expect(rolesToAbilities(['trades'])).not.toContain('trades-fund');
    expect(rolesToAbilities(['offers'])).not.toContain('trades-see-active');
    expect(rolesToAbilities(['trades'])).not.toContain('offers-see');
    expect(legacyRoles(rolesToAbilities(['offers']))).toEqual(['offers']);
    expect(legacyRoles(rolesToAbilities(['trades']))).toEqual(['trades']);
    expect(legacyRoles(rolesToAbilities(['offers', 'trades']))).toEqual(['offers', 'trades']);
  });

  it('presetOf names the preset a set matches exactly, else null ("Custom")', () => {
    for (const p of PRESETS) expect(presetOf(p.abilities)).toBe(p.id);
    expect(presetOf(['offers-see'])).toBeNull();
  });
});

// Review 2026-11-09 M1: hold v3's member rights (owner p4-8, migration 016) are the catalogue's rows
// 46-48, and each one includes the ones before it.
describe('the hold boxes (owner p4-8) after the hold v3 merge', () => {
  it('rows 46-48 are grantable boxes; ending a hold is high risk', () => {
    expect([46, 47, 48].map((n) => byNo(n).id)).toEqual(['hold-see', 'hold-cancel', 'hold-end']);
    for (const n of [46, 47, 48]) expect(byNo(n).availability, byNo(n).id).toBe('grantable');
    expect(byNo(48).risk).toBe('high');
    expect(parseAbilities(['hold-end', 'trades-see-active'])).toEqual(['trades-see-active', 'hold-end']);
  });

  it('a stronger hold box includes the weaker ones (hold-end covers hold-cancel covers hold-see), and never the reverse', () => {
    expect(hasAbility(['hold-end'], 'hold-see')).toBe(true);
    expect(hasAbility(['hold-end'], 'hold-cancel')).toBe(true);
    expect(hasAbility(['hold-cancel'], 'hold-see')).toBe(true);
    expect(hasAbility(['hold-cancel'], 'hold-end')).toBe(false);
    expect(hasAbility(['hold-see'], 'hold-cancel')).toBe(false);
    expect(hasAbility(['offers-see'], 'hold-see')).toBe(false);
  });

  it('parseRoles accepts the same five roles as hold v3 (and the confirm), in their fixed order; each hold role keeps what it included', () => {
    expect(TEAM_ROLES).toEqual(['offers', 'trades', 'hold-see', 'hold-cancel', 'hold-end']);
    expect(parseRoles(['hold-cancel', 'trades', 'hold-see'])).toEqual(['trades', 'hold-see', 'hold-cancel']);
    expect(rolesToAbilities(['hold-see'])).toEqual(['hold-see']);
    expect(rolesToAbilities(['hold-cancel'])).toEqual(['hold-see', 'hold-cancel']);
    expect(rolesToAbilities(['hold-end'])).toEqual(['hold-see', 'hold-cancel', 'hold-end']);
    expect(legacyRoles(rolesToAbilities(['trades', 'hold-end']))).toEqual(['trades', 'hold-see', 'hold-cancel', 'hold-end']);
    expect(legacyRoles(['hold-end'])).toEqual(['hold-see', 'hold-cancel', 'hold-end']);
  });
});
