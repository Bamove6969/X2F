// Owner demo note #144 (23 Nov 2026, /setup/pgp-key): "Key accepted" only for a key whose
// encryption part (the one a login challenge is encrypted to) is active and strong, and a
// non-blocking heads-up when a User ID holds an email address. Real generated keys throughout.
import { beforeAll, describe, expect, test } from 'vitest';
import * as openpgp from 'openpgp';
import { STRICT_CONFIG, encryptChallenge, inspectPublicKey } from '@x2f/accounts';
import * as keys from './fixtures/keys.js';

const DAY = 86_400_000;
const real = Date.now();
// The server clock: an hour ahead, so keys made during the run are older than it.
const now = new Date(real + 3_600_000);

beforeAll(async () => {
  await keys.rsa4096();
}, 600_000);

const pub = async (k: openpgp.PrivateKey) => k.toPublic().armor();
type Options = Omit<Parameters<typeof openpgp.generateKey>[0], 'format' | 'userIDs'> & { userIDs?: openpgp.UserID[] };
const priv = async ({ userIDs = [{ name: 'T' }], ...o }: Options) => (await openpgp.generateKey({ ...o, userIDs, format: 'object' })).privateKey;

/** The fingerprint of the key part `encryptChallenge` encrypts to (STRICT_CONFIG). */
const usedPart = async (armored: string) =>
  (await (await openpgp.readKey({ armoredKey: armored })).getEncryptionKey(undefined, now, undefined, STRICT_CONFIG)).getFingerprint();

/** Encrypts a challenge to `armored` and decrypts it with `key`: the code really arrives. */
async function roundTrip(armored: string, key: openpgp.PrivateKey): Promise<string> {
  const signer = await openpgp.readPrivateKey({ armoredKey: (await keys.signing()).privateKey });
  const message = await encryptChallenge('X2F login code: ABCD-EFGH', [armored], signer, now);
  const { data } = await openpgp.decrypt({ message: await openpgp.readMessage({ armoredMessage: message }), decryptionKeys: key, date: now });
  return data as string;
}

describe('1. an active encryption-capable part is required', () => {
  test('a sign-only key is refused with key-no-encryption, saying why', async () => {
    const r = await inspectPublicKey(await pub(await priv({ type: 'ecc', curve: 'ed25519Legacy', subkeys: [] })), now);
    expect(r).toMatchObject({ ok: false, reason: 'key-no-encryption' });
    if (!r.ok) expect(r.detail).toBe('This key can only sign. X2F sends your login code encrypted to your key, so it needs an encryption subkey. Add one in your PGP app, then paste the key again.');
  });

  test('an expired encryption subkey (primary still valid) is refused with key-encryption-inactive', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(real - 2 * DAY), subkeys: [{ keyExpirationTime: 86_400 }] });
    const r = await inspectPublicKey(await pub(k), now);
    expect(r).toMatchObject({ ok: false, reason: 'key-encryption-inactive' });
    if (!r.ok) expect(r.detail).toContain('expired or been revoked');
  });

  test('a revoked encryption subkey is refused with key-encryption-inactive', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(real - DAY) });
    k.subkeys[0] = await k.subkeys[0]!.revoke(k.keyPacket as openpgp.SecretKeyPacket, undefined, new Date(real - 1000));
    expect(await inspectPublicKey(await pub(k), now)).toMatchObject({ ok: false, reason: 'key-encryption-inactive' });
  });
});

