// @vitest-environment happy-dom
// Owner demo notes of 12 Nov 2026 (owner-demo-notes-2026-11-12.jsonl), in his own words with the
// typos fixed: the session-length hints and the setup Welcome screen's lead line and checklist.
// COPY-UNSIGNED and DESIGNER-REVIEW: design restyles both screens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Wallet } from '@x2f/auth-client';
import { SESSION_COPY } from '../src/screens/auth/sessionCopy.js';
import * as WelcomeModule from '../src/screens/setup/Welcome.js';
import { Tick, WELCOME_COPY, checklist, loginMethodsBestFirst } from '../src/screens/setup/Welcome.js';
import { render } from './render.js';

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
    // Owner demo note #166 (23 Nov): his two paragraphs replace the 12 Nov lead.
    expect(WELCOME_COPY.lead).toBe('Your account is ready. Buy and sell Monero using cash, bank transfers, gift cards, or any payment method you prefer, with every trade protected by 2-of-3 escrow.');
    expect(WELCOME_COPY.leadMore).toBe('Don’t see your preferred payment method? Send us feedback with as many details as you can (or a link with more info) so we can get it added quickly.');
    // Owner demo note #168 (23 Nov): the 12 Nov checklist became every login method under one heading.
    expect(WELCOME_COPY.loginsTitle).toBe('Secure X2F login methods');
    // Owner 27 Nov 2026: no level line (no low, medium and high security any more).
    expect(WELCOME_COPY).not.toHaveProperty('verdict');
    expect(WELCOME_COPY.walletItem).toBe('Payout wallet:');
    expect(WELCOME_COPY.changeLater).toBe('Any information provided above can be changed later in Settings.');
    expect(WELCOME_COPY.nextLogin).toBe("Next, you'll log in for the first time and try the security methods you set up, which will welcome you to the X2F experience.");
    expect(WELCOME_COPY.fee).toBe('Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.');
  });

  it('lists the login methods best to worst, never the recovery codes (their own item)', () => {
    expect(loginMethodsBestFirst({ methods: ['totp', 'pgp', 'recovery-codes', 'passkey', 'security-key'] }, fresh)).toEqual([
      'Security key', 'Passkey', 'PGP key', 'Authenticator app', 'Username',
    ]);
    // What this setup just did counts before the account is read again.
    expect(loginMethodsBestFirst({ methods: [] }, { registered: true, method: 'passkey', backup: 'security-key' })).toEqual(['Security key', 'Passkey', 'Username']);
    // A second PGP key as the backup.
    expect(loginMethodsBestFirst({ methods: ['pgp'] }, { registered: true, method: 'pgp', backup: 'pgp' })).toEqual(['PGP keys (2)', 'Username']);
  });

  it('each item is done (one tick) only when it really is', () => {
    // Owner demo note #226: the wallet's own name first, then its app.
    expect(checklist({ methods: ['pgp', 'recovery-codes'] }, [wallet()], fresh)).toEqual({
      logins: ['PGP key', 'Username'], loginDone: true, recoveryDone: true, wallet: { name: 'Wallet 1', app: 'Cake Wallet', end: 'k3Fz' },
    });
    // Opened only to add a wallet, with no recovery codes and no usable wallet yet.
    expect(checklist({ methods: ['passkey'] }, [wallet({ usable: false })], fresh)).toEqual({ logins: ['Passkey', 'Username'], loginDone: true, recoveryDone: false, wallet: null });
    expect(checklist({ methods: [] }, [], fresh)).toMatchObject({ logins: [], loginDone: false });
    // The recovery codes made in this setup count before the account is read again.
    expect(checklist({ methods: ['passkey'] }, [], { registered: true, method: 'passkey', backup: 'recovery-codes' }).recoveryDone).toBe(true);
  });
});

