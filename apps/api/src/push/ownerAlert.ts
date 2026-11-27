import { addOwnerAlert, type AlertKind } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import type { PriceAlert } from '../price/health.js';
import type { PushKind } from './send.js';

/**
 * The owner alert kinds that also go to the owner's phone (spec 11.6: price health "through the
 * owner's in-app alerts and a phone push"): the urgent one (`market-prices-paused`, every source
 * for a currency down) and a source failing. Recoveries and all-clears stay in-app only, as does
 * every trader alert kind. Staff pushes are a later plan.
 */
// B-006 (owner q7): "The owner gets a notification when the threshold is reached": the fee wallet's
// sweep alerts go to the phone too.
// D-032 review S2 (lead call): a staff security reset, started and finished, so a stolen owner
// session plus one tap is noticed on his other devices. D-011 (Plan 4 Task 24): an appeal with no
// eligible reviewer waits until the owner adds one, so the owner hears about it on the phone too.
export const PUSHED_OWNER_ALERTS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  'market-prices-paused', 'price-source-failing', 'fee-sweep-due', 'fee-sweep-failed', 'staff-security-reset', 'staff-security-reset-finished',
  'appeal-no-reviewer',
  // Owner 26 Nov: the payroll wallet could not pay a staff member (or may have), so the owner hears at once.
  'payroll-send-refused', 'payroll-send-unknown', 'payroll-send-blocked',
  // Re-review 2 m3: a staff device certified to read disputed chats (the countermeasure to a planted key).
  'staff-device-certified',
  // Plan 4 Task 12 (A6, lead call 18 Nov): a seller let the comply time pass; a senior or the owner decides.
  'dispute-comply-lapsed',
  // Re-review m3 follow-up: the proof checker is stuck, so a restart happens before sellers' deadlines pass.
  'tx-proof-check-stuck',
  // Re-review w1: the checker stopped at its cap; only a restart brings it back.
  'tx-proof-check-stopped',
  // Review of feat/lockout, item 4: new compromised-account locks hit their hourly cap (a mass report?).
  'compromised-lock-cap',
  // Owner 26 Nov 2026 (auto-assign): a dispute is still unassigned past its reply deadline.
  'dispute-unassigned-overdue',
]);

export interface OwnerAlertDeps {
  db: Queryable;
  clock: () => Date;
  /** `app.push`: the generic Web Push to every subscription of an account. */
  push: { send(accountId: string, kind: PushKind): Promise<boolean> };
}

/**
 * Pushes the fixed `alert` text ("Something needs your attention", no detail of any kind) to the
 * subscriptions of every live owner account, for the kinds in `PUSHED_OWNER_ALERTS` only.
 */
export async function pushOwnerAlert(deps: Pick<OwnerAlertDeps, 'db' | 'push'>, kind: AlertKind): Promise<void> {
  if (!PUSHED_OWNER_ALERTS.has(kind)) return;
  const { rows } = await deps.db.query<{ id: string }>("select id from accounts where kind = 'owner' and disabled_at is null");
  for (const r of rows) await deps.push.send(r.id, 'alert');
}

/**
 * The `onAlert` sink main.ts hands `createMarketPrices` once the app is built: the in-app owner
 * alert (`addOwnerAlert`) first, then the phone push for the pushed kinds (Task 19 review I3).
 */
export function ownerAlertSink(deps: OwnerAlertDeps): (a: PriceAlert) => Promise<void> {
  return async (a) => {
    await addOwnerAlert(deps.db, a.kind, a.detail, deps.clock());
    await pushOwnerAlert(deps, a.kind);
  };
}
