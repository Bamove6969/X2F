import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as openpgp from 'openpgp';
import {
  MAX_ARMORED_KEY_BYTES,
  MAX_SUBKEYS,
  PAST_REP_MIN_RSA_BITS,
  PAST_REP_VERIFY_CONFIG,
  PGP_PURPOSE,
  STRICT_CONFIG,
  challengeText,
  encryptChallenge,
  inspectPublicKey,
} from '@x2f/accounts';
import * as keys from './fixtures/keys.js';

vi.mock('openpgp', async (importOriginal) => {
  const orig = await importOriginal<typeof import('openpgp')>();
  return { ...orig, readKeys: vi.fn(orig.readKeys) };
});

// The server clock in most of these tests: an hour ahead, so keys generated
// during the run are older than `now` (see 'clock skew' for the opposite).
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

  test('RSA 2048 primary with a curve25519 subkey is weak, naming 2048', async () => {
    const k = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'T' }],
      subkeys: [{ type: 'ecc', curve: 'curve25519Legacy' }],
    });
    const r = await inspectPublicKey(k.publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toContain('2048');
  });

  test('an RSA 1024 encryption subkey is weak, not missing (openpgp would skip it by default)', async () => {
    const k = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'T' }],
      subkeys: [{ type: 'rsa', rsaBits: 1024 }],
      config: { minRSABits: 1024 },
    });
    const r = await inspectPublicKey(k.publicKey, now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toContain('1024');
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

describe('clock skew', () => {
  const real = new Date();
  const ahead = new Date(Math.floor(real.getTime() / 1000) * 1000 + 600_000);

  test('a key created after the server clock is not yet valid, checked before strength', async () => {
    for (const o of [
      { type: 'ecc', curve: 'ed25519Legacy' },
      { type: 'rsa', rsaBits: 2048 },
    ] as const) {
      const k = await openpgp.generateKey({ ...o, userIDs: [{ name: 'T' }], date: ahead });
      const r = await inspectPublicKey(k.publicKey, real);
      expect(r).toEqual({
        ok: false,
        reason: 'key-not-yet-valid',
        detail: `This key's creation time (${ahead.toISOString()}) is ahead of X2F's clock. Check your computer's clock, or try again after that time.`,
      });
    }
  });

  test('a subkey created after the server clock is not yet valid', async () => {
    const k = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'T' }],
      date: new Date(real.getTime() - 86_400_000),
      subkeys: [{ date: ahead }],
    });
    expect(await inspectPublicKey(k.publicKey, real)).toMatchObject({ ok: false, reason: 'key-not-yet-valid' });
  });

  test('the same key is accepted once the clock reaches its creation time', async () => {
    const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }], date: ahead });
    expect(await inspectPublicKey(k.publicKey, ahead)).toMatchObject({ ok: true });
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
      'team-join': 'join a team as a member',
      'staff-join': 'join the X2F staff',
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
    const armored = await encryptChallenge(text, [a.publicKey, b.publicKey], signingKey, now);
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
    const { data, signatures } = await openpgp.decrypt({
      message,
      decryptionKeys,
      verificationKeys,
      expectSigned: true,
      date: now,
    });
    expect(data).toBe(text);
    expect(signatures.length).toBe(1);
    expect(signatures[0]?.keyID.equals(signingKey.getKeyID())).toBe(true);
    await expect(signatures[0]?.verified).resolves.toBe(true);
  });

  test('fails closed instead of falling back to a weak subkey (strict config)', async () => {
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000 - 3 * 86_400_000);
    const k = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'T' }],
      date: t0,
      subkeys: [
        // Older, weak encryption subkey (ECDH on NIST P-256).
        { type: 'ecc', curve: 'nistP256', date: t0 },
        // Newer, strong subkey that expires after one day.
        { type: 'ecc', curve: 'curve25519Legacy', date: new Date(t0.getTime() + 3_600_000), keyExpirationTime: 86_400 },
      ],
    });
    const signingKey = await openpgp.readPrivateKey({ armoredKey: (await keys.oldSigning()).privateKey });
    const beforeExpiry = new Date(t0.getTime() + 2 * 3_600_000);
    // At registration time the strong subkey is the one in use.
    expect(await inspectPublicKey(k.publicKey, beforeExpiry)).toMatchObject({ ok: true });
    expect(await encryptChallenge(text, [k.publicKey], signingKey, beforeExpiry)).toContain('BEGIN PGP MESSAGE');
    // After it expires, only the weak subkey is left: refuse rather than use it.
    await expect(encryptChallenge(text, [k.publicKey], signingKey, now)).rejects.toThrow();
  });

  test('refuses an RSA 2048 recipient', async () => {
    const signingKey = await openpgp.readPrivateKey({ armoredKey: (await keys.oldSigning()).privateKey });
    await expect(encryptChallenge(text, [(await keys.rsa2048()).publicKey], signingKey, now)).rejects.toThrow();
  });

  test('uses the given clock: a recipient key created after `now` is refused', async () => {
    const signingKey = await openpgp.readPrivateKey({ armoredKey: (await keys.oldSigning()).privateKey });
    const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }] });
    await expect(encryptChallenge(text, [k.publicKey], signingKey, new Date(Date.now() - 86_400_000))).rejects.toThrow();
  });

  test('verifying with another Ed25519 key throws', async () => {
    const { a, armored } = await setup();
    const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: a.privateKey });
    const other = await openpgp.readKey({ armoredKey: (await keys.ed25519LegacyB()).publicKey });
    const message = await openpgp.readMessage({ armoredMessage: armored });
    await expect(
      openpgp.decrypt({ message, decryptionKeys, verificationKeys: other, expectSigned: true, date: now }),
    ).rejects.toThrow(/signing key/i);
  });
});

