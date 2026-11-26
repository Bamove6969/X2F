/**
 * Settings → Privacy (Plan 7 Task 4; owner 2026-10-29, R36): what X2F keeps about a trade and when
 * it goes. Plain statements, no choices: there is one fixed rule and nobody can change it.
 *
 * Every number is a shared constant (@x2f/trade), never typed here, so the page says what the
 * purges do: the whole-trade purge (apps/api/src/retention/tradePurge.ts, `tradeDeleteAt`), the
 * chat purge (chat/retention.ts, `chatPurgeDue`) and the proof purge (proofs/store.ts, on the
 * chat's rule). Owner 26 Nov 2026: an unpaid lien from a trade's dispute keeps the trade, its chat
 * and its proofs; once the lien ends they go DISPUTE_KEEP_DAYS after it ended, or on their usual
 * date if that is later (all three purges read the same lien facts).
 *
 * Not stated, because it is not what the purges do or it is not built: backups, per-trader early
 * deletes, staff deleting early. The moderation watch can hold a delete back about a day past the
 * date shown (WATCH_LIST_CLOSED_DAYS), hence "on that date or shortly after".
 *
 * All copy is COPY-UNSIGNED: the owner has not signed the 30/90-day wording off. No board yet
 * (DESIGNER-REVIEW): the page uses existing UI-kit classes only.
 */
import { CHAT_PRETRADE_IDLE_DAYS, DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';

export const PRIVACY_PATH = '/settings/privacy';

export const PRIVACY_COPY = {
  // COPY-UNSIGNED (Plan 7 Task 4)
  title: 'Privacy',
  // COPY-UNSIGNED (Plan 7 Task 4): the row on Settings → Help that opens this page.
  link: 'What X2F keeps, and for how long',
  // COPY-UNSIGNED (Plan 7 Task 4)
  deletedTitle: 'When a trade is deleted',
  // COPY-UNSIGNED (Plan 7 Task 4): what tradeDeleteAt, chatPurgeDue and purgeProofs do.
  deleted: [
    `A trade with no dispute self-destructs ${TRADE_KEEP_DAYS} days after it ends: the trade, its chat and its payment proofs are deleted for good.`,
    `A trade that had a dispute is kept ${DISPUTE_KEEP_DAYS} days after its last dispute closes, then deleted the same way, with its dispute records. While a dispute or an appeal is open, nothing is deleted.`,
    `While a lien from a trade's dispute is unpaid, the trade, its chat and its payment proofs are kept. Once the lien is repaid, cancelled or written off, they are deleted ${DISPUTE_KEEP_DAYS} days later, or on their usual date if that comes later.`,
    `A chat that never became a trade is deleted ${CHAT_PRETRADE_IDLE_DAYS} days after its last message.`,
    'The trade room shows the date each trade self-destructs. It is deleted on that date or shortly after, and goes from this device too.',
    'Nobody can delete a trade early, not even X2F.',
  ],
  // COPY-UNSIGNED (Plan 7 Task 4)
  staysTitle: 'What stays',
  // COPY-UNSIGNED (Plan 7 Task 4): account_traded_totals.purged_*, detachReviews, liens and fees_owed.
  stays: [
    'Your trade count and your dispute results stay on your profile.',
    'Reviews stay, without the link to their trade.',
    'Liens and fees owed stay with the account, also after the trade is deleted.',
  ],
} as const;
