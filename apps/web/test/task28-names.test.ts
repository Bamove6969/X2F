// Getting started's name checks (spec 6.1, FU-A): setup uses FU-A's rules from @x2f/auth-client
// (the FU-A tripwires that stood here until FU-A landed on 2026-10-28 are retired).
import * as client from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';
import { checkDisplayName, checkLoginName, checkNames } from '../src/screens/setup/names.js';
import { displayNameOf } from '../src/session/useSession.js';

describe('setup takes the name rules from the typed client', () => {
  it('names.ts re-exports the client\'s own functions', () => {
    expect(checkNames).toBe(client.checkNames);
    expect(checkDisplayName).toBe(client.checkDisplayName);
    expect(checkLoginName).toBe(client.checkLoginName);
  });
});

describe("setup's name rules are FU-A's (@x2f/auth-client)", () => {
  it('both names: 5-20 letters, digits, dots, dashes, underscores, kept exactly as typed', () => {
    expect(checkDisplayName('Mira.K_')).toEqual({ ok: true, name: 'Mira.K_', key: 'mira.k_' });
    expect(checkDisplayName('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkDisplayName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkDisplayName('a'.repeat(20)).ok).toBe(true);
    expect(checkDisplayName('Mira K')).toEqual({ ok: false, reason: 'characters' });
    expect(checkDisplayName('miraék')).toEqual({ ok: false, reason: 'characters' });
    expect(checkLoginName('x'.repeat(65))).toEqual({ ok: false, reason: 'length' });
  });

  it('reserved words and their look-alikes are refused for the display name only', () => {
    expect(checkDisplayName('x2f-team')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkDisplayName('adm1n.k')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkDisplayName('the.m0derator')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkDisplayName('rnod-desk')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkLoginName('admin-login').ok).toBe(true);
  });

  it('the two names must differ, ignoring case; the display name is checked first', () => {
    expect(checkNames('Lumen.K', 'lumen.k')).toEqual({ ok: false, field: 'loginName', reason: 'same' });
    expect(checkNames('abc', 'lumen.k')).toEqual({ ok: false, field: 'displayName', reason: 'length' });
    expect(checkNames('lumen.k', 'abc')).toEqual({ ok: false, field: 'loginName', reason: 'length' });
    expect(checkNames('lumen.k', 'lumen-login')).toMatchObject({ ok: true, display: { name: 'lumen.k' }, login: { name: 'lumen-login' } });
  });
});

describe('displayNameOf', () => {
  it("reads FU-A's displayName exactly as stored", () => {
    expect(displayNameOf({ displayName: 'Mira.K_' })).toBe('Mira.K_');
    expect(displayNameOf({})).toBe('');
  });
});
