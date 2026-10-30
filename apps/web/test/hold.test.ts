// Plan 2 Tasks 16-17: the words for the 24-hour hold, a change that waits it out, and the login
// refusals shown through CantDoThat (Plan 5 Task 21).
import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { heldNote, holdSentence, localTime, loginCantDo, refusalText } from '../src/screens/auth/refusals.js';
import { TOO_MANY_APPROVALS, TOO_MANY_DEVICES_APPROVE, TOO_MANY_DEVICES_LOGIN } from '../src/ui/cantDoCodes.js';

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
  it('the device limit, on a login and when approving', () => {
    const e = new AuthApiError(409, 'too-many-devices');
    expect(loginCantDo(e, 'login')).toEqual({ code: 'too-many-devices', text: TOO_MANY_DEVICES_LOGIN });
    expect(loginCantDo(e, 'approve')).toEqual({ code: 'too-many-devices', text: TOO_MANY_DEVICES_APPROVE });
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

  it('anything else is worded inline as before', () => {
    expect(loginCantDo(new AuthApiError(401, 'credentials-invalid'), 'login')).toBeNull();
    expect(loginCantDo(new Error('x'), 'login')).toBeNull();
  });
});
