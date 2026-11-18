// Review lead-mod-chat re-review B1: a staff device's box key is a non-extractable WebCrypto X25519
// key, so the worker opens a sealed box (crypto_box_seal) from the X25519 shared secret it gets from
// `subtle.deriveBits`, then libsodium's remaining crypto_box_seal_open steps: nonce =
// blake2b(epk || pk, 24), k = HSalsa20(shared, 0^16), crypto_secretbox_open_easy. Checked here
// against libsodium's own crypto_box_seal_open on the same inputs; likewise the countersign made by
// a WebCrypto Ed25519 key against libsodium's verification.
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chatKeyHash,
  encryptChat,
  hsalsa20,
  makeModCountersign,
  newChatKey,
  openSealedWith,
  ProtocolError,
  sealTo,
  unwrapChatKey,
  verifyModCountersign,
  wrapChatKey,
  type BoxOpener,
  type Signer,
} from '../src/index.js';

const subtle = globalThis.crypto.subtle;
const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('hex');

beforeAll(async () => {
  await sodium.ready;
});

/** A non-extractable WebCrypto X25519 key, as a staff device keeps it, and its opener. */
async function webBox(): Promise<{ opener: BoxOpener; privateKey: CryptoKey }> {
  const kp = (await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const boxPublic = hex(await subtle.exportKey('raw', kp.publicKey));
  return {
    privateKey: kp.privateKey,
    opener: {
      boxPublic,
      async sharedWith(epk) {
        const pub = await subtle.importKey('raw', epk as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []);
        return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, kp.privateKey, 256));
      },
    },
  };
}

describe('hsalsa20', () => {
  it('is crypto_box_beforenm\'s step: HSalsa20(X25519(sk, pk), 0^16) equals crypto_box_beforenm(pk, sk)', () => {
    for (let i = 0; i < 20; i++) {
      const a = sodium.crypto_box_keypair();
      const b = sodium.crypto_box_keypair();
      const shared = sodium.crypto_scalarmult(a.privateKey, b.publicKey);
      expect(hex(hsalsa20(shared))).toBe(hex(sodium.crypto_box_beforenm(b.publicKey, a.privateKey)));
    }
  });
});

describe('openSealedWith (B1)', () => {
  it('opens what crypto_box_seal sealed exactly as libsodium\'s crypto_box_seal_open does, from a WebCrypto X25519 key', async () => {
    for (const len of [0, 1, 32, 100, 1000]) {
      // The same inputs both ways: a libsodium key pair, whose secret is also given to WebCrypto (pkcs8).
      const kp = sodium.crypto_box_keypair();
      const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...kp.privateKey]);
      const priv = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
      const opener: BoxOpener = {
        boxPublic: hex(kp.publicKey),
        async sharedWith(epk) {
          const pub = await subtle.importKey('raw', epk as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []);
          return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256));
        },
      };
      const msg = sodium.randombytes_buf(len);
      const sealed = sodium.crypto_box_seal(msg, kp.publicKey);
      const ours = await openSealedWith(opener, sealed);
      const theirs = sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey);
      expect(hex(ours)).toBe(hex(theirs));
      expect(hex(ours)).toBe(hex(msg));
    }
  });

  it('refuses a box for another key, a tampered one, and one too short: not-for-me', async () => {
    const { opener } = await webBox();
    const other = await webBox();
    const sealed = await sealTo(opener.boxPublic, new Uint8Array([1, 2, 3]));
    expect(hex(await openSealedWith(opener, sealed))).toBe('010203');
    const tampered = sealed.slice();
    tampered[40] = tampered[40]! ^ 1;
    for (const [why, box, o] of [['another key', sealed, other.opener], ['tampered', tampered, opener], ['too short', sealed.subarray(0, 47), opener]] as const) {
      await expect(openSealedWith(o, box), why).rejects.toMatchObject({ code: 'not-for-me' });
    }
  });

  it('unwrapChatKey takes the opener: the chat key re-wrapped to a WebCrypto box key opens to its tkh, never to another', async () => {
    const { opener } = await webBox();
    const tk = await newChatKey();
    const wrap = await wrapChatKey(opener.boxPublic, tk);
    expect(hex(await unwrapChatKey(opener, wrap, await chatKeyHash(tk)))).toBe(hex(tk));
    await expect(unwrapChatKey(opener, wrap, await chatKeyHash(await newChatKey()))).rejects.toBeInstanceOf(ProtocolError);
  });
});

describe('the countersign by a WebCrypto Ed25519 key (B1)', () => {
  it('is a libsodium-verifiable Ed25519 signature over the same bytes; a signer whose key is not signPublic signs nothing', async () => {
    const kp = (await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    const signPublic = hex(await subtle.exportKey('raw', kp.publicKey));
    const signer: Signer = { signPublic, sign: async (b) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, kp.privateKey, b as Uint8Array<ArrayBuffer>)) };
    const body = await encryptChat({ trade: 'chan-1', from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'hi' }, tk: await newChatKey() });
    const c = await makeModCountersign({ body, requestId: 'a'.repeat(32), issuedAt: '2026-11-18T12:00:00.000Z', me: signer });
    await expect(verifyModCountersign(c, { body, signPublic })).resolves.toEqual(c);
    const other = (await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    const liar: Signer = { signPublic, sign: async (b) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, other.privateKey, b as Uint8Array<ArrayBuffer>)) };
    await expect(makeModCountersign({ body, requestId: 'a'.repeat(32), issuedAt: '2026-11-18T12:00:00.000Z', me: liar })).rejects.toBeInstanceOf(TypeError);
  });
});
