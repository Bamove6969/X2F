import { createHash, randomBytes } from 'node:crypto';
import { addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { hashPassword } from '../src/auth/password.js';
import { PAYOUT_WAIT_MS, purgeRemovedWalletAddresses, usableWallets, WALLET_APPS } from '../src/wallets/routes.js';
import { confirmTokenMethod, seedAccount } from './helpers/accounts.js';
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

const walletsActionOf = async (addresses: string[]): Promise<ConfirmAction> => ({
  kind: 'add-wallets',
  addressesHash: createHash('sha256').update(addresses.map((a) => a.trim()).join('\n')).digest('hex'),
  addressEnds: addresses.map((a) => addressEnd(a)).join(','),
});

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

/** A fresh session for the account: after a jump past the 12-hour logout timer the old one has ended. */
async function relogin(id: string): Promise<Browser> {
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return b;
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

const tokenMethod = (token: string) => confirmTokenMethod(deps, token);

async function tokenUsed(token: string): Promise<boolean> {
  const hash = createHash('sha256').update(token).digest();
  const { rows } = await deps.db.query<{ used_at: Date | null }>('select used_at from confirm_tokens where token_hash = $1', [hash]);
  return rows[0]!.used_at !== null;
}

describe('adding a wallet during onboarding (6.1 step 5, 6.4)', () => {
  it('lets the creating session add its first wallet without a token, usable at once', async () => {
    const { b } = await trader({ firstSession: true });
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
    // The account's first wallet: usable at once even confirmed with a password (owner, 2026-10-24).
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
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address), method: 'password' });
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
    for (const [method, url] of [['POST', '/v1/wallets'], ['PUT', '/v1/account/security/logout-timer']] as const) {
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
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address), method: 'password' });
      const responses = [
        await b.get('/v1/wallets'),
        await addWallet(b, { address, confirmToken: token }),
        await b.delete(`/v1/wallets/${crypto.randomUUID()}`),
        await b.get('/v1/wallets/rule'),
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
      { app: 'cake', label: 'Cake', addressEnd: second.slice(-6), usableFrom: at(PAYOUT_WAIT_MS).toISOString(), confirmedWith: 'password' },
      { app: 'feather', label: 'Phone', addressEnd: first.slice(-6), usableFrom: now.toISOString(), confirmedWith: 'onboarding' },
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

describe('the wait by confirm method (owner, 2026-10-23)', () => {
  it('makes a later wallet confirmed with a password unusable until exactly 24 hours after it was added', async () => {
    const { id, b } = await trader();
    await addConfirmed(b); // the account's first wallet: no wait
    const added = now;
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
    expect(new Date(wallet.usableFrom).getTime()).toBe(added.getTime() + PAYOUT_WAIT_MS);
    const { rows: alerts } = await deps.db.query<{ detail: { addressEnd: string; usableFrom: string; confirmedWith: string } }>(
      `select detail from alerts where account_id = $1 and kind = 'wallet-added' and detail->>'addressEnd' = $2`,
      [id, wallet.addressEnd],
    );
    expect(alerts.map((r) => [r.detail.usableFrom, r.detail.confirmedWith])).toEqual([
      [new Date(added.getTime() + PAYOUT_WAIT_MS).toISOString(), 'password'],
    ]);

    setNow(new Date(added.getTime() + PAYOUT_WAIT_MS - 1000));
    const later = await relogin(id);
    expect((await list(later)).find((w) => w.id === wallet.id)!.usable).toBe(false);
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).not.toContain(wallet.id);

    setNow(new Date(added.getTime() + PAYOUT_WAIT_MS));
    expect((await list(later)).find((w) => w.id === wallet.id)!.usable).toBe(true);
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).toContain(wallet.id);
  });

  it('never makes the account’s first wallet wait, even added later and confirmed with a password (owner, 2026-10-24)', async () => {
    const { id, b } = await trader();
    setNow(at(10 * DAY));
    const later = await relogin(id);
    const { wallet } = await addConfirmed(later);
    expect(wallet.usable).toBe(true);
    expect(new Date(wallet.usableFrom).getTime()).toBe(now.getTime());
    const { wallet: second } = await addConfirmed(later);
    expect(second.usable).toBe(false);
    void b;
  });

  it('decides "first" under the account lock: of two parallel first adds confirmed with a password, one waits', async () => {
    const { b } = await trader();
    const addresses = [fakeAddress(), fakeAddress()];
    const tokens = [await confirmToken(b, walletAction(addresses[0]!)), await confirmToken(b, walletAction(addresses[1]!))];
    gate = { need: 2, waiting: [] };
    let results;
    try {
      results = await Promise.all(addresses.map((address, i) => addWallet(b, { address, confirmToken: tokens[i] })));
    } finally {
      gate = null;
    }
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(results.map((r) => (r.json() as WalletOut).usable).sort()).toEqual([false, true]);
  });

  it('records the password method for a password confirm', async () => {
    const { b } = await trader();
    const token = await confirmToken(b, walletAction(fakeAddress()));
    expect(await tokenMethod(token)).toBe('password');
  });

  for (const method of ['pgp', 'passkey', 'security-key'] as const) {
    it(`makes a later wallet confirmed with ${method} usable at once`, async () => {
      const { id, b, sessionId } = await trader();
      await addConfirmed(b);
      const address = fakeAddress();
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address), method });
      const res = await addWallet(b, { address, confirmToken: token });
      expect(res.statusCode).toBe(201);
      const wallet = res.json() as WalletOut;
      expect(wallet.usable).toBe(true);
      expect(new Date(wallet.usableFrom).getTime()).toBe(now.getTime());
      const { rows } = await deps.db.query<{ detail: { usableFrom: string; confirmedWith: string } }>(
        `select detail from alerts where account_id = $1 and kind = 'wallet-added' and detail->>'addressEnd' = $2`,
        [id, address.slice(-6)],
      );
      expect(rows.map((r) => [r.detail.usableFrom, r.detail.confirmedWith])).toEqual([[now.toISOString(), method]]);
    });
  }

  it('takes the method from the redeemed token only: a method named in the body changes nothing', async () => {
    const { b } = await trader();
    await addConfirmed(b);
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    const res = await addWallet(b, { address, confirmToken: token, method: 'pgp', confirmedWith: 'pgp', usableFrom: now.toISOString() });
    expect(res.statusCode).toBe(201);
    expect((res.json() as WalletOut).usable).toBe(false);
  });

  it('lets a waiting wallet be removed, which cancels it', async () => {
    const { id, b } = await trader();
    await addConfirmed(b);
    const { wallet } = await addConfirmed(b);
    const del = await b.delete(`/v1/wallets/${wallet.id}`);
    expect(del.statusCode).toBe(204);
    expect((await list(b)).map((w) => w.id)).not.toContain(wallet.id);
    setNow(at(PAYOUT_WAIT_MS));
    expect((await usableWallets(deps.db, id, now)).map((w) => w.id)).not.toContain(wallet.id);
    expect((await (await relogin(id)).delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(404);
  });

  it('keeps the first-wallet exemption to once per account: after removing every wallet, a new one needs a token and waits', async () => {
    const { b } = await trader({ firstSession: true });
    const res = await addWallet(b, { address: fakeAddress() });
    const first = res.json() as WalletOut;
    expect(first.usable).toBe(true);
    expect((await b.delete(`/v1/wallets/${first.id}`)).statusCode).toBe(204);
    // Still in the onboarding window, but no longer the first wallet: a token is needed and the wallet waits.
    expect((await addWallet(b, { address: fakeAddress() })).json()).toEqual({ error: 'confirm-required', action: 'add-wallet' });
    const { wallet } = await addConfirmed(b);
    expect(wallet.usable).toBe(false);
  });

  it('has retired the opt-in setting: PUT /v1/account/security/payout-wait is gone and its action cannot be confirmed', async () => {
    const { b } = await trader();
    expect((await b.put('/v1/account/security/payout-wait', { enabled: false })).statusCode).toBe(404);
    const res = await b.post('/v1/confirm/password', { password: GOOD, action: { kind: 'payout-wait-off' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('adding several wallets at once (owner, 2026-10-24)', () => {
  const addBatch = (b: Browser, wallets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    b.post('/v1/wallets', { wallets, ...extra });
  const drafts = (addresses: string[]) => addresses.map((address, i) => ({ app: 'cake', label: `W${i + 1}`, address }));

  it('adds a batch under one add-wallets token; later wallets share one 24-hour clock, earlier ones stay usable', async () => {
    const { id, b } = await trader();
    const { wallet: old } = await addConfirmed(b);
    setNow(at(1000));
    const addresses = [fakeAddress(), fakeAddress(), fakeAddress(), fakeAddress()];
    const token = await confirmToken(b, await walletsActionOf(addresses));
    const res = await addBatch(b, drafts(addresses), { confirmToken: token });
    expect(res.statusCode).toBe(201);
    const got = res.json() as WalletOut[];
    expect(got.map((w) => w.address)).toEqual(addresses);
    expect(new Set(got.map((w) => w.usableFrom))).toEqual(new Set([at(PAYOUT_WAIT_MS).toISOString()]));
    expect(got.every((w) => !w.usable)).toBe(true);
    expect((await list(b)).find((w) => w.id === old.id)!.usable).toBe(true);
    const { rows } = await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'wallet-added'`, [id]);
    expect(rows).toHaveLength(5);
    expect(await tokenUsed(token)).toBe(true);
  });

  it('makes a batch usable at once when confirmed with a strong method, or when the account never had a wallet', async () => {
    const strong = await trader();
    await addConfirmed(strong.b);
    const a1 = [fakeAddress(), fakeAddress()];
    const t1 = await issueConfirmToken(deps, { sessionId: strong.sessionId, accountId: strong.id, action: await walletsActionOf(a1), method: 'passkey' });
    const r1 = await addBatch(strong.b, drafts(a1), { confirmToken: t1 });
    expect((r1.json() as WalletOut[]).map((w) => w.usable)).toEqual([true, true]);

    const fresh = await trader();
    const a2 = [fakeAddress(), fakeAddress(), fakeAddress()];
    const r2 = await addBatch(fresh.b, drafts(a2), { confirmToken: await confirmToken(fresh.b, await walletsActionOf(a2)) });
    expect((r2.json() as WalletOut[]).map((w) => w.usable)).toEqual([true, true, true]);
  });

  it('lets the creating session add its first batch without a token during onboarding', async () => {
    const { b } = await trader({ firstSession: true });
    const res = await addBatch(b, drafts([fakeAddress(), fakeAddress()]));
    expect(res.statusCode).toBe(201);
    expect((res.json() as WalletOut[]).map((w) => w.usable)).toEqual([true, true]);
    const again = await addBatch(b, drafts([fakeAddress()]));
    expect(again.json()).toEqual({ error: 'confirm-required', action: 'add-wallets' });
  });

  it('binds the token to the exact list in order: another list, another order or a single-wallet token is refused and kept', async () => {
    const { b } = await trader();
    await addConfirmed(b);
    const addresses = [fakeAddress(), fakeAddress()];
    expect((await addBatch(b, drafts(addresses))).json()).toEqual({ error: 'confirm-required', action: 'add-wallets' });
    const token = await confirmToken(b, await walletsActionOf(addresses));
    for (const wrong of [[addresses[1]!, addresses[0]!], [addresses[0]!], [...addresses, fakeAddress()]]) {
      expect((await addBatch(b, drafts(wrong), { confirmToken: token })).json()).toEqual({ error: 'confirm-invalid' });
    }
    const single = await confirmToken(b, walletAction(addresses[0]!));
    expect((await addBatch(b, drafts([addresses[0]!]), { confirmToken: single })).json()).toEqual({ error: 'confirm-invalid' });
    expect(await tokenUsed(token)).toBe(false);
    expect((await addBatch(b, drafts(addresses), { confirmToken: token })).statusCode).toBe(201);
  });

  it('refuses a bad batch with 400 before the token is used, and adds nothing', async () => {
    const { id, b } = await trader();
    const good = [fakeAddress(), fakeAddress()];
    const token = await confirmToken(b, await walletsActionOf(good));
    const dup = fakeAddress();
    const bad: Array<[unknown, string]> = [
      [[], 'bad-request'],
      [drafts(Array.from({ length: 11 }, () => fakeAddress())), 'bad-request'],
      [drafts([dup, ` ${dup}`]), 'bad-request'],
      [[...drafts([good[0]!]), { app: 'cake', label: '', address: good[1] }], 'bad-request'],
      [[...drafts([good[0]!]), 'x'], 'bad-request'],
      ['not a list', 'bad-request'],
      [drafts([good[0]!, fakeAddress(106)]), 'address-integrated'],
      [drafts([good[0]!, 'nope']), 'address-invalid'],
    ];
    for (const [wallets, error] of bad) {
      const res = await b.post('/v1/wallets', { wallets, confirmToken: token });
      expect(res.statusCode, JSON.stringify(wallets).slice(0, 40)).toBe(400);
      expect(res.json()).toEqual({ error });
    }
    // A batch and single-wallet fields together.
    expect((await b.post('/v1/wallets', { wallets: drafts(good), app: 'cake', confirmToken: token })).json()).toEqual({ error: 'bad-request' });
    expect(await tokenUsed(token)).toBe(false);
    expect((await deps.db.query('select 1 from wallets where account_id = $1', [id])).rows).toHaveLength(0);
  });

  it('answers 409 wallet-exists when any address is already listed, adding none of the batch', async () => {
    const { id, b } = await trader();
    const { address } = await addConfirmed(b);
    const addresses = [fakeAddress(), address];
    const token = await confirmToken(b, await walletsActionOf(addresses));
    const res = await addBatch(b, drafts(addresses), { confirmToken: token });
    expect(res.statusCode).toBe(409);
    expect(await tokenUsed(token)).toBe(false);
    expect((await deps.db.query('select 1 from wallets where account_id = $1', [id])).rows).toHaveLength(1);
  });
});

describe('GET /v1/wallets/rule (owner, 2026-10-24)', () => {
  const rule = async (b: Browser) => {
    const res = await b.get('/v1/wallets/rule');
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('a password-only account: its first wallet works at once, later ones would wait', async () => {
    const { b } = await trader();
    expect(await rule(b)).toEqual({ firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 });
    await addConfirmed(b);
    expect(await rule(b)).toEqual({ firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 });
  });

  it('lists the strong methods the account holds; an account without a password says none', async () => {
    const { id, b } = await trader();
    await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [
      id, randomBytes(20).toString('hex'), randomBytes(64), now,
    ]);
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
       values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', 'key', $4)`,
      [id, randomBytes(32), randomBytes(77), now],
    );
    await addConfirmed(b);
    expect(await rule(b)).toEqual({ firstWallet: false, strongMethods: ['pgp', 'security-key'], password: 'waits', waitHours: 24 });
    await deps.db.query('delete from passwords where account_id = $1', [id]);
    expect((await rule(b)).password).toBe('none');
  });

  it('counts a removed wallet: the account has had one', async () => {
    const { b } = await trader();
    const { wallet } = await addConfirmed(b);
    expect((await b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(204);
    expect((await rule(b)).firstWallet).toBe(false);
  });

  it('refuses a recovery session and needs a session', async () => {
    const { b } = await trader({ level: 'recovery' });
    expect((await b.get('/v1/wallets/rule')).json()).toEqual({ error: 'recovery-session' });
    expect((await new Browser(app).get('/v1/wallets/rule')).json()).toEqual({ error: 'not-authenticated' });
  });
});

describe('removing a wallet always alerts (owner, 2026-10-23)', () => {
  it('needs no confirm and writes one wallet-removed alert with the end of the address but never all of it', async () => {
    const { id, b } = await trader();
    const { address, wallet } = await addConfirmed(b, fakeAddress(), { app: 'cake', label: 'Cake' });
    const del = await b.delete(`/v1/wallets/${wallet.id}`);
    expect(del.statusCode).toBe(204);
    const { rows } = await deps.db.query<{ detail: object; created_at: Date }>(
      `select detail, created_at from alerts where account_id = $1 and kind = 'wallet-removed'`,
      [id],
    );
    expect(rows).toEqual([{ detail: { app: 'cake', label: 'Cake', addressEnd: address.slice(-6) }, created_at: now }]);
    expect(JSON.stringify(rows)).not.toContain(address);
  });

  it('writes no alert for a wallet that is not found, already removed or another account’s', async () => {
    const a = await trader();
    const c = await trader();
    const { wallet } = await addConfirmed(a.b);
    expect((await c.b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(404);
    expect((await a.b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(204);
    expect((await a.b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(404);
    expect((await a.b.delete(`/v1/wallets/${crypto.randomUUID()}`)).statusCode).toBe(404);
    const count = async (id: string) =>
      (await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'wallet-removed'`, [id])).rows.length;
    expect(await count(a.id)).toBe(1);
    expect(await count(c.id)).toBe(0);
  });

  it('refuses a recovery session', async () => {
    const { b } = await trader({ level: 'recovery' });
    expect((await b.delete(`/v1/wallets/${crypto.randomUUID()}`)).json()).toEqual({ error: 'recovery-session' });
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
