import { purgeExpired } from './auth/challenges.js';
import { purgeDisputes } from './disputes/purge.js';
import { purgeNudges } from './nudge/routes.js';
import type { RetentionJob } from './retention.js';
import { purgeTradeAddressesJob } from './trades/purge.js';
import { purgeRemovedWalletAddresses } from './wallets/routes.js';

/**
 * Every job the one retention scheduler (`startRetention`, every 10 minutes) runs, in order (X-12):
 * Plan 2's purgeExpired (Task 4) and purgeRemovedWalletAddresses (Task 12), and Plan 3's
 * purgeTradeAddresses (Task 6), purgeNudges (Task 26) and purgeDisputes (Task 27). Plan 3 Task 20 appends `purgeChats` here; Plan 4 adds its own.
 */
export const RETENTION_JOBS: readonly RetentionJob[] = [purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddressesJob, purgeNudges, purgeDisputes];
