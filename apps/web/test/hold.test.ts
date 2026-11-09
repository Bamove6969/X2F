// Plan 2 Tasks 16-17: the words for the 24-hour hold, a change that waits it out, and the login
// refusals shown through CantDoThat (Plan 5 Task 21).
import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { holdLoginSentence, holdSentence, utcTime, loginCantDo, refusalText, weakSessionCantDo } from '../src/screens/auth/refusals.js';
import { TOO_MANY_APPROVALS, WEAK_SESSION_TEXT, holdText, teamCantDoText } from '../src/ui/cantDoCodes.js';
import { ruleLines, ruleNote } from '../src/screens/wallets-model.js';
import { walletWaitNote } from '../src/screens/auth/ConfirmSheet.js';
import { HOLD_COPY } from '../src/screens/settings/holdCopy.js';

const UNTIL = '2026-10-30T14:05:00.000Z';

describe('the 24-hour hold', () => {
  it('one sentence for a held backup session and the account hold, from either client', () => {
    for (const e of [new AuthApiError(403, 'recovery-hold', { holdUntil: UNTIL }), new ApiCallError(403, 'recovery-hold', { holdUntil: UNTIL })]) {
      expect(refusalText(e, 'fallback')).toBe(holdSentence(UNTIL));
    }
  });

  it('hold v3: a staged change is a draft; the review says the 24-hour wait and how a strong login throws it away', () => {
    expect(HOLD_COPY.staged).toBe('Saved as a draft. Nothing changes until you submit it.');
    expect(HOLD_COPY.waitBody).toContain('Every change, removals included, applies after 24 h');
    expect(HOLD_COPY.throwAway).toContain('approve them at once, cancel them or change them');
    expect(HOLD_COPY.submitted(UNTIL)).toBe(`Submitted. Your changes take effect on ${utcTime(new Date(UNTIL))}.`);
  });
});

describe('loginCantDo', () => {
  it('the device limit is never a CantDoThat: approving opens the chooser, a login is never refused by it (round 3 R3-M4)', () => {
    const e = new AuthApiError(409, 'too-many-devices');
    // The chooser handles the device limit (C2-D1 review N2): no CantDoThat for it.
    expect(loginCantDo(e, 'approve')).toBeNull();
    expect(loginCantDo(e, 'login')).toBeNull();
  });

  it('round 3 R3-M3: a login refused during the hold says this login cannot get in until it ends, and what the reader can do', () => {
    const t = loginCantDo(new AuthApiError(403, 'recovery-hold', { holdUntil: UNTIL }), 'login');
    expect(t).toEqual({ code: 'recovery-hold', text: holdLoginSentence(UNTIL) });
    expect(t!.text).toContain(`This login can't get in until ${utcTime(new Date(UNTIL))}.`);
    expect(t!.text).toContain('If not, wait and log in again when the hold ends.');
    expect(t!.text).toContain('If you had a passkey, a security key or a PGP key set up before the hold');
    // Nothing it cannot keep: this login finishes no trades, and the account's held changes are not the reader's to make here.
    expect(t!.text).not.toContain('can still be finished');
    expect(t!.text).not.toContain('wallet changes');
    expect(holdLoginSentence(null)).toContain("This login can't get in for a day.");
  });

  it('lead review 8 Nov: it promises no backup login meanwhile (the used code is spent, the new one sealed) and says open trades wait', () => {
    const t = holdLoginSentence(UNTIL);
    expect(t).not.toContain('backup login');
    expect(t).not.toContain('finish trades');
    expect(t).toContain('Your open trades are paused until the hold ends or a moderator decides.');
  });

  it('the hourly cap on approvals, but not a throttle on tries', () => {
    expect(loginCantDo(new AuthApiError(429, 'slow-down', { retryAfterSeconds: 60, reason: 'approvals' }), 'login')).toEqual({
      code: 'too-many-approvals', text: TOO_MANY_APPROVALS,
    });
    expect(loginCantDo(new AuthApiError(429, 'slow-down', { retryAfterSeconds: 60 }), 'login')).toBeNull();
  });

  it('the hold when approving keeps blocking on offer', () => {
    expect(loginCantDo(new AuthApiError(403, 'recovery-hold', { holdUntil: UNTIL }), 'approve')?.text).toContain('you can still block this login');
  });

  it('round 2 N-I3: a session whose login waits cannot answer a strong login, nor log a stronger device out', () => {
    expect(loginCantDo(new AuthApiError(403, 'weak-session'), 'approve')).toEqual({ code: 'weak-session', text: WEAK_SESSION_TEXT });
    for (const e of [new AuthApiError(403, 'weak-session'), new ApiCallError(403, 'weak-session', {})]) {
      expect(weakSessionCantDo(e)).toEqual({ code: 'weak-session', text: WEAK_SESSION_TEXT });
    }
    expect(weakSessionCantDo(new AuthApiError(404, 'not-found'))).toBeNull();
  });

  it('anything else is worded inline as before', () => {
    expect(loginCantDo(new AuthApiError(401, 'credentials-invalid'), 'login')).toBeNull();
    expect(loginCantDo(new Error('x'), 'login')).toBeNull();
  });
});

describe('owner 6 Nov 2026: Q14 wording and Q81 (a PGP key login is strong)', () => {
  const NOT_PASSWORD_ONLY = /password[- ](?:only|alone)|only (?:have )?(?:a|your) password|only one way of proving/i;
  const waitRule = { firstWallet: false, strongMethods: [], password: 'waits' as const, waitHours: 24 };
  const texts = (): string[] => [
    holdText('until Tue 3:05 PM'),
    holdSentence(UNTIL),
    holdLoginSentence(UNTIL),
    HOLD_COPY.waitBody,
    HOLD_COPY.throwAway,
    WEAK_SESSION_TEXT,
    teamCantDoText('weak-session'),
    ...ruleLines(waitRule),
    ruleNote(waitRule),
    walletWaitNote(waitRule, false),
    walletWaitNote(waitRule, true),
  ];

  it('Q14: never "password only" or "password alone": it is a username and password at minimum', () => {
    for (const t of texts()) expect(t).not.toMatch(NOT_PASSWORD_ONLY);
    expect(HOLD_COPY.waitBody).toContain('You logged in with just a username and password');
    expect(WEAK_SESSION_TEXT).toContain('This device logged in with just a username and password');
  });

  it('Q81: a PGP key counts wherever a strong login is named', () => {
    expect(WEAK_SESSION_TEXT).toContain('a passkey, a security key, a PGP key, or your username, password and authenticator code');
    expect(teamCantDoText('weak-session')).toContain('a passkey, a security key, a PGP key, or your username, password and authenticator code');
  });

  it('hold v3: only a passkey, security key or PGP key held before ends the hold or cancels a waiting change (an authenticator code does not)', () => {
    for (const t of [holdText('for a day'), HOLD_COPY.throwAway, holdLoginSentence(UNTIL)]) {
      expect(t).toMatch(/a passkey, a security key or a PGP key/);
      expect(t).not.toContain('authenticator');
    }
  });
});
