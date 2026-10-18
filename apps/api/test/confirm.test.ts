import { createHash } from 'node:crypto';
import { actionHash, addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { purgeExpired } from '../src/auth/challenges.js';
import { CONFIRM_TTL_MS, issueConfirmToken, requireConfirm } from '../src/auth/confirm.js';
import { SESSION_COOKIE, requireSession, startSession } from '../src/auth/sessions.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;

const sha = (s: string) => createHash('sha256').update(s.trim()).digest('hex');
const ADDR_A = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';
const ADDR_B = '48edfHu7V9Z84YzzMa6fUueoELZ9ZRXq9VetWzYGzKt52XU5xvqgzYnDK9URnRoJMk1j8nLwEVsaSWJ4fhdUyZijBGUicoD';
const walletAction = (address: string): ConfirmAction => ({ kind: 'add-wallet', addressHash: sha(address), addressEnd: addressEnd(address) });

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/login', async (req, reply) => {
    const b = req.body as { accountId: string; firstSession?: boolean; level?: 'full' | 'recovery' };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: b.level ?? 'full', deviceLabel: 'Test', method: 'password', firstSession: b.firstSession ?? false,
    });
    return { sessionId };
  });
  const walletFromBody = (req: { body: unknown }) => walletAction((req.body as { address: string }).address);
  app.post('/t/add-wallet', { preHandler: [requireSession(), requireConfirm(walletFromBody)] }, async () => ({ ok: true }));
  app.post(
    '/t/first-wallet',
    {
      preHandler: [
        requireSession(),
        requireConfirm(walletFromBody, { onboarding: async (req) => (req.body as { first?: boolean }).first === true }),
      ],
    },
    async () => ({ ok: true }),
  );
  app.post(
    '/t/add-method',
    {
      preHandler: [
        requireSession({ allowRecovery: true }),
        requireConfirm({ kind: 'add-method', method: 'passkey' }, { onboarding: true, recovery: true }),
      ],
    },
    async () => ({ ok: true }),
  );
  app.post(
    '/t/set-password',
    { preHandler: [requireSession({ allowRecovery: true }), requireConfirm({ kind: 'set-password' })] },
    async () => ({ ok: true }),
  );
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  setNow(T0);
});

let n = 0;
const name = () => `conf${String(++n).padStart(4, '0')}`;

async function login(accountId: string, o: { firstSession?: boolean; level?: 'full' | 'recovery' } = {}) {
  const res = await app.inject({ method: 'POST', url: '/t/login', headers: { origin: ORIGIN }, payload: { accountId, ...o } });
  expect(res.statusCode).toBe(200);
  return { token: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value, sessionId: res.json<{ sessionId: string }>().sessionId };
}

async function session(o: { firstSession?: boolean; level?: 'full' | 'recovery' } = {}) {
  const accountId = await seedAccount(deps, { username: name() });
  return { accountId, ...(await login(accountId, o)) };
}

const post = (url: string, token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: token }, payload });

