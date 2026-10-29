// Plan 2 Task 17: the words for a refusal during the 24-hour cooling-off.
import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { coolingSentence, refusalText } from '../src/screens/auth/refusals.js';

describe('cooling-off refusals', () => {
  it('say what waits, until when, what still works and how to end it', () => {
    const until = '2026-10-30T14:05:00.000Z';
    for (const e of [new AuthApiError(403, 'cooling-off', { coolingUntil: until }), new ApiCallError(403, 'cooling-off', { coolingUntil: until })]) {
      const text = refusalText(e, 'fallback');
      expect(text).toBe(coolingSentence(until));
      expect(text).toContain('Trades already open can still be finished');
      expect(text).toContain('passkey, security key or PGP key');
    }
    expect(coolingSentence(undefined)).toContain('for a day');
  });
});
