// Plan 4 Task 4: the privilege matrix. Every staff route (routes.ts) is called as each kind of
// caller; the allowed roles reach the handler (2xx or a validation answer), everyone else is
// refused with the guard's code. The table must list exactly the routes the staff app registers.
import { can, type StaffRole } from '@x2f/staff';
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

const CALLERS = ['anonymous', 'trader', 'helper', 'mod', 'senior', 'owner', 'switched-off mod', 'out-of-hours mod'] as const;
type Caller = (typeof CALLERS)[number];
const ROLE_OF: Partial<Record<Caller, StaffRole>> = { helper: 'helper', mod: 'mod', senior: 'senior', owner: 'owner' };

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, deps, setNow, close } = await staffApps());
  setNow(MON_NOON);
  ids.trader = await seedAccount(deps, { loginName: uniqueName('trader'), kind: 'trader' });
  for (const role of ['helper', 'mod', 'senior', 'owner'] as const) ids[role] = (await seedStaff(deps, { role })).id;
  ids['switched-off mod'] = (await seedStaff(deps, { role: 'mod', switchedOff: true })).id;
  // A Sunday-only minute: outside the window on Monday at noon.
  ids['out-of-hours mod'] = (await seedStaff(deps, { role: 'mod', hours: { days: ['Sun'], start: '00:00', end: '00:01', tz: 'UTC' } })).id;
});
afterAll(async () => close());

/** A fresh browser for the caller (a new session each call: some answers end the session). */
async function browserFor(c: Caller): Promise<StaffBrowser> {
  const b = new StaffBrowser(app);
  if (c === 'anonymous') return b;
  // The trader's session is a trader-API one, sent under the staff cookie name.
  const { token } = await insertSession(deps, ids[c]!, c === 'trader' ? 'trader' : 'staff');
  return b.withSession(token);
}

const urlOf = (r: StaffRouteRow) => r.url.replace(/:[A-Za-z]+/g, SAMPLE_ID);
const isPublic = (r: StaffRouteRow) => (PUBLIC_PERMS as readonly string[]).includes(r.perm);

function expected(c: Caller, r: StaffRouteRow): { status: number; error: string } | 'allowed' {
  if (c === 'anonymous' || c === 'trader') return { status: 401, error: 'not-authenticated' };
  if (c === 'switched-off mod') return { status: 403, error: 'account-disabled' };
  if (c === 'out-of-hours mod') return { status: 401, error: 'outside-login-hours' };
  const role = ROLE_OF[c]!;
  if (r.ownerOnly && role !== 'owner') return { status: 403, error: 'forbidden' };
  return can(role, r.perm as Parameters<typeof can>[1]) ? 'allowed' : { status: 403, error: 'forbidden' };
}

const REFUSALS = ['not-authenticated', 'account-disabled', 'outside-login-hours', 'forbidden'];

describe('privilege matrix', () => {
  it('routes.ts lists exactly the routes the staff app registers, with their perms', () => {
    const key = (r: { method: string; url: string; perm: string }) => `${r.method} ${r.url} ${r.perm}`;
    const listed = STAFF_ROUTE_ROWS.map(key);
    expect(new Set(listed).size, 'a route listed twice').toBe(listed.length);
    expect([...app.staffRoutes].map(key).sort()).toEqual([...listed].sort());
  });

  for (const r of STAFF_ROUTE_ROWS) {
    it(`${r.method} ${r.url} (${r.perm})`, async () => {
      if (isPublic(r)) {
        // Public routes run before any session: whoever calls, never a guard refusal or a crash.
        for (const c of CALLERS) {
          const res = await (await browserFor(c)).send(r.method, urlOf(r), r.body);
          expect(res.statusCode, `${c}`).toBeLessThan(500);
          expect(REFUSALS.slice(1), `${c}`).not.toContain((res.json() as { error?: string }).error);
        }
        return;
      }
      for (const c of CALLERS) {
        const res = await (await browserFor(c)).send(r.method, urlOf(r), r.body);
        const want = expected(c, r);
        const error = res.body === '' ? undefined : (res.json() as { error?: string }).error; // a 204 has no body
        if (want === 'allowed' && r.allowedAnswer) {
          // Past the guard, the route's own check answers (e.g. no valid tap): exactly that, never a guard refusal.
          expect({ status: res.statusCode, error }, `${c}: ${res.body}`).toEqual(r.allowedAnswer);
        } else if (want === 'allowed') {
          // Allowed: the handler ran. It may still refuse with its own code (a tap that does not
          // exist is 403 `tap-invalid`, a target that is the owner 409 `owner-protected`), never
          // with one of the guard's.
          expect(res.statusCode, `${c}: ${res.body}`).toBeLessThan(500);
          expect(REFUSALS, `${c}: ${res.body}`).not.toContain(error);
        } else {
          expect({ status: res.statusCode, error }, c).toEqual(want);
        }
      }
    });
  }
});
