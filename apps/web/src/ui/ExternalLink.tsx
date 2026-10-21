import type { ReactNode } from 'react';
import './ui.css';

// Every link that leaves X2F (explorers, wallet sites) opens in a new tab without a referrer or an
// opener (P3-I15). Only https links are accepted.
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https:\/\//i.test(href)) throw new Error('ExternalLink: https links only');
  return (
    <a className="x2f-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}
