// @vitest-environment happy-dom
// Plan 4 Task 16: the staff shell (nav per role, user chip, session countdown, login hours ending),
// the API client and KeyTapDialog.
import { NAV, hasIssuedAt, stampIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';
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
  displayName: username,
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

/**
 * What `taps/start` answers (re-verify X1): the options, the nonce and the server's issuedAt, with
 * a challenge that is `tapChallenge` of the intent as stamped. `over` lets a test play a lying server.
 */
function started(intent: KeyTapIntent, over: { issuedAt?: string | null; signs?: KeyTapIntent } = {}) {
  const nonce = new Uint8Array(16).fill(9);
  const issuedAt = over.issuedAt !== undefined ? over.issuedAt : hasIssuedAt(intent.kind) ? new Date().toISOString() : null;
  const signed = over.signs ?? (issuedAt !== null && hasIssuedAt(intent.kind) ? ({ ...stampIssuedAt(intent, new Date(issuedAt)) } as KeyTapIntent) : intent);
  const challenge = Buffer.from(tapChallenge(signed, nonce)).toString('base64url');
  return { tapId: 't1', options: { challenge }, nonce: Buffer.from(nonce).toString('hex'), issuedAt };
}

describe('KeyTapDialog', () => {
  it('calls taps/start, runs startAuthentication, then finish, and returns the tapId', async () => {
    const intent = { kind: 'emergency-stop' as const };
    const body = started(intent);
    const api = fakeApi({
      'POST /staff/v1/taps/start': { body },
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
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: body.options.challenge } });
    expect(api.calls[1]!.body).toEqual({ response: { id: 'cred', response: {} } });
    expect(onDone).toHaveBeenCalledWith('t1');
  });

  it('a cancelled tap leaves the dialog open with a way to try again', async () => {
    fakeApi({ 'POST /staff/v1/taps/start': { body: started({ kind: 'emergency-stop' }) } });
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

  // Re-verify X1 (lead call, 12 Nov): the key shows nothing of what it signs, so the staff site
  // checks the challenge itself before the key is asked, and shows the whole intent.
  const dialog = (intent: KeyTapIntent) =>
    render(
      <MemoryRouter>
        <KeyTapDialog intent={intent} title="Change settings" body="Tap your key." onDone={() => undefined} onCancel={() => undefined} />
      </MemoryRouter>,
    );
  const SETTINGS: KeyTapIntent = { kind: 'settings', largeTradeLimitUsd: 2000, firstResponseH: 4, appealWindowH: 48 };

  it('shows every field the key will sign', async () => {
    dialog(SETTINGS);
    const shown = document.querySelector('[data-part="key-tap-intent"]')?.textContent ?? '';
    for (const v of ['settings', 'largeTradeLimitUsd', '2000', 'firstResponseH', '4', 'appealWindowH', '48']) expect(shown).toContain(v);
  });

  it('refuses to ask the key when the server\'s challenge is for another intent', async () => {
    fakeApi({ 'POST /staff/v1/taps/start': { body: started(SETTINGS, { signs: { ...SETTINGS, largeTradeLimitUsd: 1_000_000, issuedAt: new Date().toISOString() } as KeyTapIntent }) } });
    dialog(SETTINGS);
    await click(button('Tap security key'));
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="key-tap-fault"]')?.textContent).toContain('Nothing was signed');
  });

  it('refuses an issuedAt more than 2 minutes from this device\'s clock, or one on a kind that has none', async () => {
    for (const issuedAt of [new Date(Date.now() + 3 * 60_000).toISOString(), new Date(Date.now() - 3 * 60_000).toISOString(), null]) {
      fakeApi({ 'POST /staff/v1/taps/start': { body: started(SETTINGS, { issuedAt }) } });
      dialog(SETTINGS);
      await click(button('Tap security key'));
      expect(webauthn.startAuthentication, String(issuedAt)).not.toHaveBeenCalled();
      document.body.innerHTML = '';
    }
    const RULING: KeyTapIntent = {
      kind: 'ruling', step: 'propose', rulingId: '7d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d', code: 'ABCD-EFGH-JKMN-PQRS', round: 1, outcome: 'release-to-buyer',
      accountAction: { kind: 'none' }, amountAtomic: '1', reasonSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), round1Id: null,
    };
    fakeApi({ 'POST /staff/v1/taps/start': { body: { ...started(RULING), issuedAt: new Date().toISOString() } } });
    dialog(RULING);
    await click(button('Tap security key'));
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
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
