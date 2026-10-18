import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as openpgp from 'openpgp';
import {
  MAX_ARMORED_KEY_BYTES,
  MAX_SUBKEYS,
  PGP_PURPOSE,
  challengeText,
  encryptChallenge,
  inspectPublicKey,
} from '@x2f/accounts';
import * as keys from './fixtures/keys.js';

vi.mock('openpgp', async (importOriginal) => {
  const orig = await importOriginal<typeof import('openpgp')>();
  return { ...orig, readKeys: vi.fn(orig.readKeys) };
});

// The server clock in these tests: an hour ahead, so keys generated during
// the run are not newer than `now` (a key is not valid before its creation).
const now = new Date(Date.now() + 3_600_000);

beforeAll(async () => {
  await Promise.all([keys.rsa4096(), keys.rsa2048()]);
}, 600_000);

describe('limits', () => {
  test('constants', () => {
    expect(MAX_ARMORED_KEY_BYTES).toBe(32 * 1024);
    expect(MAX_SUBKEYS).toBe(8);
  });
});

describe('inspectPublicKey accepts', () => {
  test('Ed25519 (legacy)', async () => {
    const k = await keys.ed25519Legacy();
    const r = await inspectPublicKey(k.publicKey, now);
    expect(r).toMatchObject({ ok: true, algorithm: 'ed25519', bits: null, expiresAt: null });
    if (r.ok) {
      expect(r.fingerprint).toMatch(/^[0-9a-f]{40}$/);
      const parsed = await openpgp.readKey({ armoredKey: k.publicKey });
      expect(r.fingerprint).toBe(parsed.getFingerprint());
    }
  });

  test('v6 curve25519', async () => {
    const r = await inspectPublicKey((await keys.v6Curve25519()).publicKey, now);
    expect(r).toMatchObject({ ok: true, algorithm: 'ed25519', bits: null });
    if (r.ok) expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('curve448', async () => {
    const r = await inspectPublicKey((await keys.curve448()).publicKey, now);
    expect(r).toMatchObject({ ok: true, algorithm: 'ed448', bits: null });
    if (r.ok) expect(r.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  test('RSA 4096', async () => {
    const r = await inspectPublicKey((await keys.rsa4096()).publicKey, now);
    expect(r).toMatchObject({ ok: true, algorithm: 'rsa', bits: 4096 });
    if (r.ok) expect(r.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  test('reports a future expiry date', async () => {
    const k = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'T' }],
      keyExpirationTime: 86_400 * 30,
      date: now,
    });
    const r = await inspectPublicKey(k.publicKey, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expiresAt?.getTime()).toBe(Math.floor(now.getTime() / 1000) * 1000 + 86_400_000 * 30);
  });
});

describe('inspectPublicKey refuses', () => {
  test('RSA 2048 is weak, detail names 2048', async () => {
    const r = await inspectPublicKey((await keys.rsa2048()).publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toContain('2048');
  });

  test('NIST P-256 is weak', async () => {
    const r = await inspectPublicKey((await keys.nistP256()).publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
  });

  test('expired key, detail has the ISO date', async () => {
    const k = await keys.expired(now);
    const parsed = await openpgp.readKey({ armoredKey: k.publicKey });
    const exp = (await parsed.getExpirationTime()) as Date;
    const r = await inspectPublicKey(k.publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-expired' });
    if (!r.ok) {
      expect(r.detail).toContain(exp.toISOString().slice(0, 10));
      expect(r.detail).toBe(`This key expired on ${exp.toISOString().slice(0, 10)}.`);
    }
  });

  test('expired exactly at now', async () => {
    const k = await keys.expired(now);
    const parsed = await openpgp.readKey({ armoredKey: k.publicKey });
    const exp = (await parsed.getExpirationTime()) as Date;
    expect(await inspectPublicKey(k.publicKey, exp)).toMatchObject({ ok: false, reason: 'key-expired' });
    // One second earlier the key was still valid.
    expect(await inspectPublicKey(k.publicKey, new Date(exp.getTime() - 1000))).toMatchObject({ ok: true });
  });

  test('revoked key', async () => {
    const r = await inspectPublicKey((await keys.revoked()).publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-revoked' });
  });

  test('private key', async () => {
    const r = await inspectPublicKey((await keys.ed25519Legacy()).privateKey, now);
    expect(r).toEqual({
      ok: false,
      reason: 'key-private',
      detail: 'This is a private key. Paste your public key; never share the private one.',
    });
  });

  test('two keys in one armored block', async () => {
    const a = await openpgp.readKey({ armoredKey: (await keys.ed25519Legacy()).publicKey });
    const b = await openpgp.readKey({ armoredKey: (await keys.ed25519LegacyB()).publicKey });
    const aw = a.write();
    const bw = b.write();
    const both = new Uint8Array(aw.length + bw.length);
    both.set(aw, 0);
    both.set(bw, aw.length);
    const armored = openpgp.armor(openpgp.enums.armor.publicKey, both);
    expect(await inspectPublicKey(armored, now)).toMatchObject({ ok: false, reason: 'key-multiple' });
  });

  test('two armored blocks pasted one after the other', async () => {
    const text = (await keys.ed25519Legacy()).publicKey + '\n' + (await keys.ed25519LegacyB()).publicKey;
    expect(await inspectPublicKey(text, now)).toMatchObject({ ok: false, reason: 'key-multiple' });
  });

  test('garbage is unreadable', async () => {
    expect(await inspectPublicKey('hello', now)).toMatchObject({ ok: false, reason: 'key-unreadable' });
  });

  test('over 32 KiB is too large without parsing', async () => {
    const readKeys = vi.mocked(openpgp.readKeys);
    readKeys.mockClear();
    const big = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' + 'A'.repeat(33 * 1024) + '\n-----END PGP PUBLIC KEY BLOCK-----\n';
    expect(await inspectPublicKey(big, now)).toMatchObject({ ok: false, reason: 'key-too-large' });
    expect(readKeys).not.toHaveBeenCalled();
  });

  test('size counts UTF-8 bytes, not characters', async () => {
    const readKeys = vi.mocked(openpgp.readKeys);
    readKeys.mockClear();
    // 11,000 three-byte characters: 33,000 bytes but 11,000 UTF-16 units.
    expect(await inspectPublicKey('€'.repeat(11_000), now)).toMatchObject({ ok: false, reason: 'key-too-large' });
    expect(readKeys).not.toHaveBeenCalled();
  });

  test('nine subkeys is too large', async () => {
    const r = await inspectPublicKey((await keys.nineSubkeys()).publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-too-large' });
  });

  test('a signing-only key has no encryption key', async () => {
    const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }], subkeys: [] });
    expect(await inspectPublicKey(k.publicKey, now)).toMatchObject({ ok: false, reason: 'key-no-encryption' });
  });

  test('a strong primary with a weak encryption subkey is weak', async () => {
    const k = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'T' }],
      subkeys: [{ type: 'ecc', curve: 'nistP256' }],
    });
    expect(await inspectPublicKey(k.publicKey, now)).toMatchObject({ ok: false, reason: 'key-weak' });
  });
});

describe('challengeText', () => {
  test('exact six lines', () => {
    const text = challengeText({
      code: 'K7M2-9QXA-4FTR',
      siteName: 'X2F',
      siteHost: 'x2f.example',
      issuedAt: new Date('2026-10-17T12:00:00.123Z'),
      expiresAt: new Date('2026-10-17T12:05:00.123Z'),
      purpose: 'log in',
    });
    expect(text).toBe(
      [
        'X2F login code: K7M2-9QXA-4FTR',
        'Site: X2F (x2f.example)',
        'Purpose: log in',
        'Time: 2026-10-17T12:00:00Z',
        'Expires: 2026-10-17T12:05:00Z',
        'Only paste this code into x2f.example. If you did not just ask for it, ignore it.',
      ].join('\n'),
    );
  });

  test('PGP_PURPOSE wording', () => {
    expect(PGP_PURPOSE).toEqual({
      register: 'create your account',
      login: 'log in',
      'add-key': 'add this PGP key to your account',
    });
  });
});

describe('encryptChallenge', () => {
  const text = challengeText({
    code: 'K7M2-9QXA-4FTR',
    siteName: 'X2F',
    siteHost: 'x2f.example',
    issuedAt: new Date('2026-10-17T12:00:00Z'),
    expiresAt: new Date('2026-10-17T12:05:00Z'),
    purpose: PGP_PURPOSE.login,
  });

  async function setup() {
    const a = await keys.ed25519Legacy();
    const b = await keys.rsa4096();
    const s = await keys.signing();
    const signingKey = await openpgp.readPrivateKey({ armoredKey: s.privateKey });
    const armored = await encryptChallenge(text, [a.publicKey, b.publicKey], signingKey);
    return { a, b, s, signingKey, armored };
  }

  test('decrypts with either private key', async () => {
    const { a, b, armored } = await setup();
    for (const pair of [a, b]) {
      const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: pair.privateKey });
      const message = await openpgp.readMessage({ armoredMessage: armored });
      const { data } = await openpgp.decrypt({ message, decryptionKeys });
      expect(data).toBe(text);
    }
  });

  test('every PKESK key ID is the wildcard (zero)', async () => {
    const { armored } = await setup();
    const message = await openpgp.readMessage({ armoredMessage: armored });
    const pkesks = message.packets.filterByTag(openpgp.enums.packet.publicKeyEncryptedSessionKey);
    expect(pkesks.length).toBe(2);
    for (const p of pkesks) {
      const id = (p as unknown as { publicKeyID: openpgp.KeyID & { isWildcard(): boolean } }).publicKeyID;
      expect(id.isWildcard()).toBe(true);
      expect(id.toHex()).toBe('0000000000000000');
    }
    expect(message.getEncryptionKeyIDs().every((k) => k.toHex() === '0000000000000000')).toBe(true);
  });

  test('signed by the X2F signing key (R7)', async () => {
    const { a, s, signingKey, armored } = await setup();
    const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: a.privateKey });
    const verificationKeys = await openpgp.readKey({ armoredKey: s.publicKey });
    const message = await openpgp.readMessage({ armoredMessage: armored });
    const { data, signatures } = await openpgp.decrypt({ message, decryptionKeys, verificationKeys, expectSigned: true });
    expect(data).toBe(text);
    expect(signatures.length).toBe(1);
    expect(signatures[0]?.keyID.equals(signingKey.getKeyID())).toBe(true);
    await expect(signatures[0]?.verified).resolves.toBe(true);
  });

  test('verifying with another Ed25519 key throws', async () => {
    const { a, armored } = await setup();
    const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: a.privateKey });
    const other = await openpgp.readKey({ armoredKey: (await keys.ed25519LegacyB()).publicKey });
    const message = await openpgp.readMessage({ armoredMessage: armored });
    await expect(
      openpgp.decrypt({ message, decryptionKeys, verificationKeys: other, expectSigned: true }),
    ).rejects.toThrow();
  });
});