// The rules of the old Welcome rows (`summarize`, task28-units.test.tsx), carried into the checklist.
describe('carried over from summarize() (lead check, 12 Nov)', () => {
  it('reads the flow first: the method just set up, the recovery codes just made, the wallet', () => {
    expect(checklist({ methods: ['passkey', 'recovery-codes'] }, [wallet()], { registered: true, method: 'passkey', backup: 'recovery-codes' })).toEqual({
      logins: ['Passkey', 'Username'], loginDone: true, recoveryDone: true, wallet: { name: 'Wallet 1', app: 'Cake Wallet', end: 'k3Fz' },
    });
    // was: a second PGP key from the flow -> "Second PGP key"
    expect(checklist({ methods: ['pgp'] }, [], { registered: true, method: 'pgp', backup: 'pgp' }).logins).toEqual(['PGP keys (2)', 'Username']);
  });

  it('a reload without the flow state still reads the account', () => {
    // was: pgp + security-key -> PGP key, backup Security key
    expect(checklist({ methods: ['pgp', 'security-key'] }, [], fresh)).toMatchObject({ logins: ['Security key', 'PGP key', 'Username'], loginDone: true, recoveryDone: false, wallet: null });
    // was: security-key alone -> backup None yet
    expect(checklist({ methods: ['security-key'] }, [], fresh)).toMatchObject({ logins: ['Security key', 'Username'], recoveryDone: false });
    expect(checklist({ methods: ['passkey', 'recovery-codes'] }, [], fresh)).toMatchObject({ logins: ['Passkey', 'Username'], recoveryDone: true });
    // was: no methods -> None yet, None yet
    expect(checklist({ methods: [] }, [], fresh)).toEqual({ logins: [], loginDone: false, recoveryDone: false, wallet: null });
  });

  it('an authenticator app is never the backup or emergency login (design build gaps Job 1)', () => {
    const c = checklist({ methods: ['pgp', 'totp'] }, [], fresh);
    expect(c.recoveryDone).toBe(false);
    expect(c.logins).toEqual(['PGP key', 'Authenticator app', 'Username']);
  });

  it('the methods are ordered best to worst whatever order the account lists them in', () => {
    expect(loginMethodsBestFirst({ methods: ['totp', 'pgp', 'security-key'] }, fresh)).toEqual(['Security key', 'PGP key', 'Authenticator app', 'Username']);
    expect(loginMethodsBestFirst({ methods: ['totp', 'passkey'] }, fresh)).toEqual(['Passkey', 'Authenticator app', 'Username']);
  });

  it('only a usable wallet is ever shown, never one still waiting', () => {
    // was: "You get paid to" shows only a usable wallet
    expect(checklist({ methods: ['pgp'] }, [wallet({ usable: false })], fresh).wallet).toBeNull();
    expect(checklist({ methods: ['pgp'] }, [wallet({ usable: false }), wallet({ app: 'edge', addressEnd: 'Q9x2', usable: true })], fresh).wallet).toEqual({ name: 'Wallet 1', app: 'Edge', end: 'Q9x2' });
  });
});

// Review 12 Nov (owner-copy-1 minors, done on wip/lead-owner-ui).
describe('/setup/welcome: the review minors', () => {
  it('C1: an item not done yet says so to a screen reader, as a done one says Done', () => {
    const done = render(<Tick done />).host.firstElementChild!;
    expect([done.getAttribute('role'), done.getAttribute('aria-label'), done.getAttribute('data-part')]).toEqual(['img', 'Done', 'tick']);
    const open = render(<Tick done={false} />).host.firstElementChild!;
    expect([open.getAttribute('role'), open.getAttribute('aria-label'), open.getAttribute('data-part')]).toEqual(['img', 'Not done yet', 'tick-open']);
    expect(open.getAttribute('aria-hidden')).toBeNull();
    expect(WELCOME_COPY.notDone).toBe('Not done yet');
  });

  // C2 used the escrow teal while the tokens had no green; the `good` token (goodToken.test) is that
  // green now, so the ticks are green as the owner asked (12 Nov #34; wip/agy-layout).
  it('C2: the ticks use the kit green token, not hard-coded greens', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/setup/setup.css'), 'utf8');
    expect(css).not.toMatch(/#3ccf7a|#1a7f45|--x2f-welcome-done/i);
    const tick = /\.x2f-welcome__tick\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(tick).toContain('background: var(--x2f-good);');
  });

  it('C3: Welcome no longer exports the fee sentence it stopped showing (PostOffer keeps its own)', () => {
    expect('FEE_SENTENCE' in WelcomeModule).toBe(false);
  });
});
