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
      'Security key', 'Passkey', 'PGP key', 'Authenticator app', 'Password',
    ]);
    // What this setup just did counts before the account is read again.
    expect(loginMethodsBestFirst({ methods: [] }, { registered: true, method: 'password', backup: 'security-key' })).toEqual(['Security key', 'Password']);
    // A second PGP key as the backup.
    expect(loginMethodsBestFirst({ methods: ['pgp'] }, { registered: true, method: 'pgp', backup: 'pgp' })).toEqual(['PGP keys (2)']);
  });

  it('each item is done (one tick) only when it really is', () => {
    expect(checklist({ methods: ['pgp', 'recovery-codes'] }, [wallet()], fresh)).toEqual({
      logins: ['PGP key'], loginDone: true, recoveryDone: true, wallet: { app: 'Cake Wallet', end: 'k3Fz' },
    });
    // Opened only to add a wallet, with no recovery codes and no usable wallet yet.
    expect(checklist({ methods: ['password'] }, [wallet({ usable: false })], fresh)).toEqual({ logins: ['Password'], loginDone: true, recoveryDone: false, wallet: null });
    expect(checklist({ methods: [] }, [], fresh)).toMatchObject({ logins: [], loginDone: false });
    // The recovery codes made in this setup count before the account is read again.
    expect(checklist({ methods: ['password'] }, [], { registered: true, method: 'password', backup: 'recovery-codes' }).recoveryDone).toBe(true);
  });
});
