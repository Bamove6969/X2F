// @vitest-environment happy-dom
// Owner demo note #101 (16 Nov 2026): "The entire settings area is completely ugly, doesn't stick
// to brand, and should be broken into tabs". Settings is five tabs (Security, Alerts, Account,
// Preferences, Help), each its own route; every settings screen stays at its route, under its tab; old
// Security deep links to a section that moved are sent on to its tab.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSettings, AlertsSettings, MovedSectionRedirect, SettingsTabs, movedSection, useHashTarget } from '../src/screens/settings/SettingsTabs.js';
import { HelpSettings } from '../src/screens/settings/Security.js';
import { ACCOUNT_PATH, ALERTS_PATH, PREFERENCES_PATH, SECURITY_PATH, SETTINGS_HELP_PATH, SETTINGS_TABS, settingsTabOf } from '../src/screens/settings/settingsCopy.js';
import { BLOCKED_PATH } from '../src/screens/settings/BlockAction.js';
import { TEAM_PATH } from '../src/screens/settings/teamCopy.js';
import { ACCOUNT_TYPE_PATH } from '../src/screens/settings/accountTypeCopy.js';
import { DEVICES_PATH } from '../src/screens/settings/devicesCopy.js';
import { CHANGES_PATH } from '../src/screens/settings/holdCopy.js';
import { IDLE_REMINDER_PATH } from '../src/screens/auth/sessionCopy.js';
import { TourProvider } from '../src/tour/TourProvider.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The tab pages wait for the session to know whether this is the owner or a team member (main's
// order #2 B1 / M3, kept through the tabs): an owner's session here; securityMember.test.tsx has the member's.
const ME = { kind: 'trader', level: 'full', termsCurrent: true, displayName: 'Calcium', methods: ['password'], accountType: 'vendor', pendingChanges: null, member: null };

beforeEach(() => {
  refreshSession();
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input).split('?')[0]!;
    if (url === '/v1/account/me') return json(200, ME);
    if (url === '/v1/account/alerts') return json(200, []);
    if (url === '/v1/account/jabber') return json(200, { available: false });
    return json(404, { error: 'not-found' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function Where() {
  const { pathname, hash } = useLocation();
  return <output data-part="where">{pathname + hash}</output>;
}

describe('note #101: which tab each settings screen is under', () => {
  it('every existing settings route keeps a tab, and the tabs are the five pages', () => {
    expect(SETTINGS_TABS.map((t) => t.to)).toEqual([SECURITY_PATH, ALERTS_PATH, ACCOUNT_PATH, PREFERENCES_PATH, SETTINGS_HELP_PATH]);
    const under: [string, string][] = [
      [SECURITY_PATH, 'security'], [CHANGES_PATH, 'security'], [DEVICES_PATH, 'security'], [IDLE_REMINDER_PATH, 'security'],
      [ALERTS_PATH, 'alerts'], ['/settings/jabber', 'alerts'], ['/settings/jabber/events', 'alerts'],
      [ACCOUNT_PATH, 'account'], [ACCOUNT_TYPE_PATH, 'account'], [TEAM_PATH, 'account'], [BLOCKED_PATH, 'account'],
      [PREFERENCES_PATH, 'preferences'], [SETTINGS_HELP_PATH, 'help'],
    ];
    for (const [path, tab] of under) expect(settingsTabOf(path), path).toBe(tab);
    expect(settingsTabOf('/settings/account-typo')).toBeNull();
    expect(settingsTabOf('/wallets')).toBeNull();
  });

  it('the tab bar is a labelled nav of links, the current tab marked (aria-current), in the segment look', () => {
    const { host } = render(
      <MemoryRouter>
        <SettingsTabs current="alerts" />
      </MemoryRouter>,
    );
    const nav = host.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Settings sections');
    expect(nav.classList.contains('x2f-segment')).toBe(true);
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Security', SECURITY_PATH], ['Alerts', ALERTS_PATH], ['Account', ACCOUNT_PATH], ['Preferences', PREFERENCES_PATH], ['Help', SETTINGS_HELP_PATH],
    ]);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Alerts']);
  });
});

describe('note #101: the tab pages', () => {
  it('Account links on to Account type, Team and Blocked traders, each at its own route', () => {
    const { host } = render(
      <MemoryRouter initialEntries={[ACCOUNT_PATH]}>
        <AccountSettings />
      </MemoryRouter>,
    );
    expect(host.querySelector('h1')!.textContent).toBe('Settings');
    expect(host.querySelector('main')!.getAttribute('data-settings-tab')).toBe('account');
    const hrefs = [...host.querySelectorAll('[data-part="account-links"] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([ACCOUNT_TYPE_PATH, TEAM_PATH, BLOCKED_PATH]);
  });

  it('Alerts holds the alerts list that used to sit on Security', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={[ALERTS_PATH]}>
        <AlertsSettings />
      </MemoryRouter>,
    );
    await flush();
    expect(host.querySelector('main')!.getAttribute('data-screen')).toBe('settings-alerts');
    expect(host.querySelector('#alerts-h')?.textContent?.trim()).toBe('Alerts');
    expect(host.querySelector('[aria-current="page"]')!.textContent).toBe('Alerts');
  });

  it('Help holds the tour replay and the way back to the welcome screen', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={[SETTINGS_HELP_PATH]}>
        <TourProvider>
          <HelpSettings />
        </TourProvider>
      </MemoryRouter>,
    );
    await flush();
    expect(host.querySelector('[data-part="tour-replay"]')).not.toBeNull();
    expect(host.querySelector('[data-part="welcome-link"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')!.textContent).toBe('Help');
  });
});

describe('note #101: deep links', () => {
  it('an old Security link to a section that moved goes to its tab, hash kept; others stay', () => {
    expect(movedSection(SECURITY_PATH, '#alerts-h')).toBe(`${ALERTS_PATH}#alerts-h`);
    expect(movedSection(SECURITY_PATH, '#al-xmpp')).toBe(`${ALERTS_PATH}#al-xmpp`);
    expect(movedSection(SECURITY_PATH, '#methods-h')).toBeNull();
    expect(movedSection(SECURITY_PATH, '')).toBeNull();
    expect(movedSection(ALERTS_PATH, '#alerts-h')).toBeNull();
    expect(movedSection(SECURITY_PATH, '#constructor')).toBeNull();
  });

  it('the redirect follows it in the router', () => {
    const { host } = render(
      <MemoryRouter initialEntries={[`${SECURITY_PATH}#alerts-h`]}>
        <Routes>
          <Route path={SECURITY_PATH} element={<MovedSectionRedirect />} />
          <Route path={ALERTS_PATH} element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-part="where"]')!.textContent).toBe(`${ALERTS_PATH}#alerts-h`);
  });

  it('a #section in the address is scrolled to once it has rendered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const scrolled: string[] = [];
      function Page({ late }: { late: boolean }) {
        useHashTarget('#methods-h');
        return late ? (
          <h2 id="methods-h" ref={(el) => { if (el) el.scrollIntoView = () => void scrolled.push(el.id); }}>
            Login methods
          </h2>
        ) : null;
      }
      const r = render(<Page late={false} />);
      expect(scrolled).toEqual([]);
      r.rerender(<Page late />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(scrolled).toEqual(['methods-h']);
    } finally {
      vi.useRealTimers();
    }
  });
});
