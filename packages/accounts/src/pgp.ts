/**
 * PGP public-key inspection, the login-challenge text, and challenge
 * encryption (wildcard recipients, signed with the official X2F key).
 *
 * No function here creates, accepts or returns a user's private key.
 */
import * as openpgp from 'openpgp';

export type KeyRefusal =
  | 'key-unreadable'
  | 'key-too-large'
  | 'key-private'
  | 'key-multiple'
  | 'key-weak'
  | 'key-expired'
  | 'key-revoked'
  | 'key-no-encryption'
  | 'key-not-yet-valid';

export type KeyInspection =
  | { ok: true; fingerprint: string; algorithm: 'rsa' | 'ed25519' | 'ed448'; bits: number | null; expiresAt: Date | null }
  | { ok: false; reason: KeyRefusal; detail: string };

export const MAX_ARMORED_KEY_BYTES = 32 * 1024;
export const MAX_SUBKEYS = 8;
const MIN_RSA_BITS = 4096;

const { enums } = openpgp;

/**
 * openpgp 6.3.2's defaults written out, so our configs never depend on the
 * mutable global `openpgp.config`. Only the key-strength fields differ below.
 */
const BASE_CONFIG: openpgp.Config = Object.freeze({
  preferredHashAlgorithm: enums.hash.sha512,
  preferredSymmetricAlgorithm: enums.symmetric.aes256,
  preferredCompressionAlgorithm: enums.compression.uncompressed,
  showVersion: false,
  showComment: false,
  aeadProtect: false,
  parseAEADEncryptedV4KeysAsLegacy: false,
  allowUnauthenticatedMessages: false,
  allowUnauthenticatedStream: false,
  minRSABits: 2047,
  passwordCollisionCheck: false,
  ignoreUnsupportedPackets: true,
  ignoreMalformedPackets: false,
  enforceGrammar: true,
  additionalAllowedPackets: [],
  versionString: '',
  commentString: '',
  allowInsecureDecryptionWithSigningKeys: false,
  allowInsecureVerificationWithReformattedKeys: false,
  allowMissingKeyFlags: false,
  constantTimePKCS1Decryption: false,
  constantTimePKCS1DecryptionSupportedSymmetricAlgorithms: new Set([
    enums.symmetric.aes128,
    enums.symmetric.aes192,
    enums.symmetric.aes256,
  ]),
  v6Keys: false,
  enableParsingV5Entities: false,
  preferredAEADAlgorithm: enums.aead.gcm,
  aeadChunkSizeByte: 12,
  s2kType: enums.s2k.iterated,
  s2kIterationCountByte: 224,
  s2kArgon2Params: { passes: 3, parallelism: 4, memoryExponent: 16 },
  maxArgon2MemoryExponent: 30,
  maxUserIDLength: 5120,
  maxDecompressedMessageSize: Infinity,
  knownNotations: [],
  nonDeterministicSignaturesViaNotation: true,
  useEllipticFallback: true,
  rejectHashAlgorithms: new Set([enums.hash.md5, enums.hash.ripemd]),
  rejectMessageHashAlgorithms: new Set([enums.hash.md5, enums.hash.ripemd, enums.hash.sha1]),
  rejectPublicKeyAlgorithms: new Set([enums.publicKey.elgamal, enums.publicKey.dsa]),
  rejectCurves: new Set([enums.curve.secp256k1]),
});

/**
 * Used to encrypt challenges: openpgp itself refuses any key part outside
 * what X2F accepts (RSA ≥ 4096, Ed25519/Ed448 in either encoding, ECDH on
 * Curve25519, X25519, X448), so a key whose only usable encryption subkey is
 * weak fails closed instead of being used.
 */
const STRICT_CONFIG: openpgp.Config = Object.freeze({
  ...BASE_CONFIG,
  minRSABits: MIN_RSA_BITS,
  rejectPublicKeyAlgorithms: new Set([
    enums.publicKey.elgamal,
    enums.publicKey.dsa,
    enums.publicKey.ecdsa,
    enums.publicKey.aedh,
    enums.publicKey.aedsa,
  ]),
  rejectCurves: new Set([
    enums.curve.nistP256,
    enums.curve.nistP384,
    enums.curve.nistP521,
    enums.curve.secp256k1,
    enums.curve.brainpoolP256r1,
    enums.curve.brainpoolP384r1,
    enums.curve.brainpoolP512r1,
  ]),
});

