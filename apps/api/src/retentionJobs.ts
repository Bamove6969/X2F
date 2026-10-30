import { purgeExpired } from './auth/challenges.js';
import { purgeFeedbackForm } from './feedback/form.js';
import { purgeNudges } from './nudge/routes.js';
import type { RetentionJob } from './retention.js';
import { purgeTradesJob } from './retention/tradePurge.js';
import { purgeTradeAddressesJob } from './trades/purge.js';
import { purgeRemovedWalletAddresses } from './wallets/routes.js';

/**
 * Every job the one retention scheduler (`startRetention`, every 10 minutes) runs, in order (X-12):
 * Plan 2's purgeExpired (Task 4) and purgeRemovedWalletAddresses (Task 12), and Plan 3's
 * purgeTradeAddresses (Task 6) and purgeNudges (Task 26), and Plan 5's purgeFeedbackForm (Task 21). Plan 3 Task 20 appends `purgeChats` here; Plan 4 adds its own.
 * Plan 7's purgeTrades (Task 2) runs last: the whole-trade self-destruct. Plan 7 Task 14's
 * `collectDailyStats` must run BEFORE it, so nothing is counted after it is deleted.
 */
export const RETENTION_JOBS: readonly RetentionJob[] = [
  purgeExpired,
  purgeRemovedWalletAddresses,
  purgeTradeAddressesJob,
  purgeNudges,
  purgeFeedbackForm,
  purgeTradesJob,
];
