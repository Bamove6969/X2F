import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { driveTo, seedTrade } from './helpers/trades.js';

/**
 * Migration 120 (owner 8 Nov, p6-1): the retired `refund_requested` state. A trade still in it goes
 * back to `secured` (nothing moves from the migration; the seller cancels again and the refund then
 * starts at once), one whose signing window would return it there returns to `secured`, and no row
 * can be written in it again. The test puts the old constraint back, writes old rows, and runs the
 * migration's own SQL on them.
 */
let app: FastifyInstance;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ app, deps } = await testApp());
});
afterAll(async () => {
  await app.close();
});

async function securedTrade() {
  const sellerId = await seedAccount(deps, { loginName: `cr${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `cr${String(n).padStart(4, '0')}b` });
  const { trade } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  return driveTo(deps, trade, 'secured');
}

const OLD_STATES = `'setup', 'funding', 'securing', 'secured', 'paid', 'refund_requested', 'settling', 'released', 'refunded', 'lapsed', 'cancelled', 'disputed'`;

describe('migration 120: refund_requested is retired', () => {
  it('moves old refund_requested rows back to secured, and settle_from with them; refuses the state afterwards', async () => {
    const waiting = await securedTrade();
    const cancelling = await securedTrade();
    const untouched = await securedTrade();
    await deps.db.query('alter table trades drop constraint trades_state_check');
    await deps.db.query(`alter table trades add constraint trades_state_check check (state in (${OLD_STATES}))`);
    const alert = new Date(waiting.payBy!.getTime() + 60_000);
    await deps.db.query(`update trades set state = 'refund_requested', final_alert_at = $2 where code = $1`, [waiting.code, alert]);
    await deps.db.query(`update trades set state = 'settling', settling = 'buyer-cancel', settle_from = 'refund_requested' where code = $1`, [cancelling.code]);

    await deps.db.query(readFileSync(join(MIGRATIONS_DIR, '120_cancel_reversal.sql'), 'utf8'));

    const w = (await loadTrade(deps.db, waiting.code))!;
    expect(w.state).toBe('secured');
    expect(w.paidAt).toBeNull();
    expect(w.payBy).toEqual(waiting.payBy);
    const raw = await deps.db.query<{ final_alert_at: Date | null }>('select final_alert_at from trades where code = $1', [waiting.code]);
    expect(raw.rows[0]!.final_alert_at).toBeNull();
    const c = (await loadTrade(deps.db, cancelling.code))!;
    expect(c.state).toBe('settling');
    expect(c.settleFrom).toBe('secured');
    expect((await loadTrade(deps.db, untouched.code))!.state).toBe('secured');
    await expect(deps.db.query(`update trades set state = 'refund_requested' where code = $1`, [untouched.code])).rejects.toMatchObject({ code: '23514' });

    // The migrated trade follows the new rules: the buyer may still mark paid, or the seller cancels
    // again and the refund starts at once.
    const now = new Date(waiting.payBy!.getTime() + 120_000);
    const again = await applyEvent({ db: deps.db, clock: () => now }, waiting.code, { type: 'request-refund' }, 'seller');
    expect(again.state).toBe('settling');
    expect(again.settling).toBe('auto-refund');
  });
});
