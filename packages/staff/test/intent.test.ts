import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { normalizeTradeCode } from '@x2f/core';
import {
  BAN_REASON_CODES,
  ISSUED_AT_KINDS,
  hasIssuedAt,
  inviteTokenHash,
  ownerSetupChallenge,
  staffLoginChallenge,
  stampIssuedAt,
  canonicalJson,
  evidenceSha256,
  inviteRegistrationChallenge,
  keyCheckCode,
  sha256,
  tapChallenge,
  type KeyTapIntent,
} from '@x2f/staff';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nodeSha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const TRADE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('canonicalJson', () => {
  test('sorts keys, no whitespace, bigint as a decimal string', () => {
    expect(canonicalJson({ b: 1n, a: 'x' })).toBe('{"a":"x","b":"1"}');
    expect(canonicalJson({ z: [3, { y: true, x: null }], a: { d: 2, c: 'é"' } })).toBe(
      '{"a":{"c":"é\\"","d":2},"z":[3,{"x":null,"y":true}]}',
    );
    expect(canonicalJson(-12345678901234567890n)).toBe('"-12345678901234567890"');
  });

  test('refuses a Date and anything JSON would change or drop', () => {
    expect(() => canonicalJson({ at: new Date() })).toThrow(TypeError);
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(new Map())).toThrow(TypeError);
    expect(() => canonicalJson(new Uint8Array(1))).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(Symbol('s'))).toThrow(TypeError);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 2])).toThrow(TypeError);
  });

  test('keeps __proto__ as an ordinary key', () => {
    const o = JSON.parse('{"__proto__":{"x":1},"a":1}') as object;
    expect(canonicalJson(o)).toBe('{"__proto__":{"x":1},"a":1}');
  });
});

describe('sha256', () => {
  test('matches node:crypto', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é'.repeat(1000)]) {
      expect(hex(sha256(new TextEncoder().encode(s)))).toBe(nodeSha(s));
    }
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 0xff);
    expect(hex(sha256(bytes))).toBe(nodeSha(bytes));
  });

  test('M8: every length from 0 to 1024 bytes, seeded random content', () => {
    let seed = 0x2f2f2f2f;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    };
    for (let len = 0; len <= 1024; len++) {
      const bytes = new Uint8Array(len).map(() => next());
      expect(hex(sha256(bytes))).toBe(nodeSha(bytes));
    }
  });
});

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const ruling: KeyTapIntent = {
  kind: 'ruling',
  step: 'propose',
  rulingId: '7d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f',
  code: CODE,
  round: 1,
  outcome: 'release-to-buyer',
  accountAction: { kind: 'none' },
  amountAtomic: '1250000000000',
  reasonSha256: 'a'.repeat(64),
  evidenceSha256: 'c'.repeat(64),
  round1Id: null,
};
const nonce = new Uint8Array(32).fill(7);
const AT = new Date('2026-11-12T12:00:00.000Z');

