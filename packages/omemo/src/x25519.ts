/**
 * X25519 through node:crypto, on libsignal's raw 32-byte keys (the wire form adds a 0x05 type byte;
 * see `message.ts`). OpenSSL clamps the private scalar on use, as RFC 7748 says.
 */
import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto';

export interface KeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

const check32 = (k: Uint8Array, what: string) => {
  if (k.length !== 32) throw new RangeError(`x25519: ${what} must be 32 bytes`);
};

const privateKeyObject = (priv: Uint8Array) => {
  check32(priv, 'private key');
  return createPrivateKey({ key: Buffer.concat([PKCS8_X25519, priv]), format: 'der', type: 'pkcs8' });
};

/** A fresh pair; the private key is clamped as OpenSSL generates it. */
export function x25519KeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url'),
    privateKey: Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url'),
  };
}

export function x25519PublicKey(priv: Uint8Array): Buffer {
  return Buffer.from(createPublicKey(privateKeyObject(priv)).export({ format: 'jwk' }).x!, 'base64url');
}

/** The shared secret DH(priv, pub), 32 bytes. */
export function x25519(priv: Uint8Array, pub: Uint8Array): Buffer {
  check32(pub, 'public key');
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_X25519, pub]), format: 'der', type: 'spki' });
  return diffieHellman({ privateKey: privateKeyObject(priv), publicKey });
}
