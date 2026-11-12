import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { normalizeTradeCode } from '@x2f/core';
import { Icon, type IconName } from './icons.js';
import { Logo } from './Logo.js';
import { NewsBell } from './NewsBell.js';
import { ScreenHeaderView } from './ScreenHeader.js';
import './ui.css';

/*
 * The wide frame (Job 3; design review 8 Nov 2026 items 2 and 3). After login, the 240 px left rail
 * of the *-Wide boards (SellQuote-Wide, Settings-Wide, ...): logo D as the home link with the page
 * name under it (the Site news bell beside the logo, placement pending design), then Trade, Post
 * offer, Wallets, Profile, Settings and Help. Before login (sign-in,
 * setup, terms, a team invite: Login-Wide, SignupSecurity-Wide), the logo is centred at the top and
 * there is no navigation. Phones keep their own header and the bottom tab bar.
 */

const LINKS: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  // Trade covers both browse sides, a quote, a trade and its dispute, and site news (News-Wide).
  { to: '/sell', label: 'Trade', icon: 'trade', match: (p) => /^\/(sell|buy|trade|news)(\/|$)/.test(p) },
  // My trades (register D-005): not on the *-Wide boards yet (the Desktop board left its "My trades"
  // card out until the list existed). DESIGNER-REVIEW, COPY-UNSIGNED
  { to: '/trades', label: 'My trades', icon: 'list-check', match: (p) => /^\/trades(\/|$)/.test(p) },
  // MyOffers-Wide: My offers sits under Post offer.
  { to: '/post', label: 'Post offer', icon: 'plus-circle', match: (p) => /^\/(post|profile\/offers)(\/|$)/.test(p) },
  { to: '/wallets', label: 'Wallets', icon: 'wallet', match: (p) => /^\/wallets(\/|$)/.test(p) },
  { to: '/profile', label: 'Profile', icon: 'user', match: (p) => /^\/profile(\/|$)/.test(p) && !/^\/profile\/offers(\/|$)/.test(p) },
  // No settings hub yet (gap list, job 6): Settings opens Security, the first settings page built.
  { to: '/settings/security', label: 'Settings', icon: 'settings', match: (p) => /^\/settings(\/|$)/.test(p) },
  // No Support or FAQ screen yet (gap list, job 6): Help opens Feedback, the one way to reach staff.
  { to: '/feedback', label: 'Help', icon: 'help', match: (p) => /^\/feedback(\/|$)/.test(p) },
];

/** The routes before login: the wide layout shows the centred logo there, never the rail. */
const PRE_LOGIN = /^\/(login|setup|terms|team\/join|help)(\/|$)/;

export type WideFrame = 'rail' | 'centred';

export function wideFrameOf(pathname: string): WideFrame {
  return PRE_LOGIN.test(pathname) ? 'centred' : 'rail';
}

/** A trade's page name: "Trade · K7M2" (BuyerPaidWaiting-Wide), the code's first group in mono. */
export type RailPageName = string | { label: string; code: string };

const NAMES: [RegExp, string][] = [
  [/^\/(sell|buy)\/?$/, 'Find a trade'],
  [/^\/(sell|buy)\/[^/]+\/[^/]+\/?$/, 'Your quote'],
  [/^\/(sell|buy)\/[^/]+\/?$/, 'Offers'],
  [/^\/post(\/|$)/, 'Post an offer'],
  [/^\/profile\/offers(\/|$)/, 'My offers'],
  [/^\/trades(\/|$)/, 'My trades'],
  [/^\/wallets(\/|$)/, 'Wallets'],
  [/^\/settings\/security(\/|$)/, 'Security'],
  [/^\/settings\/devices(\/|$)/, 'Devices'],
  [/^\/settings\/blocked(\/|$)/, 'Blocked'],
  [/^\/settings\/team(\/|$)/, 'Team'],
  [/^\/news(\/|$)/, 'Site news'],
  [/^\/feedback(\/|$)/, 'Feedback'],
];

/** The page name under the logo, as the *-Wide boards write it; '' where no board names the page. */
export function railPageName(pathname: string): RailPageName {
  const trade = /^\/trade\/([^/]+)(\/dispute)?\/?$/.exec(pathname);
  if (trade) {
    const label = trade[2] ? 'Dispute' : 'Trade';
    let code: string | null = null;
    try {
      code = normalizeTradeCode(decodeURIComponent(trade[1]!));
    } catch {
      code = null;
    }
    return code === null ? label : { label, code: code.replace(/-/g, '').slice(0, 4) };
  }
  return NAMES.find(([re]) => re.test(pathname))?.[1] ?? '';
}

function PageName({ name }: { name: RailPageName }) {
  if (name === '') return null;
  return (
    <span className="x2f-rail__page">
      {typeof name === 'string' ? (
        name
      ) : (
        <>
          {name.label} · <span className="x2f-rail__code">{name.code}</span>
        </>
      )}
    </span>
  );
}

/**
 * The left rail. `postOffers` false leaves out Post offer, as the phone tab bar does for a member
 * without the Offers role; `trades` false leaves out My trades (review trades-list m1).
 */
export function DesktopRail({ postOffers = true, trades = true }: { postOffers?: boolean; trades?: boolean }) {
  const { pathname } = useLocation();
  const links = LINKS.filter((l) => (postOffers || l.to !== '/post') && (trades || l.to !== '/trades'));
  // Without the Offers role Post offer is not listed, so /profile/offers sits under Profile.
  const isCurrent = (l: (typeof LINKS)[number]) =>
    l.match(pathname) || (!postOffers && l.to === '/profile' && /^\/profile\/offers(\/|$)/.test(pathname));
  return (
    <nav aria-label="Main" className="x2f-rail">
      <div className="x2f-rail__head">
        <Link to="/sell" aria-label="X2F home" className="x2f-rail__home">
          <Logo size={24} decorative />
        </Link>
        {/*
          Site news, the bell beside the logo (owner 29 Oct; W-002: News stays reachable after "Don't
          show me this again"). Placement pending design (lead default): the rail head is the one
          place present on every wide screen after login; the boards do not draw the bell on wide yet.
        */}
        <NewsBell />
        <PageName name={railPageName(pathname)} />
      </div>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          state={{ from: pathname }}
          className="x2f-rail__link"
          aria-current={isCurrent(l) ? 'page' : undefined}
        >
          <Icon name={l.icon} size={20} stroke={1.75} />
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Before login (Login-Wide, SignupSecurity-Wide): the 32 px logo and nothing to click. Owner demo
 * notes 12 Nov 2026 #37 (DESIGNER-REVIEW): top left with the screen name beside it, the shared header.
 */
export function WideTop({ name = '' }: { name?: RailPageName }) {
  return <ScreenHeaderView name={name} size={32} className="x2f-wide-top" />;
}

/** The frame on its own around a page (the app shell, App.tsx, draws the same parts in one tree for every layout). */
export function DesktopShell({ children, postOffers = true, trades = true }: { children: ReactNode; postOffers?: boolean; trades?: boolean }) {
  const { pathname } = useLocation();
  const frame = wideFrameOf(pathname);
  return (
    <div data-shell="desktop" data-wide-frame={frame} className="x2f-desktop">
      {frame === 'rail' ? <DesktopRail postOffers={postOffers} trades={trades} /> : <WideTop />}
      <div className="x2f-desktop__body">{children}</div>
    </div>
  );
}
