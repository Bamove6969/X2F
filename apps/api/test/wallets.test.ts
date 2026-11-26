import { createHash, randomBytes } from 'node:crypto';
import { addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { WALLET_RENAMES_PER_DAY, purgeRemovedWalletAddresses, usableWallets, WALLET_APPS } from '../src/wallets/routes.js';
import { insertBan } from './helpers/bans.js';
import { confirmTokenFor, confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
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

const walletsActionOf = (addresses: string[]): ConfirmAction => ({
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
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({ addresses: fakeValidator }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
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

/** An account (two kinds of method) and a logged-in browser. `firstSession` makes it the creating session (onboarding). */
async function trader(o: { firstSession?: boolean; kind?: 'trader' | 'staff' | 'owner' } = {}) {
  const username = name();
  const id = await seedAccount(deps, { loginName: username, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id, firstSession: o.firstSession ?? false });
  expect(res.statusCode).toBe(200);
  return { id, b, sessionId: (res.json() as { sessionId: string }).sessionId };
}

/** A fresh session for the account: after a jump past the 12-hour logout timer the old one has ended. */
async function relogin(id: string): Promise<Browser> {
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return b;
}

/** A PGP confirm token for `action` (owner 26 Nov 2026: no confirm makes a wallet wait). */
const confirmToken = (b: Browser, action: ConfirmAction): Promise<string> => confirmTokenFor(deps, b.cookies, action);

const addWallet = (b: Browser, body: Record<string, unknown>) => b.post('/v1/wallets', { app: 'feather', label: 'Main', ...body });

/** Adds a wallet with a fresh confirm token; expects 201. */
async function addConfirmed(b: Browser, address = fakeAddress(), extra: Record<string, unknown> = {}) {
  const token = await confirmToken(b, walletAction(address));
  const res = await addWallet(b, { address, confirmToken: token, ...extra });
  expect(res.statusCode).toBe(201);
  return { address, wallet: res.json() as WalletOut };
}

type WalletOut = { id: string; app: string; label: string; address: string; addressEnd: string; usableFrom: string; usable: boolean; oneTime: boolean; isDefault: boolean };

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

  it('needs no token past 30 minutes while the sign-up session has not ended (owner 2026-11-26, #161)', async () => {
    const { b } = await trader({ firstSession: true });
    setNow(at(90 * 60_000));
    expect((await addWallet(b, { address: fakeAddress() })).statusCode).toBe(201);
  });

  it('needs a token once the sign-up session has ended (onboarding/end)', async () => {
    const { b } = await trader({ firstSession: true });
    await b.post('/v1/account/onboarding/end', {});
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

/**
 * Owner demo note #161 (23 Nov 2026, /setup/wallet): "the first wallet they add is supposed to let
 * them add it no matter what without a 24 hour period ... any subsequent adds of wallets they will
 * have to be security checked." The setup screen sends a batch of one (`{ wallets: [draft] }`).
 * The rule is the existing one (walletConfirm + addHandler + gateChange): no confirm and no hold
 * only for the account's first wallet ever, from the creating session, until that session ends its
 * sign-up (owner 2026-11-26: no 30-minute clock). Everything else keeps the confirm and the wait/hold rules exactly as before.
 */
describe('owner demo note #161: the first wallet added in sign-up', () => {
  const setupAdd = (b: Browser, address: string, extra: Record<string, unknown> = {}) =>
    b.post('/v1/wallets', { wallets: [{ app: 'other', label: 'Wallet 1', address }], ...extra });
  const stored = async (id: string) =>
    (await deps.db.query<{ address: string; usable_from: Date }>('select address, usable_from from wallets where account_id = $1 and removed_at is null', [id])).rows;
  const tokens = async (id: string) => (await deps.db.query('select 1 from confirm_tokens where account_id = $1', [id])).rows.length;

  it('in the window: no confirm, stored and usable at once', async () => {
    const { id, b } = await trader({ firstSession: true });
    setNow(at(29 * 60_000));
    const address = fakeAddress();
    const res = await setupAdd(b, address);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject([{ address, addressEnd: address.slice(-6), usable: true }]);
    expect(await stored(id)).toEqual([{ address, usable_from: now }]);
    expect(await tokens(id)).toBe(0);
    const { rows } = await deps.db.query<{ detail: { confirmedWith: string } }>("select detail from alerts where account_id = $1 and kind = 'wallet-added'", [id]);
    expect(rows.map((r) => r.detail.confirmedWith)).toEqual(['onboarding']);
  });

  it('past 30 minutes in the sign-up session: still no confirm (owner 2026-11-26)', async () => {
    const { id, b } = await trader({ firstSession: true });
    setNow(at(90 * 60_000));
    const address = fakeAddress();
    const res = await setupAdd(b, address);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject([{ address, usable: true }]);
    expect(await stored(id)).toEqual([{ address, usable_from: now }]);
  });

  it('once the sign-up session has ended: a confirm is required (the first wallet still never waits)', async () => {
    const { id, b } = await trader({ firstSession: true });
    await b.post('/v1/account/onboarding/end', {});
    const address = fakeAddress();
    const none = await setupAdd(b, address);
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'add-wallets' });
    expect(await stored(id)).toEqual([]);
    const ok = await setupAdd(b, address, { confirmToken: await confirmToken(b, walletsActionOf([address])) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject([{ address, usable: true }]);
  });

  it('a second wallet in the window needs a confirm, and is usable at once', async () => {
    const { id, b } = await trader({ firstSession: true });
    expect((await setupAdd(b, fakeAddress())).statusCode).toBe(201);
    const second = fakeAddress();
    const refused = await setupAdd(b, second);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'confirm-required', action: 'add-wallets' });
    expect(await stored(id)).toHaveLength(1);
    const ok = await setupAdd(b, second, { confirmToken: await confirmToken(b, walletsActionOf([second])) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject([{ address: second, usable: true, usableFrom: now.toISOString() }]);
  });

  // A wallet removed and a new one added is not "first" either: 'keeps the first-wallet exemption to once per account' below.

  it('a later session of a new account (not the creating one) needs a confirm for its first wallet', async () => {
    const { id } = await trader({ firstSession: true });
    const later = await relogin(id);
    expect((await setupAdd(later, fakeAddress())).json()).toEqual({ error: 'confirm-required', action: 'add-wallets' });
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
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address), method: 'passkey' });
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
    for (const [method, url] of [['POST', '/v1/wallets'], ['PUT', '/v1/account/session/length']] as const) {
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
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletAction(address), method: 'passkey' });
      const responses = [
        await b.get('/v1/wallets'),
        await addWallet(b, { address, confirmToken: token }),
        await b.delete(`/v1/wallets/${crypto.randomUUID()}`),
        await b.get('/v1/wallets/rule'),
        // Owner demo note #226: the rename.
        await b.put(`/v1/wallets/${crypto.randomUUID()}/label`, { label: 'Savings' }),
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
      { app: 'cake', label: 'Cake', addressEnd: second.slice(-6), usableFrom: now.toISOString(), confirmedWith: 'pgp' },
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

describe('adding several wallets at once (owner, 2026-10-24)', () => {
  const addBatch = (b: Browser, wallets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    b.post('/v1/wallets', { wallets, ...extra });
  const drafts = (addresses: string[]) => addresses.map((address, i) => ({ app: 'cake', label: `W${i + 1}`, address }));

  it('makes a batch usable at once when confirmed with a strong method, or when the account never had a wallet', async () => {
    const strong = await trader();
    await addConfirmed(strong.b);
    const a1 = [fakeAddress(), fakeAddress()];
    const t1 = await issueConfirmToken(deps, { sessionId: strong.sessionId, accountId: strong.id, action: walletsActionOf(a1), method: 'passkey' });
    const r1 = await addBatch(strong.b, drafts(a1), { confirmToken: t1 });
    expect((r1.json() as WalletOut[]).map((w) => w.usable)).toEqual([true, true]);

    const fresh = await trader();
    const a2 = [fakeAddress(), fakeAddress(), fakeAddress()];
    const r2 = await addBatch(fresh.b, drafts(a2), { confirmToken: await confirmToken(fresh.b, walletsActionOf(a2)) });
    expect((r2.json() as WalletOut[]).map((w) => w.usable)).toEqual([true, true, true]);
  });

  for (const method of ['pgp', 'security-key'] as const) {
    it(`makes a later batch confirmed with ${method} usable at once, every wallet in it`, async () => {
      const { id, b, sessionId } = await trader();
      await addConfirmed(b);
      const list = [fakeAddress(), fakeAddress(), fakeAddress()];
      const token = await issueConfirmToken(deps, { sessionId, accountId: id, action: walletsActionOf(list), method });
      const res = await addBatch(b, drafts(list), { confirmToken: token });
      expect(res.statusCode).toBe(201);
      const got = res.json() as WalletOut[];
      expect(got.map((w) => [w.usable, w.usableFrom])).toEqual(list.map(() => [true, now.toISOString()]));
    });
  }

  it('writes one alert per batch wallet with its end, the usableFrom and the method, never a full address (M1)', async () => {
    const { id, b } = await trader();
    await addConfirmed(b);
    const list = [fakeAddress(), fakeAddress(), fakeAddress()];
    const res = await addBatch(b, drafts(list), { confirmToken: await confirmToken(b, walletsActionOf(list)) });
    expect(res.statusCode).toBe(201);
    const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
      `select detail from alerts where account_id = $1 and kind = 'wallet-added' and detail->>'addressEnd' = any($2::text[])`,
      [id, list.map((a) => a.slice(-6))],
    );
    const shared = now.toISOString();
    expect(rows.map((r) => [r.detail.addressEnd, r.detail.usableFrom, r.detail.confirmedWith]).sort()).toEqual(
      list.map((a) => [a.slice(-6), shared, 'pgp']).sort(),
    );
    const { rows: all } = await deps.db.query<{ detail: unknown }>('select detail from alerts where account_id = $1', [id]);
    for (const r of all) {
      const text = JSON.stringify(r.detail);
      for (const a of list) expect(text).not.toContain(a);
    }
  });

  it('adds a batch of exactly MAX_WALLET_BATCH (10) under one token (M4)', async () => {
    const { id, b } = await trader();
    const list = Array.from({ length: 10 }, () => fakeAddress());
    const res = await addBatch(b, drafts(list), { confirmToken: await confirmToken(b, walletsActionOf(list)) });
    expect(res.statusCode).toBe(201);
    expect((res.json() as WalletOut[]).map((w) => w.address)).toEqual(list);
    expect((await deps.db.query('select 1 from wallets where account_id = $1', [id])).rows).toHaveLength(10);
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
    const token = await confirmToken(b, walletsActionOf(addresses));
    for (const wrong of [[addresses[1]!, addresses[0]!], [addresses[0]!], [...addresses, fakeAddress()], [fakeAddress(), fakeAddress()]]) {
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
    const token = await confirmToken(b, walletsActionOf(good));
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
    const token = await confirmToken(b, walletsActionOf(addresses));
    const res = await addBatch(b, drafts(addresses), { confirmToken: token });
    expect(res.statusCode).toBe(409);
    expect(await tokenUsed(token)).toBe(false);
    expect((await deps.db.query('select 1 from wallets where account_id = $1', [id])).rows).toHaveLength(1);
  });
});

describe('GET /v1/wallets/rule (owner, 2026-10-24; no waits since 26 Nov 2026)', () => {
  const rule = async (b: Browser) => {
    const res = await b.get('/v1/wallets/rule');
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('says whether the account has had a wallet and lists the methods it can confirm with', async () => {
    const { id, b } = await trader();
    expect(await rule(b)).toEqual({ firstWallet: true, strongMethods: ['passkey', 'security-key'] });
    await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [
      id, randomBytes(20).toString('hex'), randomBytes(64), now,
    ]);
    await addConfirmed(b);
    expect(await rule(b)).toEqual({ firstWallet: false, strongMethods: ['pgp', 'passkey', 'security-key'] });
  });

  it('counts a removed wallet: the account has had one', async () => {
    const { b } = await trader();
    const { wallet } = await addConfirmed(b);
    expect((await b.delete(`/v1/wallets/${wallet.id}`)).statusCode).toBe(204);
    expect((await rule(b)).firstWallet).toBe(false);
  });

  it('needs a session', async () => {
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
    for (const w of got) expect(Object.keys(w).sort()).toEqual(['address', 'addressEnd', 'app', 'id', 'inUseByTrade', 'isDefault', 'label', 'oneTime', 'usable', 'usableFrom']);
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

describe('one-time wallets (owner demo note #6)', () => {
  it('stores oneTime: true when asked and lists it; every other wallet is saved for future trades', async () => {
    const { b } = await trader();
    const saved = await addConfirmed(b);
    expect(saved.wallet.oneTime).toBe(false);
    // The list is oldest first: a second later, so the order is fixed.
    setNow(at(1000));
    const once = await addConfirmed(b, fakeAddress(), { oneTime: true });
    expect(once.wallet.oneTime).toBe(true);
    const listed = await list(b);
    expect(listed.map((w) => [w.address, w.oneTime])).toEqual([[saved.address, false], [once.address, true]]);
    const kept = await addConfirmed(b, fakeAddress(), { oneTime: false });
    expect(kept.wallet.oneTime).toBe(false);
  });

  it('refuses a oneTime that is not a boolean with 400 before the token is used', async () => {
    const { b } = await trader();
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    for (const oneTime of ['true', 1, null, {}]) {
      const res = await addWallet(b, { address, confirmToken: token, oneTime });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect(await tokenUsed(token)).toBe(false);
    expect((await addWallet(b, { address, confirmToken: token, oneTime: true })).statusCode).toBe(201);
  });

  it('takes oneTime per wallet in a batch', async () => {
    const { b } = await trader();
    const addresses = [fakeAddress(), fakeAddress()];
    const token = await confirmToken(b, walletsActionOf(addresses));
    const res = await b.post('/v1/wallets', {
      wallets: [{ app: 'cake', label: 'Once', address: addresses[0], oneTime: true }, { app: 'cake', label: 'Kept', address: addresses[1] }],
      confirmToken: token,
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as WalletOut[]).map((w) => w.oneTime)).toEqual([true, false]);
  });

});

describe('the default payout wallet (owner, 17 Nov 2026: answer to note #6 Q1)', () => {
  const makeDefault = (b: Browser, id: string) => b.put(`/v1/wallets/${id}/default`, {});
  const defaults = async (b: Browser) => (await list(b)).filter((w) => w.isDefault).map((w) => w.id);
  /** A later wallet made usable now (as a strong confirm would make it). */
  async function addReady(b: Browser, extra: Record<string, unknown> = {}) {
    const r = await addConfirmed(b, fakeAddress(), extra);
    await deps.db.query('update wallets set usable_from = created_at where id = $1', [r.wallet.id]);
    return r;
  }

  it('"If they only have one wallet saved then that\'s the default"', async () => {
    const { b } = await trader();
    expect(await list(b)).toEqual([]);
    const { wallet } = await addConfirmed(b);
    expect(await defaults(b)).toEqual([wallet.id]);
  });

  it('with several saved wallets there is none until one is chosen; choosing another moves it', async () => {
    const { b } = await trader();
    const { wallet: a } = await addConfirmed(b);
    setNow(at(1000));
    const { wallet: c } = await addReady(b);
    expect(await defaults(b)).toEqual([]);
    expect((await makeDefault(b, c.id)).statusCode).toBe(204);
    expect(await defaults(b)).toEqual([c.id]);
    expect((await makeDefault(b, a.id)).statusCode).toBe(204);
    expect(await defaults(b)).toEqual([a.id]);
    // Choosing the default again changes nothing.
    expect((await makeDefault(b, a.id)).statusCode).toBe(204);
    expect(await defaults(b)).toEqual([a.id]);
  });

  it('a one-time wallet is never the default, and does not stop a sole saved wallet being it', async () => {
    const { b } = await trader();
    const { wallet: saved } = await addConfirmed(b);
    setNow(at(1000));
    const { wallet: once } = await addReady(b, { oneTime: true });
    expect(await defaults(b)).toEqual([saved.id]);
    const res = await makeDefault(b, once.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'wallet-one-time' });
    expect(await defaults(b)).toEqual([saved.id]);
  });

  it('removing the default leaves none until one is chosen, or the sole remaining wallet', async () => {
    const { b } = await trader();
    const { wallet: a } = await addConfirmed(b);
    setNow(at(1000));
    const { wallet: c } = await addReady(b);
    setNow(at(1000));
    const { wallet: d } = await addReady(b);
    expect((await makeDefault(b, a.id)).statusCode).toBe(204);
    expect((await b.delete(`/v1/wallets/${a.id}`)).statusCode).toBe(204);
    expect(await defaults(b)).toEqual([]);
    expect((await b.delete(`/v1/wallets/${c.id}`)).statusCode).toBe(204);
    expect(await defaults(b)).toEqual([d.id]);
  });

  it("answers 404 for another account's, a removed or a malformed wallet", async () => {
    const one = await trader();
    const other = await trader();
    const { wallet: mine } = await addConfirmed(one.b);
    const { wallet: theirs } = await addConfirmed(other.b);
    expect((await makeDefault(one.b, theirs.id)).statusCode).toBe(404);
    expect((await makeDefault(one.b, 'nope')).statusCode).toBe(404);
    expect((await one.b.delete(`/v1/wallets/${mine.id}`)).statusCode).toBe(204);
    expect((await makeDefault(one.b, mine.id)).statusCode).toBe(404);
    expect((await new Browser(app).put(`/v1/wallets/${theirs.id}/default`, {})).statusCode).toBe(401);
  });

  it('refuses a removed wallet and a used-up one-time wallet (neither is an open wallet)', async () => {
    const { id, b } = await trader();
    const { wallet: first } = await addConfirmed(b);
    setNow(at(1000));
    const { wallet: once } = await addReady(b, { oneTime: true });
    // Used up by a trade (as useUpOneTimeWallet leaves it).
    await deps.db.query(`update wallets set removed_at = $2, used_by_trade = 'AAAA-BBBB-CCCC-DDDD' where id = $1`, [once.id, now]);
    expect((await makeDefault(b, once.id)).statusCode).toBe(404);
    setNow(at(1000));
    const { wallet: gone } = await addReady(b);
    expect((await b.delete(`/v1/wallets/${gone.id}`)).statusCode).toBe(204);
    expect((await makeDefault(b, gone.id)).statusCode).toBe(404);
    const { rows } = await deps.db.query('select id from wallets where account_id = $1 and is_default', [id]);
    expect(rows).toEqual([]);
    expect(await defaults(b)).toEqual([first.id]);
  });

  it('keeps one default per account even when two are chosen at once', async () => {
    const { id, b } = await trader();
    const { wallet: a } = await addConfirmed(b);
    setNow(at(1000));
    const { wallet: c } = await addReady(b);
    const res = await Promise.all([makeDefault(b, a.id), makeDefault(b, c.id)]);
    expect(res.map((r) => r.statusCode)).toEqual([204, 204]);
    const { rows } = await deps.db.query('select id from wallets where account_id = $1 and is_default and removed_at is null', [id]);
    expect(rows).toHaveLength(1);
    expect(await defaults(b)).toHaveLength(1);
  });
});

describe('renaming a wallet (owner demo note #226, 25 Nov 2026)', () => {
  const rename = (b: Browser, id: string, body: unknown) => b.put(`/v1/wallets/${id}/label`, body as Record<string, unknown>);
  const row = async (id: string) =>
    (await deps.db.query<{ label: string; address: string; is_default: boolean; usable_from: Date; app: string; one_time: boolean; removed_at: Date | null }>(
      'select label, address, is_default, usable_from, app, one_time, removed_at from wallets where id = $1', [id],
    )).rows[0]!;

  it('renames an open wallet: trimmed, the label only; address, default and usableFrom unchanged; one alert', async () => {
    const { id, b } = await trader();
    const { wallet: first } = await addConfirmed(b);
    expect((await b.put(`/v1/wallets/${first.id}/default`, {})).statusCode).toBe(204);
    const { wallet: waiting } = await addConfirmed(b);
    const before = { first: await row(first.id), waiting: await row(waiting.id) };
    const res = await rename(b, first.id, { label: '  Cake Wallet savings  ' });
    expect(res.statusCode, res.body).toBe(204);
    expect((await rename(b, waiting.id, { label: 'Spending' })).statusCode).toBe(204);
    expect(await row(first.id)).toEqual({ ...before.first, label: 'Cake Wallet savings' });
    expect(await row(waiting.id)).toEqual({ ...before.waiting, label: 'Spending' });
    const listed = await list(b);
    // Both added at the same clock (listed by id then): compared without their order.
    expect(listed.map((w) => [w.id, w.label, w.address, w.isDefault, w.usable, w.usableFrom]).sort((x, y) => String(x[1]).localeCompare(String(y[1])))).toEqual([
      [first.id, 'Cake Wallet savings', first.address, true, true, first.usableFrom],
      [waiting.id, 'Spending', waiting.address, false, true, waiting.usableFrom],
    ]);
    const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
      "select detail from alerts where account_id = $1 and kind = 'wallet-renamed' order by created_at, id", [id],
    );
    // Both at the same clock: compared without their order.
    expect(rows.map((r) => r.detail).sort((x, y) => String(x.label).localeCompare(String(y.label)))).toEqual([
      { app: 'feather', from: 'Main', label: 'Cake Wallet savings', addressEnd: addressEnd(first.address) },
      { app: 'feather', from: 'Main', label: 'Spending', addressEnd: addressEnd(waiting.address) },
    ]);
    // The same name again changes nothing and records nothing.
    expect((await rename(b, first.id, { label: 'Cake Wallet savings' })).statusCode).toBe(204);
    expect((await deps.db.query("select 1 from alerts where account_id = $1 and kind = 'wallet-renamed'", [id])).rows).toHaveLength(2);
  });

  it("answers 404 for another account's, a removed, a used-up or a malformed wallet, and changes nothing", async () => {
    const one = await trader();
    const other = await trader();
    const { wallet: theirs } = await addConfirmed(other.b);
    const { wallet: mine } = await addConfirmed(one.b);
    expect((await rename(one.b, theirs.id, { label: 'Mine now' })).statusCode).toBe(404);
    expect((await rename(one.b, 'nope', { label: 'Mine now' })).statusCode).toBe(404);
    expect((await row(theirs.id)).label).toBe('Main');
    const { wallet: once } = await addConfirmed(one.b, fakeAddress(), { oneTime: true });
    await deps.db.query(`update wallets set removed_at = $2, used_by_trade = 'AAAA-BBBB-CCCC-DDDD' where id = $1`, [once.id, now]);
    expect((await rename(one.b, once.id, { label: 'Again' })).statusCode).toBe(404);
    expect((await one.b.delete(`/v1/wallets/${mine.id}`)).statusCode).toBe(204);
    expect((await rename(one.b, mine.id, { label: 'Again' })).statusCode).toBe(404);
    expect((await row(mine.id)).label).toBe('Main');
    expect((await row(once.id)).label).toBe('Main');
    expect((await deps.db.query("select 1 from alerts where kind = 'wallet-renamed' and account_id = any($1)", [[one.id, other.id]])).rows).toEqual([]);
    expect((await new Browser(app).put(`/v1/wallets/${theirs.id}/label`, { label: 'x' })).statusCode).toBe(401);
  });

  it('refuses a name outside the add\'s rule with 400 bad-request, and changes nothing', async () => {
    const { b } = await trader();
    const { wallet } = await addConfirmed(b);
    for (const body of [
      { label: '' }, { label: '   ' }, { label: 'x'.repeat(41) }, { label: 'a‮b' }, { label: 'a​b' }, { label: 'a\nb' },
      { label: 7 }, { label: null }, {}, { label: 'Fine', address: fakeAddress() }, { label: 'Fine', isDefault: true },
    ]) {
      const res = await rename(b, wallet.id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    // 40 characters (code points, as the add counts them) is fine.
    expect((await rename(b, wallet.id, { label: '🙂'.repeat(40) })).statusCode).toBe(204);
    expect((await row(wallet.id)).label).toBe('🙂'.repeat(40));
    // Names need not be unique on an account (the add never asked).
    const { wallet: second } = await addConfirmed(b);
    expect((await rename(b, second.id, { label: '🙂'.repeat(40) })).statusCode).toBe(204);
  });

  it('security review Medium 1: a name that could pass for a wallet detail is refused at rename, add and sign-up (400)', async () => {
    const { b } = await trader();
    const { wallet } = await addConfirmed(b);
    const spoofs = [
      'Savings …Rk3Fz1', 'Main · Cake Wallet', 'Main • Ready', 'Main.. x', 'Default', 'd3fault wallet', 'READY', 'Usable', 'In use',
      'Rk3Fz1', 'Wallet abc123x', 'S\u0430vings', '\u041Cy savings', 'Wallet \uA78F 2',
    ];
    for (const label of spoofs) {
      const res = await rename(b, wallet.id, { label });
      expect(res.statusCode, label).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect((await row(wallet.id)).label).toBe('Main');
    // The add (and so the sign-up's first wallet, the same route) refuses them before any confirm is spent.
    const address = fakeAddress();
    const token = await confirmToken(b, walletAction(address));
    for (const label of ['Default', 'Main · Cake Wallet', 'Rk3Fz1', 'S\u0430vings']) {
      const res = await addWallet(b, { address, label, confirmToken: token });
      expect(res.statusCode, label).toBe(400);
    }
    expect(await tokenUsed(token)).toBe(false);
    const onboarding = await trader({ firstSession: true });
    expect((await addWallet(onboarding.b, { address: fakeAddress(), label: 'Default' })).statusCode).toBe(400);
    // Ordinary names still pass.
    for (const label of ['Savings', 'Spending 2', 'Cake Wallet savings', 'Rent money', 'Monero GUI']) {
      expect((await rename(b, wallet.id, { label })).statusCode, label).toBe(204);
    }
  });

  it('verification review: a name spelling (a look-alike of) the end of any of the account\'s addresses is refused at rename, add and batch add', async () => {
    const { b } = await trader();
    const end = 'kfzxqm';
    const address = `${fakeAddress().slice(0, 89)}${end}`;
    const { wallet } = await addConfirmed(b, address);
    const tail = 'Rk3Fz1';
    const other = `${fakeAddress().slice(0, 89)}${tail}`;
    const { wallet: removed } = await addConfirmed(b, other);
    expect((await b.delete(`/v1/wallets/${removed.id}`)).statusCode).toBe(204);
    for (const label of [
      'Savings kfzxqm', 'KFZXQ', 'kfz-xqm', 'k f z x q', 'ｋｆｚｘｑｍ', '𝐤𝐟𝐳𝐱𝐪',
      // The removed wallet's end, and its base58-excluded and spaced look-alikes.
      'Rk3Fz', 'k3Fz1', 'Rk3 Fz1', 'Rk3Fz0', 'rk3fzl', '\uFF32\uFF4B\uFF13\uFF26\uFF5A\uFF11', '\u{1D411}\u{1D424}\u{1D7D1}\u{1D405}\u{1D433}\u{1D7CF}',
    ]) {
      const res = await rename(b, wallet.id, { label });
      expect(res.statusCode, label).toBe(400);
    }
    expect((await row(wallet.id)).label).toBe('Main');
    // The add: the name may not spell the end of the address being added, nor of another in the batch.
    const next = `${fakeAddress().slice(0, 89)}abcdeq`;
    const token = await confirmToken(b, walletAction(next));
    expect((await addWallet(b, { address: next, label: 'My abcde wallet', confirmToken: token })).statusCode).toBe(400);
    expect((await addWallet(b, { address: next, label: 'Savings kfzxqm', confirmToken: token })).statusCode).toBe(400);
    expect(await tokenUsed(token)).toBe(false);
    const x = `${fakeAddress().slice(0, 89)}qwertz`;
    const y = fakeAddress();
    const batchToken = await confirmToken(b, walletsActionOf([x, y]));
    const batch = await b.post('/v1/wallets', { wallets: [{ app: 'cake', label: 'Fine', address: x }, { app: 'cake', label: 'Savings qwert', address: y }], confirmToken: batchToken });
    expect(batch.statusCode).toBe(400);
    expect(await tokenUsed(batchToken)).toBe(false);
    // Ordinary names still pass.
    for (const label of ['Savings', 'Cake Wallet savings', 'Monero main', 'Spending 2', 'Wallet-2']) {
      expect((await rename(b, wallet.id, { label })).statusCode, label).toBe(204);
    }
  });

  it(`security review Medium 3: at most ${WALLET_RENAMES_PER_DAY} renames a day per account, then 429 slow-down; the next UTC day it works again`, async () => {
    const { id, b } = await trader();
    const { wallet } = await addConfirmed(b);
    const { wallet: other } = await addConfirmed(b);
    for (let i = 0; i < WALLET_RENAMES_PER_DAY; i++) {
      expect((await rename(b, i % 2 === 0 ? wallet.id : other.id, { label: `Name ${String.fromCharCode(97 + i)}` })).statusCode, String(i)).toBe(204);
    }
    // The same name again is no change and is not counted.
    expect((await rename(b, other.id, { label: (await row(other.id)).label })).statusCode).toBe(204);
    const res = await rename(b, wallet.id, { label: 'One more' });
    expect(res.statusCode).toBe(429);
    expect((res.json() as { error: string }).error).toBe('slow-down');
    expect((await row(wallet.id)).label).not.toBe('One more');
    expect((await deps.db.query("select 1 from alerts where account_id = $1 and kind = 'wallet-renamed'", [id])).rows).toHaveLength(WALLET_RENAMES_PER_DAY);
    const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1));
    setNow(nextDay);
    expect((await rename(await relogin(id), wallet.id, { label: 'One more' })).statusCode).toBe(204);
  });

  it('is refused like every wallet route: a staff session (wrong-account-kind), a banned account, stale Terms', async () => {
    const owner = await trader();
    const { wallet } = await addConfirmed(owner.b);
    // (The site owner's account is unique in the database: the "staff and owner" test above covers it.)
    const s = await trader({ kind: 'staff' });
    const res = await rename(s.b, wallet.id, { label: 'Savings' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong-account-kind' });
    await insertBan(deps, owner.id, 'site');
    const banned = await rename(owner.b, wallet.id, { label: 'Savings' });
    expect(banned.statusCode).toBe(403);
    expect((banned.json() as { error: string }).error).toBe('banned');
    await deps.db.query('update account_bans set lifted_at = $2, lifted_by = account_id where account_id = $1', [owner.id, now]);
    await deps.db.query("update accounts set terms_version = '2020-01-01' where id = $1", [owner.id]);
    const stale = await rename(owner.b, wallet.id, { label: 'Savings' });
    expect(stale.statusCode).toBe(403);
    expect((stale.json() as { error: string }).error).toBe('terms-required');
    expect((await row(wallet.id)).label).toBe('Main');
  });
});