describe('tapChallenge', () => {
  test('is SHA-256 of the labelled canonical intent and the nonce', () => {
    const expected = nodeSha(`x2f-keytap-v1\n${canonicalJson(ruling)}\n${hex(nonce)}`);
    expect(hex(tapChallenge(ruling, nonce))).toBe(expected);
  });

  test('a round-2 ruling binds the round-1 ruling it reviews; round 1 binds none (mod-gate review B2)', () => {
    expect(() => tapChallenge({ ...ruling, round: 2 }, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...ruling, round1Id: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f' }, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...ruling, round: 2, round1Id: 'not-a-uuid' }, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...ruling, round: 2, round1Id: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f' }, nonce)).not.toThrow();
  });

  test('is the same for the same intent with keys in another order', () => {
    const reordered = Object.fromEntries(Object.entries(ruling).reverse()) as KeyTapIntent;
    expect(hex(tapChallenge(reordered, nonce))).toBe(hex(tapChallenge(ruling, nonce)));
  });

  test('changes when any field or the nonce changes', () => {
    const base = hex(tapChallenge(ruling, nonce));
    const variants: KeyTapIntent[] = [
      { ...ruling, step: 'approve' },
      { ...ruling, rulingId: '7d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e50' },
      { ...ruling, code: 'K7M2-9QXA-4FTR-8WPM' },
      { ...ruling, round: 2, round1Id: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f' },
      { ...ruling, round: 2, round1Id: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e50' },
      { ...ruling, outcome: 'refund-to-seller' },
      { ...ruling, accountAction: { kind: 'site-ban', until: '2027-01-01T00:00:00.000Z', reasonCode: 'terms' } },
      { ...ruling, accountAction: { kind: 'site-ban', until: null, reasonCode: 'terms' } },
      { ...ruling, accountAction: { kind: 'trade-ban', until: null, reasonCode: 'terms' } },
      { ...ruling, accountAction: { kind: 'trade-ban', until: null, reasonCode: 'abuse' } },
      { ...ruling, amountAtomic: '1250000000001' },
      { ...ruling, reasonSha256: 'b'.repeat(64) },
      { ...ruling, evidenceSha256: 'd'.repeat(64) },
    ];
    const seen = new Set([base]);
    for (const v of variants) seen.add(hex(tapChallenge(v, nonce)));
    expect(seen.size).toBe(variants.length + 1);
    const other = new Uint8Array(nonce);
    other[31] = 8;
    expect(hex(tapChallenge(ruling, other))).not.toBe(base);
  });

  test('a trade code typed without dashes binds the same ruling', () => {
    const typed = { ...ruling, code: 'k7m29qxa4ftr8wpn' };
    expect(hex(tapChallenge(typed, nonce))).toBe(hex(tapChallenge(ruling, nonce)));
  });

  test('refuses an intent of an unknown kind, a bad trade code or a short nonce', () => {
    expect(() => tapChallenge({ kind: 'make-me-owner' } as unknown as KeyTapIntent, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...ruling, code: 'not a code' }, nonce)).toThrow(TypeError);
    expect(() => tapChallenge(ruling, new Uint8Array(15))).toThrow(TypeError);
  });

  test('covers every intent kind', () => {
    const all: KeyTapIntent[] = [
      { kind: 'emergency-stop' },
      { kind: 'resume-trading' },
      { kind: 'create-invite', inviteId: 'i1', role: 'mod', tokenHash: 'c'.repeat(64), expiresAt: '2027-01-01T00:00:00.000Z' },
      { kind: 'switch-on', accountId: 'a1', role: 'senior' },
      { kind: 'set-role', accountId: 'a1', role: 'helper' },
      { kind: 'remove-staff', accountId: 'a1' },
      // D-032 (owner G60): the owner's reset of a staff member's security, bound to the person and the link.
      { kind: 'reset-staff-security', accountId: 'a1', inviteId: 'i2', tokenHash: 'e'.repeat(64), expiresAt: '2027-01-01T00:00:00.000Z' },
      { kind: 'add-owner-key', credentialId: 'cred', publicKeySha256: 'd'.repeat(64) },
      { kind: 'settings', largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48 },
      ruling,
      { ...ruling, outcome: 'seller-sends-xmr' },
    ].map((i) => stampIssuedAt(i as KeyTapIntent, AT));
    expect(new Set(all.map((i) => hex(tapChallenge(i, nonce)))).size).toBe(all.length);
  });

  test('an owner registry intent carries its signed issuedAt; any other carries none (lead call on mod-gate P4)', () => {
    for (const kind of ISSUED_AT_KINDS) expect(hasIssuedAt(kind)).toBe(true);
    expect(hasIssuedAt('ruling')).toBe(false);
    expect(hasIssuedAt('fee-sweep')).toBe(false);
    const stop: KeyTapIntent = { kind: 'emergency-stop' };
    expect(stampIssuedAt(stop, AT)).toEqual({ kind: 'emergency-stop', issuedAt: AT.toISOString() });
    expect(stampIssuedAt(ruling, AT)).toEqual(ruling);
    expect(() => tapChallenge(stop, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...stop, issuedAt: '2026-11-12T12:00:00Z' }, nonce)).toThrow(TypeError);
    expect(() => tapChallenge({ ...ruling, issuedAt: AT.toISOString() } as unknown as KeyTapIntent, nonce)).toThrow(TypeError);
    // Signed: another issuedAt is another challenge.
    expect(hex(tapChallenge(stampIssuedAt(stop, AT), nonce))).not.toBe(hex(tapChallenge(stampIssuedAt(stop, new Date(AT.getTime() + 1)), nonce)));
  });

  test('the ban reasons are the lead default list', () => {
    expect(BAN_REASON_CODES).toEqual(['terms', 'trade-problems', 'abuse', 'account-security']);
  });
});

