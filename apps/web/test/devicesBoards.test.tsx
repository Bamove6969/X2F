// @vitest-environment happy-dom
// C2-D1: the new-device approval screens and the Devices screen rebuilt to the LoginApprove and
// "Devices and sessions" boards (docs/design-boards on wip/design-brief, design review 1 Nov item 9):
// structure, roles, names and focus. Behaviour is the existing Plan 2 Tasks 16-17 behaviour.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalView, ApprovalWait } from '@x2f/auth-client';
import { ApproveOnDevice } from '../src/screens/auth/ApproveOnDevice.js';
import { LoginApprove } from '../src/screens/auth/LoginApprove.js';
import { Devices } from '../src/screens/settings/Devices.js';
import { loadFeedbackDraft, saveFeedbackDraft } from '../src/screens/feedbackDraft.js';
import { refreshSession, useSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;
let handler: Handler;
let calls: Array<{ url: string; method: string; body: unknown }>;

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined });
      return handler(url, init) ?? json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const part = (host: ParentNode, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
const byRole = (root: ParentNode, role: string) => [...root.querySelectorAll(`[role="${role}"]`)];
/** The accessible name from aria-label, aria-labelledby or a wrapping <label>. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by !== null) return by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  const wrap = el.closest('label');
  if (wrap !== null) return wrap.textContent?.trim() ?? '';
  const id = el.getAttribute('id');
  if (id !== null) return document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? '';
  return el.textContent?.trim() ?? '';
}

function Who() {
  return <span data-part="who">{useSession().status}</span>;
}

function Where() {
  const l = useLocation();
  return <span data-part="where">{l.pathname}</span>;
}

const WAIT: ApprovalWait = {
  status: 'approve-on-device', approvalId: '11111111-1111-4111-8111-111111111111', number: 47,
  expiresAt: new Date(Date.now() + 299_000).toISOString(),
};

describe('LoginApprove board, new-device side (ApproveOnDevice)', () => {
  const mount = (o: { onRestart?: () => void } = {}) =>
    render(
      <MemoryRouter>
        <ApproveOnDevice wait={WAIT} returnTo="/buy" onLoggedIn={() => undefined} onRestart={o.onRestart ?? (() => undefined)} pollMs={60_000} />
      </MemoryRouter>,
    );
  const mountWith = (o: { onLoggedIn?: () => void; onRestart?: () => void }) =>
    render(
      <MemoryRouter>
        <ApproveOnDevice
          wait={WAIT}
          returnTo="/buy"
          onLoggedIn={o.onLoggedIn ?? (() => undefined)}
          onRestart={o.onRestart ?? (() => undefined)}
          pollMs={60_000}
        />
      </MemoryRouter>,
    );

  it('is a full screen: h1 "Log in" with a 44 px back control, an h2, and Cancel in the footer', () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'waiting', expiresAt: WAIT.expiresAt }) : undefined);
    const { host } = mount();
    const h1 = host.querySelector('h1');
    expect(h1?.textContent).toBe('Log in');
    const back = host.querySelector('header [aria-label="Back to log in"]');
    expect(back).not.toBeNull();
    expect(back?.classList.contains('x2f-icon-button')).toBe(true);
    expect(host.querySelector('h2')?.textContent).toBe("Approve this login on a device you're already using");
    const footer = host.querySelector('footer');
    expect(footer?.querySelector('[data-part="approve-cancel"]')?.textContent).toBe('Cancel');
  });

  it('shows the number big, named by its "Your number" label, and the countdown in mm:ss', () => {
    const { host } = mount();
    const num = part(host, 'approve-number')!;
    expect(num.textContent).toBe('47');
    // Review N3: no aria-labelledby on a generic span; the label is read just before the number.
    expect(num.hasAttribute('aria-labelledby')).toBe(false);
    expect(num.previousElementSibling?.textContent).toBe('Your number');
    expect(num.classList.contains('x2f-big-number')).toBe(true);
    expect(part(host, 'approve-countdown')?.textContent).toMatch(/This ends in [45] min \d{1,2} s\./);
  });

  it('"Where do I approve it?" is a disclosure: aria-expanded and aria-controls the steps', () => {
    const { host } = mount();
    const where = part(host, 'approve-where')!;
    expect(where.getAttribute('aria-expanded')).toBe('false');
    click(where);
    expect(where.getAttribute('aria-expanded')).toBe('true');
    const steps = document.getElementById(where.getAttribute('aria-controls')!);
    expect(steps?.tagName).toBe('OL');
    expect(steps?.querySelectorAll('li')).toHaveLength(3);
  });

  it('the no-other-device card keeps the existing way to the backup login', () => {
    const { host } = mount();
    const card = part(host, 'approve-no-device')!;
    expect(card.querySelector('h3')?.textContent).toBe('No other device with you?');
    expect(card.querySelector('[data-part="approve-backup"]')?.getAttribute('href')).toBe('/login/backup?returnTo=%2Fbuy');
  });

  it('the back control cancels the wait like Cancel', async () => {
    handler = (url) => (url.endsWith('/cancel') ? json(200, { ok: true }) : undefined);
    const onRestart = vi.fn();
    const { host } = mount({ onRestart });
    click(host.querySelector('[aria-label="Back to log in"]'));
    await settle();
    expect(calls.some((c) => c.url.endsWith('/cancel') && c.method === 'POST')).toBe(true);
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('let in: a check icon, the h2 "You\'re in", and Continue as the footer primary', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'ok', loggedOut: [] }) : undefined);
    const { host } = mount();
    await settle();
    const done = part(host, 'approve-in')!;
    expect(done.querySelector('h2')?.textContent).toBe("You're in");
    expect(done.querySelector('[data-icon-tone="escrow"]')).not.toBeNull();
    expect(host.querySelector('footer [data-part="approve-continue"]')?.hasAttribute('data-primary')).toBe(true);
  });

  it('blocked: a shield icon in danger, Try again as the footer primary, and the backup link kept', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'blocked' }) : undefined);
    const { host } = mount();
    await settle();
    const b = part(host, 'approve-blocked')!;
    expect(b.querySelector('h2')?.textContent).toBe('This login was blocked');
    expect(b.querySelector('[data-icon-tone="danger"]')).not.toBeNull();
    expect(host.querySelector('footer [data-part="approve-retry"]')?.hasAttribute('data-primary')).toBe(true);
    expect(host.querySelector('footer [data-part="approve-backup"]')?.getAttribute('href')).toBe('/login/backup?returnTo=%2Fbuy');
  });

  // Review M1: once let in, the back control goes on into the app (the device is logged in), not to
  // the login chooser; blocked and expired still start again.
  it('let in: the back control goes on like Continue, never back to the login chooser', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'ok', loggedOut: [] }) : undefined);
    const onLoggedIn = vi.fn();
    const onRestart = vi.fn();
    const { host } = mountWith({ onLoggedIn, onRestart });
    await settle();
    expect(part(host, 'approve-in')).not.toBeNull();
    click(host.querySelector('header [aria-label="Back to log in"]'));
    expect(onLoggedIn).toHaveBeenCalledOnce();
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('blocked: the back control starts again', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'blocked' }) : undefined);
    const onLoggedIn = vi.fn();
    const onRestart = vi.fn();
    const { host } = mountWith({ onLoggedIn, onRestart });
    await settle();
    click(host.querySelector('header [aria-label="Back to log in"]'));
    expect(onRestart).toHaveBeenCalledOnce();
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  // Review M2: a stage change moves focus to the new stage's h2, and the footer button is a new
  // node, so a press meant for Cancel can't land on Continue.
  it('a stage change focuses the new h2 and replaces the footer button', async () => {
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((r) => {
      release = r;
    });
    handler = (url) => (url.endsWith('/poll') ? (gate as unknown as Response) : undefined);
    const { host } = mountWith({});
    await settle();
    const cancelBtn = host.querySelector<HTMLButtonElement>('footer [data-part="approve-cancel"]')!;
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);
    release(json(200, { status: 'ok', loggedOut: [] }));
    await settle();
    const h2 = part(host, 'approve-in')!.querySelector('h2')!;
    expect(h2.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h2);
    expect(cancelBtn.isConnected).toBe(false);
    expect(host.querySelector('footer button')).not.toBe(cancelBtn);
  });

  it('the first stage does not take focus on mount', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'waiting', expiresAt: WAIT.expiresAt }) : undefined);
    const { host } = mountWith({});
    await settle();
    expect(host.contains(document.activeElement)).toBe(false);
  });
});

const VIEW: ApprovalView = {
  id: '22222222-2222-4222-8222-222222222222', deviceLabel: 'Chrome on Windows', choices: [31, 47, 86],
  createdAt: '2026-10-29T14:05:00.000Z', expiresAt: new Date(Date.now() + 299_000).toISOString(), atLimit: false, oneDevice: false,
};

const TOO_MANY = {
  error: 'too-many-devices',
  sessions: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deviceLabel: 'Pixel 10 Pro Fold', lastSeenAt: new Date().toISOString(), current: true },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', deviceLabel: 'Firefox on Linux', lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), current: false },
  ],
};

describe('LoginApprove board, logged-in side (LoginApprove)', () => {
  const mount = (view: ApprovalView = VIEW, onDone: () => void = () => undefined) =>
    render(
      <MemoryRouter initialEntries={['/sell']}>
        <Routes>
          <Route path="*" element={<><LoginApprove approval={view} onDone={onDone} /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
  const dialog = () => document.querySelector('[role="dialog"]')!;

  it('the ask: a "New login" label over an h2 question, and no X close (Escape still closes)', () => {
    const onDone = vi.fn();
    mount(VIEW, onDone);
    const d = dialog();
    const title = document.getElementById(d.getAttribute('aria-labelledby')!);
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Someone is logging in on Chrome on Windows. Is this you?');
    expect(part(d, 'sheet-kicker')?.textContent).toBe('New login');
    expect(d.querySelector('[aria-label="Close"]')).toBeNull();
    fire(d, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('the facts are a <dl>: Device, Time (D Mon YYYY, HH:MM UTC) and Where', () => {
    mount();
    const dl = dialog().querySelector('dl')!;
    expect([...dl.querySelectorAll('dt')].map((t) => t.textContent)).toEqual(['Device', 'Time', 'Where']);
    const dd = [...dl.querySelectorAll('dd')].map((t) => t.textContent);
    expect(dd[0]).toBe('Chrome on Windows');
    expect(dd[1]).toBe('29 Oct 2026, 14:05 UTC');
    expect(dd[2]).toBe("Not shown. X2F doesn't log IP addresses, so we can't show where.");
  });

  it('the numbers are a radio group of three tiles named by the instruction; Yes waits for a pick', () => {
    mount();
    const d = dialog();
    const group = d.querySelector('[role="radiogroup"]')!;
    expect(nameOf(group)).toBe("If it's you, tap the number shown on the new device");
    const radios = [...group.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios.map(nameOf)).toEqual(['31', '47', '86']);
    expect(group.querySelectorAll('.x2f-choice[data-look="tile"]')).toHaveLength(3);
    expect((part(d, 'approve-yes') as HTMLButtonElement).disabled).toBe(true);
    click(radios[1]!);
    expect(radios[1]!.checked).toBe(true);
    expect(radios[1]!.closest('.x2f-choice')?.getAttribute('data-on')).toBe('true');
    expect((part(d, 'approve-yes') as HTMLButtonElement).disabled).toBe(false);
  });

  it('"No, block it" is the outlined danger button, and the countdown reads mm:ss', () => {
    mount();
    const d = dialog();
    expect(part(d, 'approve-block')?.classList.contains('x2f-button--danger-outline')).toBe(true);
    expect(part(d, 'approve-countdown')?.textContent).toMatch(/the request ends in [45] min \d{1,2} s and they stay out\./);
  });

  it('with One device at a time on, only that note shows (never the device-limit note too)', () => {
    mount({ ...VIEW, atLimit: true, oneDevice: true });
    expect(part(document, 'approve-one-device')).not.toBeNull();
    expect(part(document, 'approve-at-limit')).toBeNull();
  });

  it('at the limit, Yes goes straight to the chooser (no refusal popup): radio cards with notes', async () => {
    handler = (url, init) => {
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      return init?.method === 'POST' ? json(409, TOO_MANY) : undefined;
    };
    mount({ ...VIEW, atLimit: true });
    expect(part(document, 'approve-at-limit')).not.toBeNull();
    click(dialog().querySelectorAll('input[type="radio"]')[1]!);
    click(part(dialog(), 'approve-yes'));
    await settle();
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
    const d = dialog();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Choose a device to log out');
    expect(part(d, 'sheet-kicker')?.textContent).toBe('New login · Chrome on Windows');
    expect(part(d, 'approve-choose')?.textContent).toContain('You can be logged in on 3 devices at once. To let Chrome on Windows in, one of these has to be logged out.');
    const cards = [...d.querySelectorAll('[aria-label="Device to log out"] .x2f-choice[data-look="card"]')];
    expect(cards.map((c) => c.textContent)).toEqual(['Pixel 10 Pro FoldThis device · active now', 'Firefox on LinuxLast active 3 days ago']);
    expect(part(d, 'approve-block')?.classList.contains('x2f-button--danger-outline')).toBe(true);
    // Focus stays in the dialog when the step changes (the Yes button is gone).
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('approved: an escrow check, the h2 "<device> is logged in", a link to Devices and Done', async () => {
    handler = (_u, init) => (init?.method === 'POST' ? json(200, { outcome: 'approved' }) : undefined);
    const onDone = vi.fn();
    mount(VIEW, onDone);
    click(dialog().querySelectorAll('input[type="radio"]')[1]!);
    click(part(dialog(), 'approve-yes'));
    await settle();
    const d = dialog();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Chrome on Windows is logged in');
    expect(d.querySelector('[data-icon-tone="escrow"]')).not.toBeNull();
    expect(d.querySelector('a[href="/settings/devices"]')?.textContent).toBe('Devices');
    expect(d.contains(document.activeElement)).toBe(true);
    click(part(d, 'approve-ok'));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('approved with One device at a time on: this device is logged out, so OK goes to Log in', async () => {
    handler = (_u, init) => (init?.method === 'POST' ? json(200, { outcome: 'approved' }) : undefined);
    mount({ ...VIEW, oneDevice: true });
    click(dialog().querySelectorAll('input[type="radio"]')[1]!);
    click(part(dialog(), 'approve-yes'));
    await settle();
    expect(part(dialog(), 'approve-done')?.textContent).toContain('This device is now logged out, because One device at a time is on.');
    click(part(dialog(), 'approve-ok'));
    await settle();
    expect(part(document, 'where')?.textContent).toBe('/login');
  });

  // Review N6: this device's session ended on the server, so OK forgets the signed-in state here
  // (the shared session answer, the feedback draft) before going to Log in.
  it('OK after this device logged itself out clears the local session state first', async () => {
    let meStatus = 200;
    handler = (url, init) => {
      if (url === '/v1/account/me') return meStatus === 200 ? json(200, { displayName: 'nightowl', kind: 'trader', level: 'full' }) : json(401, { error: 'unauthenticated' });
      if (init?.method === 'POST') return json(200, { outcome: 'approved' });
      return undefined;
    };
    refreshSession();
    saveFeedbackDraft({ kind: 'feedback', text: 'half-written', anonymous: false, owner: 'nightowl' });
    render(
      <MemoryRouter initialEntries={['/sell']}>
        <Routes>
          <Route path="*" element={<><LoginApprove approval={{ ...VIEW, oneDevice: true }} onDone={() => undefined} /><Where /><Who /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(part(document, 'who')?.textContent).toBe('signed-in');
    // The server has ended this session by the time the approval is answered.
    meStatus = 401;
    click(dialog().querySelectorAll('input[type="radio"]')[1]!);
    click(part(dialog(), 'approve-yes'));
    await settle();
    click(part(dialog(), 'approve-ok'));
    await settle();
    expect(part(document, 'where')?.textContent).toBe('/login');
    expect(part(document, 'who')?.textContent).toBe('signed-out');
    expect(loadFeedbackDraft(null)).toBeNull();
  });

  it('blocked: a danger shield, the h2 "Login blocked", and the change-method box', async () => {
    handler = (_u, init) => (init?.method === 'POST' ? json(200, { outcome: 'blocked' }) : undefined);
    mount();
    click(part(dialog(), 'approve-block'));
    await settle();
    const d = dialog();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Login blocked');
    expect(d.querySelector('[data-icon-tone="danger"]')).not.toBeNull();
    expect(d.querySelector('h3')?.textContent).toBe('Change your login method');
  });
});

const NOW = Date.now();
const SESSIONS = [
  { id: 'a', deviceLabel: 'Firefox on Linux', level: 'full', createdAt: new Date(NOW - 9 * 86_400_000).toISOString(), lastSeenAt: new Date(NOW).toISOString(), current: true, member: null },
  { id: 'b', deviceLabel: 'Chrome on Android', level: 'full', createdAt: new Date(NOW - 5 * 86_400_000).toISOString(), lastSeenAt: new Date(NOW - 2 * 3_600_000).toISOString(), current: false, member: null },
  { id: 'c', deviceLabel: 'Safari on macOS', level: 'full', createdAt: new Date(NOW - 86_400_000).toISOString(), lastSeenAt: new Date(NOW - 25 * 60_000).toISOString(), current: false, member: 'desk_ana' },
];

describe('"Devices and sessions" board (Devices)', () => {
  const mount = (sessions: unknown[] = SESSIONS) => {
    handler = (url, init) => {
      if (url === '/v1/account/sessions') return json(200, sessions);
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      if (url.startsWith('/v1/account/sessions/') && init?.method === 'DELETE') return json(200, {});
      return undefined;
    };
    return render(
      <MemoryRouter>
        <Devices prove={async () => 'T'.repeat(43)} />
      </MemoryRouter>,
    );
  };

  it('is its own screen: h1 "Devices and sessions" and a 44 px back link to Settings', async () => {
    const { host } = mount();
    await settle();
    expect(host.querySelector('h1')?.textContent).toBe('Devices and sessions');
    const back = host.querySelector('header a[aria-label="Back to settings"]');
    expect(back?.getAttribute('href')).toBe('/settings/security');
    expect(back?.classList.contains('x2f-icon-button')).toBe(true);
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Devices', 'Options', 'How a new device gets in']);
  });

  it('the count card reads "N of M devices logged in" with a meter of M pills (decorative)', async () => {
    const { host } = mount();
    await settle();
    // The API counts a team member's session toward the limit (devicesInUse), so the screen does too.
    expect(part(host, 'devices-count')?.textContent).toBe('3 of 3 devices logged in');
    const meter = part(host, 'devices-meter')!;
    expect(meter.getAttribute('aria-hidden')).toBe('true');
    expect(meter.querySelectorAll('[data-filled="true"]')).toHaveLength(3);
    expect(meter.children).toHaveLength(3);
  });

  it('your devices: icon, name, "This device", last active, and a named Log out per other row', async () => {
    const { host } = mount();
    await settle();
    const mine = part(host, 'device-list')!;
    expect(nameOf(mine)).toBe('Your devices');
    const rows = [...mine.querySelectorAll('li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('This device');
    expect(rows[0]!.textContent).toContain('Active now');
    expect(rows[0]!.querySelector('[data-part="end-session"]')).toBeNull();
    expect(rows[1]!.textContent).toContain('Last active 2 h ago');
    expect(rows[1]!.querySelector('[data-device-icon="phone"]')).not.toBeNull();
    expect(rows[0]!.querySelector('[data-device-icon="computer"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-part="end-session"]')?.getAttribute('aria-label')).toBe('Log out Chrome on Android');
  });

  it('Log out asks first, then ends that session only', async () => {
    const { host } = mount();
    await settle();
    click(part(host, 'device-list')!.querySelector('[data-part="end-session"]'));
    const d = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Log out Chrome on Android?');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    click(part(d, 'end-confirm'));
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/account/sessions/b']);
  });

  it('"Log out all other devices" covers only your own devices, after asking', async () => {
    const { host } = mount();
    await settle();
    click(part(host, 'end-others'));
    const d = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Log out 1 other device?');
    click(part(d, 'end-confirm'));
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/account/sessions/b']);
  });

  it("team members' sessions are their own list, with initials and a named Log out", async () => {
    const { host } = mount();
    await settle();
    const team = part(host, 'team-sessions')!;
    expect(team.querySelector('h3')?.textContent).toBe('Team members logged in');
    const row = team.querySelector('li[data-member="desk_ana"]')!;
    expect(row.querySelector('.x2f-avatar')?.textContent).toBe('DA');
    expect(row.textContent).toContain('Safari on macOS');
    expect(row.querySelector('[data-part="end-session"]')?.getAttribute('aria-label')).toBe('Log out desk_ana on Safari on macOS');
    expect(team.querySelector('a[href="/settings/team"]')).not.toBeNull();
  });

  // Review I1 (owner, via the Devices board): "Log out all team members" in the team card, asked
  // first, ending every team member's session (and only those), plus the line that says
  // "Log out all other devices" covers only your own devices.
  it('"Log out all team members" asks first, then ends every team session and only those', async () => {
    const { host } = mount([
      ...SESSIONS,
      { id: 'd', deviceLabel: 'Edge on Windows', level: 'full', createdAt: new Date(NOW).toISOString(), lastSeenAt: new Date(NOW).toISOString(), current: false, member: 'basil' },
    ]);
    await settle();
    const team = part(host, 'team-sessions')!;
    expect(team.textContent).toContain('"Log out all other devices" covers only your own devices. Use "Log out all team members" for your team.');
    const btn = team.querySelector('[data-part="end-team"]')!;
    expect(btn.textContent).toBe('Log out all team members');
    click(btn);
    const d = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Log out all team members?');
    expect(part(d, 'end-confirm')?.textContent).toBe('Log out all team members');
    expect(part(d, 'end-cancel')?.textContent).toBe('Keep them logged in');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    click(part(d, 'end-confirm'));
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/account/sessions/c', '/v1/account/sessions/d']);
    expect(part(host, 'devices-note')?.textContent).toBe('All team members were logged out.');
  });

  it('"Keep them logged in" closes the ask without ending anything', async () => {
    const { host } = mount();
    await settle();
    click(part(host, 'end-team'));
    click(part(document.querySelector('[role="dialog"]')!, 'end-cancel'));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('One device at a time is a switch named by its label and described by its hint', async () => {
    const { host } = mount();
    await settle();
    const sw = host.querySelector('[role="switch"]')!;
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(nameOf(sw)).toBe('One device at a time');
    expect(document.getElementById(sw.getAttribute('aria-describedby')!)?.textContent).toBe(
      'When on, approving a new device logs out the one you were using.',
    );
  });
});
