import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { sealKey } from '../src/auth/pgp.js';
import { ESCROW_SYNC_ROUTES } from '../src/escrowSync/routes.js';
import { ESCROW_COPY_KEEP_AFTER_CLOSE_MS, purgeEscrowBlobs } from '../src/escrowSync/store.js';
import { rolesToAbilities, sortAbilities } from '../src/team/abilities.js';
import { addUnusedKeys, makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { Browser } from './helpers/totp.js';
import { seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Escrow-key sync (migration 860, escrowSync/routes.ts): the API keeps ciphertext only, for the
// account holder and the members the holder assigned ("Hold trade keys"). Real Postgres, one
// database for the file (helpers/db.ts copies the template per file).

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { db: await testDb({ max: 4 }) }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;
const b64 = (len: number): string => randomBytes(len).toString('base64url');
const hexKey = (): string => randomBytes(32).toString('hex');
const err = (r: { statusCode: number; json(): unknown }) => ({ status: r.statusCode, error: (r.json() as { error: string }).error });

async function team(): Promise<Who> {
  const t = await trader();
  await makeVendor(deps, t.id);
  return t;
}

async function member(teamId: string, abilities: string[]): Promise<{ id: string; browser: Browser }> {
  const name = `Keyholder${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `klogin${n}x`, tradeTag: `k-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  expect((await browser.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
  return { id: rows[0]!.id, browser };
}

const prfUnlock = () => ({ method: 'prf', ref: b64(16), salt: b64(32), envelope: b64(92) });
const pgpUnlock = () => ({ method: 'pgp', ref: 'A'.repeat(40), envelope: b64(400) });

async function register(b: Browser, publicKey = hexKey(), unlocks: unknown[] = [prfUnlock()]): Promise<string> {
  const res = await b.put('/v1/escrow-keys/reader', { publicKey, unlocks });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: string }).id;
}

async function tradeOf(seller: Who): Promise<string> {
  const buyer = await trader();
  return (await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' })).code;
}

describe('escrow-key sync routes', () => {
  it('registers all eight routes', () => {
    for (const r of ESCROW_SYNC_ROUTES) {
      const [method, url] = r.split(' ') as ['GET' | 'PUT' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
    }
  });

  it('the holder stores a copy, reads it back byte for byte, lists it, and deletes it; the API holds only what was posted', async () => {
    const holder = await team();
    const readerId = await register(holder.browser);
    const readers = (await holder.browser.get('/v1/escrow-keys/readers')).json() as { readers: { id: string; memberId: string | null }[] };
    expect(readers.readers).toEqual([expect.objectContaining({ id: readerId, memberId: null })]);
    const code = await tradeOf(holder);
    const ciphertext = b64(500);
    const wrapped = b64(80);
    const put = await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext, wraps: [{ readerId, wrapped }] });
    expect(put.statusCode, put.body).toBe(200);
    const got = (await holder.browser.get(`/v1/escrow-keys/trades/${code}`)).json() as { ciphertext: string; wrapped: string; version: number };
    expect(got).toMatchObject({ ciphertext, wrapped, version: 1 });
    expect(((await holder.browser.get('/v1/escrow-keys/trades')).json() as { trades: { code: string }[] }).trades.map((t) => t.code)).toEqual([code]);
    // An older or equal version is refused (no rollback by a stale tab).
    expect(err(await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext, wraps: [{ readerId, wrapped }] }))).toEqual({ status: 409, error: 'stale-version' });
    expect((await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 2, ciphertext: b64(600), wraps: [{ readerId, wrapped }] })).statusCode).toBe(200);
    expect((await holder.browser.delete(`/v1/escrow-keys/trades/${code}`)).statusCode).toBe(204);
    expect((await holder.browser.get(`/v1/escrow-keys/trades/${code}`)).statusCode).toBe(404);
    expect((await holder.browser.delete(`/v1/escrow-keys/trades/${code}`)).statusCode).toBe(204);
  });

  it("only the holder's own trades, always with the holder's own wrap, and only to readers the holder assigned", async () => {
    const holder = await team();
    const readerId = await register(holder.browser);
    const code = await tradeOf(holder);
    // Someone else's trade: 404.
    const other = await team();
    await register(other.browser);
    const theirs = await tradeOf(other);
    expect(err(await holder.browser.put(`/v1/escrow-keys/trades/${theirs}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId, wrapped: b64(80) }] }))).toEqual({ status: 404, error: 'not-found' });
    // A member who registered a reader key but holds no "Hold trade keys" box cannot even register.
    const plain = await member(holder.id, rolesToAbilities(['trades']));
    expect(err(await plain.browser.put('/v1/escrow-keys/reader', { publicKey: hexKey(), unlocks: [prfUnlock()] }))).toEqual({ status: 403, error: 'forbidden' });
    // An unassigned reader (another account's) is refused; so is a copy without the holder's own wrap.
    const otherReader = ((await other.browser.get('/v1/escrow-keys/reader')).json() as { id: string }).id;
    expect(err(await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId, wrapped: b64(80) }, { readerId: otherReader, wrapped: b64(80) }] })))
      .toEqual({ status: 400, error: 'reader-not-assigned' });
    const assigned = await member(holder.id, sortAbilities([...rolesToAbilities(['trades']), 'trades-escrow-keys']));
    const memberReader = await register(assigned.browser);
    expect(err(await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId: memberReader, wrapped: b64(80) }] })))
      .toEqual({ status: 400, error: 'holder-wrap-missing' });
    // Members never write or delete a copy.
    expect(err(await assigned.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId: memberReader, wrapped: b64(80) }] })))
      .toEqual({ status: 403, error: 'owner-only' });
    expect(err(await assigned.browser.delete(`/v1/escrow-keys/trades/${code}`))).toEqual({ status: 403, error: 'owner-only' });
    expect(err(await assigned.browser.get('/v1/escrow-keys/readers'))).toEqual({ status: 403, error: 'owner-only' });
  });

  it('an assigned member reads only its own wrap; unticking the box or removing the member takes the copies away', async () => {
    const holder = await team();
    const holderReader = await register(holder.browser);
    const abilities = sortAbilities([...rolesToAbilities(['trades']), 'trades-escrow-keys']);
    const m = await member(holder.id, abilities);
    const memberReader = await register(m.browser, hexKey(), [prfUnlock(), pgpUnlock()]);
    const readers = (await holder.browser.get('/v1/escrow-keys/readers')).json() as { readers: { id: string; memberId: string | null }[] };
    expect(readers.readers.map((r) => [r.id, r.memberId])).toEqual([[holderReader, null], [memberReader, m.id]]);
    const code = await tradeOf(holder);
    const holderWrap = b64(80);
    const memberWrap = b64(80);
    const ciphertext = b64(300);
    expect((await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext, wraps: [{ readerId: holderReader, wrapped: holderWrap }, { readerId: memberReader, wrapped: memberWrap }] })).statusCode).toBe(200);
    const got = (await m.browser.get(`/v1/escrow-keys/trades/${code}`)).json() as { ciphertext: string; wrapped: string };
    expect(got).toMatchObject({ ciphertext, wrapped: memberWrap });
    expect(JSON.stringify(got)).not.toContain(holderWrap);
    const mine = (await m.browser.get('/v1/escrow-keys/reader')).json() as { unlocks: { method: string }[] };
    expect(mine.unlocks.map((u) => u.method)).toEqual(['prf', 'pgp']);

    // Unticking "Hold trade keys" (the lead's confirmed PATCH) deletes the member's wraps and refuses the read.
    const { rows } = await deps.db.query<{ id: string }>("select id from sessions where account_id = $1 and member_id is null and revoked_at is null order by created_at desc limit 1", [holder.id]);
    const without = rolesToAbilities(['trades']);
    const confirmToken = await issueConfirmToken(deps, { sessionId: rows[0]!.id, accountId: holder.id, action: { kind: 'team-abilities', memberId: m.id, abilities: without.join(',') }, method: 'passkey' });
    const patched = await holder.browser.patch(`/v1/team/members/${m.id}`, { abilities: without, confirmToken });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(err(await m.browser.get(`/v1/escrow-keys/trades/${code}`))).toEqual({ status: 403, error: 'forbidden' });
    const left = await deps.db.query('select reader_id from escrow_blob_wraps where account_id = $1 and trade_code = $2', [holder.id, code]);
    expect(left.rows).toEqual([{ reader_id: holderReader }]);
    // No longer a reader the holder may seal to.
    expect(err(await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 2, ciphertext, wraps: [{ readerId: holderReader, wrapped: holderWrap }, { readerId: memberReader, wrapped: memberWrap }] })))
      .toEqual({ status: 400, error: 'reader-not-assigned' });
  });

  it('a new reader key drops what was sealed to the old one', async () => {
    const holder = await team();
    const id = await register(holder.browser);
    const code = await tradeOf(holder);
    expect((await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId: id, wrapped: b64(80) }] })).statusCode).toBe(200);
    expect(await register(holder.browser)).toBe(id);
    expect((await holder.browser.get(`/v1/escrow-keys/trades/${code}`)).statusCode).toBe(404);
  });

  it('an authenticator (TOTP) code, a password or any other way never unlocks: only prf and pgp', async () => {
    const holder = await team();
    for (const method of ['totp', 'password', 'recovery-code', 'sms']) {
      expect(err(await holder.browser.put('/v1/escrow-keys/reader', { publicKey: hexKey(), unlocks: [{ method, ref: 'x', envelope: b64(64) }] }))).toEqual({ status: 400, error: 'unlock-method-not-allowed' });
    }
    // The database refuses one too, whatever wrote it.
    const id = await register(holder.browser);
    await expect(deps.db.query("insert into escrow_reader_unlocks (reader_id, method, ref, envelope, created_at, position) values ($1, 'totp', 'x', $2, now(), 5)", [id, randomBytes(64)])).rejects.toThrow();
    // A prf unlock needs its salt; a pgp one has none.
    expect(err(await holder.browser.put('/v1/escrow-keys/reader', { publicKey: hexKey(), unlocks: [{ method: 'prf', ref: 'x', envelope: b64(64) }] }))).toEqual({ status: 400, error: 'bad-request' });
    expect(err(await holder.browser.put('/v1/escrow-keys/reader', { publicKey: hexKey(), unlocks: [{ method: 'pgp', ref: 'x', salt: b64(32), envelope: b64(64) }] }))).toEqual({ status: 400, error: 'bad-request' });
  });

  it('retention deletes a copy whose trade closed longer ago than the device keeps it, or is gone', async () => {
    const holder = await team();
    const readerId = await register(holder.browser);
    const open = await tradeOf(holder);
    const closed = await tradeOf(holder);
    for (const code of [open, closed]) {
      expect((await holder.browser.put(`/v1/escrow-keys/trades/${code}`, { version: 1, ciphertext: b64(100), wraps: [{ readerId, wrapped: b64(80) }] })).statusCode).toBe(200);
    }
    const now = deps.clock();
    await deps.db.query('update trades set closed_at = $2 where code = $1', [closed, new Date(now.getTime() - ESCROW_COPY_KEEP_AFTER_CLOSE_MS - 1000)]);
    await deps.db.query("insert into escrow_blobs (account_id, trade_code, ciphertext, version, updated_at) values ($1, 'GONE-TRADE', $2, 1, now())", [holder.id, randomBytes(64)]);
    await purgeEscrowBlobs.run(deps.db, now);
    const { rows } = await deps.db.query<{ trade_code: string }>('select trade_code from escrow_blobs where account_id = $1', [holder.id]);
    expect(rows.map((r) => r.trade_code)).toEqual([open]);
  });

  it("unlock-methods lists the person's own passkeys, security keys and PGP public keys, never an authenticator app", async () => {
    const holder = await team();
    await addUnusedKeys(deps, holder.id);
    const fingerprint = randomBytes(20).toString('hex');
    const armored = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nplaceholder\n-----END PGP PUBLIC KEY BLOCK-----\n';
    await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [holder.id, fingerprint, sealKey(deps.config, armored, fingerprint), deps.clock()]);
    const res = await holder.browser.get('/v1/escrow-keys/unlock-methods');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { keys: { kind: string; label: string; credentialId: string }[]; pgp: { fingerprint: string; label: string; publicKey: string }[] };
    const { rows } = await deps.db.query<{ kind: string; credential_id: Buffer }>('select kind, credential_id from webauthn_credentials where account_id = $1 order by created_at, id', [holder.id]);
    expect(body.keys.map((k) => [k.kind, k.credentialId]).sort()).toEqual(rows.map((r) => [r.kind, r.credential_id.toString('base64url')]).sort());
    expect(body.pgp).toEqual([{ fingerprint: fingerprint.toUpperCase(), label: fingerprint.slice(-16), publicKey: armored }]);
    expect(Object.keys(body).sort()).toEqual(['keys', 'pgp']);
    // A member's are their own login's; a member without "Hold trade keys" is refused.
    const plain = await member(holder.id, rolesToAbilities(['trades']));
    expect(err(await plain.browser.get('/v1/escrow-keys/unlock-methods'))).toEqual({ status: 403, error: 'forbidden' });
    const assigned = await member(holder.id, sortAbilities([...rolesToAbilities(['trades']), 'trades-escrow-keys']));
    const theirs = (await assigned.browser.get('/v1/escrow-keys/unlock-methods')).json() as { keys: unknown[]; pgp: unknown[] };
    expect(theirs.pgp).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain(fingerprint.toUpperCase());
  });
});
