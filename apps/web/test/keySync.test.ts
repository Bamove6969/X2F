import { IDBFactory } from 'fake-indexeddb';
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';
import {
  KeySyncError, fromB64, newReaderKey, openPgpPaste, openPrfEnvelope, openTrade, pgpEnvelope, pgpEnvelopeText, prfEnvelope,
  restoreTrades, sealTrade, toB64, withKeySync, type KeySyncApi, type Reader, type TradeCopy, type UnlockEnvelope,
} from '../src/escrow/keySync.js';
import { openEscrowStore, type EscrowRecord } from '../src/escrow/store.js';

// Escrow-key sync (migration 860): the browser's end-to-end wrap and unwrap. The server (here a
// fake API) only ever sees ciphertext; each reader opens only with its own reader secret.

const CODE = 'AAAA-BBBB-CCCC-DDDD';
const MARK = 'party-state-marker-9e1c';

function record(code: string): EscrowRecord {
  return {
    v: 1,
    code,
    role: 'seller',
    identity: { signPublic: 'ab'.repeat(32), boxPublic: 'cd'.repeat(32), signSecret: new Uint8Array(64).fill(7), boxSecret: new Uint8Array(32).fill(8) },
    registered: true,
    attestation: null,
    partyState: { v: 1, session: { v: 1, keys: MARK, cache: 'c' }, guard: { trade: 'x', seen: {} }, seq: 3, step: 'msig.prepare:0', address: null, sent: {}, received: {}, release: null },
    signalGuard: null,
    signalSeq: 1,
    ownAddress: '4SellerRefund',
    theirAddress: null,
    deal: { poster: 'seller', takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n },
    theirDeal: null,
    sizeAtomic: 1_250_000_000_000n,
    paidSeen: false,
    termsAcked: false,
    intent: null,
  } as EscrowRecord;
}

const PASSWORD = 'f0'.repeat(32);
const asText = (b64: string): string => new TextDecoder('latin1').decode(fromB64(b64));

describe('trade copies: seal and open', () => {
  it('each reader opens the copy with its own key; the ciphertext holds none of the secrets in the clear', async () => {
    const holder = await newReaderKey();
    const member = await newReaderKey();
    const readers: Reader[] = [{ id: 'h', publicKey: holder.boxPublic }, { id: 'm', publicKey: member.boxPublic }];
    const copy = await sealTrade(CODE, 5, record(CODE), PASSWORD, readers);
    expect(asText(copy.ciphertext)).not.toContain(MARK);
    expect(asText(copy.ciphertext)).not.toContain(PASSWORD);
    for (const [pair, id] of [[holder, 'h'], [member, 'm']] as const) {
      const wrap = copy.wraps.find((w) => w.readerId === id)!.wrapped;
      expect(fromB64(wrap)).toHaveLength(80);
      const opened = await openTrade(CODE, 5, copy.ciphertext, wrap, pair);
      expect(opened.password).toBe(PASSWORD);
      expect(opened.record.sizeAtomic).toBe(1_250_000_000_000n);
      expect(opened.record.identity.signSecret).toEqual(new Uint8Array(64).fill(7));
      expect((opened.record.partyState as unknown as { session: { keys: string } }).session.keys).toBe(MARK);
    }
  });

  it('refuses another reader, another trade code, another version or a tampered copy', async () => {
    const holder = await newReaderKey();
    const stranger = await newReaderKey();
    const copy = await sealTrade(CODE, 5, record(CODE), PASSWORD, [{ id: 'h', publicKey: holder.boxPublic }]);
    const wrap = copy.wraps[0]!.wrapped;
    await expect(openTrade(CODE, 5, copy.ciphertext, wrap, stranger)).rejects.toThrow(KeySyncError);
    await expect(openTrade('EEEE-FFFF-GGGG-HHHH', 5, copy.ciphertext, wrap, holder)).rejects.toThrow(KeySyncError);
    await expect(openTrade(CODE, 4, copy.ciphertext, wrap, holder)).rejects.toThrow(KeySyncError);
    const bytes = fromB64(copy.ciphertext);
    bytes[bytes.length - 1]! ^= 1;
    await expect(openTrade(CODE, 5, toB64(bytes), wrap, holder)).rejects.toThrow(KeySyncError);
    // A wrap sealed for another copy (another content key) does not open this one.
    const other = await sealTrade(CODE, 5, record(CODE), PASSWORD, [{ id: 'h', publicKey: holder.boxPublic }]);
    await expect(openTrade(CODE, 5, copy.ciphertext, other.wraps[0]!.wrapped, holder)).rejects.toThrow(KeySyncError);
  });

  it('seals to nobody is refused (a copy no one could open)', async () => {
    await expect(sealTrade(CODE, 1, record(CODE), null, [])).rejects.toThrow(KeySyncError);
  });
});

