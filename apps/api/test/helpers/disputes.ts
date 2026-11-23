import { randomUUID } from 'node:crypto';
import { applyDispute, type Actor, type Dispute, type RulingOutcome } from '@x2f/staff';
import type { Deps } from '../../src/app.js';
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { withDispute } from '../../src/disputes/store.js';

/**
 * A ruling as Plan 4 Task 12's staff routes make one (apps/api/src/disputes/rulings.ts, tested in
 * test/disputes/rulings.test.ts), without the staff session, the key tap and the draft: through
 * the dispute machine, on the server clock, so the dispute's columns and its trader-visible
 * `dispute_rulings` row agree. Round 1: a moderator takes the case and proposes; under the
 * large-trade limit with no account action it is published at once and the 48-hour appeal window
 * opens. Round 2 (after an appeal): an uninvolved senior moderator rules and it is final.
 */
export async function publishRuling(
  deps: Pick<Deps, 'db' | 'clock'>,
  code: string,
  o: { outcome: RulingOutcome; evidence?: unknown; staffId?: string; moderatorName?: string },
): Promise<Dispute> {
  const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };
  return withDispute(deps, { code }, async (d, client, now) => {
    const role = d.round === 1 ? 'mod' : 'senior';
    const staff: Actor = { kind: 'staff', id: o.staffId ?? randomUUID(), role };
    let x = applyDispute(d, { type: 'assign', staffId: staff.id, role }, staff, now, S);
    x = applyDispute(x, { type: 'propose', gate: { usdCents: x.usdCents, limitUsdCents: x.limitUsdCents }, ruling: { id: randomUUID(), outcome: o.outcome, accountAction: { kind: 'none' }, proposer: staff.id } }, staff, now, S);
    await client.query(
      `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [x.code, x.seq, x.round, o.outcome, "The payment is in the seller's activity.", JSON.stringify(o.evidence ?? ['The trade chat']),
        o.moderatorName ?? 'sarah.v', now, x.round === 1 ? x.appealEndsAt : null],
    );
    return x;
  });
}

/** An appeal as the machine takes it, without the trader route (for tests that need round 2 directly). */
export async function appealDirect(deps: Pick<Deps, 'db' | 'clock'>, code: string, side: 'buyer' | 'seller'): Promise<Dispute> {
  const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };
  return withDispute(deps, { code }, async (d, client, now) => {
    const next = applyDispute(d, { type: 'appeal', involved: [] }, { kind: 'trader', side }, now, S);
    await client.query('insert into dispute_appeals (code, seq, by, why, at) values ($1, $2, $3, $4, $5)', [code, d.seq, side, 'Please look again at this.', now]);
    return next;
  });
}

/**
 * Review p4t22 m1: the escrow payout of round `round`'s ruling seen, as the watcher's `settled`
 * report records it (disputes/execution.ts), without the trade event: for tests whose premise is
 * that the coins already moved under round 1.
 */
export async function executeDirect(deps: Pick<Deps, 'db' | 'clock'>, code: string, round: 1 | 2 = 1): Promise<Dispute> {
  const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };
  return withDispute(deps, { code }, async (d, _client, now) => applyDispute(d, { type: 'executed', round }, { kind: 'system' }, now, S));
}
