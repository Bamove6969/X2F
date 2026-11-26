// Spec 6.6 "Settings": the link and starter-limit rules the API and the owner's Settings page share.
import { describe, expect, it } from 'vitest';
import { STARTER_DEFAULTS, STARTER_FIELDS, communityLink, moderatorContactLink, starterLimitsProblem, tapChallenge } from '@x2f/staff';

describe('moderatorContactLink (D-067)', () => {
  it('takes a matrix.to identifier or a t.me name, normalised', () => {
    expect(moderatorContactLink('https://matrix.to/#/@mods:x2f.example')).toBe('https://matrix.to/#/@mods:x2f.example');
    expect(moderatorContactLink('https://matrix.to/#/#help:x2f.example')).toBe('https://matrix.to/#/#help:x2f.example');
    expect(moderatorContactLink('https://t.me/x2f_mods')).toBe('https://t.me/x2f_mods');
  });
  it('refuses anything else', () => {
    for (const v of [
      'http://t.me/x2f_mods', 'https://t.me/x2f?start=1', 'https://t.me/x2f#a', 'https://evil.example/#/@a:b', 'https://matrix.to/#/mods',
      'https://user@t.me/x', 'https://t.me:8443/x', 'https://t.me/a b', `https://t.me/${'a'.repeat(200)}`, '',
    ]) expect(moderatorContactLink(v), v).toBeNull();
  });
});

describe('communityLink (Task 29)', () => {
  it('any https link without spaces, at most 198 characters', () => {
    expect(communityLink('https://matrix.to/#/#x2f:matrix.org')).toBe('https://matrix.to/#/#x2f:matrix.org');
    expect(communityLink('https://t.me/x2f')).toBe('https://t.me/x2f');
    expect(communityLink('http://t.me/x2f')).toBeNull();
    expect(communityLink('https://t.me/x 2f')).toBeNull();
    expect(communityLink(`https://t.me/${'a'.repeat(190)}`)).toBeNull();
  });
});

describe('starterLimitsProblem (spec 2.3)', () => {
  it('the defaults are fine', () => {
    expect(STARTER_DEFAULTS).toEqual({ starterCapUsd: 200, buildingCapUsd: 1000, buildingMinTrades: 5, buildingMinDays: 7, graduatedMinTrades: 20, graduatedMinDays: 30, starterMaxOpenTrades: 3 });
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS })).toBeNull();
  });
  it('names the first number out of bounds, or a stage out of order', () => {
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, starterCapUsd: 0 })).toEqual({ field: 'starterCapUsd', why: 'bounds' });
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, starterMaxOpenTrades: 1.5 })).toEqual({ field: 'starterMaxOpenTrades', why: 'bounds' });
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, buildingCapUsd: 199 })).toEqual({ field: 'buildingCapUsd', why: 'order' });
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, graduatedMinTrades: 4 })).toEqual({ field: 'graduatedMinTrades', why: 'order' });
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, graduatedMinDays: 6 })).toEqual({ field: 'graduatedMinDays', why: 'order' });
    // Equal stages are allowed.
    expect(starterLimitsProblem({ ...STARTER_DEFAULTS, buildingCapUsd: 200, graduatedMinTrades: 5, graduatedMinDays: 7 })).toBeNull();
  });
  it('lists every field once', () => {
    expect([...STARTER_FIELDS].sort()).toEqual(Object.keys(STARTER_DEFAULTS).sort());
  });
  it('a starter-limits tap has a challenge (a known kind, no issuedAt)', () => {
    expect(tapChallenge({ kind: 'starter-limits', ...STARTER_DEFAULTS }, new Uint8Array(16))).toHaveLength(32);
  });
});
