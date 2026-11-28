/**
 * AccountBanned (Plan 4 Task 27, Revision 2026-10-29b; D-020, owner G39): the notice a banned trader
 * sees. The API sends any 403 `banned` here (api/client.ts); the screen reads GET /v1/account/ban:
 * the bans in force (the general reason only, never the rule or the staff note), the exact end or
 * none (lifetime), and the moderator contact links from the owner's Settings.
 *
 * Every string is COPY-UNSIGNED: the lead is the owner's draft of G39 ("We're sorry, but your
 * account has been banned. If you feel this has been done in error, please reach out to a moderator
 * at [Matrix Channel] [Telegram Channel] and ask to speak to a moderator for further details."), with
 * the two channels shown as links under it; design words it (register D-020). The end line is
 * Task 27's ("will be fully operational again on <exact date and time>"). No board yet: laid out with
 * the frozen notice's classes. Review S1: under a site ban, each unfinished trade (or its dispute)
 * is a link, the one way back into a trade the person may still finish.
 *
 * Owner, 28 Nov 2026: three tiers (api/ban.ts `banTier`). A Trade ban says new trades are blocked
 * and what is already started finishes; a Suspension says the account is suspended, the general
 * reason, when it was implemented and when it is lifted automatically; a Lifetime ban says it is
 * permanent. Dates are `formatDateTime`'s.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { banTier, fetchBanNotice, type BanNotice, type BanTier } from '../../api/ban.js';
import { BAN_REASON_TEXT, type BanReasonCode } from '../../ui/cantDoCodes.js';
import { formatDateTime, isMoment } from '../../ui/dates.js';
import { Hero, ResultHeadline } from '../../ui/Hero.js';
import { StatusChip } from '../../ui/StatusChip.js';
import './frozen.css';

export const BANNED_PATH = '/account/banned';

export { BAN_REASON_TEXT, type BanNotice, type BanReasonCode };

/** D-020, the owner's draft without its channel placeholders (the links follow it). COPY-UNSIGNED */
export const BAN_NOTICE_LEAD =
  // not-a-refusal: the ban notice itself (owner G39 draft), a full screen, not a refused action
  "We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.";

/** Owner, 28 Nov 2026: the Suspension's lead, the owner's draft with "suspended". COPY-UNSIGNED */
export const SUSPENSION_NOTICE_LEAD =
  // not-a-refusal: the suspension notice itself, a full screen, not a refused action
  "We're sorry, but your account has been suspended. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.";

/** Owner, 28 Nov 2026: each tier's words on the notice. COPY-UNSIGNED, DESIGNER-REVIEW */
export const BAN_TIER_COPY: Readonly<Record<BanTier, { page: string; chip: string; title: string; lead: string; means: string }>> = {
  trade: {
    page: 'Trade ban',
    chip: 'Trade ban',
    title: 'Your account has been banned from trading',
    lead: BAN_NOTICE_LEAD,
    // not-a-refusal: says what the trade ban means, on its own notice
    means: "You can't start or accept new trades. Trades you already started carry on, and you can still log in, look at offers and use your wallets.",
  },
  suspension: {
    page: 'Account suspended',
    chip: 'Suspension',
    title: 'Your account has been suspended',
    lead: SUSPENSION_NOTICE_LEAD,
    // not-a-refusal: says what the suspension means, on its own notice
    means: "You can't log in to X2F until the suspension is lifted. You can still finish trades and disputes that are already under way.",
  },
  lifetime: {
    page: 'Account banned',
    chip: 'Lifetime ban',
    title: 'Your account has been permanently banned',
    lead: BAN_NOTICE_LEAD,
    // not-a-refusal: says what the lifetime ban means, on its own notice
    means: "This ban is permanent: you can't log in to X2F again. You can still finish trades and disputes that are already under way.",
  },
};

/** Review S1: above the links to what is still open. COPY-UNSIGNED, DESIGNER-REVIEW (no board) */
export const BAN_UNFINISHED_LEAD = 'You can still finish these:';

export function AccountBanned({ notice }: { notice: BanNotice }) {
  // A site ban says more than a trade ban: show it when there is one.
  const ban = notice.bans.find((b) => b.kind === 'site') ?? notice.bans[0]!;
  const site = ban.kind === 'site';
  const tier = banTier(ban);
  const copy = BAN_TIER_COPY[tier];
  const c = notice.contacts;
  const links = [
    ...(c.matrixUrl ? [{ label: 'Matrix', href: c.matrixUrl }] : []),
    ...(c.telegramUrl ? [{ label: 'Telegram', href: c.telegramUrl }] : []),
    ...(!c.matrixUrl && !c.telegramUrl && c.moderatorUrl ? [{ label: 'Contact a moderator', href: c.moderatorUrl }] : []),
  ];
  return (
    <main className="x2f-frozen" data-screen="account-banned" aria-labelledby="banned-title">
      <header className="x2f-frozen__header">
        <span className="x2f-frozen__page">{copy.page}</span>
      </header>
      <Hero tone="danger" kind="result" label={copy.page} chip={<StatusChip tone="danger" icon="shield-x" label={copy.chip} />}>
        <ResultHeadline id="banned-title" title={copy.title} lead={copy.lead} />
        <dl className="x2f-frozen__facts" data-tier={tier}>
          <div>
            <dt>Reason</dt>
            <dd data-part="ban-reason">{BAN_REASON_TEXT[ban.reasonCode]}</dd>
          </div>
          {isMoment(ban.implementedAt) ? (
            <div>
              <dt>Implemented</dt>
              <dd data-part="ban-implemented">{formatDateTime(ban.implementedAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{tier === 'suspension' ? 'Lifted automatically' : 'Ends'}</dt>
            <dd data-part="ban-end">
              {ban.until === null
                ? 'Permanent'
                : tier === 'suspension'
                  ? `Your suspension will be lifted automatically on ${formatDateTime(ban.until)}.`
                  : `Your trade ban ends on ${formatDateTime(ban.until)}.`}
            </dd>
          </div>
        </dl>
      </Hero>
      <section className="x2f-frozen__card" aria-label="What this means" data-part="ban-means">
        <p>{copy.means}</p>
      </section>
      {site && notice.unfinished && notice.unfinished.length > 0 && (
        <section className="x2f-frozen__card" aria-label="Still to finish" data-part="ban-unfinished">
          <p>{BAN_UNFINISHED_LEAD}</p>
          <ul className="x2f-frozen__list">
            {notice.unfinished.map((u) => (
              <li key={u.code}>
                <Link to={u.dispute ? `/trade/${u.code}/dispute` : `/trade/${u.code}`}>{u.dispute ? `Dispute on trade ${u.code}` : `Trade ${u.code}`}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {links.length > 0 && (
        <section className="x2f-frozen__card" aria-label="Contact a moderator">
          <ul className="x2f-frozen__list">
            {links.map((l) => (
              <li key={l.label}>
                <a data-part="ban-contact" href={l.href} rel="noopener noreferrer" target="_blank">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** BANNED_PATH: the notice for the bans the API reports; home when there are none (ended or lifted). */
export function AccountBannedRoute() {
  const [notice, setNotice] = useState<BanNotice | null | 'none'>(null);
  useEffect(() => {
    let live = true;
    fetchBanNotice().then(
      (n) => live && setNotice(n.bans.length > 0 ? n : 'none'),
      () => live && setNotice('none'),
    );
    return () => {
      live = false;
    };
  }, []);
  if (notice === null) return null;
  return notice === 'none' ? <Navigate to="/" replace /> : <AccountBanned notice={notice} />;
}
