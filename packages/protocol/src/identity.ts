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
