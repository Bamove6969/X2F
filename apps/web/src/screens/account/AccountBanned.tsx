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
 * the frozen notice's classes.
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { api } from '../../api/client.js';
import { formatDateTime } from '../../ui/dates.js';
import { Hero, ResultHeadline } from '../../ui/Hero.js';
import { StatusChip } from '../../ui/StatusChip.js';
import './frozen.css';

export const BANNED_PATH = '/account/banned';

export type BanReasonCode = 'terms' | 'trade-problems' | 'abuse' | 'account-security';

export interface BanNotice {
  bans: Array<{ kind: 'trade' | 'site'; reasonCode: BanReasonCode; until: string | null; permanent: boolean }>;
  contacts: { moderatorUrl: string | null; matrixUrl: string | null; telegramUrl: string | null };
}

/** The general reasons (Revision 2026-10-29b, lead default list). COPY-UNSIGNED */
export const BAN_REASON_TEXT: Readonly<Record<BanReasonCode, string>> = {
  terms: 'Breaking the Terms of Service',
  'trade-problems': 'Problems in trades',
  abuse: 'Abuse of other traders',
  'account-security': 'Account security',
};

/** D-020, the owner's draft without its channel placeholders (the links follow it). COPY-UNSIGNED */
export const BAN_NOTICE_LEAD =
  // not-a-refusal: the ban notice itself (owner G39 draft), a full screen, not a refused action
  "We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.";

export function AccountBanned({ notice }: { notice: BanNotice }) {
  // A site ban says more than a trade ban: show it when there is one.
  const ban = notice.bans.find((b) => b.kind === 'site') ?? notice.bans[0]!;
  const site = ban.kind === 'site';
  const c = notice.contacts;
  const links = [
    ...(c.matrixUrl ? [{ label: 'Matrix', href: c.matrixUrl }] : []),
    ...(c.telegramUrl ? [{ label: 'Telegram', href: c.telegramUrl }] : []),
    ...(!c.matrixUrl && !c.telegramUrl && c.moderatorUrl ? [{ label: 'Contact a moderator', href: c.moderatorUrl }] : []),
  ];
  return (
    <main className="x2f-frozen" data-screen="account-banned" aria-labelledby="banned-title">
      <header className="x2f-frozen__header">
        <span className="x2f-frozen__page">Account banned</span>
      </header>
      <Hero tone="danger" kind="result" label="Account banned" chip={<StatusChip tone="danger" icon="shield-x" label={site ? 'Account banned' : 'Trading banned'} />}>
        <ResultHeadline id="banned-title" title={site ? 'Your account has been banned' : 'Your account has been banned from trading'} lead={BAN_NOTICE_LEAD} />
        <dl className="x2f-frozen__facts">
          <div>
            <dt>Reason</dt>
            <dd data-part="ban-reason">{BAN_REASON_TEXT[ban.reasonCode]}</dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd data-part="ban-end">
              {ban.until === null ? 'Permanent' : `Your account will be fully working again on ${formatDateTime(new Date(ban.until))}.`}
            </dd>
          </div>
        </dl>
      </Hero>
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
    api<BanNotice>('/v1/account/ban').then(
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
