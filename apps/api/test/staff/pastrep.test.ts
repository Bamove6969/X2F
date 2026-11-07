// Plan 5 Task 10 on the staff API (owner 2026-11-02, owner Q58 6 Nov): a senior moderator or the
// owner sets a past-reputation claim's verified dollar figure, at most $100,000, through
// setVerifiedPastRepUsd; the activity log records the claim and never the figure.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, logEntries, seedStaff, staffApps } from '../helpers/staffApp.js';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let n = 0;

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, deps, setNow, close } = await staffApps());
  setNow(new Date('2026-11-02T12:00:00Z'));
});
afterAll(async () => close());

async function claim(status = 'approved'): Promise<string> {
  const owner = await seedAccount(deps, { loginName: `pr${++n}${randomBytes(3).toString('hex')}`, kind: 'trader' });
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
     values ($1, 'LocalMonero', 'https://web.archive.org/web/2023/x', 10, $2, $3, 'text', $3, $4, now()) returning id`,
    [owner, randomBytes(20).toString('hex'), randomBytes(40), status],
  );
  return rows[0]!.id;
}

const figure = async (id: string) =>
  (await deps.db.query<{ cents: string | null }>('select verified_usd_cents::text as cents from past_reputation where id = $1', [id])).rows[0]!.cents;

async function as(role: 'senior' | 'mod' | 'owner' | 'helper'): Promise<StaffBrowser> {
  const s = role === 'owner' ? await ownerAccount() : (await seedStaff(deps, { role })).id;
  const { token } = await insertSession(deps, s, 'staff');
  return new StaffBrowser(app).withSession(token);
}
let ownerId: string | undefined;
const ownerAccount = async () => (ownerId ??= (await seedStaff(deps, { role: 'owner' })).id);

const put = (b: StaffBrowser, id: string, body: unknown) => b.send('PUT', `/staff/v1/past-rep/${id}/verified-usd`, body);

describe('PUT /staff/v1/past-rep/:id/verified-usd', () => {
  it('a senior moderator and the owner set and clear the figure; the log has the claim, never the amount', async () => {
    const id = await claim();
    const res = await put(await as('senior'), id, { usdCents: 1_234_500 });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true }]);
    expect(await figure(id)).toBe('1234500');
    const cleared = await put(await as('owner'), id, { usdCents: null });
    expect(cleared.statusCode).toBe(200);
    expect(await figure(id)).toBeNull();
    const entries = await logEntries(deps, 'pastrep.verified-usd-set');
    expect(entries.map((e) => JSON.parse(e.detail))).toEqual([{ claimId: id, cleared: false }, { claimId: id, cleared: true }]);
    expect(entries.map((e) => e.detail).join('')).not.toContain('1234500');
  });

  it('a moderator or a helper is refused by the guard (403 forbidden)', async () => {
    const id = await claim();
    for (const role of ['mod', 'helper'] as const) {
      const res = await put(await as(role), id, { usdCents: 100 });
      expect([res.statusCode, res.json()]).toEqual([403, { error: 'forbidden' }]);
    }
    expect(await figure(id)).toBeNull();
  });

  it('owner Q58: at most $100,000; zero, fractions, strings and extra keys are 400', async () => {
    const id = await claim();
    const b = await as('senior');
    expect((await put(b, id, { usdCents: 10_000_000 })).statusCode).toBe(200);
    for (const body of [{ usdCents: 10_000_001 }, { usdCents: 0 }, { usdCents: 1.5 }, { usdCents: '100' }, { usdCents: 100, x: 1 }, [], null]) {
      const res = await put(b, id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await figure(id)).toBe('10000000');
  });

  it('an unknown claim is 404 and one no longer live is 409 not-live', async () => {
    const b = await as('senior');
    expect((await put(b, '00000000-0000-4000-8000-000000000000', { usdCents: 100 })).statusCode).toBe(404);
    expect((await put(b, 'nope', { usdCents: 100 })).statusCode).toBe(404);
    const revoked = await claim('revoked');
    const res = await put(b, revoked, { usdCents: 100 });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'not-live' }]);
  });
});
