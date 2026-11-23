/**
 * The end of setup (board SetupWelcome; spec 6.1 step 6): "Welcome to X2F, <name>" with the name
 * exactly as stored; the owner's checklist (demo notes 12 Nov 2026: the login methods best to
 * worst, the recovery codes and the wallet, one big green tick each); the change-later line, the
 * next step and the owner's fee note; and one button, **Start trading**, back to `returnTo` (the take or the post that
 * started setup). Someone with no usable payout wallet is sent to Add a wallet first (spec 6.4),
 * which then carries on to `returnTo`.
 *
 * Owner G25 (6 Nov 2026): right after sign-up, Start trading ends the sign-up session and opens Log
 * in, as though the person were not logged in, so they test the login they just set up; the login
 * then asks for the session length (`afterLogin`) and goes on. Every setup step before this one
 * (backup, first wallet) still runs in the sign-up session and its 30-minute window. Someone
 * already logged in, who opened setup only to add a wallet, stays logged in.
 *
 * Owner demo note 16 Nov #97: the screen also says what the account's security rating is, always
 * lists the username with the login methods ("Username and password" when there is a password), and
 * each checklist item links back to the setting where it can be changed or made more secure.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { safeReturnTo } from '../../api/client.js';
import type { MethodType, Wallet as WalletEntry } from '@x2f/auth-client';
import { displayNameOf, refreshSession, useSession, type Me } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, useSetup, type SetupState } from './kit.js';
import { APP_LABELS } from '../wallets-model.js';

/** OD-7 (P3-M4), pending the owner's sign-off. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';

/**
 * The Welcome screen's words (owner demo notes 12 Nov 2026, his own words with the typos fixed).
 * COPY-UNSIGNED; DESIGNER-REVIEW: design restyles the screen (the owner also asked for better
 * looks and the logo with the screen name top left on every screen).
 */
export const WELCOME_COPY = {
  lead: 'Your account is ready. Trade Monero for cash, bank transfers, gift cards, or whatever payment method you choose, with every trade protected by escrow. If the site is missing a payment method, please leave feedback so we can add it quickly: include what detail you can, or a link with information on it.',
  loginItem: 'Configured your secure methods of logging into X2F',
  recoveryItem: 'Emergency login method: recovery code documented',
  walletItem: 'Connected your wallet',
  /** Under the checklist, in a bigger font (owner). */
  changeLater: 'Any information provided above can be changed later in Settings.',
  /** Right after sign-up only (owner G25: Start trading opens Log in). */
  nextLogin: "Next, you'll log in for the first time and try the security methods you set up, which will welcome you to the X2F experience.",
  fee: 'Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.',
  none: 'None yet',
  done: 'Done',
  /** Owner #97: the account's security rating, above the checklist. COPY-UNSIGNED */
  ratingTitle: "Your account's security rating",
  /** Owner #97: how to make it more secure, for an account not yet highly secure. COPY-UNSIGNED */
  ratingRaise: 'Add a passkey, a security key or a PGP key to make it highly secure.',
  ratingLink: 'Make it more secure',
  /** Owner #97: "always add Username/Password as a bullet point". COPY-UNSIGNED */
  usernamePassword: 'Username and password',
  /** Every account logs in with its private username, password or not. COPY-UNSIGNED */
  username: 'Username',
  /** Owner #97: the link back to each setting. COPY-UNSIGNED */
  change: 'Change',
  add: 'Add',
} as const;

/** The rating's words (the same levels as the trade screen's, owner 17 Nov). COPY-UNSIGNED */
export const RATING_WORDS: Record<SecurityRating, string> = {
  high: 'Highly secure',
  medium: 'Medium',
  weak: 'Weak',
};

/** Where each checklist item is changed later (owner #97). */
export const WELCOME_LINKS = {
  rating: '/settings/security',
  login: '/settings/security',
  recovery: '/settings/security',
  wallet: '/wallets',
} as const;

/** Add a wallet, then back to what started setup (the take or the post), as Start trading's own wallet step. */
export function walletAddPath(returnTo: string): string {
  return `/wallets?add=1&returnTo=${encodeURIComponent(returnTo)}`;
}

export type SecurityRating = 'weak' | 'medium' | 'high';

/**
 * The login methods, best to worst (lead default, owner may reorder): a security key and a passkey
 * (phishing-proof hardware or device keys) first, then a PGP key, an authenticator app (a
 * password's second step), and a password last. The recovery codes are their own item.
 */
const BEST_FIRST: Array<{ id: MethodType; word: string }> = [
  { id: 'security-key', word: 'Security key' },
  { id: 'passkey', word: 'Passkey' },
  { id: 'pgp', word: 'PGP key' },
  { id: 'totp', word: 'Authenticator app' },
  { id: 'password', word: WELCOME_COPY.usernamePassword },
];

