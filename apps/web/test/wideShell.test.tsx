// @vitest-environment happy-dom
// Job 3, the wide frame (design review 8 Nov 2026 items 2 and 3, design-build-gaps Job 3): the
// 240 px left rail of the *-Wide boards (logo D, the page name under it, Trade / Post offer /
// Wallets / Profile / Settings / Help), the centred logo before login, and logo D wherever the text
// "X2F" stood in for it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DesktopRail, DesktopShell, WideTop, railPageName, wideFrameOf } from '../src/ui/DesktopShell.js';
import { Logo } from '../src/ui/Logo.js';
import { render } from './render.js';

// happy-dom's import.meta.url is not a file URL; the directory is.
const SRC = join(import.meta.dirname, '..', 'src');

function rail(path: string, postOffers = true, wallets = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DesktopRail postOffers={postOffers} wallets={wallets} />
    </MemoryRouter>,
  ).host;
}

describe('rail without the Offers role (review M4)', () => {
  it('marks Profile current on /profile/offers, since Post offer is not listed', () => {
    const host = rail('/profile/offers', false);
    const cur = [...host.querySelectorAll('a.x2f-rail__link[aria-current="page"]')].map((a) => a.textContent);
    expect(cur).toEqual(['Profile']);
  });
});

describe('Logo (logo D, docs/brand/svg on wip/design-brief)', () => {
  it('is the board mark: ink letters and the one orange dot, named X2F once', () => {
    const { host } = render(<Logo size={24} />);
    const svg = host.querySelector('svg')!;
    expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['60', '24', '0 0 60 24']);
    expect([svg.getAttribute('role'), svg.getAttribute('aria-label')]).toEqual(['img', 'X2F']);
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('currentColor');
    expect(svg.querySelector('circle')!.getAttribute('class')).toBe('x2f-logo__dot');
    // No style attribute anywhere: the CSP has no 'unsafe-inline' for styles.
    expect(host.querySelector('[style]')).toBeNull();
  });

  it('comes at 32 (the pre-login header) and can be hidden from readers when a link names it', () => {
    const { host } = render(<Logo size={32} decorative />);
    const svg = host.querySelector('svg')!;
    expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['78', '32', '0 0 78 32']);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
  });
});

