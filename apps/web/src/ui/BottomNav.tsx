import { Link, useLocation } from 'react-router';
import { Icon, type IconName } from './icons.js';
import './ui.css';

// The phone tab bar from the Main board: Trade, Post offer, Wallets, Profile, with My trades after
// Trade (the trades list, not on the board yet). Trade covers both
// the Sell and the Buy browse screens. The boards with the tab bar (Main, BuyMain) have no primary
// action, so the bar carries no data-primary (their parity runs with { primary: false }). Each tab
// carries where it was pressed (router state `from`), so PostOffer's Close can return there.
// `postOffers` false leaves out Post offer, for a team member without the Offers role (design
// review 2026-11-01, shot 26: no tab that only leads to a refusal).
const TABS: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { to: '/sell', label: 'Trade', icon: 'trade', match: (p) => /^\/(sell|buy)(\/|$)/.test(p) },
  // My trades (register D-005; DESIGNER-REVIEW: no board has a fifth tab yet). COPY-UNSIGNED
  { to: '/trades', label: 'My trades', icon: 'list-check', match: (p) => /^\/trades(\/|$)/.test(p) },
  { to: '/post', label: 'Post offer', icon: 'plus-circle', match: (p) => /^\/post(\/|$)/.test(p) },
  { to: '/wallets', label: 'Wallets', icon: 'wallet', match: (p) => /^\/wallets(\/|$)/.test(p) },
  { to: '/profile', label: 'Profile', icon: 'user', match: (p) => /^\/profile(\/|$)/.test(p) },
];

export function BottomNav({ postOffers = true, wallets = true }: { postOffers?: boolean; wallets?: boolean | undefined }) {
  const { pathname } = useLocation();
  let tabs = postOffers ? TABS : TABS.filter((t) => t.to !== '/post');
  if (!wallets) tabs = tabs.filter((t) => t.to !== '/wallets');
  return (
    <nav aria-label="Main" className="x2f-bottom-nav">
      {tabs.map((t) => {
        const current = t.match(pathname);
        return (
          <Link key={t.to} to={t.to} state={{ from: pathname }} className="x2f-bottom-nav__tab" aria-current={current ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
