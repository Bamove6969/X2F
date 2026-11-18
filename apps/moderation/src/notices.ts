import { normalizeTradeCode } from '@x2f/core';
import { makeDisputeNotice } from '@x2f/protocol';
import { CHAT_AFTER_DISPUTE_DAYS, channelFor } from '@x2f/trade';
import { loadChatIdentity, type Queryable } from './keystore.js';
import type { ChatNoticeCandidate, Link } from './link.js';

/**
 * Design build task 7 (design-chat-membership-keys-2026-11-08 section 3, T2): a dispute no trader's
 * own grant reached this process through (a system escalation, or a disputer whose device holds no
 * chat key). For each candidate the API lists (a keyed chat of a disputed trade with no accepted
 * grant and no notice for the current dispute), this process signs a dispute notice with the chat's
 * moderator identity ONLY when its own records agree:
 * - it attested the chat (`signed_chats`, the channel as attested) and holds its moderator identity;
 * - its own record links the chat to that trade (`mod_chat_trade`, kept as first seen), so the API
 *   cannot point a notice at another chat;
 * - its own view shows the trade disputed within CHAT_AFTER_DISPUTE_DAYS (`mod_dispute_seen`, from
 *   the watch list and its own escalations);
 * - it accepted no grant for the chat (`mod_chat_grants`) and signed no notice for that dispute
 *   (`mod_chat_notices`); review N3: a notice it signed but the API never took (`posted_at` null) is
 *   posted again, the SAME signed notice, on each pass while the API lists the dispute, and never a
 *   second one; re-review m5: unless the API refused it for good (a 4xx other than 401, 408, 409 or 429), when
 *   it stops and the owner is alerted (`chat-notice-stopped`);
 * - a dispute a trader opened is at least NOTICE_AFTER_TRADER_MS old by this process's clock, so the
 *   disputer's own grant (T1) is tried first; a system dispute gets its notice at once.
 * The dispute's seq, opening time and opener are the API's word; the API files the notice only when
 * they name the trade's current open dispute exactly, and a trader device grants on it only when it
 * verifies AND the API's own `disputeOpen` is true (design: both checks).
 */

/** Engineering call (as GRANT_FALLBACK_MS in the trader engine): a trader-opened dispute's T1 grant goes first. */
export const NOTICE_AFTER_TRADER_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Whether a refusal of the notice is worth posting it again (re-review m5, re-review 2 m1): a 5xx,
 * 409, 429, and 401 (the API's transport check: `stale` clocks, `replay`, `bad-signature` during a
 * key rotation) and 408 (a timeout) are transient; any other 4xx is the API's lasting no.
 */
const retryable = (status: number): boolean => !(status >= 400 && status < 500) || [401, 408, 409, 429].includes(status);

/** Re-review m5: tells the API (an owner alert) that this dispute's notice was refused for good; once it is taken, never again. */
async function stopped(d: { link: Link; db: Queryable; log: (e: { reason: string }) => void }, chat: string, disputeSeq: number, status: number, now: Date): Promise<void> {
  const { status: got } = await d.link.report({ kind: 'chat-notice-stopped', chat, disputeSeq, status });
  if (got !== 201) {
    d.log({ reason: `chat-notice-stopped-report-refused-${got}` });
    return;
  }
  await d.db.query('update mod_chat_notices set alerted_at = $3 where chat = $1 and dispute_seq = $2', [chat, disputeSeq, now]);
  d.log({ reason: 'chat-notice-stopped' });
}

