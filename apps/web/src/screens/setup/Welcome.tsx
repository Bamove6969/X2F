/**
 * The end of setup (board SetupWelcome; spec 6.1 step 6): "Welcome to X2F, <name>" with the name
 * exactly as stored, how they log in, their backup and where they get paid, the fee sentence
 * (OD-7, P3-M4) and one button, **Start trading**, back to `returnTo` (the take or the post that
 * started setup). Someone with no usable payout wallet is sent to Add a wallet first (spec 6.4),
 * which then carries on to `returnTo`.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MethodType, Wallet as WalletEntry } from '@x2f/auth-client';
import { displayNameOf, refreshSession, useSession, type Me } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, useSetup, type BackupChoice, type LoginMethod, type SetupState } from './kit.js';
import { APP_LABELS } from './Wallet.js';

/** OD-7 (P3-M4), pending the owner's sign-off. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';

const LOGIN_WORDS: Record<LoginMethod, string> = { pgp: 'PGP key', passkey: 'Passkey', 'security-key': 'Security key', password: 'Password' };
const BACKUP_WORDS: Record<BackupChoice, string> = {
  totp: 'Authenticator app',
  'security-key': 'Security key',
  pgp: 'Second PGP key',
  'recovery-codes': 'Recovery codes',
};
const LOGIN_ORDER: LoginMethod[] = ['pgp', 'passkey', 'security-key', 'password'];
const BACKUP_ORDER: MethodType[] = ['totp', 'security-key', 'passkey', 'recovery-codes'];

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
    if (other === 'totp' || other === 'security-key' || other === 'recovery-codes') backup = BACKUP_WORDS[other];
    else if (other === 'passkey') backup = 'Passkey';
  }
  const usable = wallets.find((w) => w.usable);
  return {
    loginWith: login !== undefined ? LOGIN_WORDS[login] : 'None yet',
    backup: backup ?? 'None yet',
    paidTo: usable !== undefined ? { app: APP_LABELS[usable.app], end: usable.addressEnd } : null,
  };
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

  const start = () => {
    // Trading and posting need a usable payout wallet (spec 6.4): Add a wallet first, then on.
    void navigate(usable ? returnTo : `/wallets?add=1&returnTo=${encodeURIComponent(returnTo)}`);
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
    <div className="x2f-setup x2f-welcome" data-screen="setup-welcome">
      <main className="x2f-welcome__main">
        <span className="x2f-welcome__badge" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12l4 4 10-10" />
          </svg>
        </span>
        <section className="x2f-setup__intro">
          <h1 className="x2f-welcome__h1">
            Welcome to X2F, <span data-username="">{name}</span>
          </h1>
          <p className="x2f-setup__lead">
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
                {s.paidTo.app} <span className="x2f-setup__mono x2f-welcome__end">…{s.paidTo.end}</span>
              </span>
            ) : (
              <span data-part="summary-wallet">None yet</span>
            )}
          </li>
        </ul>
        <p className="x2f-setup__help">You can change any of these later in Settings.</p>
        <p className="x2f-setup__help" data-part="fee">
          {FEE_SENTENCE}
        </p>
      </main>
      <footer className="x2f-setup__foot">
        <Button variant="primary" onClick={start} data-part="start-trading">
          Start trading
        </Button>
      </footer>
    </div>
  );
}
