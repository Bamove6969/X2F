/**
 * Getting started (Plan 3 Task 28, spec 6.1). The first time someone taps Trade or posts an ad, a
 * short setup runs while the trade waits, in the canvas's board order:
 *
 *   0 Terms (`/setup`)  1 names (`name`)  2 login method (`login`)  3 PGP key and code
 *   (`pgp-key`, `pgp-code`) or a password (`password`), or a passkey / security key straight from
 *   step 2  4 backup login (`backup`, "Skip for now")  5 first payout wallet (`wallet`)  then
 *   Welcome (`welcome`) with Start trading back to `returnTo`.
 *
 * What the person has entered lives only in this component's memory: nothing goes to the URL,
 * localStorage or logs. Every step carries `returnTo` in its query (always through safeReturnTo).
 * A step opened without the steps before it (a reload before the account exists) goes back to the
 * Terms. From the backup step on, the account exists and the session is the source of truth.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { authApi } from '../auth/authApi.js';
import { Backup } from './Backup.js';
import { INITIAL, SetupContext, stepPath, useSetup, type SetupState, type Step } from './kit.js';
import { Login } from './Login.js';
import { Password } from './Password.js';
import { PgpChallenge } from './PgpChallenge.js';
import { PgpKey } from './PgpKey.js';
import { SetupTerms } from './Terms.js';
import { Username } from './Username.js';
import { Wallet } from './Wallet.js';
import { Welcome } from './Welcome.js';

export function SetupFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = returnToFrom(location.search);
  const [state, setState] = useState<SetupState>(INITIAL);
  const update = useCallback((patch: Partial<SetupState>) => setState((s) => ({ ...s, ...patch })), []);
  const path = useCallback((step: Step) => stepPath(step, returnTo), [returnTo]);
  const go = useCallback((step: Step) => void navigate(stepPath(step, returnTo)), [navigate, returnTo]);
  const api = useMemo(() => ({ state, update, returnTo, go, path }), [state, update, returnTo, go, path]);

  const named = state.terms !== null && state.displayName !== '' && state.loginName !== '';
  const need = (ok: boolean, el: ReactNode) => (ok ? el : <Navigate to={path('')} replace />);

  return (
    <SetupContext.Provider value={api}>
      <Routes>
        <Route index element={<SetupStart />} />
        <Route path="name" element={need(state.terms !== null, <Username />)} />
        <Route path="login" element={need(named, <Login />)} />
        <Route path="pgp-key" element={need(named, <PgpKey />)} />
        <Route path="pgp-code" element={need(state.challenge !== null, <PgpChallenge />)} />
        <Route path="password" element={need(named, <Password />)} />
        <Route path="backup" element={<Backup />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="*" element={<Navigate to={path('')} replace />} />
      </Routes>
    </SetupContext.Provider>
  );
}

/**
 * `/setup` itself: the Terms for someone without an account. A trader who is already signed in
 * skips setup: to Link a wallet when they have no usable wallet yet (spec 6.4), else to `returnTo`.
 */
function SetupStart() {
  const session = useSession();
  const { returnTo, path } = useSetup();
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

  if (session.status === 'loading') return null;
  if (!signedIn) return <SetupTerms />;
  if (hasWallet === null) return null;
  return <Navigate to={hasWallet ? returnTo : path('wallet')} replace />;
}
