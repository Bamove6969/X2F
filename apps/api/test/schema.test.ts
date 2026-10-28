import { createECDH, randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LISTEN_OPTIONS } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { assertSigningKeyFile, loadConfig, subkey } from '../src/config.js';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { emptyDb, testDb } from './helpers/db.js';
import { testApp, testConfig } from './helpers/app.js';
import { VAPID_ENV } from './helpers/vapid.js';

const VAPID = VAPID_ENV;

const FULL_ENV = {
  X2F_ORIGINS: 'https://x2f.test,http://x2fexample.onion',
  X2F_RP_ID: 'x2f.test',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x2f',
  X2F_LEAKED_LIST_PATH: '/srv/x2f/leaked.bin',
  X2F_SERVER_KEY: Buffer.alloc(32, 7).toString('base64'),
  X2F_MONERO_NETWORK: 'stagenet',
  X2F_TERMS_VERSION: '2026-10-17',
  X2F_PGP_SIGNING_KEY_PATH: '/srv/x2f/signing.asc',
  X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
  X2F_PASSWORD_PEPPERS: `1:${Buffer.alloc(32, 1).toString('base64')}`,
  X2F_RECOVERY_CODE_KEYS: `1:${Buffer.alloc(32, 2).toString('base64')}`,
  X2F_TOTP_KEYS: `1:${Buffer.alloc(32, 3).toString('base64')}`,
  // Task 19: a VAPID pair, base64url: the P-256 public point (65 bytes) and private scalar (32 bytes).
  ...VAPID,
};
const k32 = (fill: number) => Buffer.alloc(32, fill).toString('base64');

