/*
 * Task 30 tripwires for the lead's FU-A (login names, PGP login by key, server-counted password
 * misses), which is not on the main line yet. Until it is, `screens/auth/authApi.ts` sends FU-A's
 * shapes through the raw client and `screens/auth/loginRules.ts` mirrors FU-A's exports. Each
 * tripwire below holds today and FAILS the moment FU-A's typed client lands, which is the signal to
 * switch those calls to `authApi` and import the rules from `@x2f/auth-client`:
 *
 *   - `_typeTripwires` (never called) fails `tsc` with "unused '@ts-expect-error'" once
 *     `loginPgpStart` takes `{ key }` and `loginPassword` takes `{ loginName, ... }`. Each one
 *     names FU-A's exact field, so it cannot be satisfied by a different rename.
 *   - the runtime checks fail once `@x2f/auth-client` exports FU-A's rules.
 *
 * (FU-B's tripwires — logout timer, payout-wait removal — fired when FU-B merged into the main line
 * on 2026-10-24 and were retired; those screens now use the typed client.)
 */
import * as client from '@x2f/auth-client';
import type { AuthApi } from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';
import { MISSES_BEFORE_SENDING_AWAY, PASSWORD_LOGIN_MISMATCH } from '../src/screens/auth/loginRules.js';

// Compile-time only — never invoked.
function _typeTripwires(): void {
  // @ts-expect-error TRIPWIRE (FU-A): PGP login takes `{ key }` and no login name; then call authApi.loginPgpStart.
  const _pgp: Parameters<AuthApi['loginPgpStart']>[0] = { key: 'x' };
  // @ts-expect-error TRIPWIRE (FU-A): password login takes `loginName`; then call authApi.loginPassword and read `e.misses`.
  const _pw: Parameters<AuthApi['loginPassword']>[0] = { loginName: 'x', password: 'x', deviceLabel: 'x' };
  void _pgp;
  void _pw;
}
void _typeTripwires;

describe('Task 30 tripwires: FU-A is not on the main line yet', () => {
  it('the typed client does not export the password-login rules yet', () => {
    expect('shouldSendAway' in client).toBe(false);
    expect('PASSWORD_LOGIN_MISMATCH' in client).toBe(false);
  });

  it('the local mirror matches FU-A exactly (wording and threshold)', () => {
    expect(PASSWORD_LOGIN_MISMATCH).toBe("That login name and password don't match");
    expect(MISSES_BEFORE_SENDING_AWAY).toBe(10);
  });
});
