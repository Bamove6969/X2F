// @vitest-environment happy-dom
// The idle reminder (owner, Q75, 6 Nov 2026): in their own settings a person turns on a reminder
// after some minutes without activity, and picks the interval; off by default. A reminder only: it
// never logs anyone out, never calls the server and never moves the session's end.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleReminder } from '../src/session/IdleReminder.js';
import { publishIdleReminder, resetIdleReminder } from '../src/session/idleReminderWatch.js';
import { IDLE_REMINDER_PATH, IdleReminderScreen } from '../src/screens/settings/IdleReminderSettings.js';
import { fire, render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let calls: Array<{ url: string; method: string; body: unknown }>;
let handler: (url: string, init: RequestInit | undefined) => Response | undefined;
const ME = { tradeTag: 'mira.k', needsLoginName: false, kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: false, suggestions: [], termsCurrent: true };

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  resetIdleReminder();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const MIN = 60_000;
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
function choose(select: Element | null, value: string) {
  const el = select as HTMLSelectElement;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('IdleReminder: the reminder itself', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.parse('2026-11-06T12:00:00Z'));
  });
  const tick = (ms: number) => act(() => {
    vi.advanceTimersByTime(ms);
  });

  it('is off by default: no reminder however long the person is away', () => {
    render(<IdleReminder />);
    tick(24 * 60 * MIN);
    expect(part('idle-reminder')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reminds after the chosen minutes without activity, and only reminds: no logout, no server call', () => {
    render(<IdleReminder />);
    act(() => publishIdleReminder(15));
    tick(15 * MIN - 2_000);
    expect(part('idle-reminder')).toBeNull();
    tick(3_000);
    expect(part('idle-reminder')).not.toBeNull();
    expect(document.body.textContent).toContain('Still there?');
    expect(document.body.textContent).toContain("You haven't used X2F for 15 minutes. You're still logged in.");
    tick(60 * MIN);
    expect(calls).toEqual([]);
    click(part('idle-reminder-dismiss'));
    expect(part('idle-reminder')).toBeNull();
    // The next reminder comes another interval later.
    tick(15 * MIN - 2_000);
    expect(part('idle-reminder')).toBeNull();
    tick(3_000);
    expect(part('idle-reminder')).not.toBeNull();
  });

  it('activity starts the wait over', () => {
    render(<IdleReminder />);
    act(() => publishIdleReminder(10));
    tick(9 * MIN);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    tick(9 * MIN);
    expect(part('idle-reminder')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    tick(10 * MIN + 1_000);
    expect(part('idle-reminder')).not.toBeNull();
    expect(document.body.textContent).toContain("You haven't used X2F for 10 minutes.");
  });

  it('turned off while waiting: no reminder', () => {
    render(<IdleReminder />);
    act(() => publishIdleReminder(30));
    tick(20 * MIN);
    act(() => publishIdleReminder(null));
    tick(60 * MIN);
    expect(part('idle-reminder')).toBeNull();
  });

  it('names an hour interval in hours', () => {
    render(<IdleReminder />);
    act(() => publishIdleReminder(120));
    tick(120 * MIN + 1_000);
    expect(document.body.textContent).toContain("You haven't used X2F for 2 hours.");
  });
});

describe('IdleReminderScreen: the setting', () => {
  it('starts Off, offers the intervals, and saves the choice (null for Off)', async () => {
    handler = (url, init) => {
      if (url === '/v1/account/me') return json(200, { ...ME, idleReminderMinutes: null });
      if (url === '/v1/account/idle-reminder' && init?.method === 'PUT') {
        return json(200, { idleReminderMinutes: (JSON.parse(String(init.body)) as { minutes: number | null }).minutes });
      }
      return undefined;
    };
    render(
      <MemoryRouter initialEntries={[IDLE_REMINDER_PATH]}>
        <IdleReminderScreen />
      </MemoryRouter>,
    );
    await settle();
    expect(document.body.textContent).toContain('Idle reminder');
    const select = part('idle-reminder-select') as HTMLSelectElement;
    expect(select.value).toBe('off');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Off', '10 minutes', '15 minutes', '30 minutes', '1 hour', '2 hours']);
    choose(select, '30');
    await settle();
    choose(select, 'off');
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { url: '/v1/account/idle-reminder', method: 'PUT', body: { minutes: 30 } },
      { url: '/v1/account/idle-reminder', method: 'PUT', body: { minutes: null } },
    ]);
    expect(document.body.textContent).toContain('Saved.');
  });

  it('shows the saved interval', async () => {
    handler = (url) => (url === '/v1/account/me' ? json(200, { ...ME, idleReminderMinutes: 60 }) : undefined);
    render(
      <MemoryRouter initialEntries={[IDLE_REMINDER_PATH]}>
        <IdleReminderScreen />
      </MemoryRouter>,
    );
    await settle();
    expect((part('idle-reminder-select') as HTMLSelectElement).value).toBe('60');
  });
});
