import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

// A team member's signed-in sessions on the owner's Team screen (team/memberSessions.ts):
// GET /v1/team/members/:id/sessions, DELETE .../sessions/:sessionId and DELETE .../sessions.

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { db: await testDb({ max: 8 }) }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;

async function team(): Promise<Who> {
  const t = await trader();
  await makeVendor(deps, t.id);
  return t;
}

async function member(teamId: string): Promise<{ id: string; loginId: string; name: string }> {
  const name = `Sessioner${String(++n).padStart(3, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `mslogin${n}x`, displayName: `ms-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, '{}', $4, $5, $4, $4) returning id`,
    [teamId, name, name.toLowerCase(), now, loginId],
  );
  return { id: rows[0]!.id, loginId, name };
}

/** A new login of the member on a browser of its own; returns the browser and its session id. */
async function login(loginId: string): Promise<{ browser: Browser; sessionId: string }> {
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return { browser, sessionId: (res.json() as { sessionId: string }).sessionId };
}

interface View { id: string; deviceLabel: string; createdAt: string; lastSeenAt: string }

async function sessionsOf(b: Browser, memberId: string): Promise<View[]> {
  const res = await b.get(`/v1/team/members/${memberId}/sessions`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { sessions: View[] }).sessions;
}

const ended = async (memberId: string) =>
  (await deps.db.query<{ actor_kind: string; category: string; detail: { session: string; device: string }; member_id: string | null }>(
    `select actor_kind, category, detail, member_id from team_audit where subject_id = $1 and action = 'session-ended' order by at, id`,
    [memberId],
  )).rows;

const revoked = async (sessionId: string) =>
  (await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where id = $1', [sessionId])).rows[0]!.revoked_at;

describe("the owner sees a member's sessions", () => {
  it("lists the member's live sessions only, with device, signed in at and last seen", async () => {
    const owner = await team();
    const m = await member(owner.id);
    const other = await member(owner.id);
    const a = await login(m.loginId);
    const b = await login(m.loginId);
    const gone = await login(m.loginId);
    await login(other.loginId);
    await deps.db.query('update sessions set revoked_at = now() where id = $1', [gone.sessionId]);
    const list = await sessionsOf(owner.browser, m.id);
    expect(list.map((s) => s.id).sort()).toEqual([a.sessionId, b.sessionId].sort());
    for (const s of list) {
      expect(s.deviceLabel).toBe('Test browser');
      expect(Number.isFinite(Date.parse(s.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(s.lastSeenAt))).toBe(true);
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'deviceLabel', 'id', 'lastSeenAt']);
    }
  });

  it('answers 404 for a member of another account, an unknown id or a bad id', async () => {
    const owner = await team();
    const stranger = await team();
    const theirs = await member(stranger.id);
    expect((await owner.browser.get(`/v1/team/members/${theirs.id}/sessions`)).statusCode).toBe(404);
    expect((await owner.browser.get('/v1/team/members/00000000-0000-4000-8000-000000000000/sessions')).statusCode).toBe(404);
    expect((await owner.browser.get('/v1/team/members/nope/sessions')).statusCode).toBe(404);
  });

  it('a member may not read or end sessions (403 owner-only)', async () => {
    const owner = await team();
    const m = await member(owner.id);
    const s = await login(m.loginId);
    const r = await s.browser.get(`/v1/team/members/${m.id}/sessions`);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'owner-only' });
    expect((await s.browser.delete(`/v1/team/members/${m.id}/sessions`)).statusCode).toBe(403);
    expect(await revoked(s.sessionId)).toBeNull();
  });
});

describe("the owner ends a member's sessions", () => {
  it('ends one: the member is logged out there, the other session stays, and the team log gets session-ended', async () => {
    const owner = await team();
    const m = await member(owner.id);
    const a = await login(m.loginId);
    const b = await login(m.loginId);
    const res = await owner.browser.delete(`/v1/team/members/${m.id}/sessions/${a.sessionId}`);
    expect(res.statusCode, res.body).toBe(204);
    expect(await revoked(a.sessionId)).not.toBeNull();
    expect(await revoked(b.sessionId)).toBeNull();
    expect((await a.browser.get('/v1/account/me')).statusCode).toBe(401);
    expect((await b.browser.get('/v1/account/me')).statusCode).toBe(200);
    expect((await sessionsOf(owner.browser, m.id)).map((s) => s.id)).toEqual([b.sessionId]);
    expect(await ended(m.id)).toEqual([
      { actor_kind: 'lead', category: 'access', member_id: null, detail: { session: a.sessionId.slice(0, 8), device: 'Test browser' } },
    ]);
    // The owner's team log shows it too.
    const log = (await owner.browser.get('/v1/team/log?category=access')).json() as { entries: { action: string; subjectId: string | null }[] };
    expect(log.entries.filter((e) => e.action === 'session-ended' && e.subjectId === m.id)).toHaveLength(1);
    // Ending it again ends nothing and logs nothing more.
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions/${a.sessionId}`)).statusCode).toBe(204);
    expect(await ended(m.id)).toHaveLength(1);
  });

  it("ends all of one member's sessions, never another member's or the owner's", async () => {
    const owner = await team();
    const m = await member(owner.id);
    const other = await member(owner.id);
    const a = await login(m.loginId);
    const b = await login(m.loginId);
    const keep = await login(other.loginId);
    const res = await owner.browser.delete(`/v1/team/members/${m.id}/sessions`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ended: 2 });
    expect(await revoked(a.sessionId)).not.toBeNull();
    expect(await revoked(b.sessionId)).not.toBeNull();
    expect(await revoked(keep.sessionId)).toBeNull();
    expect((await owner.browser.get('/v1/account/me')).statusCode).toBe(200);
    expect((await ended(m.id)).map((e) => e.actor_kind)).toEqual(['lead', 'lead']);
    expect(await ended(other.id)).toHaveLength(0);
    expect(await sessionsOf(owner.browser, m.id)).toEqual([]);
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions`)).json()).toEqual({ ended: 0 });
  });

  it("answers 404 for another account's member, another member's session or the owner's own, and ends nothing", async () => {
    const owner = await team();
    const m = await member(owner.id);
    const other = await member(owner.id);
    const theirs = await login(other.loginId);
    const ownSession = (await deps.db.query<{ id: string }>('select id from sessions where account_id = $1 and member_id is null', [owner.id])).rows[0]!.id;
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions/${theirs.sessionId}`)).statusCode).toBe(404);
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions/${ownSession}`)).statusCode).toBe(404);
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions/not-a-uuid`)).statusCode).toBe(404);
    const stranger = await team();
    const s = await member(stranger.id);
    const ss = await login(s.loginId);
    expect((await owner.browser.delete(`/v1/team/members/${s.id}/sessions/${ss.sessionId}`)).statusCode).toBe(404);
    expect((await owner.browser.delete(`/v1/team/members/${s.id}/sessions`)).statusCode).toBe(404);
    for (const id of [theirs.sessionId, ownSession, ss.sessionId]) expect(await revoked(id)).toBeNull();
  });

  it('a session whose login waits (username and password only) may not end them (403 weak-session)', async () => {
    const owner = await team();
    const m = await member(owner.id);
    const a = await login(m.loginId);
    await deps.db.query("update sessions set strength = 'weak-single', onboarding_until = null where account_id = $1 and member_id is null", [owner.id]);
    for (const url of [`/v1/team/members/${m.id}/sessions/${a.sessionId}`, `/v1/team/members/${m.id}/sessions`]) {
      const res = await owner.browser.delete(url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ error: 'weak-session' });
    }
    expect(await revoked(a.sessionId)).toBeNull();
    // Reading them is fine.
    expect(await sessionsOf(owner.browser, m.id)).toHaveLength(1);
  });

  it("a member's own logout racing the owner's end-all finishes both (the removal's lock order)", async () => {
    const owner = await team();
    const m = await member(owner.id);
    const sessions = await Promise.all([login(m.loginId), login(m.loginId), login(m.loginId)]);
    const [out, all] = await Promise.all([
      sessions[1]!.browser.post('/v1/logout'),
      owner.browser.delete(`/v1/team/members/${m.id}/sessions`),
    ]);
    expect(out.statusCode).toBe(200);
    expect(all.statusCode).toBe(200);
    for (const s of sessions) expect(await revoked(s.sessionId)).not.toBeNull();
    // One row per ended session, whichever request ended it: the logout's is X2F's, the rest the owner's.
    const rows = await ended(m.id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((e) => e.actor_kind === 'system').length).toBeLessThanOrEqual(1);
    expect(rows.filter((e) => e.actor_kind === 'lead').length).toBeGreaterThanOrEqual(2);
  });

  it("other endings stay X2F's: the member's own logout and the account-wide session list (migration 859)", async () => {
    const owner = await team();
    const m = await member(owner.id);
    const a = await login(m.loginId);
    const b = await login(m.loginId);
    expect((await a.browser.post('/v1/logout')).statusCode).toBe(200);
    expect((await owner.browser.delete(`/v1/account/sessions/${b.sessionId}`)).statusCode).toBe(204);
    expect((await ended(m.id)).map((e) => e.actor_kind)).toEqual(['system', 'system']);
    // The mark does not outlive the owner's ending: a later revocation on the same connection is X2F's.
    const c = await login(m.loginId);
    const d = await login(m.loginId);
    expect((await owner.browser.delete(`/v1/team/members/${m.id}/sessions/${c.sessionId}`)).statusCode).toBe(204);
    await deps.db.query('update sessions set revoked_at = now() where id = $1', [d.sessionId]);
    expect((await ended(m.id)).map((e) => e.actor_kind)).toEqual(['system', 'system', 'lead', 'system']);
  });
});
