// @vitest-environment happy-dom
// Owner demo notes 12 Nov 2026 (#37, 38, 42, 43, 48; lead 12 Nov), DESIGNER-REVIEW: logo D top left
// with the screen name beside it on every trader screen (one shared header, a name per route); the
// type scale one step up through the tokens; /login and /session-length moved down with a row of
// help links; a little more room between the rows on /buy.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ScreenHeader, screenName } from '../src/ui/ScreenHeader.js';
import { HelpLinks, HELP_LINKS } from '../src/ui/HelpLinks.js';
import { HelpTopic, HELP_TOPICS } from '../src/screens/HelpTopic.js';
import { WideTop } from '../src/ui/DesktopShell.js';
import { TradeHeader } from '../src/ui/TradeHeader.js';
import { Route, Routes } from 'react-router';
import { render } from './render.js';

// The help pages read the session (review 12 Nov, L4): signed out unless a test says otherwise.
const state = vi.hoisted(() => ({ session: { status: 'signed-out' } as unknown }));
vi.mock('../src/session/useSession.js', async (orig) => ({ ...(await orig<object>()), useSession: () => state.session }));
afterEach(() => {
  state.session = { status: 'signed-out' };
});

const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('the type scale, one step up (owner #43: bigger, noticeably, not much)', () => {
  it('body 17/26, label 14/17, heading 19/26, screen title 30/34, the rest in proportion', () => {
    const css = read('theme/tokens.css');
    for (const d of [
      '--x2f-body-size: 17px;', '--x2f-body-line: 26px;',
      '--x2f-label-size: 14px;', '--x2f-label-line: 17px;',
      '--x2f-heading-size: 19px;', '--x2f-heading-line: 26px;',
      '--x2f-screen-title-size: 30px;', '--x2f-screen-title-line: 34px;',
      '--x2f-sheet-title-size: 26px;', '--x2f-sheet-title-line: 32px;',
      '--x2f-display-size: 42px;', '--x2f-display-line: 47px;',
      '--x2f-amount-size: 30px;', '--x2f-amount-line: 34px;',
      '--x2f-address-size: 15px;', '--x2f-address-line: 21px;',
    ]) expect(css, d).toContain(d);
  });
});

describe('screenName: the name beside the logo, one per route', () => {
  it('names the front door, the browse boards and the screens behind the door', () => {
    for (const [p, name] of [
      ['/login', 'Log in'], ['/login/backup', 'Use a backup'], ['/session-length', 'Session length'],
      ['/setup', 'Create account'], ['/setup/welcome', 'Create account'], ['/terms', 'Terms'], ['/team/join', 'Join a team'],
      ['/buy', 'Find a trade'], ['/sell', 'Find a trade'], ['/wallets', 'Wallets'], ['/settings/security', 'Security'],
      ['/help/faq', 'FAQ'], ['/help/getting-started', 'Getting started'], ['/help/support', 'Support'], ['/help/settings', 'Settings'],
    ] as const) expect([p, screenName(p)]).toEqual([p, name]);
    expect(screenName('/trade/K7M29QXA4FTR8WPN')).toEqual({ label: 'Trade', code: 'K7M2' });
    // The Landing board draws its own large logo: no header there.
    expect(screenName('/')).toBe('');
  });
});

describe('ScreenHeader: logo D top left, the screen name beside it', () => {
  it('draws the 24 px logo, then the name', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/login']}>
        <ScreenHeader />
      </MemoryRouter>,
    );
    const header = host.querySelector('header[data-screen-header]')!;
    const kids = [...header.children];
    expect(kids[0]!.querySelector('svg[role="img"][aria-label="X2F"]')!.getAttribute('height')).toBe('24');
    expect(header.querySelector('[data-part="screen-name"]')!.textContent).toBe('Log in');
    expect(header.querySelector('a, nav')).toBeNull();
  });

  it('a trade names its code; a route with no name shows the logo alone', () => {
    const trade = render(
      <MemoryRouter initialEntries={['/trade/K7M29QXA4FTR8WPN']}>
        <ScreenHeader />
      </MemoryRouter>,
    ).host;
    expect(trade.querySelector('[data-part="screen-name"]')!.textContent).toBe('Trade · K7M2');
    const none = render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <ScreenHeader />
      </MemoryRouter>,
    ).host;
    expect(none.querySelector('svg[aria-label="X2F"]')).not.toBeNull();
    expect(none.querySelector('[data-part="screen-name"]')).toBeNull();
  });

  it('the wide pre-login top is the same header: the 32 px logo top left with the name the shell gives it', () => {
    const { host } = render(<WideTop name={screenName('/login')} />);
    const header = host.querySelector('header.x2f-wide-top')!;
    expect(header.querySelector('svg[role="img"][aria-label="X2F"]')!.getAttribute('height')).toBe('32');
    expect(header.querySelector('[data-part="screen-name"]')!.textContent).toBe('Log in');
    expect(header.querySelector('nav, a')).toBeNull();
  });

  it('the app shell draws it on every phone screen but the Landing board; browse draws it in its own bar', () => {
    const app = read('App.tsx');
    expect(app).toContain('<ScreenHeader');
    expect(app).toContain('<WideTop name={screenName(pathname)} />');
    expect(read('screens/browse/MethodList.tsx')).toContain('<ScreenHeader');
  });
});