/** The account's login methods best to worst; what this setup just did counts before the account is read again. */
export function loginMethodsBestFirst(me: Pick<Me, 'methods'>, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): string[] {
  const have = methodsNow(me, flow);
  // A second PGP key is not visible in the methods list; the flow knows.
  const twoPgp = flow.registered && flow.method === 'pgp' && flow.backup === 'pgp';
  const words = BEST_FIRST.filter((m) => have.has(m.id)).map((m) => (m.id === 'pgp' && twoPgp ? 'PGP keys (2)' : m.word));
  // Owner #97: the username is always a line; with a password it is "Username and password".
  if (words.length > 0 && !have.has('password')) words.push(WELCOME_COPY.username);
  return words;
}

/** The account's methods as this setup leaves them: the account as read, plus what the flow just did. */
function methodsNow(me: Pick<Me, 'methods'>, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): Set<string> {
  const have = new Set<string>(me.methods);
  if (flow.registered) have.add(flow.method);
  if (flow.backup === 'security-key' || flow.backup === 'pgp') have.add(flow.backup);
  return have;
}

/**
 * The account's security rating (owner #97). The API's own rating wins when it sends one (GET
 * /v1/account/me `securityRating`, apps/api/src/auth/rating.ts on main); an API build without it
 * gets the same three rules applied to the methods here, for display only (it authorises nothing):
 * high with a PGP key, a passkey or a security key; medium with a password and an authenticator app;
 * weak otherwise.
 */
export function securityRating(me: Pick<Me, 'methods'> & { securityRating?: SecurityRating | null }, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): SecurityRating {
  const sent = me.securityRating;
  if (sent === 'high' || sent === 'medium' || sent === 'weak') return sent;
  const have = methodsNow(me, flow);
  if (have.has('pgp') || have.has('passkey') || have.has('security-key')) return 'high';
  if (have.has('password') && have.has('totp')) return 'medium';
  return 'weak';
}

export interface Checklist {
  logins: string[];
  loginDone: boolean;
  recoveryDone: boolean;
  wallet: { app: string; end: string } | null;
}

/** The Welcome checklist: each item is ticked only when it is really done. */
export function checklist(me: Pick<Me, 'methods'>, wallets: readonly WalletEntry[], flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): Checklist {
  const logins = loginMethodsBestFirst(me, flow);
  const usable = wallets.find((w) => w.usable);
  return {
    logins,
    loginDone: logins.length > 0,
    recoveryDone: me.methods.includes('recovery-codes') || flow.backup === 'recovery-codes',
    // A wallet saved as Other (setup no longer picks an app, owner #96) goes by its own name.
    wallet: usable !== undefined ? { app: usable.app === 'other' ? usable.label || APP_LABELS.other : APP_LABELS[usable.app], end: usable.addressEnd } : null,
  };
}

/** One big green tick (owner: one per item, the login methods together under one). */
function Tick({ done }: { done: boolean }) {
  if (!done) return <span className="x2f-welcome__tick x2f-welcome__tick--open" aria-hidden="true" />;
  return (
    <span className="x2f-welcome__tick" data-part="tick" role="img" aria-label={WELCOME_COPY.done}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path d="M5 12l4 4 10-10" />
      </svg>
    </span>
  );
}

/**
 * The link back to a setting (owner #97). Right after sign-up it leaves the way Start trading does
 * (owner G25): `leave` ends the sign-up session and Log in comes next, then the setting. The href is
 * where the link really goes, so it reads right without script.
 */
function LeaveLink({ target, leave, part, disabled, children }: { target: string; leave: Leave; part: string; disabled: boolean; children: string }) {
  const { to } = leave.path(target);
  return (
    <Link
      className="x2f-link x2f-welcome__link"
      to={to}
      data-part={part}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) void leave.go(target);
      }}
    >
      {children}
    </Link>
  );
}

interface Leave {
  path: (target: string) => { logOut: boolean; to: string };
  go: (target: string) => Promise<void>;
}

/**
 * Where a link off the Welcome screen goes (owner G25 and #97): right after sign-up (`registered`) the
 * sign-up session ends (`logOut`) and Log in comes next with `target` as its `returnTo`; someone
 * already logged in goes straight there.
 */
export function leavePath(o: { registered: boolean; target: string }): { logOut: boolean; to: string } {
  return o.registered ? { logOut: true, to: `/login?returnTo=${encodeURIComponent(safeReturnTo(o.target))}` } : { logOut: false, to: o.target };
}

/**
 * Where Start trading goes (owner G25). `registered`: this setup made the account, so the sign-up
 * session ends (`logOut`) and Log in comes next with the destination as its `returnTo`.
 */