/**
 * Loosened config used only to *find* the encryption key, so a weak one is
 * reported as `key-weak` instead of being skipped. Our own algorithm checks
 * run on whatever comes back.
 */
const FIND_CONFIG: openpgp.Config = Object.freeze({
  ...BASE_CONFIG,
  minRSABits: 0,
  rejectPublicKeyAlgorithms: new Set<openpgp.enums.publicKey>(),
  rejectCurves: new Set<openpgp.enums.curve>(),
});

const refuse = (reason: KeyRefusal, detail: string): KeyInspection => ({ ok: false, reason, detail });

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

type PrimaryAlg = { ok: true; algorithm: 'rsa' | 'ed25519' | 'ed448'; bits: number | null } | { ok: false; detail: string };

function isRsa(name: string): boolean {
  return name === 'rsaEncryptSign' || name === 'rsaEncrypt' || name === 'rsaSign';
}

function rsaTooShort(bits: number | undefined): string {
  return `RSA ${bits ?? 'unknown'}-bit keys are too short; X2F needs ${MIN_RSA_BITS} or more.`;
}

const UNSUPPORTED = 'This key type is not supported; X2F accepts RSA 4096 or more, Ed25519 and Ed448.';

function checkPrimary(info: openpgp.AlgorithmInfo): PrimaryAlg {
  const { algorithm, bits, curve } = info;
  if (algorithm === 'rsaEncryptSign' || algorithm === 'rsaSign') {
    if (bits === undefined || bits < MIN_RSA_BITS) return { ok: false, detail: rsaTooShort(bits) };
    return { ok: true, algorithm: 'rsa', bits };
  }
  if (algorithm === 'eddsaLegacy' && curve === 'ed25519Legacy') return { ok: true, algorithm: 'ed25519', bits: null };
  if (algorithm === 'ed25519') return { ok: true, algorithm: 'ed25519', bits: null };
  if (algorithm === 'ed448') return { ok: true, algorithm: 'ed448', bits: null };
  return { ok: false, detail: UNSUPPORTED };
}

function checkEncryption(info: openpgp.AlgorithmInfo): string | null {
  const { algorithm, bits, curve } = info;
  if (isRsa(algorithm)) return bits !== undefined && bits >= MIN_RSA_BITS ? null : rsaTooShort(bits);
  if (algorithm === 'ecdh' && curve === 'curve25519Legacy') return null;
  if (algorithm === 'x25519' || algorithm === 'x448') return null;
  return 'The encryption part of this key uses a type X2F does not accept; it needs RSA 4096 or more, X25519 or X448.';
}

/**
 * Check a pasted public key. The size limit is checked on UTF-8 bytes before
 * any parsing. `now` is the server clock.
 */
export async function inspectPublicKey(armored: string, now: Date): Promise<KeyInspection> {
  if (typeof armored !== 'string') return refuse('key-unreadable', 'This does not look like a PGP public key.');
  if (new TextEncoder().encode(armored).length > MAX_ARMORED_KEY_BYTES) {
    return refuse('key-too-large', 'This key is too large; X2F accepts keys up to 32 KiB.');
  }
  // openpgp reads only the first armored block; a second pasted block is
  // refused rather than silently ignored.
  if ((armored.match(/-----BEGIN PGP /g) ?? []).length > 1) {
    return refuse('key-multiple', 'This contains more than one key. Paste a single public key.');
  }

  let parsed: openpgp.Key[];
  try {
    parsed = await openpgp.readKeys({ armoredKeys: armored, config: BASE_CONFIG });
  } catch {
    return refuse('key-unreadable', 'This does not look like a PGP public key.');
  }
  if (parsed.length !== 1) {
    return parsed.length === 0
      ? refuse('key-unreadable', 'This does not look like a PGP public key.')
      : refuse('key-multiple', 'This contains more than one key. Paste a single public key.');
  }
  const key = parsed[0] as openpgp.Key;
  if (key.getSubkeys().length > MAX_SUBKEYS) {
    return refuse('key-too-large', `This key has too many subkeys; X2F accepts up to ${MAX_SUBKEYS}.`);
  }
  if (key.isPrivate()) {
    return refuse('key-private', 'This is a private key. Paste your public key; never share the private one.');
  }

  // A key (or subkey) made on a computer whose clock runs ahead of ours is
  // not valid yet; say so plainly rather than as a misleading later refusal.
  const created = Math.max(key.getCreationTime().getTime(), ...key.getSubkeys().map((s) => s.getCreationTime().getTime()));
  if (created > now.getTime()) {
    return refuse(
      'key-not-yet-valid',
      `This key's creation time (${new Date(created).toISOString()}) is ahead of X2F's clock. Check your computer's clock, or try again after that time.`,
    );
  }

  const primary = checkPrimary(key.getAlgorithmInfo());
  if (!primary.ok) return refuse('key-weak', primary.detail);

  try {
    if (await key.isRevoked(undefined, undefined, now)) return refuse('key-revoked', 'This key has been revoked.');
  } catch {
    return refuse('key-unreadable', 'This key could not be checked.');
  }

  let expiration: Date | number | null;
  try {
    expiration = await key.getExpirationTime();
  } catch {
    return refuse('key-unreadable', 'This key could not be checked.');
  }
  const expiresAt = expiration instanceof Date ? expiration : null;
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    return refuse('key-expired', `This key expired on ${isoDate(expiresAt)}.`);
  }

  let encryptionKey: openpgp.Key | openpgp.Subkey;
  try {
    encryptionKey = await key.getEncryptionKey(undefined, now, undefined, FIND_CONFIG);
  } catch {
    return refuse('key-no-encryption', 'This key cannot receive encrypted messages; it needs an encryption subkey.');
  }
  const encProblem = checkEncryption(encryptionKey.getAlgorithmInfo());
  if (encProblem !== null) return refuse('key-weak', encProblem);

  return { ok: true, fingerprint: key.getFingerprint(), algorithm: primary.algorithm, bits: primary.bits, expiresAt };
}