// Plan 5 Task 10 (P5-A22): past reputation accepts older signing keys; login's defaults stay.
describe('inspectPublicKey options (past reputation)', () => {
  const PAST = { minRsaBits: PAST_REP_MIN_RSA_BITS, requireEncryption: false };

  test('PAST_REP_MIN_RSA_BITS is 2048', () => {
    expect(PAST_REP_MIN_RSA_BITS).toBe(2048);
  });

  test('RSA 2048 passes with the past-reputation options and is still weak for login', async () => {
    const k = await keys.rsa2048();
    expect(await inspectPublicKey(k.publicKey, now, PAST)).toMatchObject({ ok: true, algorithm: 'rsa', bits: 2048 });
    expect(await inspectPublicKey(k.publicKey, now)).toMatchObject({ ok: false, reason: 'key-weak' });
    expect(await inspectPublicKey(k.publicKey, now, {})).toMatchObject({ ok: false, reason: 'key-weak' });
  });

  test('RSA 1024 is weak even for past reputation, and the detail names the 2048 minimum', async () => {
    const k = await openpgp.generateKey({ type: 'rsa', rsaBits: 1024, userIDs: [{ name: 'T' }], config: { minRSABits: 1024 } });
    const r = await inspectPublicKey(k.publicKey, now, PAST);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toContain('2048');
  });

  test('a signing-only Ed25519 key passes without an encryption subkey, and login still refuses it', async () => {
    const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }], subkeys: [] });
    expect(await inspectPublicKey(k.publicKey, now, PAST)).toMatchObject({ ok: true, algorithm: 'ed25519' });
    expect(await inspectPublicKey(k.publicKey, now)).toMatchObject({ ok: false, reason: 'key-no-encryption' });
  });

  test('NIST P-256 stays weak for past reputation', async () => {
    expect(await inspectPublicKey((await keys.nistP256()).publicKey, now, PAST)).toMatchObject({ ok: false, reason: 'key-weak' });
  });

  test('PAST_REP_VERIFY_CONFIG: RSA 2048 allowed, the login rejected algorithms kept', () => {
    expect(PAST_REP_VERIFY_CONFIG.minRSABits).toBe(2048);
    expect([...PAST_REP_VERIFY_CONFIG.rejectPublicKeyAlgorithms].sort()).toEqual([...STRICT_CONFIG.rejectPublicKeyAlgorithms].sort());
    expect([...PAST_REP_VERIFY_CONFIG.rejectCurves].sort()).toEqual([...STRICT_CONFIG.rejectCurves].sort());
    expect(STRICT_CONFIG.minRSABits).toBe(4096);
  });
});