describe('help links on /login and /session-length (owner #38, #42)', () => {
  it('FAQ, Getting started, Support, Settings: each a placeholder page on the front door', () => {
    expect(HELP_LINKS.map((l) => [l.label, l.to])).toEqual([
      ['FAQ', '/help/faq'], ['Getting started', '/help/getting-started'], ['Support', '/help/support'], ['Settings', '/help/settings'],
    ]);
    const { host } = render(
      <MemoryRouter>
        <HelpLinks />
      </MemoryRouter>,
    );
    const nav = host.querySelector('nav[aria-label="Help"][data-part="help-links"]')!;
    expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual(HELP_LINKS.map((l) => [l.label, l.to]));
    expect(read('screens/auth/Login.tsx')).toContain('<HelpLinks');
    expect(read('screens/auth/SessionLength.tsx')).toContain('<HelpLinks');
  });

  it('a help topic is a placeholder page with its name, and an unknown topic says so', () => {
    const at = (path: string) =>
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/help/:topic" element={<HelpTopic />} />
          </Routes>
        </MemoryRouter>,
      ).host;
    const faq = at('/help/faq');
    expect(faq.querySelector('main[data-screen="help-faq"] h1')!.textContent).toBe('FAQ');
    expect(at('/help/nope').querySelector('main[data-screen="help-unknown"]')).not.toBeNull();
  });

  // Review 12 Nov, L4: the same page is read logged out and logged in, so it says the right thing to
  // each, and only a signed-in reader gets links behind the door; a team member gets none to Settings.
  const FULL = { displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password'], hasBackup: true, suggestions: [], holdUntil: null };
  const page = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/help/:topic" element={<HelpTopic />} />
        </Routes>
      </MemoryRouter>,
    ).host;
  const read1 = (host: HTMLElement) => ({
    body: host.querySelector('[data-part="help-body"]')!.textContent,
    action: host.querySelector('[data-part="help-action"]')?.getAttribute('href') ?? null,
    back: [host.querySelector('[data-part="help-back"]')!.textContent, host.querySelector('[data-part="help-back"]')!.getAttribute('href')],
  });

  it('logged out: "once you are logged in", no link behind the door, back to log in', () => {
    for (const topic of Object.keys(HELP_TOPICS)) {
      const r = read1(page(`/help/${topic}`));
      expect(r.body, topic).toBe(HELP_TOPICS[topic]!.out);
      expect(r.action, topic).toBeNull();
      expect(r.back, topic).toEqual(['Back to log in', '/login']);
    }
  });

  it('logged in: no "once you are logged in", the way on, and back to trading', () => {
    state.session = { status: 'signed-in', me: FULL };
    for (const topic of Object.keys(HELP_TOPICS)) {
      const r = read1(page(`/help/${topic}`));
      expect(r.body, topic).toBe(HELP_TOPICS[topic]!.in);
      expect(r.body, topic).not.toMatch(/logged in/i);
      expect(r.back, topic).toEqual(['Back to trading', '/sell']);
    }
    expect(read1(page('/help/support')).action).toBe('/feedback');
    expect(read1(page('/help/settings')).action).toBe('/settings/security');
  });

  it('a team member: no link to the owner-only Settings', () => {
    state.session = { status: 'signed-in', me: { ...FULL, member: { name: 'Ana', roles: ['trades'] } } };
    const s = read1(page('/help/settings'));
    expect(s.action).toBeNull();
    expect(s.body).toBe(HELP_TOPICS.settings!.member);
    expect(read1(page('/help/support')).action).toBe('/feedback');
  });
});

describe('the trade room and its dispute: logo D and the name in TradeHeader (lead 12 Nov follow-up)', () => {
  const ZELLE = { name: 'Zelle', whatItIs: 'A US bank app.' };
  for (const [path, name] of [['/trade/K7M29QXA4FTR8WPN', 'Trade · K7M2'], ['/trade/K7M29QXA4FTR8WPN/dispute', 'Dispute · K7M2']] as const) {
    it(`${path}: the shared header sits at the top of the trade header, hidden with it on a tabletop`, () => {
      const { host } = render(
        <MemoryRouter initialEntries={[path]}>
          <TradeHeader title="Selling to mira.k" code="K7M2-9QXA-4FTR-8WPN" method={ZELLE} backTo="/sell" />
        </MemoryRouter>,
      );
      const brand = host.querySelector('[data-fold-glance="header"] > .x2f-trade-header__brand')!;
      // Drawn as a div, so the room has one header element, the board's row (review 12 Nov, L5).
      expect(brand.querySelector('div[data-screen-header] svg[role="img"][aria-label="X2F"]')).not.toBeNull();
      expect(host.querySelectorAll('header')).toHaveLength(1);
      expect(brand.querySelector('[data-part="screen-name"]')!.textContent).toBe(name);
      // The board's header row is unchanged after it.
      expect(brand.nextElementSibling?.matches('header.x2f-trade-header')).toBe(true);
    });
  }
});