export const PGP_PURPOSE = {
  register: 'create your account',
  login: 'log in',
  'add-key': 'add this PGP key to your account',
} as const;

/** ISO 8601 to the second, with `Z`. */
const isoSeconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

export function challengeText(a: {
  code: string;
  siteName: string;
  siteHost: string;
  issuedAt: Date;
  expiresAt: Date;
  purpose: string;
}): string {
  return [
    `X2F login code: ${a.code}`,
    `Site: ${a.siteName} (${a.siteHost})`,
    `Purpose: ${a.purpose}`,
    `Time: ${isoSeconds(a.issuedAt)}`,
    `Expires: ${isoSeconds(a.expiresAt)}`,
    `Only paste this code into ${a.siteHost}. If you did not just ask for it, ignore it.`,
  ].join('\n');
}

/**
 * Encrypt `text` to every key in one armored message. `wildcard: true` makes
 * every recipient key ID zero, so the message does not reveal which keys it
 * was for. Signed inside the encryption with the official X2F key.
 *
 * Key validity is judged at `now` (the server clock) under STRICT_CONFIG, so
 * a recipient whose only usable encryption subkey is weak, expired or not
 * yet valid makes this throw rather than encrypt to it.
 */
export async function encryptChallenge(
  text: string,
  armoredKeys: string[],
  signingKey: openpgp.PrivateKey,
  now: Date,
): Promise<string> {
  if (armoredKeys.length === 0) throw new Error('encryptChallenge: no recipient keys');
  const encryptionKeys = await Promise.all(
    armoredKeys.map((armoredKey) => openpgp.readKey({ armoredKey, config: STRICT_CONFIG })),
  );
  const message = await openpgp.createMessage({ text, date: now });
  return openpgp.encrypt({
    message,
    encryptionKeys,
    signingKeys: signingKey,
    wildcard: true,
    date: now,
    format: 'armored',
    config: STRICT_CONFIG,
  });
}

/**
 * True when the subkey `encryptChallenge` would encrypt to in `pasted` at `now` (under the same
 * strict rules) is still valid for encryption in `current`, the server's copy of the same key
 * merged with `pasted`. A login challenge is always encrypted to the pasted key, so the
 * ciphertext depends on that key alone; when the server's copy has revoked (or otherwise no longer
 * accepts) that subkey, the caller must not issue a real challenge to it.
 */
export async function pastedRecipientStillValid(pasted: openpgp.Key, current: openpgp.Key, now: Date): Promise<boolean> {
  try {
    const chosen = await pasted.getEncryptionKey(undefined, now, undefined, STRICT_CONFIG);
    await current.getEncryptionKey(chosen.getKeyID(), now, undefined, STRICT_CONFIG);
    return true;
  } catch {
    return false;
  }
}
