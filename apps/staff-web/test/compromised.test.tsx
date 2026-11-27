// @vitest-environment happy-dom
// "My account has been compromised" reports on the staff site (owner D-059; J-14 ported; no board:
// DESIGN not drawn, COPY-UNSIGNED), under Accounts: the list, a report, Unlock (an `unlock-account`
// tap bound to the account and the report) and Close (refused while still locked).
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { CompromisedCase, CompromisedItem } from '../src/api.js';
import { LOCK_SKIP_WORDS } from '../src/screens/Compromised.js';
import { button, cleanup, click, fakeApi, honestTapStart, refused, render, settle } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const ends = () => new Date(Date.now() + 3_600_000).toISOString();
const SENIOR = { tradeTag: 'sarah.v', role: 'senior', nav: NAV.senior, sessionEndsAt: ends() };
const ID = '11111111-1111-4111-8111-111111111111';
const ACCT = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const AT = new Date(Date.now() - 2 * 3_600_000).toISOString();
const TAPS = { 'POST /staff/v1/taps/start': honestTapStart('tap-1'), 'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } } };

const item = (o: Partial<CompromisedItem> = {}): CompromisedItem => ({
  id: ID, number: 1042, status: 'open', methodsLeft: ['passkey'], lockSkipped: null, createdAt: AT, closedAt: null, matched: true, tradeTag: 'harbor_lin', locked: true, ...o,
});
const report = (o: Partial<CompromisedCase> = {}): CompromisedCase => ({
  id: ID, number: 1042, status: 'open', methodsLeft: ['passkey', 'recovery-code'], lockSkipped: null, createdAt: AT, closedAt: null, comment: 'They took my phone.',
  account: { id: ACCT, tradeTag: 'harbor_lin', kind: 'trader', team: null, createdAt: AT, lockedAt: AT, openTrades: [{ code: '7RWD3MXEKQ84HN2T', state: 'funded', side: 'seller', paused: true }] },
  ...o,
});

const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('Compromised account reports (D-059)', () => {
  it('Accounts links to the list; the list shows CT-<number>, the account and the lock, never the comment', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: SENIOR }, 'GET /staff/v1/compromised': { body: { items: [item(), item({ id: '22222222-2222-4222-8222-222222222222', number: 1043, matched: false, tradeTag: null, locked: false })] } } });
    await open('/accounts');
    expect(part('compromised-reports')?.getAttribute('href')).toBe('/accounts/compromised');
    await click(part('compromised-reports'));
    const text = document.querySelector('[data-screen="compromised-list"]')!.textContent!;
    expect(text).toContain('CT-1042');
    expect(text).toContain('harbor_lin');
    expect(text).toContain('No account matched');
    expect(text).not.toContain('phone');
  });

  it('a report shows what the sender ticked and wrote, the account and its paused trades; Unlock taps unlock-account; Close waits for the unlock', async () => {
    let locked = true;
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/compromised/:id': () => ({ body: report(locked ? {} : { account: { ...report().account!, lockedAt: null } }) }),
      ...TAPS,
      'POST /staff/v1/compromised/:id/unlock': () => {
        locked = false;
        return { body: { status: 'unlocked' } };
      },
      'POST /staff/v1/compromised/:id/close': refused(409, 'account-locked'),
    });
    await open(`/accounts/compromised/${ID}`);
    expect(part('report-sender')?.textContent).toContain('Passkey, Recovery code');
    expect(part('report-sender')?.textContent).toContain('They took my phone.');
    expect(part('report-account')?.textContent).toContain('7RWD3MXEKQ84HN2T');
    expect((part('report-close') as HTMLButtonElement).disabled).toBe(true);
    await click(part('report-unlock'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('can log in again');
    await click(button('Tap security key'));
    await settle();
    expect(api.calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body)).toEqual([{ kind: 'unlock-account', accountId: ACCT, ticketId: ID }]);
    expect(api.calls.find((c) => c.path.endsWith('/unlock'))).toMatchObject({ method: 'POST', path: `/staff/v1/compromised/${ID}/unlock`, body: { tapId: 'tap-1' } });
    expect(part('report-done')?.textContent).toContain('unlocked');
    expect(part('report-unlock')).toBeNull();
    expect(part('report-lock')?.textContent).toBe('Not locked');
    api.set('POST /staff/v1/compromised/:id/close', { body: { ...report(), status: 'closed' } });
    await click(part('report-close'));
    expect(api.calls.some((c) => c.method === 'POST' && c.path.endsWith('/close'))).toBe(true);
  });

  it('a report that matched an account but locked nothing says why (review items 1, 3, 4), with no Unlock', async () => {
    for (const why of ['recent-unlock', 'legacy-login-name', 'lock-cap'] as const) {
      fakeApi({ 'GET /staff/v1/me': { body: SENIOR }, 'GET /staff/v1/compromised/:id': { body: report({ lockSkipped: why, account: { ...report().account!, lockedAt: null } }) } });
      await open(`/accounts/compromised/${ID}`);
      expect(part('report-lock-skipped')?.textContent).toBe(LOCK_SKIP_WORDS[why]);
      expect(part('report-unlock')).toBeNull();
      expect((part('report-close') as HTMLButtonElement).disabled).toBe(false);
      cleanup();
    }
  });

  it('a report that matched no account says nothing was locked and offers Close only', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: SENIOR }, 'GET /staff/v1/compromised/:id': { body: report({ account: null }) } });
    await open(`/accounts/compromised/${ID}`);
    expect(part('report-no-account')).not.toBeNull();
    expect(part('report-unlock')).toBeNull();
    expect((part('report-close') as HTMLButtonElement).disabled).toBe(false);
  });
});
