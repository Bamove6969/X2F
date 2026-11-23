// Owner demo notes of 12 Nov 2026 (owner-demo-notes-2026-11-12.jsonl), in his own words with the
// typos fixed: the session-length hints and the setup Welcome screen's lead line and checklist.
// COPY-UNSIGNED and DESIGNER-REVIEW: design restyles both screens.
import { describe, expect, it } from 'vitest';
import type { Wallet } from '@x2f/auth-client';
import { SESSION_COPY } from '../src/screens/auth/sessionCopy.js';
import { WELCOME_COPY, checklist, loginMethodsBestFirst } from '../src/screens/setup/Welcome.js';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: 'w1', app: 'cake', label: 'Wallet 1', address: `4${'9'.repeat(90)}k3Fz`, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true, ...over,
});
const fresh = { registered: false, method: 'pgp' as const, backup: null };

describe('/session-length (owner, 12 Nov)', () => {
  it('names the alert sounds "Nudges", says why a logout happens, and where to change it', () => {
    expect(SESSION_COPY.sleepHint).toBe("Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds (\"Nudges\") so a new trade wakes you.");
    expect(SESSION_COPY.askHint).toBe(
      "When this time is up, we'll ask you to confirm it's you to stay logged in. If you are unable to confirm your identity at that time, your account will be logged out for your security.",
    );
    expect(`${SESSION_COPY.changeBefore}${SESSION_COPY.changeLink}${SESSION_COPY.changeAfter}`).toBe('You can change this any time in Settings under Devices and Sessions.');
  });
});

describe('/setup/welcome (owner, 12 Nov)', () => {
  it('the lead line, the line under the checklist and the fee note are his words, typos fixed', () => {
    expect(WELCOME_COPY.lead).toBe(
      'Your account is ready. Trade Monero for cash, bank transfers, gift cards, or whatever payment method you choose, with every trade protected by escrow. If the site is missing a payment method, please leave feedback so we can add it quickly: include what detail you can, or a link with information on it.',
    );
    expect(WELCOME_COPY.loginItem).toBe('Configured your secure methods of logging into X2F');
    expect(WELCOME_COPY.recoveryItem).toBe('Emergency login method: recovery code documented');
    expect(WELCOME_COPY.walletItem).toBe('Connected your wallet');
    expect(WELCOME_COPY.changeLater).toBe('Any information provided above can be changed later in Settings.');
    expect(WELCOME_COPY.nextLogin).toBe("Next, you'll log in for the first time and try the security methods you set up, which will welcome you to the X2F experience.");
    expect(WELCOME_COPY.fee).toBe('Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.');
  });

  it('lists the login methods best to worst, never the recovery codes (their own item)', () => {
    expect(loginMethodsBestFirst({ methods: ['password', 'totp', 'pgp', 'recovery-codes', 'passkey', 'security-key'] }, fresh)).toEqual([
      'Security key', 'Passkey', 'PGP key', 'Authenticator app', 'Username and password',
    ]);
    // What this setup just did counts before the account is read again.
    expect(loginMethodsBestFirst({ methods: [] }, { registered: true, method: 'password', backup: 'security-key' })).toEqual(['Security key', 'Username and password']);
    // A second PGP key as the backup.
    expect(loginMethodsBestFirst({ methods: ['pgp'] }, { registered: true, method: 'pgp', backup: 'pgp' })).toEqual(['PGP keys (2)', 'Username']);
  });

  it('each item is done (one tick) only when it really is', () => {
    expect(checklist({ methods: ['pgp', 'recovery-codes'] }, [wallet()], fresh)).toEqual({
      logins: ['PGP key', 'Username'], loginDone: true, recoveryDone: true, wallet: { app: 'Cake Wallet', end: 'k3Fz' },
    });
    // Opened only to add a wallet, with no recovery codes and no usable wallet yet.
    expect(checklist({ methods: ['password'] }, [wallet({ usable: false })], fresh)).toEqual({ logins: ['Username and password'], loginDone: true, recoveryDone: false, wallet: null });
    expect(checklist({ methods: [] }, [], fresh)).toMatchObject({ logins: [], loginDone: false });
    // The recovery codes made in this setup count before the account is read again.
    expect(checklist({ methods: ['password'] }, [], { registered: true, method: 'password', backup: 'recovery-codes' }).recoveryDone).toBe(true);
  });
});

// The rules of the old Welcome rows (`summarize`, task28-units.test.tsx), carried into the checklist.
describe('carried over from summarize() (lead check, 12 Nov)', () => {
  it('reads the flow first: the method just set up, the recovery codes just made, the wallet', () => {
    // was: summarize(password + recovery-codes, flow password/recovery-codes) -> Password, Recovery codes, Cake Wallet …k3Fz
    expect(checklist({ methods: ['password', 'recovery-codes'] }, [wallet()], { registered: true, method: 'password', backup: 'recovery-codes' })).toEqual({
      logins: ['Username and password'], loginDone: true, recoveryDone: true, wallet: { app: 'Cake Wallet', end: 'k3Fz' },
    });
    // was: a second PGP key from the flow -> "Second PGP key"
    expect(checklist({ methods: ['pgp'] }, [], { registered: true, method: 'pgp', backup: 'pgp' }).logins).toEqual(['PGP keys (2)', 'Username']);
  });

  it('a reload without the flow state still reads the account', () => {
    // was: pgp + security-key -> PGP key, backup Security key
    expect(checklist({ methods: ['pgp', 'security-key'] }, [], fresh)).toMatchObject({ logins: ['Security key', 'PGP key', 'Username'], loginDone: true, recoveryDone: false, wallet: null });
    // was: security-key alone -> backup None yet
    expect(checklist({ methods: ['security-key'] }, [], fresh)).toMatchObject({ logins: ['Security key', 'Username'], recoveryDone: false });
    // was: password + recovery-codes -> backup Recovery codes
    expect(checklist({ methods: ['password', 'recovery-codes'] }, [], fresh)).toMatchObject({ logins: ['Username and password'], recoveryDone: true });
    // was: no methods -> None yet, None yet
    expect(checklist({ methods: [] }, [], fresh)).toEqual({ logins: [], loginDone: false, recoveryDone: false, wallet: null });
  });

  it('an authenticator app is never the backup or emergency login (design build gaps Job 1)', () => {
    // was: password + totp -> backup None yet. The app is listed only as a login method (a password's second step).
    const c = checklist({ methods: ['password', 'totp'] }, [], fresh);
    expect(c.recoveryDone).toBe(false);
    expect(c.logins).toEqual(['Authenticator app', 'Username and password']);
  });

  it('the methods are ordered best to worst whatever order the account lists them in', () => {
    expect(loginMethodsBestFirst({ methods: ['password', 'pgp', 'security-key'] }, fresh)).toEqual(['Security key', 'PGP key', 'Username and password']);
    expect(loginMethodsBestFirst({ methods: ['totp', 'passkey', 'password'] }, fresh)).toEqual(['Passkey', 'Authenticator app', 'Username and password']);
  });

  it('only a usable wallet is ever shown, never one still waiting', () => {
    // was: "You get paid to" shows only a usable wallet
    expect(checklist({ methods: ['pgp'] }, [wallet({ usable: false })], fresh).wallet).toBeNull();
    expect(checklist({ methods: ['pgp'] }, [wallet({ usable: false }), wallet({ app: 'edge', addressEnd: 'Q9x2', usable: true })], fresh).wallet).toEqual({ app: 'Edge', end: 'Q9x2' });
  });
});
