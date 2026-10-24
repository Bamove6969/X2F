import type { NudgeWiring } from './routes.js';

/**
 * Production stand-in until the tasks that own each piece merge (tripwires in test/nudge.test.ts):
 * - Task 6 (active trades) and Task 20 (open chats): `hasSharedContext`. Until then no chat or
 *   trade exists, so nobody shares one and every nudge is refused with `no-shared-context`.
 * - Task 19: `publish` (events/bus.ts) and `sendPush(accountId, 'nudge')` (push/send.ts). Never
 *   reached while `hasSharedContext` is false; they deliver nothing.
 */
export const pendingNudgeWiring: NudgeWiring = {
  hasSharedContext: async () => false,
  publish: () => undefined,
  sendPush: async () => false,
};
