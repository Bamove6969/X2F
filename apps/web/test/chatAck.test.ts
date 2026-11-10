// J-23 (S-075) phase 1 groundwork: the account chat key keeper in the worker (chat/ack.ts). Two
// devices, two stores: one makes the key, seals it to the other's device key; the other opens it.
// No key ever appears in a result.
import { generateBoxKeyPair, openSealed, sealTo } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACK_BYTES, ACK_CONTEXT, HANDOVER_WINDOW_MS, ackPayload, createAckKeeper, fromBase64Url, toBase64Url } from '../src/chat/ack.js';
import { memoryChatStore } from '../src/chat/store.js';

beforeAll(async () => {
  await sodium.ready;
});

const ACCOUNT = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_ACCOUNT = '11111111-2222-4333-8444-555555555555';
let clock = 1_800_000_000_000;

/** A device: its own store and keeper, on the shared test clock. */
function device(random?: (n: number) => Uint8Array) {
  const store = memoryChatStore();
  const keeper = createAckKeeper({ store, newBoxKeyPair: generateBoxKeyPair, now: () => clock, ...(random ? { random } : {}) });
  /** The stored key (hex) and epoch, read straight from the store: tests only. */
  const held = () => (store.account === null ? null : (JSON.parse(store.account) as { ack: { key: string; epoch: number } | null }).ack);
  return { store, keeper, held };
}

describe('the device key', () => {
  it('is made on first use, saved, and the same afterwards, for a new keeper on the same store too', async () => {
    const a = device();
    expect(a.store.account).toBeNull();
    const pub = await a.keeper.devicePublic();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(await a.keeper.devicePublic()).toBe(pub);
    const again = createAckKeeper({ store: a.store, newBoxKeyPair: generateBoxKeyPair });
    expect(await again.devicePublic()).toBe(pub);
    const rec = JSON.parse(a.store.account!) as { v: number; deviceKey: { boxPublic: string; boxSecret: string }; ack: unknown };
    expect(rec.v).toBe(1);
    expect(rec.deviceKey.boxPublic).toBe(pub);
    expect(sodium.to_hex(sodium.crypto_scalarmult_base(sodium.from_hex(rec.deviceKey.boxSecret)))).toBe(pub);
    expect(rec.ack).toBeNull();
    expect(await a.keeper.status()).toEqual({ hasKey: false, epoch: null });
    // Another device has another key.
    expect(await device().keeper.devicePublic()).not.toBe(pub);
  });
});

