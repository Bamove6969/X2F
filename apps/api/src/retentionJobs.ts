import { purgeExpired } from './auth/challenges.js';
import { purgeChatsJob } from './chat/retention.js';
import { purgeProofsJob } from './proofs/store.js';
import { purgeFeedbackForm } from './feedback/form.js';
import { purgeBlurChecks } from './proof/blurCheck.js';
import { purgeFeedback } from './feedback/mood.js';
import { purgeJabberPreKeys } from './jabber/prekeys.js';
import { purgeJabberPending } from './jabber/retention.js';
import { purgeNudges } from './nudge/routes.js';
import type { RetentionJob } from './retention.js';
import { purgeTradeAddressesJob } from './trades/purge.js';
import { purgeTeamLeftovers } from './team/members.js';
import { purgeStaffInviteLeftovers } from './staff/invites.js';
import { closeInactiveAccounts } from './accountInactivity.js';
import { purgeChatKeyEnvelopes } from './auth/chatKeys.js';
import { purgeRemovedWalletAddresses } from './wallets/routes.js';
import { purgeTradesJob } from './retention/tradePurge.js';
import { releaseStaleRecoveryHoldsJob } from './disputes/recovery.js';

/**
 * Every job the one retention scheduler (`startRetention`, every 10 minutes) runs, in order (X-12):
 * Plan 2's purgeExpired (Task 4), purgeRemovedWalletAddresses (Task 12) and purgeTeamLeftovers (Task 18), and Plan 3's
 * purgeTradeAddresses (Task 6), purgeNudges (Task 26) and purgeChats (Task 20), and Plan 5's purgeFeedbackForm (Task 21)
 * and purgeFeedback (Task 4), purgeJabberPending (owner rule p5-7, review L4), purgeJabberPreKeys (the OMEMO prekey
 * record, 180 days), purgeChatKeyEnvelopes (J-23 review F5: expired and collected chat-key envelopes), and closeInactiveAccounts
 * (owner answer Q77, 6 Nov 2026: not a purge; it closes a vendor account 60 days after its last login).
 * Plan 4's purgeStaffInviteLeftovers (Task 7/16, security review 2026-11-09) runs after purgeTeamLeftovers: it erases
 * the Terms signature of a half-made staff account whose invite was cancelled or expired (owner p11-13).
 * Plan 7's purgeTrades (Task 2, with Plan 4 Task 23's dispute half) runs right after purgeChats, which
 * deletes a trade's chat no later than the trade (@x2f/trade retention.ts): it deletes a trade whole
 * 30 days after it closed, or 90 days after its last dispute closed.
 * releaseStaleRecoveryHolds (lien recovery, re-review N3; not a purge) releases a recovery hold whose trade closed without a coin
 * longer than the moderation watch ago (or was purged), so complied is not refused for ever.
 */
export const RETENTION_JOBS: readonly RetentionJob[] = [purgeExpired, purgeRemovedWalletAddresses, purgeTeamLeftovers, purgeStaffInviteLeftovers, purgeTradeAddressesJob, purgeNudges, purgeChatsJob, purgeProofsJob, purgeTradesJob, purgeFeedbackForm, purgeBlurChecks, purgeFeedback, purgeJabberPending, purgeJabberPreKeys, purgeChatKeyEnvelopes, closeInactiveAccounts, releaseStaleRecoveryHoldsJob];
