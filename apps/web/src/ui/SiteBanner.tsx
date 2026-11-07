import type { SiteBannerInfo } from '../api/site.js';
import { Notice } from './Notice.js';
import './site-banner.css';

/**
 * Plan 4 Task 8: the owner's banner (at most 140 characters) at the top of every trader screen,
 * built on the kit's Notice: info is the info callout with the info icon, warning the caution
 * callout with the caution triangle (the icons tell them apart, not colour alone). Design 7 Nov
 * P3: no "Info" or "Warning" title; the message stands alone.
 */

export function SiteBanner({ banner }: { banner: SiteBannerInfo | null }) {
  if (banner === null) return null;
  return (
    <div className="x2f-site-banner" data-kind={banner.kind} data-part="site-banner">
      <Notice tone={banner.kind === 'warning' ? 'caution' : 'plain'} icon={banner.kind === 'warning' ? 'alert' : 'info'} live="status">
        {banner.text}
      </Notice>
    </div>
  );
}
