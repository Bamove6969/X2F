import { createHash, randomBytes } from 'node:crypto';
import { addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { hashPassword } from '../src/auth/password.js';
import { PAYOUT_WAIT_MS, purgeRemovedWalletAddresses, usableWallets, WALLET_APPS } from '../src/wallets/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const GOOD = 'Correct-Horse-9';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Route tests use this stand-in (the real validator is tested in address.test.ts): a 95-character
 * address starting with 5 is ok, a 106-character one integrated, anything else invalid.
 */
/** When set, `check` holds every call until `gate.need` calls are waiting (to line up parallel requests). */
let gate: { need: number; waiting: Array<() => void> } | null = null;

const fakeValidator: AddressValidator = {
  async check(address) {
    if (gate) {
      const g = gate;
      await new Promise<void>((resolve) => {
        g.waiting.push(resolve);
        if (g.waiting.length >= g.need) for (const r of g.waiting.splice(0)) r();
      });
    }
    if (!/^5[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return 'invalid';
    if (address.length === 95) return 'ok';
    if (address.length === 106) return 'integrated';
    return 'invalid';
  },
};

function fakeAddress(length = 95): string {
  const bytes = randomBytes(length);
  let s = '5';
  for (let i = 1; i < length; i++) s += BASE58[bytes[i]! % BASE58.length];
  return s;
}

const walletAction = (address: string): ConfirmAction => ({
  kind: 'add-wallet',
  addressHash: createHash('sha256').update(address.trim()).digest('hex'),
  addressEnd: addressEnd(address),
});

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let now = T0;
let step = 0;
let goodHash: string;
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({ addresses: fakeValidator }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
  goodHash = await hashPassword(GOOD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test starts a day later: budgets refill, throttle streaks and onboarding windows end.
  setNow(new Date(T0.getTime() + ++step * 2 * DAY));
});

const at = (ms: number) => new Date(now.getTime() + ms);
const name = (p = 'wal') => `${p}${String(++n).padStart(4, '0')}`;

/** An account with the test password and a logged-in browser. `firstSession` makes it the creating session (onboarding). */
async function trader(o: { firstSession?: boolean; kind?: 'trader' | 'staff' | 'owner'; level?: 'full' | 'recovery' } = {}) {
  const username = name();
  const id = await seedAccount(deps, { username, ...(o.kind ? { kind: o.kind } : {}) });
  await deps.db.query('insert into passwords (account_id, hash, updated_at) values ($1, $2, $3)', [id, goodHash, now]);
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id, firstSession: o.firstSession ?? false, level: o.level ?? 'full' });
  expect(res.statusCode).toBe(200);
  return { id, b, sessionId: (res.json() as { sessionId: string }).sessionId };
}

async function confirmToken(b: Browser, action: ConfirmAction): Promise<string> {
  const res = await b.post('/v1/confirm/password', { password: GOOD, action });
  expect(res.statusCode).toBe(200);
  return (res.json() as { confirmToken: string }).confirmToken;
}

const addWallet = (b: Browser, body: Record<string, unknown>) => b.post('/v1/wallets', { app: 'feather', label: 'Main', ...body });

/** Adds a wallet with a fresh confirm token; expects 201. */
async function addConfirmed(b: Browser, address = fakeAddress(), extra: Record<string, unknown> = {}) {
  const token = await confirmToken(b, walletAction(address));
  const res = await addWallet(b, { address, confirmToken: token, ...extra });
  expect(res.statusCode).toBe(201);
  return { address, wallet: res.json() as WalletOut };
}

type WalletOut = { id: string; app: string; label: string; address: string; addressEnd: string; usableFrom: string; usable: boolean };

async function list(b: Browser): Promise<WalletOut[]> {
  const res = await b.get('/v1/wallets');
  expect(res.statusCode).toBe(200);
  return res.json() as WalletOut[];
}

const setWait = (id: string, on: boolean) => deps.db.query('update accounts set payout_wait = $2 where id = $1', [id, on]);

async function tokenUsed(token: string): Promise<boolean> {
  const hash = createHash('sha256').update(token).digest();
  const { rows } = await deps.db.query<{ used_at: Date | null }>('select used_at from confirm_tokens where token_hash = $1', [hash]);
  return rows[0]!.used_at !== null;
}

describe('adding a wallet during onboarding (6.1 step 5, 6.4)', () => {
  it('lets the creating session add its first wallet without a token, usable at once even with the wait on', async () => {
    const { id, b } = await trader({ firstSession: true });
    await setWait(id, true);
    const address = fakeAddress();
    const res = await addWallet(b, { address });
    expect(res.statusCode).toBe(201);
    const [w] = await list(b);
    expect(w).toMatchObject({ app: 'feather', label: 'Main', address, addressEnd: address.slice(-6), usable: true });
    expect(new Date(w!.usableFrom).getTime()).toBe(now.getTime());
  });

  it('needs a token for a second wallet in the same session', async () => {
    const { b } = await trader({ firstSession: true });
    expect((await addWallet(b, { address: fakeAddress() })).statusCode).toBe(201);
    const second = await addWallet(b, { address: fakeAddress() });
    expect(second.statusCode).toBe(403);
    expect(second.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
  });

  it('needs a token for a first wallet from a later session', async () => {
    const { b } = await trader({ firstSession: false });
    const res = await addWallet(b, { address: fakeAddress() });
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
  });

  it('needs a token once the 30-minute window has passed', async () => {
    const { b } = await trader({ firstSession: true });
    setNow(at(30 * 60_000));
    const res = await addWallet(b, { address: fakeAddress() });
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
  });

  it('lets only one of two parallel tokenless first wallets through', async () => {
    const { b } = await trader({ firstSession: true });
    // Both requests pass the address check together, so both see `had_wallet = false` before either inserts.
    gate = { need: 2, waiting: [] };
    let results;
    try {
      results = await Promise.all([addWallet(b, { address: fakeAddress() }), addWallet(b, { address: fakeAddress() })]);
    } finally {
      gate = null;
    }
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403]);
    expect(await list(b)).toHaveLength(1);
  });
});

