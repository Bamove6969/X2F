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
 *   (`mod_chat_notices`);
 * - a dispute a trader opened is at least NOTICE_AFTER_TRADER_MS old by this process's clock, so the
 *   disputer's own grant (T1) is tried first; a system dispute gets its notice at once.
 * The dispute's seq, opening time and opener are the API's word; the API files the notice only when
 * they name the trade's current open dispute exactly, and a trader device grants on it only when it
 * verifies AND the API's own `disputeOpen` is true (design: both checks).
 */

/** Engineering call (as GRANT_FALLBACK_MS in the trader engine): a trader-opened dispute's T1 grant goes first. */
export const NOTICE_AFTER_TRADER_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

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
      const { rows } = await d.db.query<{ attestation: { channels?: { chat?: string } } | null; linked: string | null; seen: boolean; granted: boolean; noticed: boolean }>(
        `select (select attestation from signed_chats where chat = $1) as attestation,
                (select trade from mod_chat_trade where chat = $1) as linked,
                exists (select 1 from mod_dispute_seen where trade = $2 and last_seen_at >= $3) as seen,
                exists (select 1 from mod_chat_grants where chat = $1) as granted,
                exists (select 1 from mod_chat_notices where chat = $1 and dispute_seq = $4) as noticed`,
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
      if (r.granted || r.noticed) continue;
      if (openedBy !== 'system' && now.getTime() - openedAt < NOTICE_AFTER_TRADER_MS) continue;
      const mod = await loadChatIdentity(d.db, d.keystoreKey, chat);
      if (mod === null) {
        d.log({ reason: 'chat-notice-unattested' });
        continue;
      }
      const notice = await makeDisputeNotice({ chat: channel, disputeSeq: it.disputeSeq, openedAt: new Date(openedAt).toISOString(), openedBy, mod });
      // Recorded before it is sent: a notice that reached the API is always in this process's record.
      await d.db.query('insert into mod_chat_notices (chat, trade, dispute_seq, issued_at) values ($1, $2, $3, $4) on conflict do nothing', [chat, trade, it.disputeSeq, now]);
      const status = await d.link.postReport({ kind: 'chat-dispute-notice', chat, notice });
      if (status !== 201) {
        // Not counted; the row stays, so this dispute gets no second notice (the API said no).
        d.log({ reason: `chat-notice-report-refused-${status}` });
        continue;
      }
      d.log({ reason: 'chat-dispute-notice' });
      done.push(chat);
    } catch {
      d.log({ reason: 'chat-notice-failed' });
    }
  }
  return done;
}