export function startTradingPath(o: { registered: boolean; usable: boolean; returnTo: string }): { logOut: boolean; to: string } {
  // Trading and posting need a usable payout wallet (spec 6.4): Add a wallet first, then on.
  return leavePath({ registered: o.registered, target: o.usable ? o.returnTo : walletAddPath(o.returnTo) });
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
  const go = async ({ logOut, to }: { logOut: boolean; to: string }) => {
    if (logOut) {
      setLeaving(true);
      // Should the logout call fail, Log in still comes next: a login revokes the session this
      // browser's cookie names (`openSession`), so the sign-up session ends then.
      await authApi.logout().catch(() => undefined);
      refreshSession();
    }
    void navigate(to);
  };
  const start = () => go(startTradingPath({ registered: state.registered, usable, returnTo }));
  // Owner #97 links: the same way out as Start trading (G25), then the setting.
  const leave: Leave = {
    path: (target) => leavePath({ registered: state.registered, target }),
    go: (target) => go(leavePath({ registered: state.registered, target })),
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
  const c = checklist(me, wallets, state);
  const rating = securityRating(me, state);

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
          <p className="x2f-start__lead">{WELCOME_COPY.lead}</p>
        </section>
        {/* Owner #97 (16 Nov): the rating, and for anything below highly secure, the way to raise it. DESIGNER-REVIEW */}
        <section className="x2f-welcome__rating" data-part="security-rating" data-rating={rating} aria-labelledby="welcome-rating-title">
          <p className="x2f-welcome__rating-line">
            <span className="x2f-welcome__title" id="welcome-rating-title">
              {WELCOME_COPY.ratingTitle}:
            </span>{' '}
            <span data-part="rating-word">{RATING_WORDS[rating]}</span>
          </p>
          {rating !== 'high' ? (
            <p className="x2f-welcome__rating-raise">
              {WELCOME_COPY.ratingRaise}{' '}
              <LeaveLink target={WELCOME_LINKS.rating} leave={leave} part="rating-link" disabled={leaving}>
                {WELCOME_COPY.ratingLink}
              </LeaveLink>
            </p>
          ) : null}
        </section>
        {/* DESIGNER-REVIEW: the owner's checklist (12 Nov), plain until design restyles it. */}
        <ul className="x2f-welcome__checks" aria-label="Your setup">
          <li className="x2f-welcome__check" data-part="check-login">
            <div className="x2f-welcome__what">
              <span className="x2f-welcome__title" data-part="check-title">{WELCOME_COPY.loginItem}</span>
              {c.logins.length > 0 ? (
                <ul className="x2f-welcome__methods" data-part="login-methods">
                  {c.logins.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <span className="x2f-welcome__key">{WELCOME_COPY.none}</span>
              )}
              <LeaveLink target={WELCOME_LINKS.login} leave={leave} part="change-login" disabled={leaving}>
                {c.loginDone ? WELCOME_COPY.change : WELCOME_COPY.add}
              </LeaveLink>
            </div>
            <Tick done={c.loginDone} />
          </li>
          <li className="x2f-welcome__check" data-part="check-recovery">
            <div className="x2f-welcome__what">
              <span className="x2f-welcome__title" data-part="check-title">{WELCOME_COPY.recoveryItem}</span>
              <LeaveLink target={WELCOME_LINKS.recovery} leave={leave} part="change-recovery" disabled={leaving}>
                {c.recoveryDone ? WELCOME_COPY.change : WELCOME_COPY.add}
              </LeaveLink>
            </div>
            <Tick done={c.recoveryDone} />
          </li>
          <li className="x2f-welcome__check" data-part="check-wallet">
            <div className="x2f-welcome__what">
              <span className="x2f-welcome__title" data-part="check-title">{WELCOME_COPY.walletItem}</span>
              {c.wallet !== null ? (
                <span data-part="summary-wallet">
                  {c.wallet.app} <span className="x2f-start__mono x2f-welcome__end">…{c.wallet.end}</span>
                </span>
              ) : (
                <span className="x2f-welcome__key" data-part="summary-wallet">{WELCOME_COPY.none}</span>
              )}
              <LeaveLink target={c.wallet !== null ? WELCOME_LINKS.wallet : walletAddPath(returnTo)} leave={leave} part="change-wallet" disabled={leaving}>
                {c.wallet !== null ? WELCOME_COPY.change : WELCOME_COPY.add}
              </LeaveLink>
            </div>
            <Tick done={c.wallet !== null} />
          </li>
        </ul>
        <p className="x2f-welcome__next" data-part="change-later">
          {WELCOME_COPY.changeLater}
        </p>
        {state.registered ? (
          <p className="x2f-welcome__next" data-part="login-next">
            {WELCOME_COPY.nextLogin}
          </p>
        ) : null}
        <p className="x2f-start__help" data-part="fee">
          {WELCOME_COPY.fee}
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
