// O-040 (owner Q35, 6 Nov 2026): the owner's notifications list on the staff site. The owner
// alerts (price sources failing or back, market prices paused, the fee sweep, auto-close capped,
// a refund after a ruling, ...) are rows of the owner account's `alerts`; this route lists them,
// newest first, with an unread count for the shell's badge. Owner only. Real Postgres.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { addAlert, addOwnerAlert } from '../../src/alerts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, staffApps } from '../helpers/staffApp.js';

const T0 = new Date('2026-11-12T09:00:00Z');
const MIN = 60_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());

interface View {
  items: Array<{ id: string; kind: string; message: string | null; detail: Record<string, unknown>; createdAt: string; seenAt: string | null }>;
  unread: number;
  next: string | null;
}
const list = async (b: StaffBrowser, q = ''): Promise<View> => {
  const res = await b.get(`/staff/v1/owner/alerts${q}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as View;
};

describe('GET /staff/v1/owner/alerts (O-040)', () => {
  it('lists the owner\'s alerts newest first with their message and an unread count; marking one read lowers the count', async () => {
    await addOwnerAlert(deps.db, 'price-source-failing', { feed: 'xmr', source: 'kraken', reason: 'timeout', message: 'Kraken price feed is failing' }, new Date(T0.getTime() + MIN));
    await addOwnerAlert(deps.db, 'fee-sweep-due', { message: 'The fee wallet reached your threshold: moving the excess to your cold wallet' }, new Date(T0.getTime() + 2 * MIN));
    await addOwnerAlert(deps.db, 'auto-close-capped', { closed: 50, cap: 50, switchedOff: true }, new Date(T0.getTime() + 3 * MIN));
    const v = await list(owner);
    expect(v.items.map((i) => i.kind)).toEqual(['auto-close-capped', 'fee-sweep-due', 'price-source-failing']);
    expect(v.items[1]!.message).toBe('The fee wallet reached your threshold: moving the excess to your cold wallet');
    expect(v.items[0]!.message).toBeNull();
    expect(v.items[0]!.detail).toEqual({ closed: 50, cap: 50, switchedOff: true });
    expect(v.unread).toBe(3);
    expect(v.next).toBeNull();

    const before = (await logEntries(deps, 'staff.alert-seen')).length;
    const res = await owner.post(`/staff/v1/owner/alerts/${v.items[1]!.id}/read`, {});
    expect(res.statusCode, res.body).toBe(204);
    // Review OA2: the entry names which kind of alert was hidden (never its detail).
    expect((await logEntries(deps, 'staff.alert-seen')).slice(before).map((e) => JSON.parse(e.detail) as unknown)).toEqual([{ kind: v.items[1]!.kind }]);
    const after = await list(owner);
    expect(after.unread).toBe(2);
    expect(after.items[1]!.seenAt).not.toBeNull();
    // Again: nothing changes, nothing more is logged.
    expect((await owner.post(`/staff/v1/owner/alerts/${v.items[1]!.id}/read`, {})).statusCode).toBe(204);
    expect((await logEntries(deps, 'staff.alert-seen')).length).toBe(before + 1);
  });

  it('marks all read at once', async () => {
    await addOwnerAlert(deps.db, 'market-prices-paused', { urgent: true, currencies: ['EUR'], message: 'EUR prices paused' }, new Date(T0.getTime() + 4 * MIN));
    expect((await list(owner)).unread).toBeGreaterThan(0);
    const unread = (await list(owner)).unread;
    const before = (await logEntries(deps, 'staff.alert-seen')).length;
    const res = await owner.post('/staff/v1/owner/alerts/read-all', {});
    expect(res.statusCode, res.body).toBe(204);
    expect((await list(owner)).unread).toBe(0);
    // Review OA1/OA2: logged once, with how many it hid; again with nothing unread: 204, nothing logged.
    expect((await logEntries(deps, 'staff.alert-seen')).slice(before).map((e) => JSON.parse(e.detail) as unknown)).toEqual([{ count: unread }]);
    expect((await owner.post('/staff/v1/owner/alerts/read-all', {})).statusCode).toBe(204);
    expect((await logEntries(deps, 'staff.alert-seen')).length).toBe(before + 1);
  });

  it('pages by 50, newest first, with no repeat across pages', async () => {
    for (let i = 0; i < 55; i++) await addOwnerAlert(deps.db, 'price-source-recovered', { message: `back ${i}` }, new Date(T0.getTime() + (10 + i) * MIN));
    const p1 = await list(owner);
    expect(p1.items).toHaveLength(50);
    expect(p1.items[0]!.message).toBe('back 54');
    expect(p1.next).not.toBeNull();
    const p2 = await list(owner, `?before=${encodeURIComponent(p1.next!)}`);
    const ids = new Set(p1.items.map((i) => i.id));
    expect(p2.items.some((i) => ids.has(i.id))).toBe(false);
    expect(p2.items[0]!.message).toBe('back 4');
    expect(errorOf(await owner.get('/staff/v1/owner/alerts?before=nonsense'))).toBe('bad-request');
  });

  it('only the owner: every other role is refused, and no one reads or marks another account\'s alert', async () => {
    const mod = await seedStaff(deps, { role: 'mod' });
    await addAlert(deps.db, mod.id, 'new-login', { method: 'pgp', deviceLabel: 'x' }, T0);
    for (const role of ['senior', 'mod', 'helper'] as const) {
      const s = await seedStaff(deps, { role });
      const b = new StaffBrowser(app).withSession((await insertSession(deps, s.id, 'staff')).token);
      expect(errorOf(await b.get('/staff/v1/owner/alerts'))).toBe('forbidden');
      expect(errorOf(await b.post('/staff/v1/owner/alerts/read-all', {}))).toBe('forbidden');
    }
    const modAlert = (await deps.db.query<{ id: string }>('select id from alerts where account_id = $1', [mod.id])).rows[0]!.id;
    const before = (await logEntries(deps, 'staff.alert-seen')).length;
    expect((await owner.post(`/staff/v1/owner/alerts/${modAlert}/read`, {})).statusCode).toBe(404);
    expect((await list(owner)).items.some((i) => i.id === modAlert)).toBe(false);
    // Review OA1: the 404 changed nothing: the other account's alert is still unread, and nothing is logged.
    expect((await deps.db.query('select seen_at from alerts where id = $1', [modAlert])).rows).toEqual([{ seen_at: null }]);
    expect((await logEntries(deps, 'staff.alert-seen')).length).toBe(before);
    // Read-all touches only the owner's own rows.
    await owner.post('/staff/v1/owner/alerts/read-all', {});
    expect((await deps.db.query('select seen_at from alerts where id = $1', [modAlert])).rows).toEqual([{ seen_at: null }]);
  });
});
