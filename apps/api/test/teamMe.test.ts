import { WEEKDAYS } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { OWN_DATA_READS } from '../src/auth/frontDoor.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { ABILITIES, PRESETS } from '../src/team/abilities.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

// GET /v1/team/me: a team member's own access, read only (team/access.ts). Real Postgres.

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;
const START = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { db: await testDb() }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;

async function team(): Promise<Who> {
  setNow(START);
  const t = await trader();
  await makeVendor(deps, t.id);
  return t;
}

/** A joined member seeded directly (the real sign-up is team.test.ts's), logged in. */
async function member(teamId: string, abilities: string[]) {
  const name = `Mmember${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `mmlogin${n}x`, displayName: `mm-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return { id: rows[0]!.id, name, browser };
}

async function sessionId(b: Browser): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>("select id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [b.cookies['__Host-x2f_session']]);
  return rows[0]!.id;
}

interface Access {
  name: string;
  chatLabel: string;
  lead: { displayName: string };
  preset: string | null;
  groups: { id: string; label: string; boxes: { id: string; label: string; does: string; always: boolean; ready: boolean }[] }[];
  limits?: { band: { minAtomic: string; maxAtomic: string } | null; hours: unknown; insideNow: boolean; workingUntil: string | null };
  serverNow: string;
}

const today = () => WEEKDAYS[deps.clock().getUTCDay()]!;

describe('GET /v1/team/me', () => {
  it("answers a member's own boxes in the catalogue's words, their lead and their limits (any time by default)", async () => {
    const owner = await team();
    const trades = [...PRESETS.find((p) => p.id === 'trades')!.abilities];
    const m = await member(owner.id, trades);
    const res = await m.browser.get('/v1/team/me');
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json() as Access;
    expect(a.name).toBe(m.name);
    expect(a.lead).toEqual({ displayName: owner.displayName });
    expect(a.chatLabel).toBe(`${owner.displayName} Assistant 1`);
    expect(a.preset).toBe('trades');
    // Every box the member holds, in catalogue order, with the catalogue's label and description.
    const boxes = a.groups.flatMap((g) => g.boxes);
    const order = ABILITIES.map((x) => x.id);
    expect(boxes.map((b) => order.indexOf(b.id))).toEqual([...boxes.map((b) => order.indexOf(b.id))].sort((x, y) => x - y));
    for (const id of trades) {
      const cat = ABILITIES.find((x) => x.id === id)!;
      expect(boxes.find((b) => b.id === id), id).toMatchObject({ label: cat.label, does: cat.does, always: false });
    }
    // The always-on boxes are there too, marked; no group is empty.
    expect(boxes.find((b) => b.id === 'own-login-methods')).toMatchObject({ always: true, ready: true });
    expect(a.groups.every((g) => g.boxes.length > 0)).toBe(true);
    // Nothing the member does not hold (an owner-only box).
    expect(boxes.some((b) => b.id === 'trades-release')).toBe(false);
    expect(a.limits).toEqual({ band: null, hours: 'any', insideNow: true, workingUntil: null });
    expect(a.serverNow).toBe(START.toISOString());
  });

  it('a band and a window: both shown, inside now, with the end of the window', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades-see-active']);
    const hours = { days: [today()], start: '08:00', end: '13:00', tz: 'UTC' };
    const band = { minAtomic: '100000000000', maxAtomic: '2000000000000' };
    const confirmToken = await issueConfirmToken(deps, {
      sessionId: await sessionId(owner.browser), accountId: owner.id, method: 'passkey',
      action: { kind: 'team-limits', memberId: m.id, band: `${band.minAtomic}-${band.maxAtomic}`, hours: `${today()} 08:00-13:00 UTC` },
    });
    const put = await owner.browser.put(`/v1/team/members/${m.id}/limits`, { band, hours, confirmToken });
    expect(put.statusCode, put.body).toBe(200);
    const a = (await m.browser.get('/v1/team/me')).json() as Access;
    expect(a.limits).toEqual({ band, hours, insideNow: true, workingUntil: '2026-10-17T13:00:00.000Z' });
    // A ticked box X2F does not offer yet reads as not ready.
    await deps.db.query("update team_members set abilities = array['trades-see-active', 'trades-export-history'] where id = $1", [m.id]);
    const b = (await m.browser.get('/v1/team/me')).json() as Access;
    expect(b.groups.flatMap((g) => g.boxes).find((x) => x.id === 'trades-export-history')).toMatchObject({ ready: false, label: 'Export trade history' });
  });

  it('the account owner gets 403 forbidden; no session is 401; a removed member is logged out', async () => {
    const owner = await team();
    const o = await owner.browser.get('/v1/team/me');
    expect({ status: o.statusCode, error: (o.json() as { error: string }).error }).toEqual({ status: 403, error: 'forbidden' });
    expect((await new Browser(app).get('/v1/team/me')).statusCode).toBe(401);
    const m = await member(owner.id, ['trades-see-active']);
    await deps.db.query('update team_members set removed_at = $2 where id = $1', [m.id, deps.clock()]);
    expect((await m.browser.get('/v1/team/me')).statusCode).toBe(401);
  });

  it('shows another team nothing: each member sees only their own row', async () => {
    const a = await team();
    const b = await team();
    const ma = await member(a.id, ['offers-see']);
    const mb = await member(b.id, ['trades-see-active']);
    const va = (await ma.browser.get('/v1/team/me')).json() as Access;
    const vb = (await mb.browser.get('/v1/team/me')).json() as Access;
    expect(va.lead.displayName).toBe(a.displayName);
    expect(vb.lead.displayName).toBe(b.displayName);
    expect(va.groups.flatMap((g) => g.boxes).map((x) => x.id)).toContain('offers-see');
    expect(va.groups.flatMap((g) => g.boxes).map((x) => x.id)).not.toContain('trades-see-active');
  });

  it('is classified as an own-data read', () => {
    expect(OWN_DATA_READS['GET /v1/team/me']).toBeTruthy();
  });
});
