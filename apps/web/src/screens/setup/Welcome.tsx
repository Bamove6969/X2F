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
 * lists the username with the login methods, and
 * each checklist item links back to the setting where it can be changed or made more secure.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { safeReturnTo } from '../../api/client.js';
import type { MethodType, Wallet as WalletEntry } from '@x2f/auth-client';
import { tradeTagOf, refreshSession, useSession, type Me } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Logo } from '../../ui/Logo.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, useSetup, type SetupState } from './kit.js';
import { APP_LABELS } from '../wallets-model.js';

/**
 * The Welcome screen's words (owner demo notes 12 Nov 2026, his own words with the typos fixed).
 * COPY-UNSIGNED; DESIGNER-REVIEW: design restyles the screen (the owner also asked for better
 * looks and the logo with the screen name top left on every screen).
 */
export const WELCOME_COPY = {
  // Owner demo note #166 (23 Nov), his two paragraphs word for word.
  lead: 'Your account is ready. Buy and sell Monero using cash, bank transfers, gift cards, or any payment method you prefer, with every trade protected by 2-of-3 escrow.',
  leadMore: 'Don’t see your preferred payment method? Send us feedback with as many details as you can (or a link with more info) so we can get it added quickly.',
  /**
   * Owner demo note #168 (23 Nov): every login method X2F offers under one bold, underlined heading,
   * each with a big green check or red cross, ending in the level reached (the #167 rating line).
   * COPY-UNSIGNED
   */
  loginsTitle: 'Secure X2F login methods',
  methodSet: 'Set up',
  methodNotSet: 'Not set up',
  verdict: 'You have achieved level:',
  recoveryCode: 'Recovery code',
  walletItem: 'Payout wallet:',
  /** Under the checklist, in a bigger font (owner). */
  changeLater: 'Any information provided above can be changed later in Settings.',
  /** Right after sign-up only (owner G25: Start trading opens Log in). */
  nextLogin: "Next, you'll log in for the first time and try the security methods you set up, which will welcome you to the X2F experience.",
  fee: 'Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.',
  none: 'None yet',
  done: 'Done',
  /** Review 12 Nov, C1: what a screen reader hears for an item not done yet. */
  notDone: 'Not done yet',
  /** Owner #97: how to make it more secure, for an account not yet highly secure. COPY-UNSIGNED */
  ratingRaise: 'Add a passkey, a security key or a PGP key to make it highly secure.',
  ratingLink: 'Make it more secure',
  /** Owner #97: the username is always a bullet point. COPY-UNSIGNED */
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
 * (phishing-proof hardware or device keys) first, then a PGP key and an authenticator app (it counts
 * as a kind but never logs in alone). The recovery codes are their own item.
 */
const BEST_FIRST: Array<{ id: MethodType; word: string }> = [
  { id: 'security-key', word: 'Security key' },
  { id: 'passkey', word: 'Passkey' },
  { id: 'pgp', word: 'PGP key' },
  { id: 'totp', word: 'Authenticator app' },
];

/**
 * Owner demo note #168: every login method X2F offers, in his order (PGP key, security key, passkey,
 * authenticator app), then the recovery code, each marked set up or not from the account's
 * methods as this setup leaves them.
 */
const OFFERED: Array<{ id: MethodType; word: string }> = [
  { id: 'pgp', word: 'PGP key' },
  { id: 'security-key', word: 'Security key' },
  { id: 'passkey', word: 'Passkey' },
  { id: 'totp', word: 'Authenticator app' },
  { id: 'recovery-codes', word: WELCOME_COPY.recoveryCode },
];

export interface MethodRow {
  id: MethodType;
  word: string;
  set: boolean;
}

export function methodRows(me: Pick<Me, 'methods'>, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): MethodRow[] {
  const have = methodsNow(me, flow);
  if (flow.backup === 'recovery-codes') have.add('recovery-codes');
  return OFFERED.map((m) => ({ ...m, set: have.has(m.id) }));
}

/** The account's login methods best to worst; what this setup just did counts before the account is read again. */
export function loginMethodsBestFirst(me: Pick<Me, 'methods'>, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): string[] {
  const have = methodsNow(me, flow);
  // A second PGP key is not visible in the methods list; the flow knows.
  const twoPgp = flow.registered && flow.method === 'pgp' && flow.backup === 'pgp';
  const words = BEST_FIRST.filter((m) => have.has(m.id)).map((m) => (m.id === 'pgp' && twoPgp ? 'PGP keys (2)' : m.word));
  // Owner #97: the username is always a line.
  if (words.length > 0) words.push(WELCOME_COPY.username);
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
 * high with a PGP key, a passkey or a security key; weak otherwise (medium is never given since
 * owner 26 Nov 2026: it was a password with an authenticator app).
 */
export function securityRating(me: Pick<Me, 'methods'> & { securityRating?: SecurityRating | null }, flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): SecurityRating {
  const sent = me.securityRating;
  if (sent === 'high' || sent === 'medium' || sent === 'weak') return sent;
  const have = methodsNow(me, flow);
  if (have.has('pgp') || have.has('passkey') || have.has('security-key')) return 'high';
  return 'weak';
}

export interface Checklist {
  logins: string[];
  loginDone: boolean;
  recoveryDone: boolean;
  /**
   * The usable wallet: its own name, its app's name (null for a wallet saved as Other), and the end
   * of its address, kept apart so each is drawn in its own element (security review of
   * wip/lead-note-226, Medium 1: a name can never run into the real app or address end).
   */
  wallet: { name: string; app: string | null; end: string } | null;
}

/**
 * The wallet's name and app on the checklist. Owner demo note #226 (25 Nov): "Traders want to know
 * where each wallet is going", so the name the person gave it comes first. A wallet saved as Other
 * (setup no longer picks an app, owner #96) goes by its name alone (Other when it has none); one in
 * a named app gets the app after it, in its own element. COPY-UNSIGNED (note #226)
 */
export function walletName(w: Pick<WalletEntry, 'app' | 'label'>): { name: string; app: string | null } {
  const label = w.label.trim();
  if (w.app === 'other') return { name: label || APP_LABELS.other, app: null };
  return label === '' ? { name: APP_LABELS[w.app], app: null } : { name: label, app: APP_LABELS[w.app] };
}

/** The Welcome checklist: each item is ticked only when it is really done. */
export function checklist(me: Pick<Me, 'methods'>, wallets: readonly WalletEntry[], flow: Pick<SetupState, 'registered' | 'method' | 'backup'>): Checklist {
  const logins = loginMethodsBestFirst(me, flow);
  const usable = wallets.find((w) => w.usable);
  return {
    logins,
    loginDone: logins.length > 0,
    recoveryDone: me.methods.includes('recovery-codes') || flow.backup === 'recovery-codes',
    wallet: usable !== undefined ? { ...walletName(usable), end: usable.addressEnd } : null,
  };
}

/**
 * One big tick (owner: one per item, the login methods together under one). An item not done yet is
 * the open circle, named for a screen reader as the done tick is (review 12 Nov, C1).
 */
export function Tick({ done }: { done: boolean }) {
  if (!done) return <span className="x2f-welcome__tick x2f-welcome__tick--open" data-part="tick-open" role="img" aria-label={WELCOME_COPY.notDone} />;
  return (
    <span className="x2f-welcome__tick" data-part="tick" role="img" aria-label={WELCOME_COPY.done}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path d="M5 12l4 4 10-10" />
      </svg>
    </span>
  );
}

/** Owner #168: the big green check or red cross of one login method; the row's text says it too. */
function MethodMark({ set }: { set: boolean }) {
  return (
    <span className="x2f-welcome__mark" data-part={set ? 'mark-set' : 'mark-unset'} aria-hidden="true">
      <Icon name={set ? 'check' : 'close'} size={32} stroke={3} />
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

  const name = tradeTagOf(me) || state.tradeTag;
  const c = checklist(me, wallets, state);
  const rating = securityRating(me, state);
  const rows = methodRows(me, state);

  return (
    <div className="x2f-start x2f-welcome" data-screen="setup-welcome">
      <main className="x2f-welcome__main">
        <span className="x2f-welcome__badge" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12l4 4 10-10" />
          </svg>
        </span>
        <section className="x2f-start__intro">
          {/* Owner demo note #165 (23 Nov): "Welcome to" in big letters, then X2F as the logo, much
              bigger, across the page, with no comma after it; the name below with a comma after it, and
              the paragraph right after. The heading reads "Welcome to X2F" (the logo's label). */}
          <h1 className="x2f-welcome__h1">
            <span className="x2f-welcome__to">Welcome to</span> <Logo height={160} className="x2f-welcome__logo" />
          </h1>
          <p className="x2f-welcome__name" data-part="welcome-name">
            <span data-username="">{name}</span>,
          </p>
          <p className="x2f-start__lead">{WELCOME_COPY.lead}</p>
          <p className="x2f-start__lead">{WELCOME_COPY.leadMore}</p>
        </section>
        {/* Owner demo note #168 (23 Nov): every login method X2F offers, a big green check or red
            cross each, ending in the level reached (#167: big, coloured by level). DESIGNER-REVIEW */}
        <section className="x2f-welcome__logins" aria-labelledby="welcome-logins-title">
          <h2 className="x2f-welcome__logins-title" id="welcome-logins-title">
            {WELCOME_COPY.loginsTitle}
          </h2>
          <ul className="x2f-welcome__rows" data-part="login-rows">
            {rows.map((m) => (
              <li key={m.id} className="x2f-welcome__row" data-part="method-row" data-method={m.id} data-set={m.set ? 'true' : 'false'}>
                <MethodMark set={m.set} />
                <span className="x2f-welcome__row-name">{m.word}</span>
                <span className="x2f-welcome__row-state" data-part="method-state">
                  {m.set ? WELCOME_COPY.methodSet : WELCOME_COPY.methodNotSet}
                </span>
                <LeaveLink target={m.id === 'recovery-codes' ? WELCOME_LINKS.recovery : WELCOME_LINKS.login} leave={leave} part={`method-link-${m.id}`} disabled={leaving}>
                  {m.set ? WELCOME_COPY.change : WELCOME_COPY.add}
                </LeaveLink>
              </li>
            ))}
          </ul>
          <div className="x2f-welcome__rating" data-part="security-rating" data-rating={rating}>
            <p className="x2f-welcome__rating-line" id="welcome-rating-title">
              {WELCOME_COPY.verdict} <span data-part="rating-word">{RATING_WORDS[rating]}</span>
            </p>
            {rating !== 'high' ? (
              <p className="x2f-welcome__rating-raise">
                {WELCOME_COPY.ratingRaise}{' '}
                <LeaveLink target={WELCOME_LINKS.rating} leave={leave} part="rating-link" disabled={leaving}>
                  {WELCOME_COPY.ratingLink}
                </LeaveLink>
              </p>
            ) : null}
          </div>
        </section>
        <ul className="x2f-welcome__checks" aria-label="Your payout wallet">
          <li className="x2f-welcome__check" data-part="check-wallet">
            <div className="x2f-welcome__what">
              <span className="x2f-welcome__title" data-part="check-title">{WELCOME_COPY.walletItem}</span>
              {c.wallet !== null ? (
                <span data-part="summary-wallet">
                  <bdi data-part="wallet-name">{c.wallet.name}</bdi>
                  {c.wallet.app !== null ? <span className="x2f-welcome__app" data-part="wallet-app">{` · ${c.wallet.app}`}</span> : null}{' '}
                  <span className="x2f-start__mono x2f-welcome__end">…{c.wallet.end}</span>
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