export async function noticePass(d: { link: Link; db: Queryable; keystoreKey: Uint8Array; now: () => Date; log: (e: { reason: string }) => void }): Promise<string[]> {
  let items: ChatNoticeCandidate[];
  try {
    items = await d.link.pullChatNotices();
  } catch {
    d.log({ reason: 'chat-notices-unavailable' });
    return [];
  }
  const done: string[] = [];
  for (const it of items) {
    const chat = typeof it.chat === 'string' ? normalizeTradeCode(it.chat) : null;
    const trade = typeof it.trade === 'string' ? normalizeTradeCode(it.trade) : null;
    const openedAt = typeof it.openedAt === 'string' ? Date.parse(it.openedAt) : Number.NaN;
    const openedBy = it.openedBy;
    if (chat === null || trade === null || !Number.isSafeInteger(it.disputeSeq) || it.disputeSeq < 1 || !Number.isFinite(openedAt)
      || (openedBy !== 'buyer' && openedBy !== 'seller' && openedBy !== 'system')) {
      d.log({ reason: 'bad-chat-notice' });
      continue;
    }
    try {
      const now = d.now();
      const { rows } = await d.db.query<{
        attestation: { channels?: { chat?: string } } | null; linked: string | null; seen: boolean; granted: boolean;
        noticed: { notice: unknown; posted: boolean; refused: number | null; alerted: boolean } | null;
      }>(
        `select (select attestation from signed_chats where chat = $1) as attestation,
                (select trade from mod_chat_trade where chat = $1) as linked,
                exists (select 1 from mod_dispute_seen where trade = $2 and last_seen_at >= $3) as seen,
                exists (select 1 from mod_chat_grants where chat = $1) as granted,
                (select json_build_object('notice', notice, 'posted', posted_at is not null, 'refused', refused_status, 'alerted', alerted_at is not null)
                   from mod_chat_notices where chat = $1 and dispute_seq = $4) as noticed`,
        [chat, trade, new Date(now.getTime() - CHAT_AFTER_DISPUTE_DAYS * DAY_MS), it.disputeSeq],
      );
      const r = rows[0]!;
      const channel = await channelFor(chat, 'chat');
      if (r.attestation?.channels?.chat !== channel) {
        d.log({ reason: 'chat-notice-unattested' });
        continue;
      }
      if (r.linked !== trade) {
        d.log({ reason: 'chat-notice-unlinked' });
        continue;
      }
      if (!r.seen) {
        d.log({ reason: 'chat-notice-not-disputed' });
        continue;
      }
      if (r.granted) continue;
      let notice: unknown;
      if (r.noticed !== null) {
        // Review N3: signed before. Taken by the API: done. Not taken: the same notice again. A row
        // with no notice (from before migration 020) is never signed a second time.
        if (r.noticed.posted || r.noticed.notice === null) continue;
        // Re-review m5: refused for good: never posted again; the owner told until the API takes it.
        if (r.noticed.refused !== null) {
          if (!r.noticed.alerted) await stopped(d, chat, it.disputeSeq, r.noticed.refused, now);
          continue;
        }
        notice = r.noticed.notice;
      } else {
        if (openedBy !== 'system' && now.getTime() - openedAt < NOTICE_AFTER_TRADER_MS) continue;
        const mod = await loadChatIdentity(d.db, d.keystoreKey, chat);
        if (mod === null) {
          d.log({ reason: 'chat-notice-unattested' });
          continue;
        }
        const signed = await makeDisputeNotice({ chat: channel, disputeSeq: it.disputeSeq, openedAt: new Date(openedAt).toISOString(), openedBy, mod });
        // Recorded before it is sent: a notice that reached the API is always in this process's record.
        // If another pass recorded one first, that one is the notice (never two for one dispute).
        const { rows: kept } = await d.db.query<{ notice: unknown }>(
          `with i as (insert into mod_chat_notices (chat, trade, dispute_seq, issued_at, notice) values ($1, $2, $3, $4, $5)
                      on conflict do nothing returning notice)
           select notice from i union all select notice from mod_chat_notices where chat = $1 and dispute_seq = $3 and not exists (select 1 from i)`,
          [chat, trade, it.disputeSeq, now, JSON.stringify(signed)],
        );
        if (kept[0]?.notice == null) continue;
        notice = kept[0].notice;
      }
      const { status, error } = await d.link.report({ kind: 'chat-dispute-notice', chat, notice });
      if (status !== 201) {
        d.log({ reason: `chat-notice-report-refused-${status}${status === 401 && error !== null ? `-${error}` : ''}` });
        if (!retryable(status)) {
          // Re-review m5: the API will not take it (bad body, unknown chat, ...): stop, and tell the owner.
          await d.db.query('update mod_chat_notices set refused_status = $3 where chat = $1 and dispute_seq = $2 and posted_at is null', [chat, it.disputeSeq, status]);
          await stopped(d, chat, it.disputeSeq, status, now);
        }
        // Otherwise (transient) the row stays unposted, so the next pass posts this same notice again.
        continue;
      }
      await d.db.query('update mod_chat_notices set posted_at = $3 where chat = $1 and dispute_seq = $2 and posted_at is null', [chat, it.disputeSeq, now]);
      d.log({ reason: 'chat-dispute-notice' });
      done.push(chat);
    } catch {
      d.log({ reason: 'chat-notice-failed' });
    }
  }
  return done;
}
