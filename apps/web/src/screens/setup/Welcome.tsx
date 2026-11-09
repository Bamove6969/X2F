/**
 * The end of setup (board SetupWelcome; spec 6.1 step 6): "Welcome to X2F, <name>" with the name
 * exactly as stored, how they log in, their backup and where they get paid, the fee sentence
 * (OD-7, P3-M4) and one button, **Start trading**, back to `returnTo` (the take or the post that
 * started setup). Someone with no usable payout wallet is sent to Add a wallet first (spec 6.4),
 * which then carries on to `returnTo`.
 *
 * Owner G25 (6 Nov 2026): right after sign-up, Start trading ends the sign-up session and opens Log
 * in, as though the person were not logged in, so they test the login they just set up; the login
 * then asks for the session length (`afterLogin`) and goes on. Every setup step before this one
 * (backup, first wallet) still runs in the sign-up session and its 30-minute window. Someone
 * already logged in, who opened setup only to add a wallet, stays logged in.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { safeReturnTo } from '../../api/client.js';
import type { MethodType, Wallet as WalletEntry } from '@x2f/auth-client';
import { displayNameOf, refreshSession, useSession, type Me } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, useSetup, type BackupChoice, type LoginMethod, type SetupState } from './kit.js';
import { APP_LABELS } from '../wallets-model.js';

/** OD-7 (P3-M4), pending the owner's sign-off. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';

const LOGIN_WORDS: Record<LoginMethod, string> = { pgp: 'PGP key', passkey: 'Passkey', 'security-key': 'Security key', password: 'Password' };
const BACKUP_WORDS: Record<BackupChoice, string> = {
  'security-key': 'Security key',
  pgp: 'Second PGP key',
  'recovery-codes': 'Recovery codes',
};
const LOGIN_ORDER: LoginMethod[] = ['pgp', 'passkey', 'security-key', 'password'];
// An authenticator app is no backup login (design build gaps Job 1): it is a password's second step.
const BACKUP_ORDER: MethodType[] = ['security-key', 'passkey', 'recovery-codes'];

export interface Summary {
  loginWith: string;
  backup: string;
  paidTo: { app: string; end: string } | null;
}

/**
 * The Welcome rows. What this setup just did wins (it knows a second PGP key, which the methods
 * list cannot tell apart); otherwise the account's own methods and its first usable wallet.
 */
export function summarize(me: Pick<Me, 'methods'>, wallets: readonly WalletEntry[], flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): Summary {
  const login: LoginMethod | undefined = flow.registered ? flow.method : LOGIN_ORDER.find((m) => me.methods.includes(m));
  let backup = flow.backup !== null ? BACKUP_WORDS[flow.backup] : null;
  if (backup === null) {
    const other = BACKUP_ORDER.find((m) => m !== login && me.methods.includes(m));
    if (other === 'security-key' || other === 'recovery-codes') backup = BACKUP_WORDS[other];
    else if (other === 'passkey') backup = 'Passkey';
  }
  const usable = wallets.find((w) => w.usable);
  return {
    loginWith: login !== undefined ? LOGIN_WORDS[login] : 'None yet',
    backup: backup ?? 'None yet',
    paidTo: usable !== undefined ? { app: APP_LABELS[usable.app], end: usable.addressEnd } : null,
  };
}

/**
 * Where Start trading goes (owner G25). `registered`: this setup made the account, so the sign-up
 * session ends (`logOut`) and Log in comes next with the destination as its `returnTo`.
 */
export function startTradingPath(o: { registered: boolean; usable: boolean; returnTo: string }): { logOut: boolean; to: string } {
  // Trading and posting need a usable payout wallet (spec 6.4): Add a wallet first, then on.
  const next = o.usable ? o.returnTo : `/wallets?add=1&returnTo=${encodeURIComponent(o.returnTo)}`;
  return o.registered ? { logOut: true, to: `/login?returnTo=${encodeURIComponent(safeReturnTo(next))}` } : { logOut: false, to: next };
}

export function Welcome() {
  const navigate = useNavigate();
  const { state, returnTo } = useSetup();
  const session = useSession();
  const [wallets, setWallets] = useState<WalletEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  // The backup and the wallet were added after the sign-up: ask for the account as it is now.
  useEffect(() => {
    refreshSession();
    let live = true;
    authApi.listWallets().then(
      (ws) => live && setWallets(ws),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const me = session.status === 'signed-in' ? session.me : null;
  const ready = me !== null && wallets !== null;
  const usable = wallets?.some((w) => w.usable) ?? false;

  const [leaving, setLeaving] = useState(false);
  const start = async () => {
    const { logOut, to } = startTradingPath({ registered: state.registered, usable, returnTo });
    if (logOut) {
      setLeaving(true);
      // Should the logout call fail, Log in still comes next: a login revokes the session this
      // browser's cookie names (`openSession`), so the sign-up session ends then.
      await authApi.logout().catch(() => undefined);
      refreshSession();
    }
    void navigate(to);
  };

  if (!ready) {
    return (
      <SetupFrame screen="setup-welcome" footer={null}>
        {failed || session.status === 'error' ? (
          <p className="x2f-error" role="alert">
            Could not load your account. Reload the page to try again.
          </p>
        ) : (
          <p className="x2f-note">Loading your account.</p>
        )}
      </SetupFrame>
    );
  }

  const name = displayNameOf(me) || state.displayName;
  const s = summarize(me, wallets, state);

  return (
    <div className="x2f-start x2f-welcome" data-screen="setup-welcome">
      <main className="x2f-welcome__main">
        <span className="x2f-welcome__badge" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12l4 4 10-10" />
          </svg>
        </span>
        <section className="x2f-start__intro">
          <h1 className="x2f-welcome__h1">
            Welcome to X2F, <span data-username="">{name}</span>
          </h1>
          <p className="x2f-start__lead">
            Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow.
          </p>
        </section>
        <ul className="x2f-welcome__rows" aria-label="Your setup">
          <li className="x2f-welcome__row">
            <span className="x2f-welcome__key">You log in with</span>
            <span data-part="summary-login">{s.loginWith}</span>
          </li>
          <li className="x2f-welcome__row">
            <span className="x2f-welcome__key">Backup login</span>
            <span data-part="summary-backup">{s.backup}</span>
          </li>
          <li className="x2f-welcome__row">
            <span className="x2f-welcome__key">You get paid to</span>
            {s.paidTo !== null ? (
              <span data-part="summary-wallet">
                {s.paidTo.app} <span className="x2f-start__mono x2f-welcome__end">…{s.paidTo.end}</span>
              </span>
            ) : (
              <span data-part="summary-wallet">None yet</span>
            )}
          </li>
        </ul>
        <p className="x2f-start__help">You can change any of these later in Settings.</p>
        {state.registered ? (
          <p className="x2f-start__help" data-part="login-next">
            Next, log in with what you just set up, to check it works.
          </p>
        ) : null}
        <p className="x2f-start__help" data-part="fee">
          {FEE_SENTENCE}
        </p>
      </main>
      <footer className="x2f-start__foot">
        <Button variant="primary" disabled={leaving} onClick={() => void start()} data-part="start-trading">
          Start trading
        </Button>
      </footer>
    </div>
  );
}
