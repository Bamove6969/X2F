/*
 * Task 28 tripwires for the lead's FU-A (the public display name and the private login name, spec
 * 6.1, owner 2026-10-23), which is not on the main line yet. Until it is,
 * `screens/setup/register.ts` sends FU-A's register shapes through the raw client,
 * `screens/setup/names.ts` mirrors FU-A's name rules, and `session/useSession.ts` reads FU-A's
 * `displayName` from `me()` with the main line's `username` as the fallback. Each tripwire below
 * holds today and FAILS the moment FU-A's typed client lands, which is the signal to switch those
 * calls to `authApi`, import the name rules from `@x2f/auth-client`, and drop the fallback:
 *
 *   - `_typeTripwires` (never called) fails `tsc` with "unused '@ts-expect-error'" once each
 *     register call takes `{ displayName, loginName, ... }` and `AccountOverview` has `displayName`.
 *   - the runtime checks fail once `@x2f/auth-client` exports FU-A's name rules.
 */
import * as client from '@x2f/auth-client';
import type { AccountOverview, AuthApi } from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';
import { checkDisplayName, checkLoginName, checkNames } from '../src/screens/setup/names.js';
import { displayNameOf } from '../src/session/useSession.js';

// Compile-time only — never invoked.
function _typeTripwires(): void {
  const names = { displayName: 'lumen.k', loginName: 'lumen-login' };
  // @ts-expect-error TRIPWIRE (FU-A): password sign-up takes both names; then call authApi.registerPassword.
  const _pw: Parameters<AuthApi['registerPassword']>[0] = { ...names, password: 'x', deviceLabel: 'x', acceptedTerms: 'x' };
  // @ts-expect-error TRIPWIRE (FU-A): PGP sign-up takes both names; then call authApi.registerPgpStart.
  const _pgp: Parameters<AuthApi['registerPgpStart']>[0] = { ...names, publicKey: 'x' };
  // @ts-expect-error TRIPWIRE (FU-A): passkey and security-key sign-up take both names; then use registerWithWebAuthn.
  const _wa: Parameters<AuthApi['registerWebAuthnStart']>[0] = { ...names, kind: 'passkey' };
  // @ts-expect-error TRIPWIRE (FU-A): me() answers the public displayName; then drop displayNameOf's fallback.
  const _me: AccountOverview['displayName'] = 'x';
  void [_pw, _pgp, _wa, _me];
}
void _typeTripwires;

describe('Task 28 tripwires: FU-A is not on the main line yet', () => {
  it('the typed client does not export the name rules yet', () => {
    expect('checkNames' in client).toBe(false);
    expect('checkDisplayName' in client).toBe(false);
    expect('checkLoginName' in client).toBe(false);
  });
});

describe('the local name rules mirror FU-A', () => {
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
  it("reads FU-A's displayName, else the main line's username", () => {
    expect(displayNameOf({ displayName: 'Mira.K_' })).toBe('Mira.K_');
    expect(displayNameOf({ username: 'nightowl' })).toBe('nightowl');
    expect(displayNameOf({ displayName: 'Mira.K_', username: 'old' })).toBe('Mira.K_');
    expect(displayNameOf({})).toBe('');
  });
});
