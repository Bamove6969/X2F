// @vitest-environment happy-dom
// Plan 2 Task 16: both sides of new-device approval and the Devices settings.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalView, ApprovalWait } from '@x2f/auth-client';
import { ApproveOnDevice, roomNote } from '../src/screens/auth/ApproveOnDevice.js';
import { LoginApprove } from '../src/screens/auth/LoginApprove.js';
import { Devices } from '../src/screens/settings/Devices.js';
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
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const part = (host: HTMLElement, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

const WAIT: ApprovalWait = {
  status: 'approve-on-device', approvalId: '11111111-1111-4111-8111-111111111111', number: 47,
  expiresAt: new Date(Date.now() + 120_000).toISOString(), devices: { loggedIn: 1, max: 3, oneDevice: false },
};

describe('the new device (ApproveOnDevice)', () => {
  it('shows the number, polls, and on ok says so before going on', async () => {
    let polls = 0;
    handler = (url) => {
      if (url === `/v1/login/approval/${WAIT.approvalId}/poll`) {
        polls++;
        return json(200, polls < 2 ? { status: 'waiting', expiresAt: WAIT.expiresAt } : { status: 'ok', loggedOut: [] });
      }
      return undefined;
    };
    const onLoggedIn = vi.fn();
    const { host } = render(
      <MemoryRouter>
        <ApproveOnDevice wait={WAIT} returnTo="/" onLoggedIn={onLoggedIn} onRestart={() => undefined} pollMs={10} />
      </MemoryRouter>,
    );
    expect(part(host, 'approve-number')?.textContent).toBe('47');
    expect(part(host, 'approve-room')?.textContent).toContain("You're on 1 now");
    await settle();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await settle();
    expect(part(host, 'approve-in')).not.toBeNull();
    expect(onLoggedIn).not.toHaveBeenCalled();
    click(part(host, 'approve-continue'));
    expect(onLoggedIn).toHaveBeenCalledOnce();
  });

  it('a blocked login offers to try again or use a backup', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'blocked' }) : undefined);
    const onRestart = vi.fn();
    const { host } = render(
      <MemoryRouter>
        <ApproveOnDevice wait={WAIT} returnTo="/x" onLoggedIn={() => undefined} onRestart={onRestart} pollMs={10} />
      </MemoryRouter>,
    );
    await settle();
    expect(part(host, 'approve-blocked')?.textContent).toContain('This login was blocked');
    expect(part(host, 'approve-backup')?.getAttribute('href')).toBe('/login/backup?returnTo=%2Fx');
    click(part(host, 'approve-retry'));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('cancel tells the server and starts again', async () => {
    handler = (url) => (url.endsWith('/poll') ? json(200, { status: 'waiting', expiresAt: WAIT.expiresAt }) : url.endsWith('/cancel') ? json(200, { ok: true }) : undefined);
    const onRestart = vi.fn();
    const { host } = render(
      <MemoryRouter>
        <ApproveOnDevice wait={WAIT} returnTo="/" onLoggedIn={() => undefined} onRestart={onRestart} pollMs={1000} />
      </MemoryRouter>,
    );
    click(part(host, 'approve-cancel'));
    await settle();
    expect(calls.some((c) => c.url === `/v1/login/approval/${WAIT.approvalId}/cancel` && c.method === 'POST')).toBe(true);
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('the room note covers the limit and One device at a time', () => {
    expect(roomNote({ loggedIn: 3, max: 3, oneDevice: false })).toContain('the most allowed');
    expect(roomNote({ loggedIn: 1, max: 1, oneDevice: true })).toContain('One device at a time is on');
  });
});

const VIEW: ApprovalView = {
  id: '22222222-2222-4222-8222-222222222222', deviceLabel: 'Chrome on Windows', choices: [31, 47, 86],
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), atLimit: false, oneDevice: false,
};

describe('the logged-in device (LoginApprove)', () => {
  it('asks "Is this you?", sends the tapped number, and shows the result', async () => {
    handler = (url, init) => (url === `/v1/account/approvals/${VIEW.id}` && init?.method === 'POST' ? json(200, { outcome: 'approved' }) : undefined);
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <LoginApprove approval={VIEW} onDone={onDone} />
      </MemoryRouter>,
    );
    const sheet = document.body;
    expect(sheet.textContent).toContain('Someone is logging in on Chrome on Windows. Is this you?');
    expect(sheet.textContent).toContain("X2F doesn't log IP addresses");
    const choices = [...sheet.querySelectorAll('[data-part="approve-choice"]')].map((b) => b.textContent);
    expect(choices).toEqual(['31', '47', '86']);
    expect((part(sheet, 'approve-yes') as HTMLButtonElement).disabled).toBe(true);
    click([...sheet.querySelectorAll('[data-part="approve-choice"]')][1]!);
    click(part(sheet, 'approve-yes'));
    await settle();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ choice: 47 });
    expect(part(sheet, 'approve-done')?.textContent).toContain('Chrome on Windows is logged in');
  });

  it('"No, block it" blocks and suggests changing the login method', async () => {
    handler = (url, init) => (init?.method === 'POST' ? json(200, { outcome: 'blocked' }) : undefined);
    render(
      <MemoryRouter>
        <LoginApprove approval={VIEW} onDone={() => undefined} />
      </MemoryRouter>,
    );
    click(part(document.body, 'approve-block'));
    await settle();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ block: true });
    expect(part(document.body, 'approve-blocked')?.textContent).toContain('Change your login method');
  });

  it('at the limit it asks which device to log out, then sends it', async () => {
    let n = 0;
    handler = (_url, init) => {
      if (init?.method !== 'POST') return undefined;
      n++;
      return n === 1
        ? json(409, { error: 'too-many-devices', sessions: [{ id: '33333333-3333-4333-8333-333333333333', deviceLabel: 'Safari on iOS', lastSeenAt: VIEW.createdAt, current: false }] })
        : json(200, { outcome: 'approved' });
    };
    render(
      <MemoryRouter>
        <LoginApprove approval={{ ...VIEW, atLimit: true }} onDone={() => undefined} />
      </MemoryRouter>,
    );
    expect(part(document.body, 'approve-at-limit')).not.toBeNull();
    click([...document.body.querySelectorAll('[data-part="approve-choice"]')][1]!);
    click(part(document.body, 'approve-yes'));
    await settle();
    expect(part(document.body, 'approve-choose')?.textContent).toContain('Safari on iOS');
    click(part(document.body, 'approve-out'));
    click(part(document.body, 'approve-out-yes'));
    await settle();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { choice: 47 },
      { choice: 47, logOut: '33333333-3333-4333-8333-333333333333' },
    ]);
    expect(part(document.body, 'approve-done')).not.toBeNull();
  });
});

describe('Devices', () => {
  it('shows the count against the limit and the One device at a time setting', async () => {
    handler = (url) => {
      if (url === '/v1/account/sessions') {
        return json(200, [
          { id: 'a', deviceLabel: 'Browser on Linux', level: 'full', createdAt: VIEW.createdAt, lastSeenAt: VIEW.createdAt, current: true },
          { id: 'b', deviceLabel: 'Safari on iOS', level: 'full', createdAt: VIEW.createdAt, lastSeenAt: VIEW.createdAt, current: false },
        ]);
      }
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      return undefined;
    };
    const prove = vi.fn(async () => 'T'.repeat(43));
    const { host } = render(<Devices prove={prove} />);
    await settle();
    expect(part(host, 'devices-count')?.textContent).toBe('Logged in · 2 of 3');
    expect(part(host, 'one-device-toggle')?.textContent).toBe('Off');
  });
});