describe('confirm tokens', () => {
  it('refuses without a token: 403 confirm-required naming the action', async () => {
    const s = await session();
    const res = await post('/t/add-wallet', s.token, { address: ADDR_A });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
  });

  it('binds a token to the exact address; a mismatch does not use it up; it works once', async () => {
    const s = await session();
    const confirmToken = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: walletAction(ADDR_A) });
    const wrong = await post('/t/add-wallet', s.token, { address: ADDR_B, confirmToken });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'confirm-invalid' });
    const ok = await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken });
    expect(ok.statusCode).toBe(200);
    const again = await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken });
    expect(again.json()).toEqual({ error: 'confirm-invalid' });
  });

  it('binds a token to the session it was issued to', async () => {
    const s = await session();
    const t = await login(s.accountId);
    const confirmToken = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: walletAction(ADDR_A) });
    const res = await post('/t/add-wallet', t.token, { address: ADDR_A, confirmToken });
    expect(res.json()).toEqual({ error: 'confirm-invalid' });
    expect((await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken })).statusCode).toBe(200);
  });

  it('expires at exactly 5:00 after issue; works at 4:59', async () => {
    expect(CONFIRM_TTL_MS).toBe(5 * MIN);
    const s = await session();
    const t1 = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: walletAction(ADDR_A) });
    const t2 = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: walletAction(ADDR_A) });
    setNow(new Date(T0.getTime() + 5 * MIN));
    expect((await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken: t1 })).json()).toEqual({ error: 'confirm-invalid' });
    setNow(new Date(T0.getTime() + 5 * MIN - 1000));
    expect((await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken: t2 })).statusCode).toBe(200);
  });

  it('refuses a token for another action', async () => {
    const s = await session();
    const confirmToken = await issueConfirmToken(deps, {
      sessionId: s.sessionId, accountId: s.accountId, action: { kind: 'add-method', method: 'passkey' },
    });
    expect((await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken })).json()).toEqual({ error: 'confirm-invalid' });
  });

  it('lets only one of two parallel redemptions through', async () => {
    const s = await session();
    const confirmToken = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: walletAction(ADDR_A) });
    const results = await Promise.all([
      post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken }),
      post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.statusCode === 403)!.json()).toEqual({ error: 'confirm-invalid' });
  });

  it('gives no exemption to a login 10 seconds ago (no FRESH_MS)', async () => {
    const s = await session();
    setNow(new Date(T0.getTime() + 10_000));
    const res = await post('/t/add-wallet', s.token, { address: ADDR_A });
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
    // A first session's onboarding window does not help on a route without the onboarding option either.
    const first = await session({ firstSession: true });
    expect((await post('/t/add-wallet', first.token, { address: ADDR_A })).json()).toMatchObject({ error: 'confirm-required' });
  });

  it('refuses malformed and unknown tokens as confirm-invalid', async () => {
    const s = await session();
    for (const confirmToken of ['nope', 'A'.repeat(43), 42, null]) {
      const res = await post('/t/add-wallet', s.token, { address: ADDR_A, confirmToken });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'confirm-invalid' });
    }
  });

  it('stores only hashes: the token SHA-256 and the action hash', async () => {
    const s = await session();
    const action = walletAction(ADDR_A);
    const token = await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action });
    const { rows } = await deps.db.query<{ token_hash: Buffer; action_hash: string; expires_at: Date; account_id: string }>(
      'select token_hash, action_hash, expires_at, account_id from confirm_tokens where session_id = $1',
      [s.sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(rows[0]!.action_hash).toBe(await actionHash(action));
    expect(rows[0]!.expires_at).toEqual(new Date(T0.getTime() + CONFIRM_TTL_MS));
    expect(rows[0]!.account_id).toBe(s.accountId);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });
});

describe('onboarding and recovery exemptions', () => {
  it('lets the creating session skip the token within 30 minutes, only where the route allows it', async () => {
    const s = await session({ firstSession: true });
    expect((await post('/t/first-wallet', s.token, { address: ADDR_A, first: true })).statusCode).toBe(200);
    // A token that is sent is always redeemed, even inside the onboarding window.
    const sent = await post('/t/first-wallet', s.token, { address: ADDR_A, first: true, confirmToken: 'A'.repeat(43) });
    expect(sent.statusCode).toBe(403);
    expect(sent.json()).toEqual({ error: 'confirm-invalid' });
    // The route's own predicate (first wallet only) still applies.
    expect((await post('/t/first-wallet', s.token, { address: ADDR_A, first: false })).json()).toMatchObject({ error: 'confirm-required' });
    expect((await post('/t/add-method', s.token, {})).statusCode).toBe(200);
    setNow(new Date(T0.getTime() + 30 * MIN));
    expect((await post('/t/first-wallet', s.token, { address: ADDR_A, first: true })).json()).toMatchObject({ error: 'confirm-required' });
    expect((await post('/t/add-method', s.token, {})).json()).toMatchObject({ error: 'confirm-required', action: 'add-method' });
  });

  it('gives a later (non-first) session no onboarding exemption', async () => {
    const s = await session();
    expect((await post('/t/first-wallet', s.token, { address: ADDR_A, first: true })).json()).toMatchObject({ error: 'confirm-required' });
  });

  it('lets a recovery session through only where recovery is allowed', async () => {
    const s = await session({ level: 'recovery' });
    expect((await post('/t/add-method', s.token, {})).statusCode).toBe(200);
    const res = await post('/t/set-password', s.token, {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-session' });
  });
});

describe('purgeExpired', () => {
  it('also deletes confirm tokens expired over 1 hour ago', async () => {
    const s = await session();
    await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: { kind: 'set-password' } });
    await issueConfirmToken(deps, { sessionId: s.sessionId, accountId: s.accountId, action: { kind: 'new-recovery-codes' } });
    await deps.db.query(`update confirm_tokens set expires_at = $2 where session_id = $1 and action_hash = $3`, [
      s.sessionId, new Date(now.getTime() - 61 * MIN), await actionHash({ kind: 'set-password' }),
    ]);
    await purgeExpired.run(deps.db, now);
    const { rows } = await deps.db.query('select action_hash from confirm_tokens where session_id = $1', [s.sessionId]);
    expect(rows).toEqual([{ action_hash: await actionHash({ kind: 'new-recovery-codes' }) }]);
  });
});
