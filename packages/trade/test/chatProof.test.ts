import { newTradeCode } from '@x2f/core';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { chatIdentityProofBytes, chatIdentityProofValid, identityProofBytes } from '../src/index.js';

beforeAll(async () => {
  await sodium.ready;
});

function keys(chat: string, role: 'buyer' | 'seller', bytes: (c: string, r: 'buyer' | 'seller', s: string, b: string) => Uint8Array = chatIdentityProofBytes) {
  const kp = sodium.crypto_sign_keypair();
  const signPublic = sodium.to_hex(kp.publicKey);
  const boxPublic = sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey));
  const proof = sodium.to_hex(sodium.crypto_sign_detached(bytes(chat, role, signPublic, boxPublic), kp.privateKey));
  return { signPublic, boxPublic, proof };
}

describe('chatIdentityProofValid', () => {
  it('accepts a proof over this chat and role', async () => {
    const chat = newTradeCode();
    expect(await chatIdentityProofValid(chat, 'buyer', keys(chat, 'buyer'))).toBe(true);
  });

  it('refuses another role, another chat, a trade-identity proof and a mismatched box key', async () => {
    const chat = newTradeCode();
    expect(await chatIdentityProofValid(chat, 'seller', keys(chat, 'buyer'))).toBe(false);
    expect(await chatIdentityProofValid(newTradeCode(), 'buyer', keys(chat, 'buyer'))).toBe(false);
    expect(await chatIdentityProofValid(chat, 'buyer', keys(chat, 'buyer', identityProofBytes))).toBe(false);
    const k = keys(chat, 'buyer');
    expect(await chatIdentityProofValid(chat, 'buyer', { ...k, boxPublic: keys(chat, 'buyer').boxPublic })).toBe(false);
  });

  it('never throws on junk', async () => {
    expect(await chatIdentityProofValid('nope', 'buyer', { signPublic: 'x', boxPublic: 'y', proof: 'z' })).toBe(false);
    expect(await chatIdentityProofValid(newTradeCode(), 'mod' as 'buyer', keys(newTradeCode(), 'buyer'))).toBe(false);
  });
});
