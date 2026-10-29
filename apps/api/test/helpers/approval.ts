import type { LightMyRequestResponse } from 'fastify';
import type { Deps } from '../../src/app.js';

/**
 * Plan 2 Task 16, for tests about something else: a trader login from a new browser while the
 * account is logged in elsewhere answers `approve-on-device`. This approves it as a logged-in
 * device would (straight in the database: deviceApproval.test.ts covers the real decision) and
 * collects the session with the same browser's `poll`. Any other answer is returned as it was.
 */
export async function approvedLogin(
  deps: Pick<Deps, 'db' | 'clock'>,
  res: LightMyRequestResponse,
  poll: (url: string) => Promise<LightMyRequestResponse>,
): Promise<unknown> {
  const body = res.json() as { status?: string; approvalId?: string };
  if (body.status !== 'approve-on-device' || body.approvalId === undefined) return body;
  const now = deps.clock();
  await deps.db.query(
    `update login_approvals set outcome = 'approved', decided_at = $2, expires_at = $3 where id = $1 and outcome is null`,
    [body.approvalId, now, new Date(now.getTime() + 60_000)],
  );
  const polled = (await poll(`/v1/login/approval/${body.approvalId}/poll`)).json() as { status: string };
  return polled.status === 'ok' ? { status: 'ok' } : polled;
}
