// X3DH and the Double Ratchet, both sides, including a seeded property test over random message
// schedules (out-of-order delivery, both directions) checking that every message decrypts, no
// message key is ever used twice, and a failed decryption leaves the state untouched.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePreKeyMessage, parseSignalMessage } from '../src/message.js';
import { MAX_SKIPPED_KEYS, createChain, decrypt, encrypt, initAlice, initBob, messageKeys, nextChain, type SessionState } from '../src/ratchet.js';
import { x25519, x25519KeyPair } from '../src/x25519.js';

function pair() {
  const alice = { identity: x25519KeyPair(), base: x25519KeyPair() };
  const bob = { identity: x25519KeyPair(), signedPreKey: x25519KeyPair(), oneTime: x25519KeyPair() };
  const a = initAlice({
    ourIdentity: alice.identity, ourBaseKey: alice.base, theirIdentity: bob.identity.publicKey, theirSignedPreKey: bob.signedPreKey.publicKey,
    theirOneTimePreKey: bob.oneTime.publicKey, signedPreKeyId: 7, preKeyId: 42, registrationId: 100,
  });
  const b = initBob({
    ourIdentity: bob.identity, ourSignedPreKey: bob.signedPreKey, ourOneTimePreKey: bob.oneTime, theirIdentity: alice.identity.publicKey,
    theirBaseKey: alice.base.publicKey, registrationId: 200,
  });
  return { a, b, alice, bob };
}

/** Bob's view of Alice's first message: the PreKeySignalMessage carries the inner SignalMessage. */
const inner = (preKey: Buffer) => parsePreKeyMessage(preKey).message;

describe('X3DH + Double Ratchet: libsignal semantics', () => {
  it("Alice's first message is a PreKeySignalMessage with her base key, identity and the prekey ids; Bob decrypts it", () => {
    const { a, b, alice } = pair();
    const m = encrypt(a, Buffer.from('hello bob'));
    const p = parsePreKeyMessage(m);
    expect(p).toMatchObject({ registrationId: 100, preKeyId: 42, signedPreKeyId: 7, baseKey: alice.base.publicKey, identityKey: alice.identity.publicKey });
    const s = parseSignalMessage(p.message);
    expect(s.counter).toBe(0);
    expect(s.previousCounter).toBe(0);
    expect(s.ratchetKey.equals(alice.base.publicKey)).toBe(false); // a fresh ratchet key, not the base key
    expect(decrypt(b, p.message).toString()).toBe('hello bob');
  });

  it('Alice keeps wrapping until Bob answers; receiving her ratchet key makes Bob ratchet (a fresh key, not his signed prekey); his reply clears the wrapper', () => {
    const { a, b, bob } = pair();
    const m1 = encrypt(a, Buffer.from('one'));
    const m2 = encrypt(a, Buffer.from('two'));
    expect(parsePreKeyMessage(m2).baseKey).toEqual(parsePreKeyMessage(m1).baseKey);
    expect(parseSignalMessage(inner(m2)).counter).toBe(1);
    expect(decrypt(b, inner(m1)).toString()).toBe('one');
    expect(decrypt(b, inner(m2)).toString()).toBe('two');
    // libsignal: a message under a new ratchet key makes the receiver take a DH step and pick a new sending ratchet key.
    expect(b.sendingRatchet.publicKey.equals(bob.signedPreKey.publicKey)).toBe(false);
    const r = encrypt(b, Buffer.from('reply'));
    expect(parseSignalMessage(r).ratchetKey).toEqual(b.sendingRatchet.publicKey);
    expect(parseSignalMessage(r).counter).toBe(0);
    expect(decrypt(a, r).toString()).toBe('reply');
    expect(a.pendingPreKey).toBeNull();
    const m3 = encrypt(a, Buffer.from('three'));
    expect(() => parsePreKeyMessage(m3)).toThrow(); // a plain SignalMessage now
    const s3 = parseSignalMessage(m3);
    expect(s3.counter).toBe(0); // a new sending chain after the DH ratchet step
    expect(s3.previousCounter).toBe(1); // two messages went out on the old chain
    expect(decrypt(b, m3).toString()).toBe('three');
  });

  it('works without a one-time prekey (libsignal allows a bundle whose prekeys ran out)', () => {
    const alice = { identity: x25519KeyPair(), base: x25519KeyPair() };
    const bob = { identity: x25519KeyPair(), signedPreKey: x25519KeyPair() };
    const a = initAlice({ ourIdentity: alice.identity, ourBaseKey: alice.base, theirIdentity: bob.identity.publicKey, theirSignedPreKey: bob.signedPreKey.publicKey, signedPreKeyId: 1, registrationId: 1 });
    const b = initBob({ ourIdentity: bob.identity, ourSignedPreKey: bob.signedPreKey, theirIdentity: alice.identity.publicKey, theirBaseKey: alice.base.publicKey, registrationId: 2 });
    const m = encrypt(a, Buffer.from('no otp'));
    expect(parsePreKeyMessage(m).preKeyId).toBeUndefined();
    expect(decrypt(b, inner(m)).toString()).toBe('no otp');
  });

  it('a message under another identity, a tampered byte or a replay fails, and the state is exactly as before', () => {
    const { a, b } = pair();
    const m = inner(encrypt(a, Buffer.from('x')));
    const snapshot = JSON.stringify(b);
    const bad = Buffer.from(m);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => decrypt(b, bad)).toThrow(/mac/);
    expect(JSON.stringify(b)).toBe(snapshot);
    const other = pair().b;
    expect(() => decrypt(other, m)).toThrow(/mac/);
    expect(decrypt(b, m).toString()).toBe('x');
    expect(() => decrypt(b, m)).toThrow(/duplicate/);
    const after = JSON.stringify(b);
    expect(() => decrypt(b, bad)).toThrow();
    expect(JSON.stringify(b)).toBe(after);
  });

  it('out-of-order delivery uses skipped message keys once; a gap over the cap is refused', () => {
    const { a, b } = pair();
    const ms = Array.from({ length: 5 }, (_, i) => inner(encrypt(a, Buffer.from(`m${i}`))));
    expect(decrypt(b, ms[4]!).toString()).toBe('m4');
    expect(decrypt(b, ms[1]!).toString()).toBe('m1');
    expect(decrypt(b, ms[0]!).toString()).toBe('m0');
    expect(() => decrypt(b, ms[1]!)).toThrow(/duplicate/);
    expect(decrypt(b, ms[3]!).toString()).toBe('m3');
    expect(decrypt(b, ms[2]!).toString()).toBe('m2');
    expect(b.skipped).toHaveLength(0);
    for (let i = 0; i <= MAX_SKIPPED_KEYS; i++) encrypt(a, Buffer.alloc(1));
    const far = inner(encrypt(a, Buffer.from('far')));
    expect(() => decrypt(b, far)).toThrow(/far ahead/);
  });

  it('chain and root derivations are deterministic functions of their inputs', () => {
    const root = randomBytes(32);
    const dh = x25519(x25519KeyPair().privateKey, x25519KeyPair().publicKey);
    expect(createChain(root, dh)).toEqual(createChain(root, dh));
    expect(createChain(root, dh).rootKey.equals(createChain(randomBytes(32), dh).rootKey)).toBe(false);
    const chain = { key: randomBytes(32), index: 3 };
    const keys = messageKeys(chain);
    expect(keys.index).toBe(3);
    expect(keys.cipherKey).toHaveLength(32);
    expect(keys.macKey).toHaveLength(32);
    expect(keys.iv).toHaveLength(16);
    expect(nextChain(chain).index).toBe(4);
    expect(nextChain(chain).key.equals(chain.key)).toBe(false);
    expect(messageKeys(nextChain(chain)).cipherKey.equals(keys.cipherKey)).toBe(false);
  });
});

