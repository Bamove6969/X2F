// @vitest-environment happy-dom
// Plan 4 Task 31 / J-14: the staff Tickets and Compromised accounts pages against a fake staff API.
import { navFor } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { STAFF_REFUSALS } from '../src/refusals.js';
import { button, click, fakeApi, field, honestTapStart, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const ends = () => new Date(Date.now() + 3600_000).toISOString();
const TICKET = { id: '11111111-1111-4111-8111-111111111111', number: 1001, category: 'trades', tradeCode: null, status: 'open', createdAt: '2026-11-09T10:00:00.000Z', updatedAt: '2026-11-09T10:00:00.000Z', closedAt: null, displayName: 'mira.k' };
const REPORT = { ...TICKET, id: '22222222-2222-4222-8222-222222222222', number: 1002, category: 'compromised', displayName: 'victim_1', matched: true, locked: true, methodsLeft: ['passkey'] };
const ACCOUNT = '33333333-3333-4333-8333-333333333333';

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

describe('Tickets (tickets.handle)', () => {
  it('a helper with the grant sees Tickets in the menu, the queue, the thread, and answers', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: { displayName: 'helper_1', role: 'helper', nav: navFor('helper', ['tickets.handle']), sessionEndsAt: ends() } },
      'GET /staff/v1/tickets': { body: { tickets: [TICKET] } },
      'GET /staff/v1/tickets/:id': {
        body: { ticket: TICKET, displayName: 'mira.k', messages: [{ author: 'trader', memberName: null, staffName: null, body: 'Where is my trade?', at: TICKET.createdAt }] },
      },
      'POST /staff/v1/tickets/:id/messages': { status: 201, body: {} },
    });
    await open('/tickets');
    expect([...document.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['Tickets']);
    await click([...document.querySelectorAll('a')].find((a) => a.textContent === '#1001'));
    expect(document.querySelector('[data-part="ticket-thread"]')?.textContent).toContain('Where is my trade?');
    typeInto(field('Answer'), 'Looking now.');
    await click(button('Send answer'));
    expect(api.calls.find((c) => c.method === 'POST')).toMatchObject({ path: `/staff/v1/tickets/${TICKET.id}/messages`, body: { body: 'Looking now.' } });
  });
});

describe('Compromised accounts (accounts.freeze)', () => {
  it('a senior sees the report, the account and its paused trades, and unlocks with a key tap bound to the account', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: { displayName: 'senior_1', role: 'senior', nav: navFor('senior'), sessionEndsAt: ends() } },
      'GET /staff/v1/compromised': { body: { tickets: [REPORT] } },
      'GET /staff/v1/compromised/:id': {
        body: {
          ticket: REPORT,
          methodsLeft: ['passkey'],
          comment: 'Phone stolen',
          account: { id: ACCOUNT, displayName: 'victim_1', kind: 'trader', createdAt: '2026-01-01T00:00:00.000Z', lockedAt: REPORT.createdAt, openTrades: [{ code: 'ABCD-EFGH-JKMN-PQRS', state: 'secured', side: 'seller', paused: true }] },
        },
      },
      // Re-verify X1 on main: an honest taps/start (nonce, issuedAt, the challenge the dialog rebuilds).
      'POST /staff/v1/taps/start': honestTapStart('tap-1'),
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
      'POST /staff/v1/compromised/:id/unlock': { body: { status: 'unlocked' } },
      'POST /staff/v1/compromised/:id/close': refused(409, 'account-locked'),
    });
    await open('/compromised');
    expect([...document.querySelectorAll('nav a')].map((a) => a.textContent)).toContain('Compromised accounts');
    await click([...document.querySelectorAll('a')].find((a) => a.textContent === '#1002'));
    expect(document.querySelector('[data-part="compromised-comment"]')?.textContent).toBe('Phone stolen');
    expect(document.body.textContent).toContain('ABCD-EFGH-JKMN-PQRS');
    expect(document.body.textContent).toContain('Paused');
    // Closing while locked is the refusal, in CantDoThat.
    await click(button('Close report'));
    expect(document.querySelector('[data-part="cant-do-that"]')?.getAttribute('data-from')).toBe('account-locked');
    expect(document.body.textContent).toContain(STAFF_REFUSALS['account-locked']);
    await click(button('OK'));
    await click(button('Unlock account'));
    await click(button('Tap security key'));
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')?.body).toEqual({ kind: 'unlock-account', accountId: ACCOUNT });
    expect(api.calls.find((c) => c.path.endsWith('/unlock'))).toMatchObject({ method: 'POST', body: { tapId: 'tap-1' } });
  });
});
