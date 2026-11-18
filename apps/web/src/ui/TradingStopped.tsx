import { Link } from 'react-router';
import { useSiteInfo, type CommunityLinks } from '../api/site.js';
import { ExternalLink } from './ExternalLink.js';
import { Notice } from './Notice.js';

// Plan 4 Task 29: while the emergency stop is on (Task 8, `tradingPaused`), every offer list, the
// quote and Post offer show this instead of offers, and Trade and Post are off. The API already
// lists nothing and refuses takes and posts (409 trading-paused); a poster still sees their own
// offers in My offers. The sentence is the plan's (Task 29 "Interfaces"), with links to News and the
// owner's community links (a link that is not set is left out of the sentence). The channel topic
// itself is written by staff on Matrix or Telegram, outside X2F.
// COPY-UNSIGNED; DESIGNER-REVIEW (no board draws the stopped state).

/** The community part of the sentence: "or join our Matrix or Telegram", one of them, or nothing. */
function community(links: CommunityLinks) {
  const matrix = links.matrix !== null ? <ExternalLink href={links.matrix}>Matrix</ExternalLink> : null;
  const telegram = links.telegram !== null ? <ExternalLink href={links.telegram}>Telegram</ExternalLink> : null;
  if (matrix === null && telegram === null) return null;
  return (
    <>
      , or join our {matrix}
      {matrix !== null && telegram !== null ? ' or ' : null}
      {telegram}, where the channel topic has the latest information and you can ask questions
    </>
  );
}

export function TradingStopped() {
  const { communityLinks } = useSiteInfo();
  return (
    <Notice tone="caution" live="status" data-part="trading-stopped">
      Unscheduled but necessary maintenance. We&apos;ll be back as soon as possible. Check the{' '}
      <Link className="x2f-link" to="/news" data-part="stopped-news">
        News section
      </Link>
      {community(communityLinks)}.
    </Notice>
  );
}
