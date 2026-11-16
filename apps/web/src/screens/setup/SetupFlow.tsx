/**
 * Getting started (Plan 3 Task 28, spec 6.1). The first time someone taps Trade or posts an ad, a
 * short setup runs while the trade waits, in the canvas's board order:
 *
 *   0 Terms (`/setup`)  1 the private username (`name`, with the live "is available" tick), then
 *   the public display name (`display-name`)  2 login methods (`login`: every one wanted is ticked,
 *   owner demo notes 12 Nov 2026)  3 each ticked method in turn (kit.ts SIGNUP_ORDER): PGP key and
 *   code (`pgp-key`, `pgp-code`), a security key (`security-key`), a passkey (`passkey`), a
 *   password (`password`), an authenticator app (`authenticator`); the first one makes the account
 *   (a passkey or security key ticked first straight from step 2)  4 backup login (`backup`: the
 *   recovery code, required (owner S-017), after all the ticked methods, then an optional security
 *   key or second PGP key, "Skip for now")  5 first payout wallet (`wallet`)  then Welcome
 *   (`welcome`) with Start trading back to `returnTo`.
 *
 * What the person has entered lives only in this component's memory: nothing goes to the URL,
 * localStorage or logs. Every step carries `returnTo` in its query (always through safeReturnTo).
 * A step opened without the steps before it (a reload before the account exists) goes back to the
 * Terms. Once the account exists the session is the source of truth: the steps that would make it
 * again redirect to the next step still to do (the next ticked method, else the backup step, with
 * `replace`), a method step opens only while that method is still to do, and the step after each
 * one is entered with `replace`, so Back never offers a second sign-up. A finished PGP code step stays
 * (it shows "Key verified" and Continue only).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { authApi } from '../auth/authApi.js';
import { Backup } from './Backup.js';
import { DisplayName } from './DisplayName.js';
import { INITIAL, SetupContext, nextStep, stepPath, useSetup, type SetupState, type SignupMethod, type Step } from './kit.js';
import { Login } from './Login.js';
import { AuthenticatorStep, KeyStep } from './MoreMethods.js';
import { Password } from './Password.js';
import { PgpChallenge } from './PgpChallenge.js';
import { PgpKey } from './PgpKey.js';
import { clearPendingSignup, readPendingSignup, writePendingSignup } from './signupPending.js';
import { SetupTerms } from './Terms.js';
import { Username } from './Username.js';
import { Wallet } from './Wallet.js';
import { Welcome } from './Welcome.js';

/**
 * Owner S-017: once this flow has made the account, the wallet and Welcome steps wait until the
 * recovery codes are saved (typed back). Someone already signed in who only comes to link a wallet
 * did not sign up here, so it does not apply to them.
 */
export function needsBackup(state: Pick<SetupState, 'registered' | 'backup'>): boolean {
  return state.registered && state.backup === null;
}

/**
 * The m-2 blocking fix: a sign-up in this tab whose recovery code is still owed (it left `/setup`,
 * by Back or a reload) starts again from what the marker kept, so it goes straight to that step.
 */
export function restoredState(): SetupState {
  const p = readPendingSignup();
  return p === null ? INITIAL : { ...INITIAL, registered: true, displayName: p.displayName, method: p.method, methods: p.methods, done: p.done };
}

