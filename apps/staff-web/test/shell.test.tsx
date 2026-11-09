// @vitest-environment happy-dom
// Plan 4 Task 16: the staff shell (nav per role, user chip, session countdown, login hours ending),
// the API client and KeyTapDialog.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffApi } from '../src/api.js';
import { App } from '../src/App.js';
import { NAV_LABELS } from '../src/ui/StaffShell.js';
import { KeyTapDialog } from '../src/ui/KeyTapDialog.js';
import { RoleChip } from '../src/ui/RoleChip.js';
import { button, click, fakeApi, refused, render, settle } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const me = (role: 'owner' | 'senior' | 'mod' | 'helper', username = 'lumen.k', ends = inMinutes(120)) => ({
  username,
  role,
  nav: NAV[role],
  sessionEndsAt: ends,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const navLabels = () => [...document.querySelectorAll('nav[aria-label="Staff"] a')].map((a) => a.textContent);

beforeEach(() => {
  webauthn.startAuthentication.mockReset();
  webauthn.startRegistration.mockReset();
});

describe('StaffShell', () => {
  it('a moderator sees exactly Disputes, Training library and Activity log', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('mod', 'nightowl_44') } });
    await open('/');
    expect(navLabels()).toEqual(['Disputes', 'Training library', 'Activity log']);
  });

  it('a senior moderator sees the same three, and Feedback (owner Q60: seniors always get feedback)', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('senior') } });
    await open('/');
    expect(navLabels()).toEqual(['Disputes', 'Training library', 'Activity log', 'Feedback']);
  });

  it('a helper sees no staff pages, only "Nothing to show for your role yet"', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('helper') } });
    await open('/');
    expect(navLabels()).toEqual([]);
    expect(document.body.textContent).toContain('Nothing to show for your role yet');
    // A page the role does not have shows the same, never another role's page.
    await open('/settings');
    expect(document.body.textContent).toContain('Nothing to show for your role yet');
  });

  it("the owner sees every item in the boards' order (Feedback before Settings, Plan 5 Task 4)", async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('owner') } });
    await open('/');
    expect(navLabels()).toEqual(['Overview', 'Disputes', 'Staff', 'Performance', 'Training library', 'Activity log', 'Feedback', 'Settings']);
    expect(navLabels()).toEqual(NAV.owner.map((n) => NAV_LABELS[n]));
    // The board's seven plus Feedback; the first item is the landing page and is marked current.
    expect(document.querySelector('nav[aria-label="Staff"] a[aria-current="page"]')?.textContent).toBe('Overview');
  });

  it('shows the user chip "<username> · <Role>"', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('owner') } });
    await open('/');
    expect(document.querySelector('[data-part="user-chip"]')?.textContent).toBe('lumen.k · Owner');
    render(<RoleChip username="mira.k" role="senior" />);
    expect([...document.querySelectorAll('[data-part="user-chip"]')].at(-1)?.textContent).toBe('mira.k · Senior moderator');
  });

  it('shows a session countdown only when the session ends within 10 minutes', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('mod', 'nightowl_44', inMinutes(30)) } });
    await open('/');
    expect(document.querySelector('[data-part="session-countdown"]')).toBeNull();
    fakeApi({ 'GET /staff/v1/me': { body: me('mod', 'nightowl_44', inMinutes(8)) } });
    await open('/');
    const c = document.querySelector('[data-part="session-countdown"]');
    expect(c?.textContent).toBe('Your session ends in 8 min');
  });

  it('on outside-login-hours it says "Your login hours have ended." and returns to Login', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: me('mod', 'nightowl_44') } });
    await open('/disputes');
    expect(navLabels()).toContain('Disputes');
    api.set('GET /staff/v1/me', refused(401, 'outside-login-hours'));
    // Any later call answered with outside-login-hours ends the shell.
    await staffApi('/staff/v1/me').catch(() => undefined);
    await settle();
    expect(document.querySelector('nav[aria-label="Staff"]')).toBeNull();
    expect(document.querySelector('[data-screen="login"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Your login hours have ended.');
  });

  it('without a session it goes to Login', async () => {
    fakeApi({ 'GET /staff/v1/me': refused(401, 'not-authenticated') });
    await open('/disputes');
    expect(document.querySelector('[data-screen="login"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Your login hours have ended.');
  });

  it('Log out ends the session and returns to Login', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: me('owner') }, 'POST /staff/v1/logout': { status: 204 } });
    await open('/');
    await click(button('Log out'));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/staff/v1/logout')).toBe(true);
    expect(document.querySelector('[data-screen="login"]')).not.toBeNull();
  });
});

describe('the staff API client', () => {
  it("sends every call with credentials: 'same-origin' and throws the API's code", async () => {
    const api = fakeApi({ 'GET /staff/v1/me': refused(403, 'forbidden') });
    await expect(staffApi('/staff/v1/me')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(api.calls.map((c) => c.credentials)).toEqual(['same-origin']);
  });
});

describe('KeyTapDialog', () => {
  it('calls taps/start, runs startAuthentication, then finish, and returns the tapId', async () => {
    const intent = { kind: 'emergency-stop' as const };
    const api = fakeApi({
      'POST /staff/v1/taps/start': { body: { tapId: 't1', options: { challenge: 'abc' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 't1' } },
    });
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred', response: {} });
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <KeyTapDialog intent={intent} title="Pause all new trades" body="Tap your security key to pause." onDone={onDone} onCancel={() => undefined} />
      </MemoryRouter>,
    );
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Pause all new trades');
    await click(button('Tap security key'));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /staff/v1/taps/start', 'POST /staff/v1/taps/t1/finish']);
    expect(api.calls[0]!.body).toEqual(intent);
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });
    expect(api.calls[1]!.body).toEqual({ response: { id: 'cred', response: {} } });
    expect(onDone).toHaveBeenCalledWith('t1');
  });

  it('a cancelled tap leaves the dialog open with a way to try again', async () => {
    fakeApi({ 'POST /staff/v1/taps/start': { body: { tapId: 't1', options: { challenge: 'abc' } } } });
    webauthn.startAuthentication.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <KeyTapDialog intent={{ kind: 'emergency-stop' }} title="Pause all new trades" body="Tap your key." onDone={onDone} onCancel={() => undefined} />
      </MemoryRouter>,
    );
    await click(button('Tap security key'));
    expect(onDone).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('The key tap did not finish. Try again.');
    expect(button('Tap security key')).toBeDefined();
  });

  it('a refused tap (no security key on this account) is a CantDoThat', async () => {
    fakeApi({ 'POST /staff/v1/taps/start': refused(403, 'method-not-allowed') });
    render(
      <MemoryRouter>
        <KeyTapDialog intent={{ kind: 'emergency-stop' }} title="Pause all new trades" body="Tap your key." onDone={() => undefined} onCancel={() => undefined} />
      </MemoryRouter>,
    );
    await click(button('Tap security key'));
    expect(document.querySelector('[data-part="cant-do-that"]')?.getAttribute('data-from')).toBe('method-not-allowed');
  });
});
