import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import './ui.css';

// The frame of the Desktop board (1280×800): the X2F wordmark and the Buy, Sell, My trades and
// Wallets links, then the page.
const LINKS: { to: string; label: string; match: (path: string) => boolean }[] = [
  { to: '/buy', label: 'Buy', match: (p) => /^\/buy(\/|$)/.test(p) },
  { to: '/sell', label: 'Sell', match: (p) => /^\/sell(\/|$)/.test(p) },
  { to: '/trades', label: 'My trades', match: (p) => /^\/trades?(\/|$)/.test(p) },
  { to: '/wallets', label: 'Wallets', match: (p) => /^\/wallets(\/|$)/.test(p) },
];

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div data-shell="desktop" className="x2f-desktop">
      <DesktopHeader />
      <div className="x2f-desktop__body">{children}</div>
    </div>
  );
}

/** The Desktop board's header on its own: the app shell keeps one tree for every layout (Task 40). */
export function DesktopHeader() {
  const { pathname } = useLocation();
  return (
    <header className="x2f-desktop__header">
      <span className="x2f-wordmark">X2F</span>
      <nav aria-label="Main" className="x2f-desktop__nav">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} aria-current={l.match(pathname) ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