export function SetupFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = returnToFrom(location.search);
  const [state, setState] = useState<SetupState>(restoredState);
  // The marker lives from the account's making until the recovery code is saved (m-2).
  const { registered, backup, displayName, method, methods, done } = state;
  useEffect(() => {
    if (registered && backup === null) writePendingSignup({ displayName, method, methods, done });
    else if (backup !== null) clearPendingSignup();
  }, [registered, backup, displayName, method, methods, done]);
  const update = useCallback((patch: Partial<SetupState>) => setState((s) => ({ ...s, ...patch })), []);
  const path = useCallback((step: Step) => stepPath(step, returnTo), [returnTo]);
  const go = useCallback((step: Step, o?: { replace?: boolean }) => void navigate(stepPath(step, returnTo), { replace: o?.replace === true }), [navigate, returnTo]);
  const api = useMemo(() => ({ state, update, returnTo, go, path }), [state, update, returnTo, go, path]);

  const named = state.terms !== null && state.displayName !== '' && state.loginName !== '';
  const need = (ok: boolean, el: ReactNode) => (ok ? el : <Navigate to={path('')} replace />);
  // Once the account exists, the steps that create it are closed (review I2): Back, or a stale tab,
  // lands on the backup step instead of a second sign-up that would read "That username is taken".
  const before = (ok: boolean, el: ReactNode) => (state.registered ? <Navigate to={path(nextStep(state))} replace /> : need(ok, el));
  // A ticked method's own step, once the account exists: open while that method is still to do.
  const todo = (m: SignupMethod) => state.methods.includes(m) && !state.done.includes(m);
  const more = (m: SignupMethod, el: ReactNode) => (state.registered ? (todo(m) ? el : <Navigate to={path(nextStep(state))} replace />) : need(false, el));
  const after = (el: ReactNode) => (needsBackup(state) ? <Navigate to={path('backup')} replace /> : el);

  return (
    <SetupContext.Provider value={api}>
      <Routes>
        <Route index element={<SetupStart />} />
        {/* NEEDS_OWNER_SITE_RULES (owner p11-24): a site rules step, if the owner makes one, goes between the Terms and `name` (see SetupTerms). */}
        <Route path="name" element={before(state.terms !== null, <Username />)} />
        <Route path="display-name" element={before(state.terms !== null && state.loginName !== '', <DisplayName />)} />
        <Route path="login" element={before(named, <Login />)} />
        <Route path="pgp-key" element={before(named, <PgpKey />)} />
        <Route path="pgp-code" element={need(state.challenge !== null, <PgpChallenge />)} />
        <Route path="password" element={state.registered ? more('password', <Password />) : before(named, <Password />)} />
        <Route path="security-key" element={more('security-key', <KeyStep key="security-key" kind="security-key" />)} />
        <Route path="passkey" element={more('passkey', <KeyStep key="passkey" kind="passkey" />)} />
        <Route path="authenticator" element={more('totp', <AuthenticatorStep />)} />
        <Route path="backup" element={<Backup />} />
        <Route path="wallet" element={after(<Wallet />)} />
        <Route path="welcome" element={after(<EndSignup registered={state.registered}><Welcome /></EndSignup>)} />
        <Route path="*" element={<Navigate to={path('')} replace />} />
      </Routes>
    </SetupContext.Provider>
  );
}

/**
 * Security review M1(a) (12 Nov 2026): reaching Welcome after this flow made the account ends
 * sign-up, so the creating session's sign-up window (no confirm-it's-you for a first method) is
 * closed. Best effort: if the call fails the window still ends on its own after 30 minutes, and
 * Start trading logs the session out (G25).
 */
function EndSignup({ registered, children }: { registered: boolean; children: ReactNode }) {
  useEffect(() => {
    if (registered) void authApi.endOnboarding().catch(() => undefined);
  }, [registered]);
  return children;
}

/**
 * `/setup` itself: the Terms for someone without an account. A trader who is already signed in
 * skips setup: to Link a wallet when they have no usable wallet yet (spec 6.4), else to `returnTo`.
 */
function SetupStart() {
  const session = useSession();
  const { returnTo, path, state, update } = useSetup();
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const signedIn = session.status === 'signed-in';

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    authApi.listWallets().then(
      (ws) => live && setHasWallet(ws.some((w) => w.usable)),
      () => live && setHasWallet(false),
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

  // Signed out: an owed recovery code from an earlier sign-up in this tab is no longer this person's.
  const stale = session.status === 'signed-out' && state.registered;
  useEffect(() => {
    if (!stale) return;
    clearPendingSignup();
    update(INITIAL);
  }, [stale, update]);

  if (session.status === 'loading') return null;
  if (!signedIn) return stale ? null : <SetupTerms />;
  if (hasWallet === null) return null;
  return <Navigate to={hasWallet ? returnTo : path('wallet')} replace />;
}
