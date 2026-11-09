/**
 * Shared parts of the Getting started screens (Task 28): the flow's in-memory state and its
 * context, the step paths, and the frame every setup board shares.
 */
import { createContext, useContext, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { WalletApp } from '@x2f/auth-client';
import { Icon } from '../../ui/icons.js';
import type { RegisterPgpStart, SetupError } from './register.js';
import './setup.css';

export type LoginMethod = 'pgp' | 'passkey' | 'security-key' | 'password';
/** No authenticator app: it is no backup login (design build gaps Job 1). */
export type BackupChoice = 'security-key' | 'pgp' | 'recovery-codes';
export type Step = '' | 'name' | 'display-name' | 'login' | 'pgp-key' | 'pgp-code' | 'password' | 'backup' | 'wallet' | 'welcome';

export interface SetupState {
  /** The Terms version accepted on the first screen; sent as `acceptedTerms` with the register call. */
  terms: string | null;
  displayName: string;
  loginName: string;
  method: LoginMethod;
  publicKey: string;
  challenge: RegisterPgpStart | null;
  registered: boolean;
  backup: BackupChoice | null;
  wallet: { app: WalletApp; addressEnd: string } | null;
}

export const INITIAL: SetupState = {
  terms: null,
  displayName: '',
  loginName: '',
  method: 'pgp',
  publicKey: '',
  challenge: null,
  registered: false,
  backup: null,
  wallet: null,
};

export interface SetupApi {
  state: SetupState;
  update: (patch: Partial<SetupState>) => void;
  returnTo: string;
  /** Goes to a step, keeping `returnTo`; `replace` for the step after a sign-up (Back never returns to it). */
  go: (step: Step, o?: { replace?: boolean }) => void;
  path: (step: Step) => string;
}

export const SetupContext = createContext<SetupApi | null>(null);

export function useSetup(): SetupApi {
  const api = useContext(SetupContext);
  if (api === null) throw new Error('useSetup outside SetupFlow');
  return api;
}

/** `/setup/<step>?returnTo=…`; `returnTo` has already been through safeReturnTo. */
export function stepPath(step: Step, returnTo: string): string {
  return `/setup${step === '' ? '' : `/${step}`}?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * The frame every setup board shares: the back arrow, "Set up your account", "Step N of 5", the
 * five-part progress bar and "Takes about 2 minutes.", then the screen, then its buttons at the
 * bottom. `fit` keeps the whole frame in the viewport (the Terms box scrolls inside it).
 */
export function SetupFrame({
  screen,
  step,
  back,
  title = 'Set up your account',
  fit = false,
  footer,
  children,
}: {
  screen: string;
  step?: 1 | 2 | 3 | 4 | 5;
  back?: string;
  title?: string;
  fit?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={fit ? 'x2f-start x2f-start--fit' : 'x2f-start'} data-screen={screen}>
      <header className="x2f-start__head">
        <div className="x2f-start__bar">
          {back !== undefined ? (
            <Link className="x2f-icon-button x2f-start__back" to={back} aria-label="Back">
              <Icon name="chevron-left" />
            </Link>
          ) : (
            <span className="x2f-start__nobar" aria-hidden="true" />
          )}
          <span className="x2f-start__title">{title}</span>
          {step !== undefined ? <span className="x2f-start__step">Step {step} of 5</span> : null}
        </div>
        {step !== undefined ? (
          <>
            <div className="x2f-start__progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="x2f-start__seg" data-on={i <= step ? 'true' : 'false'} />
              ))}
            </div>
            <span className="x2f-start__time">Takes about 2 minutes.</span>
          </>
        ) : null}
      </header>
      <main className="x2f-start__main">{children}</main>
      <footer className="x2f-start__foot">{footer}</footer>
    </div>
  );
}

/** The screen's heading and the sentence under it. */
export function SetupIntro({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <section className="x2f-start__intro">
      <h1 className="x2f-start__h1">{title}</h1>
      {children !== undefined ? <p className="x2f-start__lead">{children}</p> : null}
    </section>
  );
}

/**
 * A refused register call. A name problem links back to the screen of the name to change (review
 * F8: a display-name refusal to the display-name screen, any other to the username; what they typed is kept);
 * a key already on another account links back to the key screen and to Log in (review I1).
 */
export function RegisterError({ error }: { error: SetupError | null }) {
  const { path, returnTo } = useSetup();
  if (error === null) return null;
  return (
    <p className="x2f-error" role="alert" data-part="register-error">
      {error.text}
      {error.names ? (
        <>
          {' '}
          <Link className="x2f-link" to={path(error.names)} data-part="change-names">
            Change your names
          </Link>
        </>
      ) : null}
      {error.keyInUse ? (
        <>
          {' '}
          <Link className="x2f-link" to={path('pgp-key')} replace data-part="other-key">
            Use a different key
          </Link>{' '}
          <Link className="x2f-link" to={`/login?returnTo=${encodeURIComponent(returnTo)}`} data-part="key-login">
            Log in
          </Link>
        </>
      ) : null}
    </p>
  );
}

/**
 * The props of option `i` in a group of `role="radio"` buttons (review M8, the ARIA radio pattern):
 * only the picked option is a tab stop, and the arrow keys move the pick and the focus, wrapping.
 */
export function radioProps<T>(ids: readonly T[], value: T, set: (v: T) => void, i: number) {
  const id = ids[i]!;
  return {
    role: 'radio' as const,
    'aria-checked': id === value,
    tabIndex: id === value ? 0 : -1,
    onClick: () => set(id),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (d === 0) return;
      e.preventDefault();
      const n = (i + d + ids.length) % ids.length;
      set(ids[n]!);
      const group = e.currentTarget.closest('[role="radiogroup"]');
      group?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
    },
  };
}