describe('2. the encryption part meets the same strength rule as the primary', () => {
  test('RSA 4096 primary with an RSA 2048 encryption subkey is refused key-weak, naming the subkey', async () => {
    const k = await priv({ type: 'rsa', rsaBits: 4096, subkeys: [{ type: 'rsa', rsaBits: 2048 }] });
    const r = await inspectPublicKey(await pub(k), now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toBe("This key's encryption subkey is RSA 2048, which is too short. X2F sends your login code encrypted to it, so it needs RSA 4096 or more, X25519 or X448.");
  }, 600_000);

  test('an Ed25519 primary with a NIST P-256 encryption subkey is refused key-weak', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', subkeys: [{ type: 'ecc', curve: 'nistP256' }] });
    const r = await inspectPublicKey(await pub(k), now);
    expect(r).toMatchObject({ ok: false, reason: 'key-weak' });
    if (!r.ok) expect(r.detail).toContain('does not accept for encryption');
  });

  test('a strong newest subkey beside an older weak one: accepted, and only the strong one is used', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(real - 2 * DAY), subkeys: [{ type: 'rsa', rsaBits: 2048 }] });
    const withStrong = await k.addSubkey({ type: 'ecc', curve: 'curve25519Legacy', date: new Date(real - DAY) });
    const armored = await pub(withStrong);
    expect(await inspectPublicKey(armored, now)).toMatchObject({ ok: true });
    const strong = withStrong.subkeys.find((s) => s.getAlgorithmInfo().algorithm === 'ecdh')!;
    expect(await usedPart(armored)).toBe(strong.getFingerprint());
    expect(await roundTrip(armored, withStrong)).toBe('X2F login code: ABCD-EFGH');
  }, 120_000);

  test('a weak newest subkey beside an older strong one: refused key-weak (it is the one PGP apps pick)', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(real - 2 * DAY) });
    const withWeak = await k.addSubkey({ type: 'rsa', rsaBits: 2048, date: new Date(real - DAY) });
    expect(await inspectPublicKey(await pub(withWeak), now)).toMatchObject({ ok: false, reason: 'key-weak' });
  }, 120_000);

  test('once the strong subkey expires, the older weak one is refused and never encrypted to', async () => {
    const k = await priv({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(real - 3 * DAY), subkeys: [{ type: 'rsa', rsaBits: 2048 }] });
    const withStrong = await k.addSubkey({ type: 'ecc', curve: 'curve25519Legacy', date: new Date(real - 2 * DAY), keyExpirationTime: 86_400 });
    const armored = await pub(withStrong);
    expect(await inspectPublicKey(armored, now)).toMatchObject({ ok: false, reason: 'key-weak' });
    await expect(roundTrip(armored, withStrong)).rejects.toThrow();
  }, 120_000);

  test('good keys are accepted: Ed25519 + X25519 (v4 and v6), Ed448 + X448, RSA 4096', async () => {
    const v4 = await priv({ type: 'ecc', curve: 'ed25519Legacy' });
    expect(v4.subkeys[0]!.getAlgorithmInfo()).toMatchObject({ algorithm: 'ecdh', curve: 'curve25519Legacy' });
    expect(await inspectPublicKey(await pub(v4), now)).toMatchObject({ ok: true, algorithm: 'ed25519' });
    expect(await roundTrip(await pub(v4), v4)).toBe('X2F login code: ABCD-EFGH');
    const v6 = await openpgp.readKey({ armoredKey: (await keys.v6Curve25519()).publicKey });
    expect(v6.subkeys[0]!.getAlgorithmInfo().algorithm).toBe('x25519');
    expect(await inspectPublicKey((await keys.v6Curve25519()).publicKey, now)).toMatchObject({ ok: true, algorithm: 'ed25519' });
    const x448 = await openpgp.readKey({ armoredKey: (await keys.curve448()).publicKey });
    expect(x448.subkeys[0]!.getAlgorithmInfo().algorithm).toBe('x448');
    expect(await inspectPublicKey((await keys.curve448()).publicKey, now)).toMatchObject({ ok: true, algorithm: 'ed448' });
    expect(await inspectPublicKey((await keys.rsa4096()).publicKey, now)).toMatchObject({ ok: true, algorithm: 'rsa', bits: 4096 });
  }, 120_000);
});

describe('3. an email address in a User ID: a heads-up, never a refusal', () => {
  test('hasEmail is true for an email in any User ID, and the key is still accepted', async () => {
    const one = await priv({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Alice', email: 'alice@example.com' }] });
    expect(await inspectPublicKey(await pub(one), now)).toMatchObject({ ok: true, hasEmail: true, name: 'Alice' });
    const second = await priv({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Alice' }, { name: 'Work', email: 'a@work.example' }] });
    expect(await inspectPublicKey(await pub(second), now)).toMatchObject({ ok: true, hasEmail: true });
  });

  test('hasEmail is false without one', async () => {
    expect(await inspectPublicKey(await pub(await priv({ type: 'ecc', curve: 'ed25519Legacy' })), now)).toMatchObject({ ok: true, hasEmail: false });
  });
});
