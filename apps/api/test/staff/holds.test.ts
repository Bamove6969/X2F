// Lead hold v3 review (minor) and owner G35 (7 Nov): staff extend or end a trader account's
// recovery-code hold; every action goes to the activity log.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { MAX_HOLD_EXTEND_MS } from '../../src/staff/holds.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, logEntries, seedStaff, staffApps } from '../helpers/staffApp.js';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
const NOW = new Date('2026-11-07T12:00:00Z');
const HOUR = 3_600_000;

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, deps, setNow, close } = await staffApps());
  setNow(NOW);
});
afterAll(async () => close());

async function held(): Promise<string> {
  const id = await seedAccount(deps, { loginName: `hh${randomBytes(4).toString('hex')}`, kind: 'trader' });
  await deps.db.query(
    `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
    [id, NOW, new Date(NOW.getTime() + 24 * HOUR)],
  );
  return id;
}

async function senior(): Promise<StaffBrowser> {
  const s = (await seedStaff(deps, { role: 'senior' })).id;
  const { token } = await insertSession(deps, s, 'staff');
  return new StaffBrowser(app).withSession(token);
}

const holdUntil = async (id: string) =>
  (await deps.db.query<{ h: Date }>('select hold_until as h from account_holds where account_id = $1', [id])).rows[0]?.h ?? null;

describe('staff and a recovery-code hold', () => {
  it('a senior moderator extends a hold; the log has the account and the new end', async () => {
    const id = await held();
    const b = await senior();
    const until = new Date(NOW.getTime() + 48 * HOUR).toISOString();
    const res = await b.send('POST', `/staff/v1/accounts/${id}/hold/extend`, { until });
    expect([res.statusCode, res.json()]).toEqual([200, { holdUntil: until }]);
    expect((await holdUntil(id))?.toISOString()).toBe(until);
    const entries = await logEntries(deps, 'hold.extended');
    expect(entries.map((e) => JSON.parse(e.detail))).toContainEqual({ accountId: id, holdUntil: until });
    // Never earlier than it was.
    const earlier = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    expect((await b.send('POST', `/staff/v1/accounts/${id}/hold/extend`, { until: earlier })).json()).toEqual({ holdUntil: until });
  });

  it('bad ends are 400; no hold is 404', async () => {
    const id = await held();
    const b = await senior();
    for (const until of ['nope', new Date(NOW.getTime() - HOUR).toISOString(), new Date(NOW.getTime() + MAX_HOLD_EXTEND_MS + HOUR).toISOString()]) {
      expect((await b.send('POST', `/staff/v1/accounts/${id}/hold/extend`, { until })).statusCode, until).toBe(400);
    }
    expect((await b.send('POST', `/staff/v1/accounts/${id}/hold/extend`, { until: new Date(NOW.getTime() + 2 * HOUR).toISOString(), x: 1 })).statusCode).toBe(400);
    const free = await seedAccount(deps, { loginName: `hf${randomBytes(4).toString('hex')}`, kind: 'trader' });
    expect((await b.send('POST', `/staff/v1/accounts/${free}/hold/end`, {})).statusCode).toBe(404);
    expect((await b.send('POST', '/staff/v1/accounts/nope/hold/end', {})).statusCode).toBe(404);
  });

  it('a senior moderator ends a hold; the log has the account', async () => {
    const id = await held();
    const b = await senior();
    expect((await b.send('POST', `/staff/v1/accounts/${id}/hold/end`, {})).statusCode).toBe(204);
    expect(await holdUntil(id)).toBeNull();
    const entries = await logEntries(deps, 'hold.ended');
    expect(entries.map((e) => JSON.parse(e.detail))).toContainEqual({ accountId: id });
  });
});
