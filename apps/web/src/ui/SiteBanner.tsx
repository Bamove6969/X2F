import type { SiteBannerInfo } from '../api/site.js';
import { Notice } from './Notice.js';
import './site-banner.css';

/**
 * Plan 4 Task 8: the owner's banner (at most 140 characters) at the top of every trader screen,
 * built on the kit's Notice: info is teal with the info icon, warning is amber with the caution
 * triangle, each with its kind word as the title so the kind never rests on colour alone.
 */
// COPY-UNSIGNED: the plan says "an icon and a word" and gives no words.
export const BANNER_WORD = { info: 'Info', warning: 'Warning' } as const;

export function SiteBanner({ banner }: { banner: SiteBannerInfo | null }) {
  if (banner === null) return null;
  return (
    <div className="x2f-site-banner" data-kind={banner.kind} data-part="site-banner">
      <Notice tone={banner.kind === 'warning' ? 'caution' : 'plain'} icon={banner.kind === 'warning' ? 'alert' : 'info'} title={BANNER_WORD[banner.kind]} live="status">
        {banner.text}
      </Notice>
    </div>
  );
}
