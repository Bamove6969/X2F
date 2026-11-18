import sodium from 'libsodium-wrappers';

/** Hex public keys; Ed25519 signing keys with X25519 box keys derived from them. */
export interface Identity {
  signPublic: string;
  boxPublic: string;
  signSecret: Uint8Array;
  boxSecret: Uint8Array;
}

export async function generateIdentity(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

const KEY_HEX = /^[0-9a-f]{64}$/;

/**
 * Detached Ed25519 signature by `me` over `bytes`, as 128 lower-case hex characters: the proof
 * the API verifies against `signPublic` (the chat and trade identity proofs). The caller builds
 * the domain-separated bytes. Throws TypeError when `bytes` is not a Uint8Array or signSecret
 * does not match signPublic (the same check seal makes), so a mixed-up identity never signs.
 */
export async function signProof(me: Identity, bytes: Uint8Array): Promise<string> {
  await sodium.ready;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('signProof: bytes must be a Uint8Array');
  const { signPublic, signSecret } = me;
  if (typeof signPublic !== 'string' || !KEY_HEX.test(signPublic)) throw new TypeError('signProof: invalid signPublic');
  if (
    !(signSecret instanceof Uint8Array) ||
    signSecret.length !== sodium.crypto_sign_SECRETKEYBYTES ||
    !sodium.memcmp(signSecret.subarray(32), sodium.from_hex(signPublic))
  ) {
    throw new TypeError('signProof: signSecret does not match signPublic');
  }
  return sodium.to_hex(sodium.crypto_sign_detached(bytes, signSecret));
}

/**
 * Whether an identity's secrets are its public keys' (review lead-mod-chat N11 d): the Ed25519 secret
 * key's seed and its public half both give `signPublic`, and the X25519 box secret times the base point is `boxPublic`.
 * For a stored identity opened from storage, before it is used.
 */
export async function identityKeysMatch(me: Identity): Promise<boolean> {
  await sodium.ready;
  const { signPublic, boxPublic, signSecret, boxSecret } = me;
  if (typeof signPublic !== 'string' || !KEY_HEX.test(signPublic) || typeof boxPublic !== 'string' || !KEY_HEX.test(boxPublic)) return false;
  if (!(signSecret instanceof Uint8Array) || signSecret.length !== sodium.crypto_sign_SECRETKEYBYTES) return false;
  if (!(boxSecret instanceof Uint8Array) || boxSecret.length !== sodium.crypto_box_SECRETKEYBYTES) return false;
  // The public key derived from the seed (the first 32 bytes), and the copy the secret key carries.
  const kp = sodium.crypto_sign_seed_keypair(signSecret.subarray(0, 32));
  const box = sodium.crypto_scalarmult_base(boxSecret);
  try {
    const pk = sodium.from_hex(signPublic);
    return sodium.memcmp(kp.publicKey, pk) && sodium.memcmp(signSecret.subarray(32), pk) && sodium.memcmp(box, sodium.from_hex(boxPublic));
  } finally {
    sodium.memzero(kp.privateKey);
    sodium.memzero(box);
  }
}
