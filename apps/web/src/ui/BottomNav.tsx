import { Link, useLocation } from 'react-router';
import { Icon, type IconName } from './icons.js';
import './ui.css';

// The phone tab bar from the Main board: Trade, Post offer, Wallets, Profile. Trade covers both
// the Sell and the Buy browse screens. The boards with the tab bar (Main, BuyMain) have no primary
// action, so the bar carries no data-primary (their parity runs with { primary: false }).
const TABS: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { to: '/sell', label: 'Trade', icon: 'trade', match: (p) => /^\/(sell|buy)(\/|$)/.test(p) },
  { to: '/post', label: 'Post offer', icon: 'plus-circle', match: (p) => /^\/post(\/|$)/.test(p) },
  { to: '/wallets', label: 'Wallets', icon: 'wallet', match: (p) => /^\/wallets(\/|$)/.test(p) },
  { to: '/profile', label: 'Profile', icon: 'user', match: (p) => /^\/profile(\/|$)/.test(p) },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="x2f-bottom-nav">
      {TABS.map((t) => {
        const current = t.match(pathname);
        return (
          <Link key={t.to} to={t.to} className="x2f-bottom-nav__tab" aria-current={current ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