describe('reader unlocks', () => {
  it('prf: the same PRF output opens the envelope; another output, or the envelope moved to another credential, does not', async () => {
    const reader = await newReaderKey();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const env = await prfEnvelope(reader, 'cred-1', salt, prf);
    expect(env).toMatchObject({ method: 'prf', ref: 'cred-1', salt: toB64(salt) });
    expect(asText(env.envelope)).not.toContain(new TextDecoder('latin1').decode(reader.boxSecret));
    const opened = await openPrfEnvelope(env, reader.boxPublic, prf);
    expect(opened.boxSecret).toEqual(reader.boxSecret);
    await expect(openPrfEnvelope(env, reader.boxPublic, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow(KeySyncError);
    await expect(openPrfEnvelope({ ...env, ref: 'cred-2' }, reader.boxPublic, prf)).rejects.toThrow(KeySyncError);
    // A server that names another public key gets nothing that opens.
    await expect(openPrfEnvelope(env, (await newReaderKey()).boxPublic, prf)).rejects.toThrow(KeySyncError);
  });

  it("pgp: encrypted to the person's own public key; their own decryption, pasted back, unlocks", async () => {
    const reader = await newReaderKey();
    const { privateKey, publicKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ name: 'Test' }], format: 'armored' });
    const env = await pgpEnvelope(reader, publicKey);
    expect(env.method).toBe('pgp');
    const armored = pgpEnvelopeText(env);
    expect(armored).toMatch(/^-----BEGIN PGP MESSAGE-----/);
    // The person's own tool (here openpgp with their private key, outside X2F).
    const { data } = await openpgp.decrypt({
      message: await openpgp.readMessage({ armoredMessage: armored }),
      decryptionKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }),
    });
    const opened = await openPgpPaste(String(data), reader.boxPublic);
    expect(opened.boxSecret).toEqual(reader.boxSecret);
    await expect(openPgpPaste('not a key', reader.boxPublic)).rejects.toThrow(KeySyncError);
    await expect(openPgpPaste('ab'.repeat(32), reader.boxPublic)).rejects.toThrow(KeySyncError);
  });

  it('there is no authenticator (TOTP) unlock: only prf and pgp envelopes exist, and neither opens as the other', async () => {
    const reader = await newReaderKey();
    const env: UnlockEnvelope = { method: 'totp' as never, ref: 'x', envelope: toB64(new Uint8Array(64)) };
    await expect(openPrfEnvelope(env, reader.boxPublic, new Uint8Array(32))).rejects.toThrow(KeySyncError);
    expect(() => pgpEnvelopeText(env)).toThrow(KeySyncError);
  });
});

/** An in-memory API that keeps exactly what the browser sends (the server's view). */
function fakeApi(readers: Reader[], me: string) {
  const copies = new Map<string, { version: number } & TradeCopy>();
  const api: KeySyncApi = {
    readers: async () => readers,
    async putTrade(code, body) {
      const had = copies.get(code)?.version ?? 0;
      if (body.version <= had) return { stale: had };
      copies.set(code, body);
      return { ok: true };
    },
    async deleteTrade(code) {
      copies.delete(code);
    },
    listTrades: async () => [...copies].filter(([, c]) => c.wraps.some((w) => w.readerId === me)).map(([code, c]) => ({ code, version: c.version })),
    async getTrade(code) {
      const c = copies.get(code);
      const w = c?.wraps.find((x) => x.readerId === me);
      return c && w ? { version: c.version, ciphertext: c.ciphertext, wrapped: w.wrapped } : null;
    },
    getReader: async () => null,
    putReader: async () => ({ id: me }),
  };
  return { api, copies };
}

describe('sync on write and restore on a new device', () => {
  it('a save uploads a sealed copy, a new device restores record and password after unlock, and a delete removes the copy', async () => {
    const reader = await newReaderKey();
    const { api, copies } = fakeApi([{ id: 'h', publicKey: reader.boxPublic }], 'h');
    const local = withKeySync(await openEscrowStore({ indexedDB: new IDBFactory() }), api);
    await local.save(record(CODE));
    const pw = await local.createPassword(CODE);
    await local.idle();
    const stored = copies.get(CODE)!;
    expect(stored.wraps.map((w) => w.readerId)).toEqual(['h']);
    expect(asText(stored.ciphertext)).not.toContain(pw);

    const fresh = await openEscrowStore({ indexedDB: new IDBFactory() });
    expect(await restoreTrades(fresh, api, reader)).toEqual([CODE]);
    expect((await fresh.load(CODE))?.partyState).toEqual(record(CODE).partyState);
    expect(await fresh.password(CODE)).toBe(pw);
    // Already there: not restored twice; a stranger's key restores nothing.
    expect(await restoreTrades(fresh, api, reader)).toEqual([]);
    expect(await restoreTrades(await openEscrowStore({ indexedDB: new IDBFactory() }), api, await newReaderKey())).toEqual([]);

    await local.delete(CODE);
    await local.idle();
    expect(copies.has(CODE)).toBe(false);
  });

  it('with no reader registered nothing is uploaded; a stale version is retried above the stored one', async () => {
    const none = fakeApi([], 'h');
    const a = withKeySync(await openEscrowStore({ indexedDB: new IDBFactory() }), none.api);
    await a.save(record(CODE));
    await a.idle();
    expect(none.copies.size).toBe(0);

    const reader = await newReaderKey();
    const some = fakeApi([{ id: 'h', publicKey: reader.boxPublic }], 'h');
    some.copies.set(CODE, { version: 10_000, ciphertext: 'x', wraps: [] });
    const b = withKeySync(await openEscrowStore({ indexedDB: new IDBFactory() }), some.api, { now: () => 5 });
    await b.save(record(CODE));
    await b.idle();
    expect(some.copies.get(CODE)!.version).toBe(10_001);
  });
});
