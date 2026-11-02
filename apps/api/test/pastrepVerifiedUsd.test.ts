// Owner order 2 Nov 2026 (lead 07:48): imported past-reputation volume counts toward the traded total
// ("Completed over $X") ONLY through a moderator-verified dollar figure. Migration 310 adds
// `past_reputation.verified_usd_cents` (bigint, null = not verified); only a moderator sets it,
// through `setVerifiedPastRepUsd` (the staff route and screen are Plan 4's); the traded total reads
// `verifiedPastRepUsdCents`, which sums APPROVED claims with a figure (owner 2026-11-02). Null, a signed
// (not yet approved) or a dead claim adds nothing.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { setVerifiedPastRepUsd, verifiedPastRepUsdCents } from '../src/pastrep/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';

const T0 = new Date('2026-11-02T12:00:00Z');
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let app: FastifyInstance;
let deps: Deps;
let n = 0;

const account = (kind: 'trader' | 'staff' | 'owner' | 'member' = 'trader', disabled = false) => {
  n += 1;
  return seedAccount(deps, { loginName: `vusd${n}x`, displayName: `Vusd${String(n).padStart(3, '0')}`, kind, disabled });
};

// One owner account may exist (`one_owner`): made once, reused.
let ownerId: string | undefined;
const owner = async () => (ownerId ??= await account('owner'));

/** A claim row as finish stores it (the key and signature bytes do not matter here). */
async function claim(accountId: string, o: { site?: string; status?: string; fingerprint?: string } = {}): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
     values ($1, $2, 'https://web.archive.org/web/2023/x', 10, $3, $4, 'text', $4, $5, $6) returning id`,
    [accountId, o.site ?? 'LocalMonero', o.fingerprint ?? randomBytes(20).toString('hex'), randomBytes(40), o.status ?? 'signed', T0],
  );
  return rows[0]!.id;
}

const row = async (id: string) =>
  (await deps.db.query<{ verified_usd_cents: string | null; verified_usd_by: string | null; verified_usd_at: Date | null }>(
    'select verified_usd_cents, verified_usd_by, verified_usd_at from past_reputation where id = $1', [id],
  )).rows[0]!;

beforeAll(async () => {
  ({ app, deps } = await testApp());
});
afterAll(async () => app.close());
beforeEach(async () => {
  await deps.db.query('delete from past_reputation');
});

describe('migration 310: past_reputation.verified_usd_cents', () => {
  it('is a nullable bigint with no default: a new claim is not verified', async () => {
    const { rows } = await deps.db.query(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'past_reputation' and column_name = 'verified_usd_cents'`,
    );
    expect(rows).toEqual([{ data_type: 'bigint', is_nullable: 'YES', column_default: null }]);
    const id = await claim(await account());
    expect(await row(id)).toEqual({ verified_usd_cents: null, verified_usd_by: null, verified_usd_at: null });
  });

  it('the database refuses a figure set by anyone but an enabled staff account, or with no time', async () => {
    const trader = await account();
    const staff = await account('staff');
    const id = await claim(trader);
    const set = (by: string | null, at: Date | null = T0, cents = 100) =>
      deps.db.query('update past_reputation set verified_usd_cents = $2, verified_usd_by = $3, verified_usd_at = $4 where id = $1', [id, cents, by, at]);
    await expect(set(null)).rejects.toMatchObject({ code: '42501' });
    await expect(set(trader)).rejects.toMatchObject({ code: '42501' });
    await expect(set(await owner())).rejects.toMatchObject({ code: '42501' });
    await expect(set(await account('member'))).rejects.toMatchObject({ code: '42501' });
    await expect(set(await account('staff', true))).rejects.toMatchObject({ code: '42501' });
    await expect(set(staff, null)).rejects.toMatchObject({ code: '42501' });
    await expect(set(staff, T0, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(set(staff, T0, -1)).rejects.toMatchObject({ code: '23514' });
    expect((await row(id)).verified_usd_cents).toBeNull();
    await set(staff);
    expect(await row(id)).toEqual({ verified_usd_cents: '100', verified_usd_by: staff, verified_usd_at: T0 });
  });
});

