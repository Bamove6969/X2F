// Plan 4 Task 8: the owner's settings on the staff API (perm settings.write). The large-trade limit
// and the appeal window bind the moderation gate, so changing either needs a security-key tap
// (intent `settings`, with the values as they will be); the first-reply time and the links do not.
// Each changed field writes one `settings.changed` entry with from and to.
import type { KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { SETTINGS_DEFAULTS, getSettings } from '../../src/staff/settings.js';
// After staff/settings.ts on purpose: see "the defaults are one module" below.
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';

const T0 = new Date('2026-11-02T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;

const DEFAULTS = {
  largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48,
  moderatorContactUrl: null, communityMatrixUrl: null, communityTelegramUrl: null,
};

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query(
    `update settings set large_trade_limit_usd = 1000, first_response_h = 4, appeal_window_h = 48, limits_tap_id = null,
       moderator_contact_url = null, community_matrix_url = null, community_telegram_url = null`,
  );
});

const put = (body: unknown) => owner.send('PUT', '/staff/v1/settings', body);
const settingsTap = (s: { largeTradeLimitUsd: number; firstResponseH: number; appealWindowH: number }): KeyTapIntent => ({ kind: 'settings', ...s });
const changes = async () => (await logEntries(deps, 'settings.changed')).map((r) => JSON.parse(r.detail) as Record<string, unknown>);