describe('DesktopRail (SellQuote-Wide, Settings-Wide and the other *-Wide boards)', () => {
  it('has the logo as the home link, the page name under it, then the pages in board order, with My trades after Trade (not on the boards yet)', () => {
    const host = rail('/sell');
    const nav = host.querySelector('nav[aria-label="Main"].x2f-rail')!;
    // The rail head carries the logo link and the Site news bell beside it (lead default 9 Nov; HEAD's
    // rail head wins over J-17's .x2f-brand span, lead batch 4).
    const home = nav.querySelector('.x2f-rail__head > a[aria-label="X2F home"]')!;
    expect(home.getAttribute('href')).toBe('/sell');
    expect(home.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(nav.querySelector('.x2f-rail__page')!.textContent).toBe('Find a trade');
    const links = [...nav.querySelectorAll('a.x2f-rail__link')];
    expect(links.map((a) => a.textContent)).toEqual(['Trade', 'My trades', 'Post offer', 'Wallets', 'Profile', 'Settings', 'Help']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/sell', '/trades', '/post', '/wallets', '/profile', '/settings/security', '/feedback']);
    for (const a of links) expect(a.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // The words "X2F" never stand in for the mark.
    expect(nav.textContent).not.toContain('X2F');
  });

  it('marks one page current, the way the boards do', () => {
    const cases: [string, string][] = [
      ['/sell', 'Trade'],
      ['/buy?currency=EUR', 'Trade'],
      ['/sell/ZELLE/offer-1', 'Trade'],
      ['/trade/K7M29QXA4FTR8WPN', 'Trade'],
      ['/news', 'Trade'],
      ['/post', 'Post offer'],
      // MyOffers-Wide: My offers sits under Post offer.
      ['/profile/offers', 'Post offer'],
      ['/wallets', 'Wallets'],
      ['/profile', 'Profile'],
      ['/settings/devices', 'Settings'],
      ['/settings/team', 'Settings'],
      ['/feedback', 'Help'],
    ];
    for (const [path, current] of cases) {
      const host = rail(path);
      const cur = [...host.querySelectorAll('a.x2f-rail__link[aria-current="page"]')];
      expect([path, cur.map((a) => a.textContent)]).toEqual([path, [current]]);
    }
  });

  it('leaves out Post offer for a trader/vendor without the Offers role', () => {
    const host = rail('/sell', false, true);
    expect([...host.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual(['Trade', 'My trades', 'Wallets', 'Profile', 'Settings', 'Help']);
  });

  it('leaves out owner-only routes (Wallets) for a team member while keeping Settings (Order #2 M3)', () => {
    // `trades` is left at its default (true) here: My trades has its own case below (review trades-list m1).
    // Member with offers role (wallets=false): Trade, Post offer, Profile, Settings, Help (never Wallets)
    const hostWithOffers = rail('/sell', true, false);
    expect([...hostWithOffers.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual([
      'Trade',
      'My trades',
      'Post offer',
      'Profile',
      'Settings',
      'Help',
    ]);
    expect([...hostWithOffers.querySelectorAll('a.x2f-rail__link')].map((a) => a.getAttribute('href'))).toEqual([
      '/sell',
      '/trades',
      '/post',
      '/profile',
      '/settings/security',
      '/feedback',
    ]);

    // Member without offers role (postOffers=false, wallets=false): Trade, Profile, Settings, Help
    const hostWithoutOffers = rail('/sell', false, false);
    expect([...hostWithoutOffers.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual([
      'Trade',
      'My trades',
      'Profile',
      'Settings',
      'Help',
    ]);

    // Account owner (wallets=true): all 6 links present
    const hostOwner = rail('/sell', true, true);
    expect([...hostOwner.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual([
      'Trade',
      'My trades',
      'Post offer',
      'Wallets',
      'Profile',
      'Settings',
      'Help',
    ]);

    // Cold load / loading session (wallets=false): leaves out Wallets to avoid flicker (M1)
    const hostLoading = rail('/sell', true, false);
    expect([...hostLoading.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual([
      'Trade',
      'My trades',
      'Post offer',
      'Profile',
      'Settings',
      'Help',
    ]);
  });

  it('leaves out My trades for a session that may read no part of the trades list (review m1), as the phone tab bar does', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <DesktopRail trades={false} />
      </MemoryRouter>,
    );
    expect([...host.querySelectorAll('a.x2f-rail__link')].map((a) => a.textContent)).toEqual(['Trade', 'Post offer', 'Wallets', 'Profile', 'Settings', 'Help']);
  });
});

describe('railPageName', () => {
  it('names each page the way the *-Wide boards do', () => {
    expect(railPageName('/sell')).toBe('Find a trade');
    expect(railPageName('/buy')).toBe('Find a trade');
    expect(railPageName('/sell/ZELLE')).toBe('Offers');
    expect(railPageName('/buy/ZELLE/offer-1')).toBe('Your quote');
    // BuyerPaidWaiting-Wide: "Trade · K7M2", the code's first group in mono.
    expect(railPageName('/trade/k7m2-9qxa-4ftr-8wpn')).toEqual({ label: 'Trade', code: 'K7M2' });
    expect(railPageName('/trade/not a code!')).toBe('Trade');
    expect(railPageName('/trade/K7M29QXA4FTR8WPN/dispute')).toEqual({ label: 'Dispute', code: 'K7M2' });
    expect(railPageName('/post')).toBe('Post an offer');
    expect(railPageName('/profile/offers')).toBe('My offers');
    expect(railPageName('/wallets')).toBe('Wallets');
    expect(railPageName('/settings/security')).toBe('Security');
    expect(railPageName('/settings/devices')).toBe('Devices');
    expect(railPageName('/settings/blocked')).toBe('Blocked');
    expect(railPageName('/settings/team')).toBe('Team');
    expect(railPageName('/news')).toBe('Site news');
    expect(railPageName('/feedback')).toBe('Feedback');
    expect(railPageName('/somewhere-else')).toBe('');
  });

  it('shows the code group in mono in the rail', () => {
    const host = rail('/trade/K7M29QXA4FTR8WPN');
    const page = host.querySelector('.x2f-rail__page')!;
    expect(page.textContent).toBe('Trade · K7M2');
    expect(page.querySelector('.x2f-rail__code')!.textContent).toBe('K7M2');
  });
});

describe('wideFrameOf: before login the logo is centred and there is no rail', () => {
  it('picks the centred top for the sign-in and setup routes, the rail everywhere else', () => {
    for (const p of ['/login', '/login/backup', '/setup', '/setup/username', '/terms', '/team/join']) expect([p, wideFrameOf(p)]).toEqual([p, 'centred']);
    for (const p of ['/sell', '/buy/ZELLE', '/trade/K7M29QXA4FTR8WPN', '/wallets', '/post', '/settings/security', '/feedback', '/loginx']) {
      expect([p, wideFrameOf(p)]).toEqual([p, 'rail']);
    }
  });

  it('WideTop is a header with the 32 px logo and no navigation', () => {
    const { host } = render(<WideTop />);
    const header = host.querySelector('header.x2f-wide-top')!;
    expect(header.querySelector('svg[role="img"][aria-label="X2F"]')!.getAttribute('height')).toBe('32');
    expect(header.querySelector('nav, a')).toBeNull();
  });
});

describe('DesktopShell', () => {
  it('is the rail beside the page', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/trade/K7M29QXA4FTR8WPN']}>
        <DesktopShell>
          <p>room</p>
        </DesktopShell>
      </MemoryRouter>,
    );
    const shell = host.querySelector('[data-shell="desktop"][data-wide-frame="rail"]')!;
    expect(shell.children[0]!.matches('nav.x2f-rail')).toBe(true);
    expect(shell.children[1]!.matches('.x2f-desktop__body')).toBe(true);
    expect(shell.querySelector('a.x2f-rail__link[aria-current="page"]')!.textContent).toBe('Trade');
    expect(host.textContent).toContain('room');
  });
});

describe('the wide frame CSS (no stretched phone layout)', () => {
  const ui = readFileSync(join(SRC, 'ui', 'ui.css'), 'utf8');
  const quote = readFileSync(join(SRC, 'screens', 'quote', 'quote.css'), 'utf8');
  const rule = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the rail is 240 px with the boards\' 24 16 padding; the content pads 32 48 48', () => {
    expect(rule(ui, '.x2f-rail')).toMatch(/width: 240px;/);
    expect(rule(ui, '.x2f-rail')).toMatch(/padding: var\(--x2f-space-6\) var\(--x2f-space-4\);/);
    expect(rule(ui, "[data-wide-frame='rail'] > .x2f-desktop__body")).toMatch(/padding: 32px 48px 48px;/);
    // The current page: the raised surface and the one inset line the kit allows (kit 1.1).
    expect(rule(ui, ".x2f-rail__link[aria-current='page']")).toMatch(/box-shadow: inset 2px 0 0 var\(--x2f-ink\);/);
  });

  it('content is at most 720 px, or 944 px (two columns) for the screens that lay out two', () => {
    expect(rule(ui, "[data-wide-frame='rail'] > .x2f-desktop__body > .x2f-panes > [data-pane='main'] > *")).toMatch(/max-width: 720px;/);
    expect(ui).toMatch(/\[data-pane='main'\] > :is\(\.x2f-quote, :has\(\.x2f-room\), :has\(\.x2f-columns\), :has\(\.x2f-flow\[data-look='page'\]\)\) \{\s*max-width: 944px;/);
  });

  it('the wide quote is two columns, 560 and 360, with Trade at the top of the second', () => {
    expect(rule(quote, "[data-shell='desktop'] .x2f-quote")).toMatch(/grid-template-columns: minmax\(0, 560px\) minmax\(280px, 360px\);/);
    expect(rule(quote, "[data-shell='desktop'] .x2f-quote__footer")).toMatch(/grid-column: 2;/);
  });
});

describe('logo D wherever "X2F" stood in for it (design review item 3)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
    });

  it('no element of the app draws the letters X2F as a wordmark', () => {
    const offenders = files(SRC).filter((f) => /<span[^>]*>\s*X2F\s*<\/span>/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