describe('adding a wallet later (P2-C2, R17)', () => {
  it('refuses without a token seconds after a login, refuses a token for another address, accepts the right one', async () => {
    const { b } = await trader();
    setNow(at(10_000));
    const address = fakeAddress();
    const none = await addWallet(b, { address });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });

    const other = await confirmToken(b, walletAction(fakeAddress()));
    const wrong = await addWallet(b, { address, confirmToken: other });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'confirm-invalid' });

    const right = await confirmToken(b, walletAction(address));
    const ok = await addWallet(b, { address, confirmToken: right });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ address, addressEnd: address.slice(-6), usable: true });
  });

  it('stores the trimmed address that was confirmed', async () => {
    const { id, b } = await trader();
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    const res = await addWallet(b, { address: `  ${address}\n`, confirmToken: token });
    expect(res.statusCode).toBe(201);
    const { rows } = await deps.db.query<{ address: string }>('select address from wallets where account_id = $1', [id]);
    expect(rows.map((r) => r.address)).toEqual([address]);
  });

  it('refuses a recovery session', async () => {
    const { b } = await trader({ level: 'recovery' });
    const res = await addWallet(b, { address: fakeAddress() });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-session' });
    expect((await b.get('/v1/wallets')).json()).toEqual({ error: 'recovery-session' });
  });

  it('refuses an integrated address with 400 address-integrated without using up the token', async () => {
    const { b } = await trader();
    const address = fakeAddress(106);
    const token = await confirmToken(b, walletAction(address));
    const res = await addWallet(b, { address, confirmToken: token });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'address-integrated' });
    expect(await tokenUsed(token)).toBe(false);
  });

  it('refuses an invalid or wrong-network address with 400 address-invalid without using up the token', async () => {
    const { id, b, sessionId } = await trader();
    for (const address of ['4' + fakeAddress().slice(1), 'not an address', '', fakeAddress(96), 'x'.repeat(2000)]) {
      // Issued directly so even '' gets a token for exactly its own action (the confirm route refuses an empty addressEnd).
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address) });
      const res = await addWallet(b, { address, confirmToken: token });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'address-invalid' });
      expect(await tokenUsed(token)).toBe(false);
    }
  });

  it('refuses a bad app or label with 400 before the token is used, then accepts the same token', async () => {
    const { b } = await trader();
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    const bad: Record<string, unknown>[] = [
      { app: 'metamask' }, { app: 1 }, { label: '' }, { label: '   ' }, { label: 'x'.repeat(41) }, { label: 7 }, { label: 'a\u0000b' },
      { label: 'evil\u202Etxt.exe' }, { label: 'a\u200Bb' },
    ];
    for (const extra of bad) {
      const res = await addWallet(b, { address, confirmToken: token, ...extra });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect((await addWallet(b, { address: 5, confirmToken: token })).json()).toEqual({ error: 'bad-request' });
    expect(await tokenUsed(token)).toBe(false);
    const ok = await addWallet(b, { address, confirmToken: token, app: 'monero-gui-cli', label: 'x'.repeat(40) });
    expect(ok.statusCode).toBe(201);
    expect(await tokenUsed(token)).toBe(true);
  });

  it('refuses a body that is not a JSON object with 400 bad-request (M7)', async () => {
    const { b } = await trader();
    for (const [method, url] of [['POST', '/v1/wallets'], ['PUT', '/v1/account/security/payout-wait']] as const) {
      for (const payload of ['[]', '"x"', '7', 'null']) {
        const res = await app.inject({
          method, url, headers: { origin: ORIGIN, 'content-type': 'application/json' }, cookies: b.cookies, payload,
        });
        expect(res.statusCode, `${method} ${payload}`).toBe(400);
        expect(res.json()).toEqual({ error: 'bad-request' });
      }
    }
  });

  it('trims the label in the list and the alert, and counts it in code points: 40 emoji fit, 41 do not (M4)', async () => {
    const { id, b } = await trader();
    await addConfirmed(b, fakeAddress(), { label: '  Main  ' });
    expect((await list(b)).map((w) => w.label)).toEqual(['Main']);
    const { rows } = await deps.db.query<{ detail: { label: string } }>(
      `select detail from alerts where account_id = $1 and kind = 'wallet-added'`,
      [id],
    );
    expect(rows.map((r) => r.detail.label)).toEqual(['Main']);
    await addConfirmed(b, fakeAddress(), { label: '\u{1F4B0}'.repeat(40) });
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    const long = await addWallet(b, { address, confirmToken: token, label: '\u{1F4B0}'.repeat(41) });
    expect(long.json()).toEqual({ error: 'bad-request' });
    expect(await tokenUsed(token)).toBe(false);
  });

  it('accepts every wallet app from the list', async () => {
    const { b } = await trader();
    for (const appName of WALLET_APPS) await addConfirmed(b, fakeAddress(), { app: appName });
    expect((await list(b)).map((w) => w.app).sort()).toEqual([...WALLET_APPS].sort());
  });

  it('answers 409 wallet-exists for an address already listed, without using up the token; after removal it can be added again', async () => {
    const { b } = await trader();
    const { address, wallet } = await addConfirmed(b);
    const token = await confirmToken(b, walletAction(address));
    const again = await addWallet(b, { address: ` ${address} `, confirmToken: token });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'wallet-exists' });
    expect(await tokenUsed(token)).toBe(false);

    expect((await b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(204);
    const readd = await addWallet(b, { address, confirmToken: token });
    expect(readd.statusCode).toBe(201);
  });

  it('lets only one of two parallel adds of the same address through, and the loser keeps its token (M1)', async () => {
    const { id, b } = await trader();
    await addConfirmed(b); // not the first wallet: both requests need a token
    const address = fakeAddress();
    const tokens = [await confirmToken(b, walletAction(address)), await confirmToken(b, walletAction(address))];
    // Both pass the "already listed" check together; the unique index decides.
    gate = { need: 2, waiting: [] };
    let results;
    try {
      results = await Promise.all(tokens.map((t) => addWallet(b, { address, confirmToken: t })));
    } finally {
      gate = null;
    }
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = results.findIndex((r) => r.statusCode === 409);
    expect(results[loser]!.json()).toEqual({ error: 'wallet-exists' });
    expect(await tokenUsed(tokens[loser]!)).toBe(false);
    expect(await tokenUsed(tokens[1 - loser]!)).toBe(true);
    const { rows } = await deps.db.query('select 1 from wallets where account_id = $1 and address = $2', [id, address]);
    expect(rows).toHaveLength(1);
    const alerts = await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'wallet-added' and detail->>'addressEnd' = $2`, [
      id, address.slice(-6),
    ]);
    expect(alerts.rows).toHaveLength(1);
  });

  it('lets two accounts list the same address', async () => {
    const a = await trader();
    const c = await trader();
    const { address } = await addConfirmed(a.b);
    await addConfirmed(c.b, address);
  });
});

describe('staff and owner accounts hold no payout wallets (R3)', () => {
  for (const kind of ['staff', 'owner'] as const) {
    it(`answers 403 wrong-account-kind to a ${kind} session on every wallet route`, async () => {
      const { id, b, sessionId } = await trader({ kind });
      const address = fakeAddress();
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address) });
      const responses = [
        await b.get('/v1/wallets'),
        await addWallet(b, { address, confirmToken: token }),
        await b.delete(`/v1/wallets/${crypto.randomUUID()}`),
        await b.put('/v1/account/security/payout-wait', { enabled: true }),
      ];
      for (const res of responses) {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'wrong-account-kind' });
      }
      expect(await tokenUsed(token)).toBe(false);
    });
  }
});

describe('alerts and logs', () => {
  it('writes one wallet-added alert per add, with the end of the address but never all of it', async () => {
    const { id, b } = await trader({ firstSession: true });
    const first = fakeAddress();
    expect((await addWallet(b, { address: first, label: 'Phone' })).statusCode).toBe(201);
    const { address: second } = await addConfirmed(b, fakeAddress(), { app: 'cake', label: 'Cake' });
    const { rows } = await deps.db.query<{ kind: string; detail: Record<string, unknown> }>(
      `select kind, detail from alerts where account_id = $1 and kind = 'wallet-added' order by created_at, detail->>'label' desc`,
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.detail).sort((x, y) => String(x.label).localeCompare(String(y.label)))).toEqual([
      { app: 'cake', label: 'Cake', addressEnd: second.slice(-6), usableFrom: now.toISOString() },
      { app: 'feather', label: 'Phone', addressEnd: first.slice(-6), usableFrom: now.toISOString() },
    ]);
    const all = JSON.stringify(rows);
    expect(all).not.toContain(first);
    expect(all).not.toContain(second);
  });

  it('never logs an address, even when a request fails', async () => {
    const { b } = await trader();
    const address = fakeAddress();
    await addWallet(b, { address });
    await addWallet(b, { address: fakeAddress(106) });
    await addConfirmed(b, address);
    const text = logs.join('\n');
    expect(text).not.toContain(address);
    expect(text).not.toContain(address.slice(-6));
  });
});

describe('the opt-in 24-hour wait', () => {
  it('makes a later wallet unusable until exactly 24 hours after it was added', async () => {
    const { id, b } = await trader();
    await setWait(id, true);
    await addConfirmed(b); // the account's first wallet: no wait
    const added = now;
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
    expect(new Date(wallet.usableFrom).getTime()).toBe(added.getTime() + PAYOUT_WAIT_MS);
    const { rows: alerts } = await deps.db.query<{ detail: { addressEnd: string; usableFrom: string } }>(
      `select detail from alerts where account_id = $1 and kind = 'wallet-added' and detail->>'addressEnd' = $2`,
      [id, wallet.addressEnd],
    );
    expect(alerts.map((r) => r.detail.usableFrom)).toEqual([new Date(added.getTime() + PAYOUT_WAIT_MS).toISOString()]);

    setNow(new Date(added.getTime() + PAYOUT_WAIT_MS - 1000));
    expect((await list(b)).find((w) => w.id === wallet.id)!.usable).toBe(false);
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).not.toContain(wallet.id);

    setNow(new Date(added.getTime() + PAYOUT_WAIT_MS));
    expect((await list(b)).find((w) => w.id === wallet.id)!.usable).toBe(true);
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).toContain(wallet.id);
  });

  it('lets a waiting wallet be removed, which cancels it', async () => {
    const { id, b } = await trader();
    await setWait(id, true);
    await addConfirmed(b);
    const { wallet } = await addConfirmed(b);
    const del = await b.delete(`/v1/wallets/${wallet.id}`);
    expect(del.statusCode).toBe(204);
    expect((await list(b)).map((w) => w.id)).not.toContain(wallet.id);
    setNow(at(PAYOUT_WAIT_MS));
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).not.toContain(wallet.id);
    expect((await b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(404);
  });

  it('keeps the first-wallet exemption to once per account: after removing every wallet, a new one waits', async () => {
    const { id, b } = await trader({ firstSession: true });
    await setWait(id, true);
    const res = await addWallet(b, { address: fakeAddress() });
    const first = res.json() as WalletOut;
    expect(first.usable).toBe(true);
    expect((await b.delete(`/v1/wallets/${first.id}`)).statusCode).toBe(204);
    // Still in the onboarding window, but no longer the first wallet: a token is needed and the wallet waits.
    expect((await addWallet(b, { address: fakeAddress() })).json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
  });

  it('turns on at once without a token', async () => {
    const { id, b } = await trader();
    const res = await b.put('/v1/account/security/payout-wait', { enabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, offAt: null });
    await addConfirmed(b);
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
    const { rows } = await deps.db.query('select payout_wait, payout_wait_off_at from accounts where id = $1', [id]);
    expect(rows[0]).toEqual({ payout_wait: true, payout_wait_off_at: null });
  });

  it('needs a payout-wait-off token to turn off, even in the onboarding window, and takes 24 hours', async () => {
    const { id, b } = await trader({ firstSession: true });
    expect((await b.put('/v1/account/security/payout-wait', { enabled: true })).statusCode).toBe(200);
    const none = await b.put('/v1/account/security/payout-wait', { enabled: false });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'payout-wait-off' });

    const walletToken = await confirmToken(b, walletAction(fakeAddress()));
    const wrong = await b.put('/v1/account/security/payout-wait', { enabled: false, confirmToken: walletToken });
    expect(wrong.json()).toEqual({ error: 'confirm-invalid' });

    const token = await confirmToken(b, { kind: 'payout-wait-off' });
    const off = await b.put('/v1/account/security/payout-wait', { enabled: false, confirmToken: token });
    expect(off.statusCode).toBe(200);
    const offAt = new Date(now.getTime() + PAYOUT_WAIT_MS);
    expect(off.json()).toEqual({ enabled: true, offAt: offAt.toISOString() });
    const { rows: alerts } = await deps.db.query<{ detail: object }>(
      `select detail from alerts where account_id = $1 and kind = 'payout-wait-off-scheduled'`,
      [id],
    );
    expect(alerts.map((r) => r.detail)).toEqual([{ offAt: offAt.toISOString() }]);

    // Asking again while it is scheduled changes nothing and needs no token.
    const again = await b.put('/v1/account/security/payout-wait', { enabled: false });
    expect(again.json()).toEqual({ enabled: true, offAt: offAt.toISOString() });

    // The first wallet (onboarding) is immediate; wallets added in the next 24 hours still wait.
    expect((await addWallet(b, { address: fakeAddress() })).statusCode).toBe(201);
    setNow(new Date(offAt.getTime() - 1000));
    const { wallet: waiting } = await addConfirmed(b);
    expect(waiting.usable).toBe(false);
    expect(new Date(waiting.usableFrom).getTime()).toBe(now.getTime() + PAYOUT_WAIT_MS);

    setNow(offAt);
    const { wallet: immediate } = await addConfirmed(b);
    expect(immediate.usable).toBe(true);
    expect((await b.put('/v1/account/security/payout-wait', { enabled: false })).json()).toEqual({ enabled: false, offAt: null });
  });

  it('re-checks under the row lock: a tokenless switch-off that races a switch-on needs a token (I1)', async () => {
    const { id, b } = await trader();
    // The wait is off, so the preHandler lets a tokenless "off" through as a no-op.
    const other = await deps.db.connect();
    try {
      await other.query('begin');
      await other.query('select 1 from accounts where id = $1 for update', [id]);
      await other.query('update accounts set payout_wait = true where id = $1', [id]);
      const { rows: [me] } = await other.query<{ pid: number }>('select pg_backend_pid() as pid');
      const pending = b.put('/v1/account/security/payout-wait', { enabled: false });
      // Wait until the handler's `select ... for update` is blocked behind this transaction.
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await deps.db.query(
          `select 1 from pg_stat_activity where wait_event_type = 'Lock' and pid <> $1 and query like '%for update%'`,
          [me!.pid],
        );
        if (rows.length > 0) break;
        if (Date.now() > deadline) throw new Error('the handler never waited on the row lock');
        await new Promise((r) => setTimeout(r, 20));
      }
      await other.query('commit');
      const res = await pending;
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'confirm-required', action: 'payout-wait-off' });
    } finally {
      other.release();
    }
    const { rows } = await deps.db.query<{ payout_wait: boolean; payout_wait_off_at: Date | null }>(
      'select payout_wait, payout_wait_off_at from accounts where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ payout_wait: true, payout_wait_off_at: null });
    const alerts = await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'payout-wait-off-scheduled'`, [id]);
    expect(alerts.rows).toHaveLength(0);
  });

  it('cancels a scheduled switch-off when turned back on', async () => {
    const { id, b } = await trader();
    await setWait(id, true);
    const token = await confirmToken(b, { kind: 'payout-wait-off' });
    expect((await b.put('/v1/account/security/payout-wait', { enabled: false, confirmToken: token })).statusCode).toBe(200);
    const on = await b.put('/v1/account/security/payout-wait', { enabled: true });
    expect(on.json()).toEqual({ enabled: true, offAt: null });
    setNow(at(2 * PAYOUT_WAIT_MS));
    await addConfirmed(b);
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
  });

  it('refuses a body without a boolean enabled, before any token is used', async () => {
    const { id, b } = await trader();
    await setWait(id, true);
    const token = await confirmToken(b, { kind: 'payout-wait-off' });
    for (const body of [{}, { enabled: 'false', confirmToken: token }, { enabled: 0, confirmToken: token }, { enabled: null }]) {
      const res = await b.put('/v1/account/security/payout-wait', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect(await tokenUsed(token)).toBe(false);
  });

  it('refuses a recovery session', async () => {
    const { b } = await trader({ level: 'recovery' });
    expect((await b.put('/v1/account/security/payout-wait', { enabled: true })).json()).toEqual({ error: 'recovery-session' });
  });
});

