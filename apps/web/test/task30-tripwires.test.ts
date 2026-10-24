/*
 * Task 30 tripwires. The new login rules (owner, 2026-10-23) are built to the spec, but their API
 * + auth-client changes are not on this branch yet (lead follow-up branches). These assertions
 * hold now and fail LOUDLY the moment the real shapes land, which is the signal to move the shims
 * in `screens/auth/authApi.ts` and `screens/settings/logoutTimer.ts` onto the typed client:
 *
 *   - `_typeTripwires` (never called) fails `tsc` when the typed client / `AccountOverview` gains
 *     PGP-login-by-key, the inactivity logout timer, or a changed payout-wait shape.
 *   - the runtime checks fail when the client gains a logout-timer method or drops the opt-in
 *     payout-wait method.
 */
import { createAuthApi, type AccountOverview, type AuthApi } from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';

// Compile-time only — never invoked.
async function _typeTripwires(api: AuthApi, me: AccountOverview): Promise<void> {
  // @ts-expect-error TRIPWIRE: PGP login needs no login name once the by-key form lands; then switch pgpLoginStart to the typed client.
  await api.loginPgpStart({ publicKey: 'x' });
  // @ts-expect-error TRIPWIRE: AccountOverview gains the inactivity logout timer; then read it here instead of defaulting to 12.
  const _hours: number = me.logoutTimerHours;
  void _hours;
  // Not an expect-error: this fails only if the opt-in payout-wait SHAPE changes (the rule drops the toggle).
  const _pw: { enabled: boolean; offAt: string | null } = me.payoutWait;
  void _pw;
}
void _typeTripwires;

describe('Task 30 tripwires: the new-login-rules API is not on main yet', () => {
  it('the typed client has no logout-timer method yet', () => {
    expect(Object.keys(createAuthApi())).not.toContain('setLogoutTimer');
  });

  it('the opt-in payout-wait method is still present (the wallet-wait-by-method rule will drop it)', () => {
    expect('setPayoutWait' in createAuthApi()).toBe(true);
  });
});