describe('making and sealing the key', () => {
  it('without a key there is nothing to seal; makeKey draws 32 random bytes once and never replaces a key held', async () => {
    const draws: number[] = [];
    const a = device((n) => {
      draws.push(n);
      return sodium.randombytes_buf(n);
    });
    expect(await a.keeper.sealFor('ab'.repeat(32), ACCOUNT)).toBeNull();
    expect(await a.keeper.makeKey(0)).toEqual({ epoch: 0 });
    expect(draws).toEqual([ACK_BYTES]);
    const first = a.held();
    expect(first!.key).toMatch(/^[0-9a-f]{64}$/);
    expect(first!.epoch).toBe(0);
    expect(await a.keeper.makeKey(5)).toEqual({ epoch: 0 });
    expect(a.held()).toEqual(first);
    expect(draws).toEqual([ACK_BYTES]);
    expect(await a.keeper.status()).toEqual({ hasKey: true, epoch: 0 });
    await expect(a.keeper.makeKey(-1)).rejects.toThrow(TypeError);
    await expect(a.keeper.makeKey(1.5)).rejects.toThrow(TypeError);
  });

  it("sealFor is a crypto_box_seal of 'x2f/ack/v1' || accountId || epoch || ACK to the recipient, base64url, with the epoch", async () => {
    const a = device();
    await a.keeper.makeKey(2);
    const recipient = await generateBoxKeyPair();
    const out = (await a.keeper.sealFor(recipient.boxPublic, ACCOUNT))!;
    expect(out.epoch).toBe(2);
    expect(out.sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = fromBase64Url(out.sealed)!;
    const plain = await openSealed(recipient, bytes);
    expect(ACK_CONTEXT).toBe('x2f/ack/v1');
    expect(plain).toEqual(ackPayload(ACCOUNT, 2, sodium.from_hex(a.held()!.key)));
    expect(new TextDecoder().decode(plain.subarray(0, 10))).toBe('x2f/ack/v1');
    expect(new TextDecoder().decode(plain.subarray(10, 46))).toBe(ACCOUNT);
    expect(Array.from(plain.subarray(46, 50))).toEqual([0, 0, 0, 2]);
    expect(sodium.to_hex(plain.subarray(50))).toBe(a.held()!.key);
    expect(bytes).toHaveLength(10 + 36 + 4 + ACK_BYTES + 48);
    // Never to a malformed key or for a malformed account.
    await expect(a.keeper.sealFor('AB'.repeat(32), ACCOUNT)).rejects.toThrow(TypeError);
    await expect(a.keeper.sealFor('ab'.repeat(31), ACCOUNT)).rejects.toThrow(TypeError);
    await expect(a.keeper.sealFor(recipient.boxPublic, ACCOUNT.toUpperCase())).rejects.toThrow(TypeError);
    await expect(a.keeper.sealFor(recipient.boxPublic, 'not-an-account')).rejects.toThrow(TypeError);
  });
});

describe('the handover between two devices', () => {
  /** b publishes its device key for (account, epoch); a seals its key to it. */
  async function handover(o: { epoch?: number; boxAccount?: string } = {}) {
    const epoch = o.epoch ?? 0;
    const a = device();
    const b = device();
    await a.keeper.makeKey(epoch);
    const pubB = await b.keeper.devicePublic({ accountId: ACCOUNT, epoch });
    const sealed = (await a.keeper.sealFor(pubB, o.boxAccount ?? ACCOUNT))!;
    return { a, b, pubB, sealed: sealed.sealed };
  }

  it('the device that published its key opens the box and holds the same key at the same epoch; it can hand it on', async () => {
    const { a, b, sealed } = await handover();
    expect(b.held()).toBeNull();
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('opened');
    expect(b.held()).toEqual(a.held());
    expect(await b.keeper.status()).toEqual({ hasKey: true, epoch: 0 });
    // b hands it to a third device that asked for it.
    const c = device();
    const onward = (await b.keeper.sealFor(await c.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 }), ACCOUNT))!;
    expect(await c.keeper.open(onward)).toBe('opened');
    expect(c.held()).toEqual(a.held());
  });

  it('review F1: no box is taken unless this device started a handover; success ends it; 10 minutes end it', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(0);
    // b's key is known (a plain read), but b never published it for a handover.
    const unsolicited = (await a.keeper.sealFor(await b.keeper.devicePublic(), ACCOUNT))!;
    expect(await b.keeper.open(unsolicited)).toBe('not-pending');
    expect(b.held()).toBeNull();
    // Published: taken once; the same box again is refused (nothing pending any more).
    await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    expect(await b.keeper.open(unsolicited)).toBe('opened');
    expect(await b.keeper.open(unsolicited)).toBe('not-pending');
    // A new handover that runs out unanswered.
    const c = device();
    const pubC = await c.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    const late = (await a.keeper.sealFor(pubC, ACCOUNT))!;
    clock += HANDOVER_WINDOW_MS;
    expect(HANDOVER_WINDOW_MS).toBe(10 * 60_000);
    expect(await c.keeper.open(late)).toBe('not-pending');
    expect(c.held()).toBeNull();
    // Just inside the window is fine.
    await c.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    clock += HANDOVER_WINDOW_MS - 1;
    expect(await c.keeper.open(late)).toBe('opened');
  });

  it('review F1: the context inside the box must match this handover: another account, another epoch or no context is wrong-context', async () => {
    const other = await handover({ boxAccount: OTHER_ACCOUNT });
    expect(await other.b.keeper.open({ sealed: other.sealed, epoch: 0 })).toBe('wrong-context');
    expect(other.b.held()).toBeNull();
    // A key at epoch 3 into a handover this device started for epoch 0.
    const a = device();
    const b = device();
    await a.keeper.makeKey(3);
    const pub = await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    const e3 = (await a.keeper.sealFor(pub, ACCOUNT))!;
    expect(await b.keeper.open(e3)).toBe('wrong-context');
    // The old, context-free shape (a bare 32-byte key) and a wrong label.
    const bare = toBase64Url(await sealTo(pub, sodium.randombytes_buf(ACK_BYTES)));
    expect(await b.keeper.open({ sealed: bare, epoch: 0 })).toBe('bad-envelope');
    const label = ackPayload(ACCOUNT, 0, sodium.randombytes_buf(ACK_BYTES));
    label[0] = 'y'.charCodeAt(0);
    expect(await b.keeper.open({ sealed: toBase64Url(await sealTo(pub, label)), epoch: 0 })).toBe('wrong-context');
    expect(b.held()).toBeNull();
  });

  it('review F1: the epoch outside the box is ignored; the one inside is the one kept', async () => {
    const { a, b, sealed } = await handover({ epoch: 2 });
    // The handover was started for epoch 2; the envelope claims 9: the box's own 2 is what counts.
    expect(await b.keeper.open({ sealed, epoch: 9 })).toBe('opened');
    expect(await b.keeper.status()).toEqual({ hasKey: true, epoch: 2 });
    expect(b.held()).toEqual(a.held());
  });

  it('review F1: a key held at the same epoch is never overwritten (conflict); the same key is already', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(0);
    await b.keeper.makeKey(0);
    const before = b.held();
    const pub = await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    expect(await b.keeper.open((await a.keeper.sealFor(pub, ACCOUNT))!)).toBe('conflict');
    expect(b.held()).toEqual(before);
    expect(await b.keeper.open((await b.keeper.sealFor(pub, ACCOUNT))!)).toBe('already');
    expect(b.held()).toEqual(before);
  });

  it('an older epoch than the key held is stale-epoch and keeps the key; a newer one replaces it', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(1);
    await b.keeper.makeKey(2);
    const old = (await a.keeper.sealFor(await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 1 }), ACCOUNT))!;
    const before = b.held();
    expect(await b.keeper.open(old)).toBe('stale-epoch');
    expect(b.held()).toEqual(before);
    const newer = (await b.keeper.sealFor(await a.keeper.devicePublic({ accountId: ACCOUNT, epoch: 2 }), ACCOUNT))!;
    expect(await a.keeper.open(newer)).toBe('opened');
    expect(a.held()).toEqual(b.held());
    expect(await a.keeper.status()).toEqual({ hasKey: true, epoch: 2 });
  });

  it('a box sealed to another device, tampered or truncated is not-for-me; malformed input is bad-envelope; nothing is stored', async () => {
    const { b, pubB, sealed } = await handover();
    const other = device();
    await other.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    expect(await other.keeper.open({ sealed, epoch: 0 })).toBe('not-for-me');
    expect(other.held()).toBeNull();
    const bytes = fromBase64Url(sealed)!;
    const tampered = new Uint8Array(bytes);
    tampered[5]! ^= 0x40;
    expect(await b.keeper.open({ sealed: toBase64Url(tampered), epoch: 0 })).toBe('not-for-me');
    expect(await b.keeper.open({ sealed: toBase64Url(bytes.subarray(0, bytes.length - 1)), epoch: 0 })).toBe('not-for-me');
    const short = await sealTo(pubB, ackPayload(ACCOUNT, 0, new Uint8Array(ACK_BYTES)).subarray(0, 81));
    expect(await b.keeper.open({ sealed: toBase64Url(short), epoch: 0 })).toBe('bad-envelope');
    for (const bad of ['', 'not base64url!', `${sealed}=`, 42 as unknown as string]) expect(await b.keeper.open({ sealed: bad, epoch: 0 })).toBe('bad-envelope');
    expect(await b.keeper.open(null as unknown as { sealed: string; epoch: number })).toBe('bad-envelope');
    expect(b.held()).toBeNull();
    // The good box still opens after all that (the handover is still pending).
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('opened');
  });

  it('forget erases the device key, the chat key and the pending handover; the next use makes a new device key', async () => {
    const { b, pubB, sealed } = await handover();
    await b.keeper.forget();
    expect(b.store.account).toBeNull();
    expect(await b.keeper.status()).toEqual({ hasKey: false, epoch: null });
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('not-pending');
    expect(await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 })).not.toBe(pubB);
    // The old box was for the old device key.
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('not-for-me');
  });

  it('devicePublic refuses a malformed handover context', async () => {
    const b = device();
    await expect(b.keeper.devicePublic({ accountId: 'x', epoch: 0 })).rejects.toThrow(TypeError);
    await expect(b.keeper.devicePublic({ accountId: ACCOUNT, epoch: -1 })).rejects.toThrow(TypeError);
    await expect(b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 1.5 })).rejects.toThrow(TypeError);
  });

  it('no result ever carries the key or the device secret', async () => {
    const { a, b, pubB, sealed } = await handover();
    const results: unknown[] = [
      await a.keeper.devicePublic(), await a.keeper.status(), await a.keeper.makeKey(0), await a.keeper.sealFor(pubB, ACCOUNT),
      await b.keeper.open({ sealed, epoch: 0 }), await b.keeper.status(),
    ];
    const text = JSON.stringify(results);
    for (const d of [a, b]) {
      const rec = JSON.parse(d.store.account!) as { deviceKey: { boxSecret: string }; ack: { key: string } };
      expect(text).not.toContain(rec.ack.key);
      expect(text).not.toContain(rec.deviceKey.boxSecret);
      expect(text).not.toContain(toBase64Url(sodium.from_hex(rec.ack.key)));
    }
  });

  it('serialises: two opens racing on one device end with one stored key', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(0);
    const pubB = await b.keeper.devicePublic({ accountId: ACCOUNT, epoch: 0 });
    const x = (await a.keeper.sealFor(pubB, ACCOUNT))!;
    const y = (await a.keeper.sealFor(pubB, ACCOUNT))!;
    const [r1, r2, after] = await Promise.all([b.keeper.open(x), b.keeper.open(y), b.keeper.status()]);
    // The first ends the handover; the second finds nothing pending.
    expect([r1, r2].sort()).toEqual(['not-pending', 'opened']);
    expect(after).toEqual({ hasKey: true, epoch: 0 });
    expect(b.held()).toEqual(a.held());
  });

  it('the sender-proof gap is marked for p12-5 (tripwire)', () => {
    expect(readFileSync(new URL('../src/chat/ack.ts', import.meta.url), 'utf8')).toContain('NEEDS_P12_5_SENDER_PROOF');
  });
});

describe('base64url helpers', () => {
  it('round-trip and refuse what is not canonical base64url', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 80, 1024]) {
      const bytes = sodium.randombytes_buf(n);
      const s = toBase64Url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      if (n > 0) expect(fromBase64Url(s)).toEqual(bytes);
    }
    expect(fromBase64Url('')).toBeNull();
    expect(fromBase64Url('AAA=')).toBeNull();
    expect(fromBase64Url('A+')).toBeNull();
    // 'AQ' is 000000 010000: the byte 0x01 and four zero bits.
    expect(fromBase64Url('AQ')).toEqual(new Uint8Array([0x01]));
    // Non-canonical trailing bits are refused: 'AC' decodes to one byte that re-encodes as 'AA'.
    expect(fromBase64Url('AC')).toBeNull();
  });
});