describe('GET /staff/v1/settings', () => {
  it('answers the defaults (appeal window 48 h, owner 2026-10-29c), and getSettings reads the same', async () => {
    const res = await owner.get('/staff/v1/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULTS);
    expect(await getSettings(deps.db)).toEqual(DEFAULTS);
  });
});

describe('PUT /staff/v1/settings', () => {
  it('refuses a limit change without a tap with tap-invalid, and changes and logs nothing', async () => {
    const before = await changes();
    for (const body of [{ largeTradeLimitUsd: 2000 }, { largeTradeLimitUsd: 2000, tapId: '00000000-0000-4000-8000-000000000000' }, { appealWindowH: 72 }]) {
      const res = await put(body);
      expect({ status: res.statusCode, error: errorOf(res) }, JSON.stringify(body)).toEqual({ status: 403, error: 'tap-invalid' });
    }
    expect(await getSettings(deps.db)).toEqual(DEFAULTS);
    expect(await changes()).toEqual(before);
  });

  it('changes the limit with a tap bound to the new values, logs from and to, and the tap works once', async () => {
    const before = (await changes()).length;
    const tapId = await seedTap(deps, ownerId, settingsTap({ largeTradeLimitUsd: 2000, firstResponseH: 4, appealWindowH: 48 }));
    const res = await put({ largeTradeLimitUsd: 2000, tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ...DEFAULTS, largeTradeLimitUsd: 2000 });
    expect((await changes()).slice(before)).toEqual([{ field: 'largeTradeLimitUsd', from: 1000, to: 2000 }]);
    const entries = await logEntries(deps, 'settings.changed');
    expect(entries.at(-1)!.actor_kind).toBe('staff');
    const { rows } = await deps.db.query<{ limits_tap_id: string }>('select limits_tap_id from settings');
    expect(rows[0]!.limits_tap_id).toBe(tapId);
    // Used: the same tap again (for a further change) is refused.
    const again = await put({ largeTradeLimitUsd: 2000, appealWindowH: 72, tapId });
    expect(errorOf(again)).toBe('tap-invalid');
  });

  it('refuses a tap for other values, for another kind, another person\'s or an expired one', async () => {
    const other = await seedStaff(deps, { role: 'senior' });
    const taps = [
      await seedTap(deps, ownerId, settingsTap({ largeTradeLimitUsd: 3000, firstResponseH: 4, appealWindowH: 48 })),
      await seedTap(deps, ownerId, { kind: 'emergency-stop' }),
      await seedTap(deps, ownerId, settingsTap({ largeTradeLimitUsd: 2000, firstResponseH: 4, appealWindowH: 48 }), new Date(T0.getTime() - 2 * 60_000)),
    ];
    taps.push(await seedTap(deps, other.id, settingsTap({ largeTradeLimitUsd: 2000, firstResponseH: 4, appealWindowH: 48 })));
    for (const tapId of taps) expect(errorOf(await put({ largeTradeLimitUsd: 2000, tapId }))).toBe('tap-invalid');
    expect(await getSettings(deps.db)).toEqual(DEFAULTS);
  });

  it('binds the first-reply time too when it changes with the limit: one entry per changed field', async () => {
    const before = (await changes()).length;
    const tapId = await seedTap(deps, ownerId, settingsTap({ largeTradeLimitUsd: 1500, firstResponseH: 8, appealWindowH: 72 }));
    const res = await put({ largeTradeLimitUsd: 1500, firstResponseH: 8, appealWindowH: 72, tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect((await changes()).slice(before)).toEqual([
      { field: 'largeTradeLimitUsd', from: 1000, to: 1500 },
      { field: 'firstResponseH', from: 4, to: 8 },
      { field: 'appealWindowH', from: 48, to: 72 },
    ]);
  });

  it('changes the first-reply time and the links without a tap; a link is logged by its field only', async () => {
    const before = (await changes()).length;
    const res = await put({ firstResponseH: 6, moderatorContactUrl: 'https://matrix.to/#/#x2f-mods:matrix.org' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ firstResponseH: 6, moderatorContactUrl: 'https://matrix.to/#/#x2f-mods:matrix.org' });
    const added = (await changes()).slice(before);
    expect(added).toEqual([{ field: 'firstResponseH', from: 4, to: 6 }, { field: 'moderatorContactUrl' }]);
    expect(JSON.stringify(added)).not.toContain('matrix.to');
    // Unsetting a link.
    expect((await put({ moderatorContactUrl: null })).json()).toMatchObject({ moderatorContactUrl: null });
  });

  it('D-067: the moderator contact link takes a Matrix (matrix.to) or Telegram (t.me) link and nothing else', async () => {
    for (const ok of ['https://matrix.to/#/#x2f-mods:matrix.org', 'https://matrix.to/#/@mod:example.org', 'https://t.me/x2f_mods']) {
      const res = await put({ moderatorContactUrl: ok });
      expect(res.statusCode, `${ok} ${res.body}`).toBe(200);
      expect(res.json()).toMatchObject({ moderatorContactUrl: ok });
    }
    for (const bad of [
      'https://example.org/mods', 'https://matrix.to.evil.example/#/#x', 'https://evil.example/https://t.me/x', 'https://t.me.evil.example/x',
      'https://user@matrix.to/#/#x', 'https://matrix.to:8443/#/#x', 'https://matrix.to/', 'https://matrix.to/#/', 'https://t.me/', 'https://wa.me/15551234567',
    ]) {
      const res = await put({ moderatorContactUrl: bad });
      expect({ status: res.statusCode, error: errorOf(res) }, bad).toEqual({ status: 400, error: 'bad-request' });
    }
    expect((await put({ moderatorContactUrl: null })).json()).toMatchObject({ moderatorContactUrl: null });
  });

  it('a value equal to the current one changes nothing, needs no tap and logs nothing', async () => {
    const before = (await changes()).length;
    const res = await put({ largeTradeLimitUsd: 1000, appealWindowH: 48 });
    expect(res.statusCode).toBe(200);
    expect((await changes()).length).toBe(before);
  });

  it('refuses values out of bounds, wrong types and unknown fields with bad-request', async () => {
    for (const body of [
      {}, [], { largeTradeLimitUsd: 0 }, { largeTradeLimitUsd: 1_000_001 }, { largeTradeLimitUsd: 1.5 }, { largeTradeLimitUsd: '2000' },
      { firstResponseH: 0 }, { firstResponseH: 73 }, { appealWindowH: 11 }, { appealWindowH: 169 },
      { payModCaseUsd: 5 }, { firstResponseH: 5, extra: 1 }, { moderatorContactUrl: 'http://matrix.to/x' },
      { moderatorContactUrl: 'https://a b' }, { communityTelegramUrl: `https://t.me/${'a'.repeat(200)}` }, { firstResponseH: 5, tapId: 7 },
    ]) {
      const res = await put(body);
      expect({ status: res.statusCode, error: errorOf(res) }, JSON.stringify(body)).toEqual({ status: 400, error: 'bad-request' });
    }
    expect(await getSettings(deps.db)).toEqual(DEFAULTS);
  });

  it('a moderator gets forbidden (also in the privilege matrix)', async () => {
    const mod = (await seedStaff(deps, { role: 'mod' })).id;
    const b = new StaffBrowser(app).withSession((await insertSession(deps, mod, 'staff')).token);
    const res = await b.send('PUT', '/staff/v1/settings', { firstResponseH: 6 });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden' });
    expect(errorOf(await b.get('/staff/v1/settings'))).toBe('forbidden');
  });
});

// Hold model v3 made auth/hold.ts reach trades/store.ts, which reaches disputes/settings.ts, so when
// staff/settings.ts is the first module loaded (as this file loads it) the old
// disputes/settings.ts read `SETTINGS_DEFAULTS` from a module still evaluating, and the whole file
// failed to import. The defaults live in a leaf module (staff/settingsDefaults.ts) both read.
describe('the defaults are one module, whatever loads first', () => {
  it('disputes/settings.ts carries the staff defaults when staff/settings.ts loads first', () => {
    expect(SETTINGS_DEFAULTS).toEqual(DEFAULTS);
    expect(DISPUTE_DEFAULTS).toEqual({ largeTradeLimitUsd: DEFAULTS.largeTradeLimitUsd, firstResponseH: DEFAULTS.firstResponseH, appealWindowH: DEFAULTS.appealWindowH });
  });
});