describe('setVerifiedPastRepUsd (the moderator seam)', () => {
  it('a staff account sets the figure on a live claim (signed or approved), recording who and when', async () => {
    const trader = await account();
    const staff = await account('staff');
    const signed = await claim(trader, { site: 'LocalMonero' });
    const approved = await claim(trader, { site: 'Paxful', status: 'approved' });
    expect(await setVerifiedPastRepUsd(deps.db, signed, 1_250_000_00, staff, T0)).toEqual({ ok: true });
    expect(await setVerifiedPastRepUsd(deps.db, approved, 99, staff, T0)).toEqual({ ok: true });
    expect(await row(signed)).toEqual({ verified_usd_cents: '125000000', verified_usd_by: staff, verified_usd_at: T0 });
    // Owner 2026-11-02: a figure may be entered before approval, but only an APPROVED claim counts.
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(99);
  });

  it('anyone but an enabled staff account is refused not-staff and nothing is stored', async () => {
    const trader = await account();
    const id = await claim(trader);
    for (const by of [trader, await owner(), await account('member'), await account('staff', true), '00000000-0000-4000-8000-000000000000']) {
      expect(await setVerifiedPastRepUsd(deps.db, id, 500, by, T0), by).toEqual({ ok: false, reason: 'not-staff' });
    }
    expect((await row(id)).verified_usd_cents).toBeNull();
  });

  it('a figure that is not a whole positive number of cents is refused bad-amount', async () => {
    const id = await claim(await account());
    const staff = await account('staff');
    for (const cents of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await setVerifiedPastRepUsd(deps.db, id, cents, staff, T0), String(cents)).toEqual({ ok: false, reason: 'bad-amount' });
    }
    expect((await row(id)).verified_usd_cents).toBeNull();
  });

  it('a revoked, rejected or removed claim is refused not-live; an unknown claim not-found', async () => {
    const trader = await account();
    const staff = await account('staff');
    for (const status of ['revoked', 'rejected', 'removed']) {
      const id = await claim(trader, { site: `S-${status}`, status });
      expect(await setVerifiedPastRepUsd(deps.db, id, 500, staff, T0), status).toEqual({ ok: false, reason: 'not-live' });
      expect((await row(id)).verified_usd_cents).toBeNull();
    }
    expect(await setVerifiedPastRepUsd(deps.db, '00000000-0000-4000-8000-000000000000', 500, staff, T0)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('null clears the figure (the claim adds nothing again)', async () => {
    const trader = await account();
    const staff = await account('staff');
    const id = await claim(trader, { status: 'approved' });
    await setVerifiedPastRepUsd(deps.db, id, 700, staff, T0);
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(700);
    expect(await setVerifiedPastRepUsd(deps.db, id, null, staff, T0)).toEqual({ ok: true });
    expect(await row(id)).toEqual({ verified_usd_cents: null, verified_usd_by: null, verified_usd_at: null });
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(0);
  });
});

describe('verifiedPastRepUsdCents (what the traded total may add)', () => {
  it('owner 2026-11-02: a signed (not yet approved) claim with a figure counts nothing; once approved it counts', async () => {
    const trader = await account();
    const staff = await account('staff');
    const id = await claim(trader, { site: 'Pending' });
    expect(await setVerifiedPastRepUsd(deps.db, id, 5_000_00, staff, T0)).toEqual({ ok: true });
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(0);
    await deps.db.query(`update past_reputation set status = 'approved' where id = $1`, [id]);
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(5_000_00);
    // Read at query time: revoked after approval stops counting at once.
    await deps.db.query(`update past_reputation set status = 'revoked' where id = $1`, [id]);
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(0);
  });

  it('sums only the account’s approved claims with a figure: never unverified, never a dead claim', async () => {
    const trader = await account();
    const otherTrader = await account();
    const staff = await account('staff');
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(0);
    await claim(trader, { site: 'NoFigure', status: 'approved' });
    const kept = await claim(trader, { site: 'Kept', status: 'approved' });
    const revoked = await claim(trader, { site: 'Revoked', status: 'approved' });
    const removed = await claim(trader, { site: 'Removed', status: 'approved' });
    const others = await claim(otherTrader, { site: 'Kept', status: 'approved' });
    for (const id of [kept, revoked, removed, others]) expect(await setVerifiedPastRepUsd(deps.db, id, 10_000_00, staff, T0)).toEqual({ ok: true });
    await deps.db.query(`update past_reputation set status = 'revoked' where id = $1`, [revoked]);
    await deps.db.query(`update past_reputation set status = 'removed' where id = $1`, [removed]);
    expect(await verifiedPastRepUsdCents(deps.db, trader)).toBe(10_000_00);
    expect(await verifiedPastRepUsdCents(deps.db, otherTrader)).toBe(10_000_00);
  });
});

/** Every .ts file under `dir` (none when it does not exist). */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : sources(p)) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('stand-ins', () => {
  it('only the seam writes verified_usd_cents (no other server file names the column)', () => {
    const holders = [...sources(join(ROOT, 'apps/api/src')), ...sources(join(ROOT, 'apps/moderation/src'))]
      .filter((f) => readFileSync(f, 'utf8').includes('verified_usd_cents'))
      .map((f) => f.slice(ROOT.length));
    expect(holders).toEqual(['apps/api/src/pastrep/store.ts']);
  });

  it('NEEDS_P4_PASTREP_VERIFIED_USD: the moderator route sets the figure through setVerifiedPastRepUsd', () => {
    // When Plan 4's staff API lands (`buildStaffApi`, `apps/api/src/staff`, or a staff app): add the
    // moderator route that sets a claim's verified dollar figure (perm check, activity-log entry with
    // the claim id and no amount text in it), calling `setVerifiedPastRepUsd` only; then delete this test.
    const staffFiles = [
      ...sources(join(ROOT, 'apps/api/src/staff')),
      ...sources(join(ROOT, 'apps/staff-api/src')),
    ];
    const appTs = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
    const staffLanded = /buildStaffApi/.test(appTs) || staffFiles.length > 0;
    const usesSeam = staffFiles.some((f) => readFileSync(f, 'utf8').includes('setVerifiedPastRepUsd'));
    expect(staffLanded && !usesSeam, 'Plan 4 staff API landed without a verified-USD route on setVerifiedPastRepUsd (see this test)').toBe(false);
  });

  it('NEEDS_C12_PASTREP_IN_TRADED_TOTAL: the traded total adds verifiedPastRepUsdCents', () => {
    // wip/third-p5-reviews-api (C12) builds account_traded_totals / tradedTotal.ts. Once both are on
    // one branch, the "Completed over $X" bucket adds verifiedPastRepUsdCents (and nothing else from
    // past reputation); then delete this test.
    const total = join(ROOT, 'apps/api/src/traders/tradedTotal.ts');
    const landed = existsSync(total);
    const wired = landed && readFileSync(total, 'utf8').includes('verifiedPastRepUsdCents');
    expect(landed && !wired, 'tradedTotal.ts is here: add verifiedPastRepUsdCents to the traded total (see this test)').toBe(false);
  });
});