describe('keyCheckCode', () => {
  test('is the first 80 bits of SHA-256 in grouped Crockford base32', () => {
    const pk = new Uint8Array(65).map((_, i) => i);
    const code = keyCheckCode(pk);
    expect(code).toMatch(TRADE_CODE_RE);
    expect(normalizeTradeCode(code)).toBe(code);
    // Decode the 16 symbols back to 10 bytes and compare with the digest.
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let bits = 0n;
    for (const ch of code.replaceAll('-', '')) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(ch));
    expect(bits.toString(16).padStart(20, '0')).toBe(nodeSha(pk).slice(0, 20));
  });

  test('differs for different keys', () => {
    expect(keyCheckCode(new Uint8Array([1]))).not.toBe(keyCheckCode(new Uint8Array([2])));
  });
});

describe('inviteRegistrationChallenge', () => {
  test('is SHA-256 of the labelled token hash', () => {
    const th = 'e'.repeat(64);
    expect(hex(inviteRegistrationChallenge(th))).toBe(nodeSha(`x2f-invite-v1\n${th}`));
  });
});

describe('evidenceSha256 (review mod-screens M1: the ruling tap binds the evidence lines)', () => {
  test('is SHA-256 of the UTF-8 canonical JSON array of the lines, in order', () => {
    const lines = ['The trade chat', 'Bank statement: “paid” 08:51', '日本語 ✓'];
    expect(evidenceSha256(lines)).toBe(nodeSha(canonicalJson(lines)));
    expect(evidenceSha256(lines)).toBe(nodeSha(JSON.stringify(lines)));
    expect(evidenceSha256([])).toBe(nodeSha('[]'));
  });

  test('changes with the order, the split and the text of the lines', () => {
    const seen = new Set([
      evidenceSha256(['a', 'b']),
      evidenceSha256(['b', 'a']),
      evidenceSha256(['a,b']),
      evidenceSha256(['a', 'b ']),
      evidenceSha256(['a']),
      evidenceSha256([]),
    ]);
    expect(seen.size).toBe(6);
  });
});

// Re-verify round 3, X2 (lead call): every WebAuthn ceremony on the staff site has its own domain,
// derived by the staff site itself, so no login or setup assertion can ever be a tap's.
describe('staff-site challenge domains (X2)', () => {
  const N = 'ab'.repeat(32);
  test('the login and the owner-setup challenges are SHA-256 of their own prefix and the nonce', () => {
    expect(hex(staffLoginChallenge(N))).toBe(nodeSha(`x2f-staff-login-v1\n${N}`));
    expect(hex(ownerSetupChallenge(N))).toBe(nodeSha(`x2f-owner-setup-v1\n${N}`));
    expect(inviteTokenHash('tok_1')).toBe(nodeSha('tok_1'));
    expect(hex(inviteRegistrationChallenge(inviteTokenHash('tok_1')))).toBe(nodeSha(`x2f-invite-v1\n${nodeSha('tok_1')}`));
  });
  test('a malformed nonce is refused', () => {
    for (const bad of ['', 'AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(32)}0`, 'zz'.repeat(32)]) {
      expect(() => staffLoginChallenge(bad), bad).toThrow(TypeError);
      expect(() => ownerSetupChallenge(bad), bad).toThrow(TypeError);
    }
  });
  test('no domain can collide with a tap: the preimages differ in their first line', () => {
    expect(hex(staffLoginChallenge(N))).not.toBe(hex(ownerSetupChallenge(N)));
    expect(hex(staffLoginChallenge(N))).not.toBe(hex(tapChallenge(stampIssuedAt({ kind: 'emergency-stop' }, AT), new Uint8Array(32).fill(0xab))));
  });
});

