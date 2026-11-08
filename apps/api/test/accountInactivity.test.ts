import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { assertNotDisabled } from '../src/auth/sessions.js';
import { closeDueAccounts, closeInactiveAccounts, CLOSE_CAP, INACTIVE_MS, inactivityJob } from '../src/accountInactivity.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { genKey } from './helpers/pgpKeys.js';
import { Browser } from './helpers/totp.js';
import { seedOffer, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Owner answer Q77 (2026-11-06, comms owner-answers-page-2026-11-06.md): "If they haven't logged
// into their account in 60 days, then it automatically closes. And if they want to switch to a
// trader account, then they have to open a new account." A vendor account with no login for 60
// days is closed by a retention job; closing uses the existing disabled state (no login, no
// session, offers unlisted, push off). Real Postgres, one database for the file.

const DAY = 86_400_000;
const START = new Date('2026-10-17T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let n = 0;

beforeAll(async () => {
  ({ app, deps, setNow, trader } = await tradeApp());
  setNow(START);
});
afterAll(async () => {
  await app.close();
});

const at = (ms: number) => new Date(START.getTime() + ms);

interface Row {
  last_login_at: Date | null;
  disabled_at: Date | null;
  closed_at: Date | null;
  closed_reason: string | null;
}
async function row(id: string): Promise<Row> {
  const { rows } = await deps.db.query<Row>('select last_login_at, disabled_at, closed_at, closed_reason from accounts where id = $1', [id]);
  return rows[0]!;
}

/** A vendor that logged in at START. */
async function vendor() {
  setNow(START);
  const t = await trader();
  await makeVendor(deps, t.id);
  return t;
}

async function liveSessions(id: string): Promise<number> {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from sessions where account_id = $1 and revoked_at is null', [id]);
  return rows[0]!.n;
}

describe('the last login is recorded', () => {
  it("every login stamps the account's last_login_at", async () => {
    const t = await vendor();
    expect((await row(t.id)).last_login_at).toEqual(START);
    setNow(at(5 * DAY));
    expect((await new Browser(app).post('/t/login', { accountId: t.id })).statusCode).toBe(200);
    expect((await row(t.id)).last_login_at).toEqual(at(5 * DAY));
  });

  it("a team member's login counts as the vendor account's login (stamped on the team account)", async () => {
    const t = await vendor();
    const loginId = await seedAccount(deps, { loginName: `vimember${++n}x`, displayName: `vi-${n}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [t.id, `ViMember${n}`, `vimember${n}`, ['trades'], START, loginId],
    );
    setNow(at(30 * DAY));
    const res = await new Browser(app).post('/t/login', { accountId: loginId });
    expect(res.statusCode, res.body).toBe(200);
    expect((await row(t.id)).last_login_at).toEqual(at(30 * DAY));
  });
});

describe('closeInactiveAccounts (Q77)', () => {
  it('is one of the retention jobs', () => {
    expect(RETENTION_JOBS).toContain(closeInactiveAccounts);
    expect(INACTIVE_MS).toBe(60 * DAY);
  });

  it('closes a vendor whose last login is 60 days old: disabled, closed (inactive), sessions revoked; not a moment before', async () => {
    const t = await vendor();
    await closeDueAccounts(deps.db, new Date(START.getTime() + INACTIVE_MS - 1));
    expect((await row(t.id)).closed_at).toBeNull();
    const when = at(INACTIVE_MS);
    expect(await closeDueAccounts(deps.db, when)).toBeGreaterThanOrEqual(1);
    expect(await row(t.id)).toEqual({ last_login_at: START, disabled_at: when, closed_at: when, closed_reason: 'inactive' });
    expect(await liveSessions(t.id)).toBe(0);
  });

  it("owner G14: a closed vendor's PGP key can go on a new account (its key is released); its names stay taken", async () => {
    const t = await vendor();
    const key = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: t.id, fingerprint: key.fingerprint, armored: key.publicKey, now: START });
    expect(await closeDueAccounts(deps.db, at(INACTIVE_MS))).toBeGreaterThanOrEqual(1);
    expect((await deps.db.query('select 1 from pgp_keys where account_id = $1', [t.id])).rowCount).toBe(0);
    const fresh = await seedAccount(deps, { loginName: `fresh${t.id.slice(0, 8)}` });
    await insertPgpKey(deps.db, deps.config, { accountId: fresh, fingerprint: key.fingerprint, armored: key.publicKey, now: START });
    expect((await deps.db.query('select 1 from accounts where id = $1 and closed_at is not null', [t.id])).rowCount).toBe(1);
  });

  it('a closed vendor cannot log in (403 account-disabled), and its live offer is no longer listed', async () => {
    const t = await vendor();
    const offerId = await seedOffer(deps, t.id, 'seller');
    await deps.db.query("update offers set status = 'live', method_id = 'ZELLE' where id = $1", [offerId]);
    const other = await trader();
    expect((await other.browser.get(`/v1/offers/${offerId}`)).statusCode).toBe(200);
    await closeDueAccounts(deps.db, at(INACTIVE_MS));
    setNow(at(INACTIVE_MS + 1));
    // Every login finish runs assertNotDisabled before its session (the test login skips it).
    await expect(assertNotDisabled(deps.db, t.id)).rejects.toMatchObject({ status: 403, code: 'account-disabled' });
    expect((await other.browser.get(`/v1/offers/${offerId}`)).statusCode).toBe(404);
  });

  it('owner p4-5: closes a trader account too (every account), after 60 days; staff and member logins never', async () => {
    setNow(START);
    const t = await trader();
    await closeDueAccounts(deps.db, at(INACTIVE_MS - 1));
    expect((await row(t.id)).closed_at).toBeNull();
    await closeDueAccounts(deps.db, at(INACTIVE_MS));
    expect((await row(t.id)).closed_reason).toBe('inactive');
    const staff = await seedAccount(deps, { loginName: `st${Date.now().toString(36)}`, kind: 'staff' });
    await deps.db.query('update accounts set last_login_at = $2 where id = $1', [staff, START]);
    await closeDueAccounts(deps.db, at(400 * DAY));
    expect((await row(staff)).closed_at).toBeNull();
  });

  it('a later login restarts the 60 days', async () => {
    const t = await vendor();
    setNow(at(50 * DAY));
    expect((await new Browser(app).post('/t/login', { accountId: t.id })).statusCode).toBe(200);
    await closeDueAccounts(deps.db, at(INACTIVE_MS));
    expect((await row(t.id)).closed_at).toBeNull();
    await closeDueAccounts(deps.db, at(50 * DAY + INACTIVE_MS));
    expect((await row(t.id)).closed_reason).toBe('inactive');
  });

  it('owner p4-5: an open trade or dispute pauses the clock; the 60 days count again from its close', async () => {
    const t = await vendor();
    setNow(START);
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: buyer.id, poster: 'seller' });
    await closeDueAccounts(deps.db, at(INACTIVE_MS + DAY));
    expect((await row(t.id)).closed_at).toBeNull();
    await deps.db.query("update trades set state = 'cancelled', closed_at = $2 where code = $1", [trade.code, at(INACTIVE_MS + DAY)]);
    await closeDueAccounts(deps.db, at(INACTIVE_MS + DAY + INACTIVE_MS - 1));
    expect((await row(t.id)).closed_at).toBeNull();
    await closeDueAccounts(deps.db, at(INACTIVE_MS + DAY + INACTIVE_MS));
    expect((await row(t.id)).closed_reason).toBe('inactive');
  });

  it('leaves an account a moderator already disabled as it is (not marked closed)', async () => {
    const t = await vendor();
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [t.id, at(DAY)]);
    await closeDueAccounts(deps.db, at(INACTIVE_MS + DAY));
    expect(await row(t.id)).toMatchObject({ disabled_at: at(DAY), closed_at: null, closed_reason: null });
  });

  it('lead vendor review item 4: the first pass after a start or a gap closes nothing; a pass in maintenance closes nothing', async () => {
    const t = await vendor();
    const job = inactivityJob();
    const due = at(INACTIVE_MS + DAY);
    expect(await job.run(deps.db, due)).toBe(0); // the first pass only records the time
    expect((await row(t.id)).closed_at).toBeNull();
    await deps.db.query('update site_flags set maintenance_since = $1', [due]);
    try {
      expect(await job.run(deps.db, new Date(due.getTime() + 10 * 60_000))).toBe(0);
      expect((await row(t.id)).closed_at).toBeNull();
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null');
    }
    // A gap of more than an hour: again nothing, then the next regular pass closes.
    const later = new Date(due.getTime() + 3 * 60 * 60_000);
    expect(await job.run(deps.db, later)).toBe(0);
    expect(await job.run(deps.db, new Date(later.getTime() + 10 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await row(t.id)).closed_reason).toBe('inactive');
  });

  it(`lead vendor review item 4: one pass closes at most ${CLOSE_CAP}; when more are due the owner is alerted`, async () => {
    const owner = await seedAccount(deps, { loginName: `vowner${Date.now()}`, kind: 'owner' }).catch(async () => (await deps.db.query<{ id: string }>("select id from accounts where kind = 'owner'")).rows[0]!.id);
    const many = [];
    for (let i = 0; i < CLOSE_CAP + 2; i++) many.push(await vendor());
    const when = at(INACTIVE_MS + 500 * DAY);
    const closed = await closeDueAccounts(deps.db, when);
    expect(closed).toBe(CLOSE_CAP);
    const { rows } = await deps.db.query<{ detail: { closed: number; cap: number } }>(
      "select detail from alerts where account_id = $1 and kind = 'auto-close-capped' order by created_at desc limit 1", [owner],
    );
    expect(rows[0]!.detail).toEqual({ closed: CLOSE_CAP, cap: CLOSE_CAP });
    // The rest close on the next passes.
    expect(await closeDueAccounts(deps.db, when)).toBeGreaterThanOrEqual(2);
  });
});