/** xorshift32: a small seeded generator so a failing schedule can be replayed by seed. */
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

describe('property: random schedules', () => {
  it('for 40 seeds × 60 messages, both directions, delivered in random order within a window: every message decrypts and no (chain, counter) repeats', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = prng(seed * 7919);
      const { a, b } = pair();
      const sides: Array<[SessionState, SessionState, string]> = [[a, b, 'a→b'], [b, a, 'b→a']];
      const used = new Set<string>();
      type Sent = { from: number; bytes: Buffer; text: string };
      const pending: Sent[] = [];
      let n = 0;
      const deliver = (s: Sent) => {
        const [, to, dir] = sides[s.from]!;
        const parsed = parseSignalMessage(s.bytes);
        expect(decrypt(to, s.bytes).toString(), `seed ${seed} ${dir} ${s.text}`).toBe(s.text);
        const id = `${parsed.ratchetKey.toString('hex')}/${parsed.counter}/${dir}`;
        expect(used.has(id), `seed ${seed}: message key reused ${id}`).toBe(false);
        used.add(id);
      };
      let heldBack = false;
      while (n < 60) {
        // A burst from one side (either may start: libsignal's Bob has a sending chain from the start).
        const from = rnd(2);
        const burst = 1 + rnd(4);
        for (let i = 0; i < burst && n < 60; i++, n++) {
          const text = `#${n}`;
          const wrapped = from === 0 && a.pendingPreKey !== null;
          const bytes = encrypt(sides[from]![0], Buffer.from(text));
          pending.push({ from, bytes: wrapped ? parsePreKeyMessage(bytes).message : bytes, text });
        }
        // Deliver in random order; hold up to two back for one round (a receiver keeps 5 chains, as libsignal does).
        const keep: number = heldBack ? 0 : rnd(3);
        heldBack = keep > 0;
        while (pending.length > keep) deliver(pending.splice(rnd(pending.length), 1)[0]!);
        expect(a.receivingChains.length).toBeLessThanOrEqual(5);
        expect(b.receivingChains.length).toBeLessThanOrEqual(5);
      }
      while (pending.length > 0) deliver(pending.splice(rnd(pending.length), 1)[0]!);
      expect(used.size).toBe(60);
    }
  });
});
