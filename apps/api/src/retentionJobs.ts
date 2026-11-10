import { purgeExpired } from './auth/challenges.js';
import { purgeChatsJob } from './chat/retention.js';
import { purgeFeedbackForm } from './feedback/form.js';
import { purgeFeedback } from './feedback/mood.js';
import { purgeJabberPreKeys } from './jabber/prekeys.js';
import { purgeJabberPending } from './jabber/retention.js';
import { purgeNudges } from './nudge/routes.js';
import type { RetentionJob } from './retention.js';
import { purgeTickets } from './tickets/traderRoutes.js';
import { purgeTradeAddressesJob } from './trades/purge.js';
import { purgeTeamLeftovers } from './team/members.js';
import { purgeStaffInviteLeftovers } from './staff/invites.js';
import { closeInactiveAccounts } from './accountInactivity.js';
import { purgeChatKeyEnvelopes } from './auth/chatKeys.js';
import { purgeRemovedWalletAddresses } from './wallets/routes.js';

/**
 * Every job the one retention scheduler (`startRetention`, every 10 minutes) runs, in order (X-12):
 * Plan 2's purgeExpired (Task 4), purgeRemovedWalletAddresses (Task 12) and purgeTeamLeftovers (Task 18), and Plan 3's
 * purgeTradeAddresses (Task 6), purgeNudges (Task 26) and purgeChats (Task 20), and Plan 5's purgeFeedbackForm (Task 21)
 * and purgeFeedback (Task 4), purgeJabberPending (owner rule p5-7, review L4), purgeJabberPreKeys (the OMEMO prekey
 * record, 180 days), purgeChatKeyEnvelopes (J-23 review F5: expired and collected chat-key envelopes), and closeInactiveAccounts
 * (owner answer Q77, 6 Nov 2026: not a purge; it closes a vendor account 60 days after its last login).
 * Plan 4's purgeTickets (Task 30) runs after purgeChatKeyEnvelopes. Plan 4's purgeStaffInviteLeftovers (Task 7/16, security review 2026-11-09) runs after purgeTeamLeftovers: it erases
 * the Terms signature of a half-made staff account whose invite was cancelled or expired (owner p11-13).
 */
export const RETENTION_JOBS: readonly RetentionJob[] = [purgeExpired, purgeRemovedWalletAddresses, purgeTeamLeftovers, purgeStaffInviteLeftovers, purgeTradeAddressesJob, purgeNudges, purgeChatsJob, purgeFeedbackForm, purgeFeedback, purgeJabberPending, purgeJabberPreKeys, purgeChatKeyEnvelopes, purgeTickets, closeInactiveAccounts];