describe('migrations', () => {
  it('applies every migration once on an empty database, then nothing', async () => {
    const db = await emptyDb();
    try {
      expect(await migrate(db)).toEqual([
        '001_accounts.sql', '002_sessions.sql', '003_confirm.sql', '004_passwords.sql', '005_pgp.sql', '006_webauthn.sql',
        '007_totp_recovery.sql', '008_wallets.sql', '010_wallet_wait_logout_timer.sql', '011_secret_keys.sql',
        '101_method_suggestions.sql', '103_trades.sql', '104_trade_retention.sql', '105_push.sql', '107_nudge.sql', '108_disputes.sql', '109_owner_settings.sql', '110_dispute_system_retention.sql',
      ]);
      expect(await migrate(db)).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('010 carries existing rows over: old tokens count as password, waits keep their time, trader sessions get 12 hours idle', async () => {
    const db = await emptyDb();
    const dir = await mkdtemp(join(tmpdir(), 'x2f-mig-'));
    try {
      for (const f of (await readdir(MIGRATIONS_DIR)).filter((f) => f < '010')) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
      await migrate(db, dir);
      const t = new Date('2026-10-20T12:00:00Z');
      const ins = async (sql: string, args: unknown[]) => (await db.query<{ id: string }>(sql, args)).rows[0]?.id;
      const account = async (name: string, kind: string, wait: boolean) =>
        ins(
          `insert into accounts (username, username_key, kind, webauthn_user_id, payout_wait, payout_wait_off_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [name, name.toLowerCase(), kind, randomBytes(32), wait, wait ? new Date(t.getTime() + 3_600_000) : null, t],
        );
      const trader = await account('Trader01', 'trader', true);
      const staff = await account('Staff001', 'staff', false);
      const session = (accountId: string | undefined, level: string, lastSeen: Date) =>
        ins(
          `insert into sessions (account_id, token_hash, level, device_label, created_at, last_seen_at, expires_at)
           values ($1, $2, $3, 'b', $4, $4, $5) returning id`,
          [accountId, randomBytes(32), level, lastSeen, new Date(lastSeen.getTime() + 7 * 86_400_000)],
        );
      const full = await session(trader, 'full', t);
      const recovery = await session(trader, 'recovery', t);
      const staffSession = await session(staff, 'full', t);
      await db.query(
        `insert into confirm_tokens (session_id, account_id, token_hash, action_hash, created_at, expires_at) values ($1, $2, $3, 'h', $4, $5)`,
        [full, trader, randomBytes(32), t, new Date(t.getTime() + 300_000)],
      );
      const waiting = new Date(t.getTime() + 86_400_000);
      await db.query(
        `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'w', 'addr', $2, $3)`,
        [trader, t, waiting],
      );

      expect(await migrate(db)).toEqual([
        '010_wallet_wait_logout_timer.sql', '011_secret_keys.sql', '101_method_suggestions.sql', '103_trades.sql',
        '104_trade_retention.sql', '105_push.sql', '107_nudge.sql', '108_disputes.sql', '109_owner_settings.sql', '110_dispute_system_retention.sql',
      ]);

      expect((await db.query('select method from confirm_tokens')).rows).toEqual([{ method: 'password' }]);
      expect((await db.query('select usable_from from wallets')).rows).toEqual([{ usable_from: waiting }]);
      const cols = await db.query(`select column_name from information_schema.columns where table_name = 'accounts' and column_name like 'payout%'`);
      expect(cols.rows).toEqual([]);
      expect((await db.query('select idle_hours from accounts order by username')).rows).toEqual([{ idle_hours: 12 }, { idle_hours: 12 }]);
      const expires = async (id: string | undefined) =>
        (await db.query<{ expires_at: Date }>('select expires_at from sessions where id = $1', [id])).rows[0]!.expires_at;
      expect(await expires(full)).toEqual(new Date(t.getTime() + 12 * 3_600_000));
      // Recovery and staff sessions have their own fixed policies; the migration leaves them alone.
      expect(await expires(recovery)).toEqual(new Date(t.getTime() + 7 * 86_400_000));
      expect(await expires(staffSession)).toEqual(new Date(t.getTime() + 7 * 86_400_000));
      await expect(db.query('update accounts set idle_hours = 3 where id = $1', [trader])).rejects.toMatchObject({ code: '23514' });
      await expect(db.query(`update confirm_tokens set method = 'totp'`)).rejects.toMatchObject({ code: '23514' });
    } finally {
      await db.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('schema', () => {
  let db: pg.Pool;
  beforeAll(async () => {
    db = await testDb();
  });
  afterAll(async () => {
    await db.end();
  });

  it('has no column that could hold an IP, user agent, email or phone number', async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.filter((r) => /(^|_)ip($|_)|ip_?addr|remote_?addr|user_agent|email|phone/.test(r.column_name));
    expect(bad).toEqual([]);
  });

  const insertAccount = (kind: string, name: string) =>
    db.query(
      `insert into accounts (username, username_key, kind, webauthn_user_id, created_at) values ($1, $2, $3, $4, now())`,
      [name, name.toLowerCase(), kind, randomBytes(32)],
    );

  it('allows only one owner account', async () => {
    await insertAccount('owner', 'TheBoss1');
    await expect(insertAccount('owner', 'TheBoss2')).rejects.toMatchObject({ code: '23505' });
    await insertAccount('trader', 'Trader01');
    await insertAccount('trader', 'Trader02');
  });

  it('refuses unknown account kinds and duplicate username keys', async () => {
    await expect(insertAccount('admin', 'Someone1')).rejects.toMatchObject({ code: '23514' });
    await insertAccount('trader', 'Alice123');
    await expect(insertAccount('trader', 'ALICE123')).rejects.toMatchObject({ code: '23505' });
  });
});

describe('config', () => {
  it('names the first missing variable', () => {
    expect(() => loadConfig({})).toThrow(/X2F_ORIGINS/);
    const { X2F_TERMS_VERSION: _t, ...noTerms } = FULL_ENV;
    expect(() => loadConfig(noTerms)).toThrow(/X2F_TERMS_VERSION/);
  });

  it('loads a full environment with defaults', () => {
    const c = loadConfig(FULL_ENV);
    expect(c.siteName).toBe('X2F');
    expect(c.origins).toEqual(['https://x2f.test', 'http://x2fexample.onion']);
    expect(c.attestationDir).toBe('apps/api/data/fido-mds');
    expect(c.serverKey).toHaveLength(32);
    expect(c.moneroNetwork).toBe('stagenet');
    expect(c.termsVersion).toBe('2026-10-17');
    expect(c.pgpSigningKeyPath).toBe('/srv/x2f/signing.asc');
    expect(c.pgpSigningFingerprint).toBe('a'.repeat(40));
    expect(loadConfig({ ...FULL_ENV, X2F_PGP_SIGNING_FINGERPRINT: 'b'.repeat(64) }).pgpSigningFingerprint).toBe('b'.repeat(64));
    expect(c.vapidPublic).toBe(FULL_ENV.X2F_VAPID_PUBLIC);
    expect(c.vapidPrivate).toBe(FULL_ENV.X2F_VAPID_PRIVATE);
  });

  it('needs both VAPID keys (Task 19)', () => {
    const { X2F_VAPID_PUBLIC: _p, ...noPublic } = FULL_ENV;
    expect(() => loadConfig(noPublic)).toThrow(/X2F_VAPID_PUBLIC/);
    const { X2F_VAPID_PRIVATE: _k, ...noPrivate } = FULL_ENV;
    expect(() => loadConfig(noPrivate)).toThrow(/X2F_VAPID_PRIVATE/);
  });

  it.each([
    ['X2F_PGP_SIGNING_FINGERPRINT', 'xyz'],
    ['X2F_PGP_SIGNING_FINGERPRINT', 'A'.repeat(40)],
    ['X2F_PGP_SIGNING_FINGERPRINT', 'a'.repeat(50)],
    ['X2F_TERMS_VERSION', 'v'.repeat(33)],
    ['X2F_TERMS_VERSION', ''],
    ['X2F_SERVER_KEY', Buffer.alloc(16).toString('base64')],
    ['X2F_SERVER_KEY', 'not base64!'],
    ['X2F_MONERO_NETWORK', 'regtest'],
    ['X2F_ORIGINS', 'https://x2f.test/'],
    ['X2F_ORIGINS', 'x2f.test'],
    ['DATABASE_URL', 'mysql://x'],
    ['X2F_VAPID_PUBLIC', Buffer.alloc(65, 4).toString('base64')],
    ['X2F_VAPID_PUBLIC', Buffer.concat([Buffer.from([2]), Buffer.alloc(64, 9)]).toString('base64url')],
    ['X2F_VAPID_PUBLIC', Buffer.alloc(33, 4).toString('base64url')],
    ['X2F_VAPID_PRIVATE', Buffer.alloc(31, 5).toString('base64url')],
    ['X2F_VAPID_PRIVATE', 'not base64url!'],
    ['X2F_VAPID_PUBLIC', (() => { const e = createECDH('prime256v1'); e.generateKeys(); return e.getPublicKey().toString('base64url'); })()],
  ])('refuses malformed %s', (name, value) => {
    expect(() => loadConfig({ ...FULL_ENV, [name]: value })).toThrow(name);
  });

  it('never echoes a secret value in its error', () => {
    const secret = 'postgres-password-zz9';
    expect(() => loadConfig({ ...FULL_ENV, DATABASE_URL: `mysql://u:${secret}@h/x` })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });

  it('loads the three key rings; the first entry of each is the current key (FU-C)', () => {
    const c = loadConfig({ ...FULL_ENV, X2F_PASSWORD_PEPPERS: ` 7:${k32(9)} , 3:${k32(8)} ` });
    expect(c.passwordPeppers.current).toBe(7);
    expect([...c.passwordPeppers.keys.keys()]).toEqual([7, 3]);
    expect(Buffer.from(c.passwordPeppers.keys.get(3)!)).toEqual(Buffer.alloc(32, 8));
    expect(c.recoveryCodeKeys.current).toBe(1);
    expect(Buffer.from(c.recoveryCodeKeys.keys.get(1)!)).toEqual(Buffer.alloc(32, 2));
    expect(c.totpKeys.current).toBe(1);
    expect(Buffer.from(c.totpKeys.keys.get(1)!)).toEqual(Buffer.alloc(32, 3));
  });

  it.each(['X2F_PASSWORD_PEPPERS', 'X2F_RECOVERY_CODE_KEYS', 'X2F_TOTP_KEYS'])('needs %s', (name) => {
    const env: Record<string, string> = { ...FULL_ENV };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  });

  it.each([
    ['X2F_PASSWORD_PEPPERS', ''],
    ['X2F_PASSWORD_PEPPERS', k32(9)],
    ['X2F_PASSWORD_PEPPERS', `0:${k32(9)}`],
    ['X2F_PASSWORD_PEPPERS', `32768:${k32(9)}`],
    ['X2F_PASSWORD_PEPPERS', `01:${k32(9)}`],
    ['X2F_PASSWORD_PEPPERS', `1:${Buffer.alloc(16, 9).toString('base64')}`],
    ['X2F_PASSWORD_PEPPERS', `1:not base64!`],
    ['X2F_PASSWORD_PEPPERS', `1:${k32(9)},1:${k32(10)}`],
    ['X2F_PASSWORD_PEPPERS', `1:${k32(9)},`],
    ['X2F_RECOVERY_CODE_KEYS', `x:${k32(9)}`],
    ['X2F_TOTP_KEYS', `1:${k32(9)},2:${k32(9)}`],
  ])('refuses malformed %s %#', (name, value) => {
    expect(() => loadConfig({ ...FULL_ENV, [name]: value })).toThrow(name);
  });

  it('refuses a key that is X2F_SERVER_KEY or is shared with another ring, naming the variable only', () => {
    expect(() => loadConfig({ ...FULL_ENV, X2F_TOTP_KEYS: `1:${FULL_ENV.X2F_SERVER_KEY}` })).toThrow(
      expect.objectContaining({ message: expect.stringMatching(/X2F_TOTP_KEYS.*separate/) }),
    );
    expect(() => loadConfig({ ...FULL_ENV, X2F_RECOVERY_CODE_KEYS: `2:${k32(1)}` })).toThrow(/X2F_RECOVERY_CODE_KEYS/);
    const secret = k32(7);
    expect(() => loadConfig({ ...FULL_ENV, X2F_TOTP_KEYS: `1:${secret}` })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });

  it('never echoes a key ring in its error', () => {
    const secret = Buffer.alloc(31, 5).toString('base64');
    for (const name of ['X2F_PASSWORD_PEPPERS', 'X2F_RECOVERY_CODE_KEYS', 'X2F_TOTP_KEYS']) {
      expect(() => loadConfig({ ...FULL_ENV, [name]: `4:${secret}` })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(secret) }),
      );
    }
  });

  it('reads a key ring from <NAME>_FILE, readable by the API user only, and refuses both or a shared file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-ring-'));
    try {
      const file = join(dir, 'totp.keys');
      await writeFile(file, `5:${k32(11)}\n`);
      await chmod(file, 0o600);
      const { X2F_TOTP_KEYS: _t, ...rest } = FULL_ENV;
      const c = loadConfig({ ...rest, X2F_TOTP_KEYS_FILE: file });
      expect(c.totpKeys.current).toBe(5);
      expect(Buffer.from(c.totpKeys.keys.get(5)!)).toEqual(Buffer.alloc(32, 11));
      expect(() => loadConfig({ ...FULL_ENV, X2F_TOTP_KEYS_FILE: file })).toThrow(/X2F_TOTP_KEYS/);
      await chmod(file, 0o640);
      expect(() => loadConfig({ ...rest, X2F_TOTP_KEYS_FILE: file })).toThrow(/X2F_TOTP_KEYS_FILE.*chmod 600/);
      expect(() => loadConfig({ ...rest, X2F_TOTP_KEYS_FILE: join(dir, 'missing') })).toThrow(/X2F_TOTP_KEYS_FILE/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('X2F_LEGACY_SECRETS is on by default, accepts on and off, refuses anything else (review M1)', () => {
    expect(loadConfig(FULL_ENV).legacySecrets).toBe(true);
    expect(loadConfig({ ...FULL_ENV, X2F_LEGACY_SECRETS: 'on' }).legacySecrets).toBe(true);
    expect(loadConfig({ ...FULL_ENV, X2F_LEGACY_SECRETS: 'off' }).legacySecrets).toBe(false);
    for (const bad of ['0', 'false', 'OFF', 'no']) expect(() => loadConfig({ ...FULL_ENV, X2F_LEGACY_SECRETS: bad })).toThrow(/X2F_LEGACY_SECRETS/);
  });

  it('refuses a key ring file owned by another user (review M4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-ring-'));
    try {
      const file = join(dir, 'totp.keys');
      await writeFile(file, `5:${k32(11)}`);
      await chmod(file, 0o600);
      const { X2F_TOTP_KEYS: _t, ...rest } = FULL_ENV;
      expect(loadConfig({ ...rest, X2F_TOTP_KEYS_FILE: file }).totpKeys.current).toBe(5);
      const uid = process.getuid!();
      const spy = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
      try {
        expect(() => loadConfig({ ...rest, X2F_TOTP_KEYS_FILE: file })).toThrow(/X2F_TOTP_KEYS_FILE.*owned by the API user/);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derives distinct 32-byte subkeys per label', () => {
    const c = testConfig();
    const a = subkey(c, 'totp');
    expect(a).toHaveLength(32);
    expect(subkey(c, 'totp')).toEqual(a);
    expect(subkey(c, 'decoy')).not.toEqual(a);
    expect(subkey(c, 'device')).not.toEqual(subkey(c, 'decoy'));
    expect(subkey(testConfig(), 'totp')).not.toEqual(a);
  });

  it('refuses a signing key file other users can read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-key-'));
    try {
      const file = join(dir, 'signing.asc');
      await writeFile(file, 'key');
      await chmod(file, 0o600);
      await expect(assertSigningKeyFile(file)).resolves.toBeUndefined();
      await chmod(file, 0o644);
      await expect(assertSigningKeyFile(file)).rejects.toThrow(/X2F_PGP_SIGNING_KEY_PATH/);
      await expect(assertSigningKeyFile(join(dir, 'missing.asc'))).rejects.toThrow(/X2F_PGP_SIGNING_KEY_PATH/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('app', () => {
  it('answers /healthz', async () => {
    const { app } = await testApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('logs no address, port or host of the caller, even when a route fails (R5)', async () => {
    const { app, logs } = await testApp();
    try {
      app.get('/boom', async () => {
        throw new Error('kaboom');
      });
      const res = await app.inject({ method: 'GET', url: '/boom?trade=K7M2-9QXA-4FTR-8WPN', remoteAddress: '127.0.0.1' });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'internal' });
      expect(logs.some((l) => l.includes('"route":"/boom"'))).toBe(true);
      for (const bad of ['127.0.0.1', 'remoteAddress', 'remotePort', 'hostname', 'K7M2', '"url"']) {
        expect(logs.filter((l) => l.includes(bad))).toEqual([]);
      }
      expect((app.initialConfig as { trustProxy?: unknown }).trustProxy).toBeFalsy();
    } finally {
      await app.close();
    }
  });

  it('never trusts X-Forwarded-For (trustProxy unset)', async () => {
    const { app, logs } = await testApp();
    try {
      app.get('/whoami', async (req) => {
        req.log.info({ req }, 'probe');
        return { ip: req.ip };
      });
      const res = await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-forwarded-for': '203.0.113.9' } });
      expect(res.json()).toEqual({ ip: '127.0.0.1' });
      expect(logs.some((l) => l.includes('"route":"/whoami"'))).toBe(true);
      expect(logs.filter((l) => l.includes('203.0.113.9') || l.includes('127.0.0.1'))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('keeps trade codes in query strings out of the logs', async () => {
    const { app, logs } = await testApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz?trade=K7M2-9QXA-4FTR-8WPN' });
      expect(res.statusCode).toBe(200);
      expect(logs.filter((l) => l.includes('K7M2'))).toEqual([]);
      // Request logging is off: a healthy request writes no line at all.
      expect(logs).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // Same-origin requests (Task 4's origin check refuses POSTs without one; see origin.test.ts).
  it('accepts only JSON bodies; text/plain JSON gets 415', async () => {
    const { app } = await testApp();
    try {
      app.post('/healthz-echo', async (req) => ({ got: req.body }));
      const plain = await app.inject({
        method: 'POST', url: '/healthz-echo', headers: { origin: 'https://x2f.test', 'content-type': 'text/plain' }, payload: '{"a":1}',
      });
      expect(plain.statusCode).toBe(415);
      expect(plain.json()).toEqual({ error: 'unsupported-media-type' });
      const json = await app.inject({ method: 'POST', url: '/healthz-echo', headers: { origin: 'https://x2f.test' }, payload: { a: 1 } });
      expect(json.statusCode).toBe(200);
      expect(json.json()).toEqual({ got: { a: 1 } });
    } finally {
      await app.close();
    }
  });

  it('caps bodies at 16 KiB and answers unknown routes with not-found', async () => {
    const { app } = await testApp();
    try {
      app.post('/healthz-echo', async () => ({ ok: true }));
      const big = await app.inject({
        method: 'POST', url: '/healthz-echo', headers: { origin: 'https://x2f.test', 'content-type': 'application/json' },
        payload: JSON.stringify({ a: 'x'.repeat(16 * 1024) }),
      });
      expect(big.statusCode).toBe(413);
      expect(big.json()).toEqual({ error: 'bad-request' });
      const missing = await app.inject({ method: 'GET', url: '/nope' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'not-found' });
    } finally {
      await app.close();
    }
  });

  it('replies { error, ...extra } for an ApiError, with Retry-After when given', async () => {
    const { app } = await testApp();
    try {
      app.get('/busy', async () => {
        throw new ApiError(503, 'busy', { retryAfterSeconds: 30 });
      });
      const res = await app.inject({ method: 'GET', url: '/busy' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'busy', retryAfterSeconds: 30 });
      expect(res.headers['retry-after']).toBe('30');
    } finally {
      await app.close();
    }
  });

  it('never lets extra override the error code', async () => {
    const { app } = await testApp();
    try {
      app.get('/clash', async () => {
        throw new ApiError(400, 'bad-request', { error: 'something-else', field: 'x' });
      });
      const res = await app.inject({ method: 'GET', url: '/clash' });
      expect(res.json()).toEqual({ error: 'bad-request', field: 'x' });
    } finally {
      await app.close();
    }
  });

  it("keeps the URL out of fastify's own 'reply already sent' warning", async () => {
    const { app, logs } = await testApp();
    try {
      app.get('/x/:code', async (_req, reply) => {
        void reply.send({ first: true });
        return reply.send({ second: true });
      });
      const res = await app.inject({ method: 'GET', url: '/x/K7M2-9QXA-4FTR-8WPN?trade=K7M2-9QXA-4FTR-8WPN' });
      expect(res.json()).toEqual({ first: true });
      expect(logs.length).toBeGreaterThan(0); // the warning itself is still logged
      expect(logs.filter((l) => l.includes('K7M2') || l.includes('/x/'))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('logs a database error by type and code only, never row values', async () => {
    const marker = 'MarkerZq7Wv';
    const { app, deps, logs } = await testApp();
    try {
      app.get('/dup', async () => {
        const insert = () =>
          deps.db.query(
            `insert into accounts (username, username_key, kind, webauthn_user_id, created_at) values ($1, $2, 'trader', $3, now())`,
            [marker, marker.toLowerCase(), randomBytes(32)],
          );
        await insert();
        await insert();
        return { ok: true };
      });
      const res = await app.inject({ method: 'GET', url: '/dup' });
      expect(res.statusCode).toBe(500);
      expect(logs.some((l) => l.includes('"code":"23505"'))).toBe(true);
      expect(logs.filter((l) => l.toLowerCase().includes(marker.toLowerCase()))).toEqual([]);
      expect(logs.filter((l) => /"(stack|detail|message)"/.test(l))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("applies the same error whitelist under the 'error' key", async () => {
    const { app, logs } = await testApp();
    try {
      const e = Object.assign(new Error('Key (username_key)=(markerqq5) already exists'), {
        code: '23505', detail: 'Key (username_key)=(markerqq5) already exists.',
      });
      app.log.error({ error: e }, 'failed');
      expect(logs.some((l) => l.includes('"error":{"type":"Error","code":"23505"}'))).toBe(true);
      expect(logs.filter((l) => l.includes('markerqq5'))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not log the address it listens on', async () => {
    const { app, logs } = await testApp();
    try {
      await app.listen({ ...LISTEN_OPTIONS, host: '127.0.0.1', port: 0 });
      expect(logs.some((l) => l.includes('listening'))).toBe(true);
      expect(logs.filter((l) => l.includes('127.0.0.1'))).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
