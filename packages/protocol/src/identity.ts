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
