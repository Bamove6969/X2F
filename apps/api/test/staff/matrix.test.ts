// Plan 4 Task 4: the privilege matrix. Every staff route (routes.ts) is called as each kind of
// caller; the allowed roles reach the handler (2xx or a validation answer), everyone else is
// refused with the guard's code. The table must list exactly the routes the staff app registers.
// Who is allowed comes from routes.ts's hand-written `allowed` column, never from `can()` (RV5 m4).
import { GRANTABLE_PERMS, type StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { PUBLIC_PERMS } from '../../src/staff/guard.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, seedStaff, staffApps, uniqueName } from '../helpers/staffApp.js';
import { STAFF_ROUTE_ROWS, type StaffRouteRow } from './routes.js';

const MON_NOON = new Date('2026-11-02T12:00:00Z');
const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
const ids: Record<string, string> = {};

const CALLERS = [
  'anonymous', 'trader', 'member', 'helper', 'mod', 'senior', 'owner', 'switched-off mod', 'out-of-hours mod', 'recovery mod', 'mod with a grant',
] as const;
type Caller = (typeof CALLERS)[number];
const ROLE_OF: Partial<Record<Caller, StaffRole>> = { helper: 'helper', mod: 'mod', senior: 'senior', owner: 'owner', 'mod with a grant': 'mod' };

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, deps, setNow, close } = await staffApps());
  setNow(MON_NOON);
  ids.trader = await seedAccount(deps, { loginName: uniqueName('trader'), kind: 'trader' });
  // A team member's own login account (Plan 2 Task 18): never a staff-app session.
  ids.member = await seedAccount(deps, { loginName: uniqueName('member'), kind: 'member' });
  for (const role of ['helper', 'mod', 'senior', 'owner'] as const) ids[role] = (await seedStaff(deps, { role })).id;
  ids['switched-off mod'] = (await seedStaff(deps, { role: 'mod', switchedOff: true })).id;
  // A Sunday-only minute: outside the window on Monday at noon.
  ids['out-of-hours mod'] = (await seedStaff(deps, { role: 'mod', hours: { days: ['Sun'], start: '00:00', end: '00:01', tz: 'UTC' } })).id;
  ids['recovery mod'] = (await seedStaff(deps, { role: 'mod' })).id;
  // Every grantable perm stored: a grant widens only routes of that perm (`grantable` rows).
  ids['mod with a grant'] = (await seedStaff(deps, { role: 'mod', grants: [...GRANTABLE_PERMS] })).id;
});
afterAll(async () => close());

/** A fresh browser for the caller (a new session each call: some answers end the session). */
async function browserFor(c: Caller): Promise<StaffBrowser> {
  const b = new StaffBrowser(app);
  if (c === 'anonymous') return b;
  // The trader's session is a trader-API one, sent under the staff cookie name.
  const { token, sessionId } = await insertSession(deps, ids[c]!, c === 'trader' ? 'trader' : 'staff');
  if (c === 'recovery mod') await deps.db.query("update sessions set level = 'recovery' where id = $1", [sessionId]);
  return b.withSession(token);
}

const urlOf = (r: StaffRouteRow) => r.url.replace(/:[A-Za-z]+/g, SAMPLE_ID);
const isPublic = (r: StaffRouteRow) => (PUBLIC_PERMS as readonly string[]).includes(r.perm);

function expected(c: Caller, r: StaffRouteRow): { status: number; error: string } | 'allowed' {
  if (c === 'anonymous' || c === 'trader' || c === 'member') return { status: 401, error: 'not-authenticated' };
  if (c === 'switched-off mod') return { status: 403, error: 'account-disabled' };
  if (c === 'out-of-hours mod') return { status: 401, error: 'outside-login-hours' };
  if (c === 'recovery mod') return { status: 403, error: 'recovery-session' };
  if (r.allowed === 'public') throw new Error(`${r.url} is public`);
  if (c === 'mod with a grant' && r.grantable) return 'allowed';
  return r.allowed.includes(ROLE_OF[c]!) ? 'allowed' : { status: 403, error: 'forbidden' };
}

const REFUSALS = ['not-authenticated', 'account-disabled', 'outside-login-hours', 'forbidden', 'recovery-session'];

describe('privilege matrix', () => {
  it('routes.ts lists exactly the routes the staff app registers, with their perms', () => {
    const key = (r: { method: string; url: string; perm: string }) => `${r.method} ${r.url} ${r.perm}`;
    const listed = STAFF_ROUTE_ROWS.map(key);
    expect(new Set(listed).size, 'a route listed twice').toBe(listed.length);
    expect([...app.staffRoutes].map(key).sort()).toEqual([...listed].sort());
  });

  it('every row says who is allowed: public exactly for the public perms, a role list otherwise', () => {
    for (const r of STAFF_ROUTE_ROWS) {
      expect(r.allowed === 'public', `${r.method} ${r.url}`).toBe(isPublic(r));
      expect(r.grantable === true, `${r.method} ${r.url}`).toBe((GRANTABLE_PERMS as readonly string[]).includes(r.perm));
    }
  });

  // Every GET route is also called as HEAD (Fastify's automatic HEAD copies the GET's preHandlers).
  const calls = STAFF_ROUTE_ROWS.flatMap((r) => (r.method === 'GET' ? [{ r, method: 'GET' }, { r, method: 'HEAD' }] : [{ r, method: r.method }]));
  for (const { r, method } of calls) {
    it(`${method} ${r.url} (${r.perm})`, async () => {
      if (isPublic(r)) {
        // Public routes run before any session: whoever calls, never a guard refusal or a crash.
        for (const c of CALLERS) {
          const res = await (await browserFor(c)).send(method, urlOf(r), r.body);
          expect(res.statusCode, `${c}`).toBeLessThan(500);
          if (method !== 'HEAD') expect(REFUSALS.slice(1), `${c}`).not.toContain((res.json() as { error?: string }).error);
        }
        return;
      }
      for (const c of CALLERS) {
        const res = await (await browserFor(c)).send(method, urlOf(r), r.body);
        const want = expected(c, r);
        // A HEAD answer has no body: its status alone must match.
        const error = method === 'HEAD' ? undefined : (res.json() as { error?: string }).error;
        if (want === 'allowed') {
          // Allowed: the handler ran. It may still refuse with its own code (a tap that does not
          // exist is 403 `tap-invalid`, a target that is the owner 409 `owner-protected`), never
          // with one of the guard's.
          expect(res.statusCode, `${c}: ${res.body}`).toBeLessThan(500);
          expect([401, 403], `${c}: ${res.body}`).not.toContain(res.statusCode);
          expect(REFUSALS, `${c}`).not.toContain(error);
        } else if (method === 'HEAD') {
          expect(res.statusCode, c).toBe(want.status);
        } else {
          expect({ status: res.statusCode, error }, c).toEqual(want);
        }
      }
    });
  }
});
