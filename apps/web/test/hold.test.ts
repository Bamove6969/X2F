// Plan 2 Tasks 16-17: the words for the 24-hour hold, a change that waits it out, and the login
// refusals shown through CantDoThat (Plan 5 Task 21).
import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { heldNote, holdLoginSentence, holdSentence, localTime, loginCantDo, refusalText, weakSessionCantDo } from '../src/screens/auth/refusals.js';
import { TOO_MANY_APPROVALS, TOO_MANY_DEVICES_APPROVE, WEAK_SESSION_TEXT } from '../src/ui/cantDoCodes.js';

const UNTIL = '2026-10-30T14:05:00.000Z';

describe('the 24-hour hold', () => {
  it('one sentence for a held backup session and the account hold, from either client', () => {
    for (const e of [new AuthApiError(403, 'recovery-hold', { holdUntil: UNTIL }), new ApiCallError(403, 'recovery-hold', { holdUntil: UNTIL })]) {
      expect(refusalText(e, 'fallback')).toBe(holdSentence(UNTIL));
    }
  });

  it('a change that waits says when it takes effect and how to cancel it', () => {
    const t = heldNote(UNTIL);
    expect(t).toContain(`takes effect at ${localTime(new Date(UNTIL))}`);
    expect(t).toContain('cancels it');
    expect(heldNote('broken')).toContain('takes effect in a day');
  });
});

describe('loginCantDo', () => {
  it('the device limit when approving; a login is never refused by it (round 3 R3-M4: no login text)', () => {
    const e = new AuthApiError(409, 'too-many-devices');
    expect(loginCantDo(e, 'approve')).toEqual({ code: 'too-many-devices', text: TOO_MANY_DEVICES_APPROVE });
    expect(loginCantDo(e, 'login')).toBeNull();
  });

  it('round 3 R3-M3: a login refused during the hold says this login cannot get in until it ends, and what the reader can do', () => {
    const t = loginCantDo(new AuthApiError(403, 'recovery-hold', { holdUntil: UNTIL }), 'login');
    expect(t).toEqual({ code: 'recovery-hold', text: holdLoginSentence(UNTIL) });
    expect(t!.text).toContain(`This login can't get in until ${localTime(new Date(UNTIL))}.`);
    expect(t!.text).toContain('If not, wait and log in again when the hold ends.');
    expect(t!.text).toContain('If you had a passkey, a security key, or an authenticator code set up before the hold');
    // Nothing it cannot keep: this login finishes no trades, and the account's held changes are not the reader's to make here.
    expect(t!.text).not.toContain('can still be finished');
    expect(t!.text).not.toContain('wallet changes');
    expect(holdLoginSentence(null)).toContain("This login can't get in for a day.");
  });

  it('round 4 R4-M3: it says a backup login uses up a recovery code and makes the hold longer', () => {
    const t = holdLoginSentence(UNTIL);
    expect(t).toContain('With a recovery code you can use a backup login in the meantime to finish trades already open.');
    expect(t).toContain('A backup login uses up that recovery code and makes the hold last 24 hours from then.');
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
