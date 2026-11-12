// @vitest-environment happy-dom
// Plan 4 Task 33 (D-041, D-045): the clock-out sheet in the staff shell. Only a clock-out pays:
// it shows the total since the last paid clock-out with a thank-you, asks which pre-approved
// address to send it to (adding one is a security-key tap), and ends the session.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { usdText, xmrText } from '../src/ui/ClockOut.js';
import { button, click, fakeApi, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const me = (role: 'owner' | 'senior' | 'mod' | 'helper') => ({
  displayName: 'lumen.k',
  role,
  nav: NAV[role],
  sessionEndsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
});
const A1 = `5${'a'.repeat(94)}`;
const A2 = `5${'b'.repeat(94)}`;
const A3 = `5${'c'.repeat(94)}`;
const sheet = (o: Record<string, unknown> = {}) => ({
  quote: 'q.sig', expiresAt: '2026-11-12T10:05:00.000Z',
  due: 'pay', disputes: 2, largeTrades: 0, clawbacks: 0, usdCents: '6600', atomic: '0', usdCentsPerXmr: '33000',
  amountAtomic: '200000000000',
  addresses: [{ id: 'a1', address: A1, addedAt: '2026-11-01T00:00:00.000Z' }, { id: 'a2', address: A2, addedAt: '2026-11-02T00:00:00.000Z' }],
  ...o,
});

async function open() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

beforeEach(() => {
  webauthn.startAuthentication.mockReset();
});

describe('the clock-out sheet', () => {
  it('the owner has no Clock out; staff see it with the reminder that only a clock-out pays', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('owner') } });
    await open();
    expect(button('Clock out')).toBeUndefined();
    document.body.innerHTML = '';
    fakeApi({ 'GET /staff/v1/me': { body: me('mod') } });
    await open();
    expect(button('Clock out')).toBeDefined();
    expect(document.querySelector('[data-part="clock-out-reminder"]')?.textContent).toContain('Logging out or closing the app does not pay');
  });

  it('shows the total and the thank-you, sends to the shown (newest) address or another chosen one, and returns to Login', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: me('mod') },
      'GET /staff/v1/pay/clock-out': { body: sheet() },
      'POST /staff/v1/pay/clock-out': { body: { due: 'pay', payout: { id: 'p1', amountAtomic: '200000000000', addressId: 'a1', status: 'waiting-send' } } },
    });
    await open();
    await click(button('Clock out'));
    const text = document.querySelector('[data-part="clock-out-text"]')?.textContent ?? '';
    expect(text).toContain("You've earned 0.200000 XMR ($66.00 at today's price)");
    expect(text).toContain("we couldn't do it without you");
    expect(document.querySelector('[data-part="clock-out-total"]')?.textContent).toContain('2 disputes completed since your last paid clock-out');
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="payout-address"]')];
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    await click(radios[0]);
    await click(button('Send my pay and clock out'));
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/staff/v1/pay/clock-out');
    expect(post?.body).toEqual({ quote: 'q.sig', addressId: 'a1' });
    expect(document.querySelector('[data-screen="login"]')).not.toBeNull();
  });

  it('adds another address with a key tap bound to it, then chooses it', async () => {
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred' });
    let added = false;
    const api = fakeApi({
      'GET /staff/v1/me': { body: me('senior') },
      'GET /staff/v1/pay/clock-out': () => ({ body: sheet(added ? { addresses: [...sheet().addresses, { id: 'a3', address: A3, addedAt: '2026-11-03T00:00:00.000Z' }] } : {}) }),
      'POST /staff/v1/taps/start': { body: { tapId: 't1', options: { challenge: 'abc' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 't1' } },
      'POST /staff/v1/pay/addresses': () => {
        added = true;
        return { body: { id: 'a3', address: A3, addedAt: '2026-11-03T00:00:00.000Z' } };
      },
    });
    await open();
    await click(button('Clock out'));
    typeInto(document.querySelector('[data-part="clock-out-addresses"] input.x2f-input'), A3);
    await settle();
    await click(button('Add this address'));
    await click(button('Tap security key'));
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')?.body).toEqual({ kind: 'payout-address', address: A3 });
    expect(api.calls.find((c) => c.path === '/staff/v1/pay/addresses')?.body).toEqual({ address: A3, tapId: 't1' });
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="payout-address"]')];
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
  });

  it('a clawback debt pays nothing and says it comes off the next pay; no address is asked for', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: me('senior') },
      'GET /staff/v1/pay/clock-out': { body: sheet({ due: 'owed', disputes: 0, clawbacks: 2, usdCents: '-3300', amountAtomic: '-100000000000' }) },
      'POST /staff/v1/pay/clock-out': { body: { due: 'owed', payout: null } },
    });
    await open();
    await click(button('Clock out'));
    expect(document.querySelector('[data-part="clock-out-text"]')?.textContent).toContain('0.100000 XMR, comes off your next pay');
    expect(document.querySelector('input[name="payout-address"]')).toBeNull();
    await click(button('Clock out', document.querySelector('[data-part="clock-out"]')!));
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/staff/v1/pay/clock-out')?.body).toEqual({ quote: 'q.sig' });
  });

  it('pay that changed while the sheet was open: the sheet is read again and says so; nothing is paid', async () => {
    let n = 0;
    fakeApi({
      'GET /staff/v1/me': { body: me('mod') },
      'GET /staff/v1/pay/clock-out': () => ({ body: sheet(++n > 1 ? { disputes: 3, amountAtomic: '300000000000', usdCents: '9900' } : {}) }),
      'POST /staff/v1/pay/clock-out': { status: 409, body: { error: 'quote-changed' } },
    });
    await open();
    await click(button('Clock out'));
    await click(button('Send my pay and clock out'));
    expect(document.querySelector('[data-part="clock-out-fault"]')?.textContent).toContain('Your pay changed while this was open');
    expect(document.querySelector('[data-part="clock-out-text"]')?.textContent).toContain('0.300000 XMR');
    expect(document.querySelector('[data-screen="login"]')).toBeNull();
  });

  it('review r2-m2: an expired sheet has its own words, and a failed re-read keeps the error and drops the stale figures', async () => {
    let n = 0;
    fakeApi({
      'GET /staff/v1/me': { body: me('mod') },
      'GET /staff/v1/pay/clock-out': () => (++n === 1 ? { body: sheet() } : { status: 503, body: { error: 'busy' } }),
      'POST /staff/v1/pay/clock-out': { status: 409, body: { error: 'quote-expired' } },
    });
    await open();
    await click(button('Clock out'));
    await click(button('Send my pay and clock out'));
    const fault = document.querySelector('[data-part="clock-out-fault"]')?.textContent ?? '';
    expect(fault).toContain('more than 5 minutes old');
    expect(fault).not.toContain('Your pay changed while this was open');
    expect(fault).toContain('could not be worked out');
    // The stale total is gone and nothing can be sent on it.
    expect(document.querySelector('[data-part="clock-out-text"]')).toBeNull();
    expect(button('Clock out', document.querySelector('[data-part="clock-out"]')!)?.disabled).toBe(true);
  });

  it('formats XMR truncated to 6 places and dollars with their sign', () => {
    expect(xmrText('1234567890123')).toBe('1.234567 XMR');
    expect(xmrText('-1250000000')).toBe('-0.001250 XMR');
    expect(usdText('6600')).toBe('$66.00');
    expect(usdText('-3305')).toBe('-$33.05');
    expect(usdText('123456789')).toBe('$1,234,567.89');
  });
});
