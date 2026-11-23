// @vitest-environment happy-dom
// The m-2 blocking fix (owner's demo notes, 13 Nov 2026): swiping Back from the recovery-code step
// left sign-up for the app. A marker in sessionStorage keeps the owed step until the code is saved.
import { afterEach, describe, expect, it } from 'vitest';
import { needsBackup, restoredState } from '../src/screens/setup/SetupFlow.js';
import { INITIAL } from '../src/screens/setup/kit.js';
import { backupRedirect, clearPendingSignup, readPendingSignup, writePendingSignup } from '../src/screens/setup/signupPending.js';

const pending = { displayName: 'Satoshi Fan', method: 'pgp' as const, methods: ['pgp' as const, 'password' as const], done: ['pgp' as const] };

afterEach(() => {
  clearPendingSignup();
});

describe('signup backup gate (m-2)', () => {
  it('a page outside /setup goes to the recovery-code step while this tab owes it', () => {
    writePendingSignup(pending);
    expect(backupRedirect('/welcome', { displayName: 'Satoshi Fan' })).toBe('/setup/backup');
    expect(backupRedirect('/', { displayName: 'Satoshi Fan' })).toBe('/setup/backup');
    expect(backupRedirect('/sell', { displayName: 'Satoshi Fan' })).toBe('/setup/backup');
  });

  it('never inside /setup, never for another account, never once the code is saved', () => {
    writePendingSignup(pending);
    expect(backupRedirect('/setup/backup', { displayName: 'Satoshi Fan' })).toBeNull();
    expect(backupRedirect('/setup', { displayName: 'Satoshi Fan' })).toBeNull();
    expect(backupRedirect('/welcome', { displayName: 'Someone Else' })).toBeNull();
    expect(backupRedirect('/welcome', null)).toBeNull();
    clearPendingSignup();
    expect(backupRedirect('/welcome', { displayName: 'Satoshi Fan' })).toBeNull();
  });

  it('the flow restarts at the owed step, with the methods still ticked', () => {
    expect(restoredState()).toEqual(INITIAL);
    writePendingSignup(pending);
    const s = restoredState();
    expect(s.registered).toBe(true);
    expect(needsBackup(s)).toBe(true);
    expect(s.methods).toEqual(['pgp', 'password']);
    expect(s.done).toEqual(['pgp']);
  });

  it('keeps no secret, and ignores a marker it cannot read', () => {
    writePendingSignup(pending);
    expect(JSON.parse(window.sessionStorage.getItem('x2f.signup.backup-pending')!)).toEqual(pending);
    window.sessionStorage.setItem('x2f.signup.backup-pending', '{"displayName":1}');
    expect(readPendingSignup()).toBeNull();
    window.sessionStorage.setItem('x2f.signup.backup-pending', 'not json');
    expect(readPendingSignup()).toBeNull();
  });
});