describe('listing and removing', () => {
  it('lists only the account’s own open wallets, oldest first, never a balance', async () => {
    const a = await trader();
    const c = await trader();
    const { wallet: w1 } = await addConfirmed(a.b);
    setNow(at(1000));
    const { wallet: w2 } = await addConfirmed(a.b, fakeAddress(), { label: 'Second' });
    await addConfirmed(c.b);
    const got = await list(a.b);
    expect(got.map((w) => w.id)).toEqual([w1.id, w2.id]);
    for (const w of got) expect(Object.keys(w).sort()).toEqual(['address', 'addressEnd', 'app', 'id', 'label', 'usable', 'usableFrom']);
  });

  it('answers 404 for another account’s wallet or a malformed id', async () => {
    const a = await trader();
    const c = await trader();
    const { wallet } = await addConfirmed(a.b);
    expect((await c.b.delete(`/v1/wallets/${wallet.id}`)).json()).toEqual({ error: 'not-found' });
    expect((await c.b.delete('/v1/wallets/not-a-uuid')).statusCode).toBe(404);
    expect((await list(a.b)).map((w) => w.id)).toEqual([wallet.id]);
  });

  it('needs a session', async () => {
    const b = new Browser(app);
    expect((await b.get('/v1/wallets')).json()).toEqual({ error: 'not-authenticated' });
    expect((await addWallet(b, { address: fakeAddress() })).json()).toEqual({ error: 'not-authenticated' });
  });
});

describe('purgeRemovedWalletAddresses', () => {
  it('nulls the address of a wallet removed 91 days ago and keeps one removed 89 days ago', async () => {
    const { id, b } = await trader();
    const { wallet: old } = await addConfirmed(b);
    const { wallet: recent } = await addConfirmed(b);
    const { wallet: open } = await addConfirmed(b);
    await deps.db.query('update wallets set removed_at = $2 where id = $1', [old.id, new Date(now.getTime() - 91 * DAY)]);
    await deps.db.query('update wallets set removed_at = $2 where id = $1', [recent.id, new Date(now.getTime() - 89 * DAY)]);
    expect(await purgeRemovedWalletAddresses.run(deps.db, now)).toBe(1);
    const { rows } = await deps.db.query<{ id: string; address: string | null }>('select id, address from wallets where account_id = $1', [id]);
    const by = new Map(rows.map((r) => [r.id, r.address]));
    expect(by.get(old.id)).toBeNull();
    expect(by.get(recent.id)).toBe(recent.address);
    expect(by.get(open.id)).toBe(open.address);
    expect(await purgeRemovedWalletAddresses.run(deps.db, now)).toBe(0);
  });
});
