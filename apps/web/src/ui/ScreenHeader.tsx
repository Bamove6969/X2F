import { useLocation } from 'react-router';
import { railPageName, type RailPageName } from './DesktopShell.js';
import { Logo } from './Logo.js';
import './ui.css';

/*
 * Owner demo notes 12 Nov 2026 #37 ("the logo in the top left of every screen with the screen name
 * beside it"), lead 12 Nov. DESIGNER-REVIEW: one shared header for every trader screen, the front door
 * included: logo D top left (not a link: before login nothing here leads behind the door), then the
 * screen's name. The phone shell draws it on every screen but the Landing board (which has its own
 * large logo); Buy/Sell draw it in their own bar, beside the Site news bell and the Buy/Sell tabs;
 * the wide pre-login top (WideTop) is this header with the 32 px logo. The wide rail keeps its own
 * head (logo, bell, page name), which already names the page. Screens keep their own titles.
 */

/** The names the rail does not carry (the front door and the screens no *-Wide board names). COPY-UNSIGNED */
const MORE: [RegExp, string][] = [
  [/^\/login\/backup\/?$/, 'Use a backup'],
  [/^\/login\/?$/, 'Log in'],
  [/^\/session-length\/?$/, 'Session length'],
  [/^\/setup(\/|$)/, 'Create account'],
  [/^\/terms\/?$/, 'Terms'],
  [/^\/team\/join\/?$/, 'Join a team'],
  [/^\/help\/faq\/?$/, 'FAQ'],
  [/^\/help\/getting-started\/?$/, 'Getting started'],
  [/^\/help\/support\/?$/, 'Support'],
  [/^\/help\/settings\/?$/, 'Settings'],
  [/^\/help(\/|$)/, 'Help'],
  [/^\/settings\/changes(\/|$)/, 'Account changes'],
  [/^\/settings\/jabber\/events(\/|$)/, 'Jabber notices'],
  [/^\/settings\/jabber(\/|$)/, 'Jabber'],
  [/^\/settings\/account-type(\/|$)/, 'Account type'],
  [/^\/settings(\/|$)/, 'Settings'],
  [/^\/profile(\/|$)/, 'Profile'],
];

/** The name beside the logo for `pathname`; '' for the Landing board and any route with no name. */
export function screenName(pathname: string): RailPageName {
  if (pathname === '/' || pathname === '') return '';
  const rail = railPageName(pathname);
  if (rail !== '') return rail;
  return MORE.find(([re]) => re.test(pathname))?.[1] ?? '';
}

/**
 * The element the header is drawn as. A `header` where it is the screen's own top; a `div` inside a bar
 * that is already a header or a phrasing wrapper (Buy/Sell's bar, the trade header): a `header` may not
 * sit inside another `header` or a `span` (review 12 Nov, L5).
 */
export type ScreenHeaderAs = 'header' | 'div';

/** The shared header for the current route: logo D, then the route's screen name. */
export function ScreenHeader({ size = 24, className, as = 'header' }: { size?: 24 | 32; className?: string; as?: ScreenHeaderAs }) {
  const { pathname } = useLocation();
  return <ScreenHeaderView name={screenName(pathname)} size={size} as={as} {...(className !== undefined ? { className } : {})} />;
}

/** The same header for a given name (the wide pre-login top, which the shell hands the name). */
export function ScreenHeaderView({ name, size = 24, className, as: Tag = 'header' }: { name: RailPageName; size?: 24 | 32; className?: string; as?: ScreenHeaderAs }) {
  return (
    <Tag className={className === undefined ? 'x2f-screen-header' : `x2f-screen-header ${className}`} data-screen-header="">
      <span className="x2f-screen-header__logo">
        <Logo size={size} />
      </span>
      {name === '' ? null : (
        <span className="x2f-screen-header__name" data-part="screen-name">
          {typeof name === 'string' ? (
            name
          ) : (
            <>
              {name.label} · <span className="x2f-rail__code">{name.code}</span>
            </>
          )}
        </span>
      )}
    </Tag>
  );
}
