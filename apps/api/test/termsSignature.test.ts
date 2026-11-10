import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BODY_LIMIT } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import {
  MAX_TYPED_NAME, SIGNATURE_BODY_ALLOWANCE, SIGNATURE_MAX_BYTES, SIGNATURE_SEALED_MAX_BYTES, SIGNED_BODY_LIMIT, checkTermsSignature,
  openTermsSignature, sealTermsSignature, validPath, type TermsSignature,
} from '../src/termsSignature.js';
import { testConfig } from './helpers/app.js';

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return e.code;
    throw e;
  }
  return undefined;
};

describe('checkTermsSignature (owner, 8 Nov 2026)', () => {
  it('accepts a drawn path and returns exactly its four fields', () => {
    const sig = { kind: 'drawn', width: 320, height: 120, path: 'M0 0L320 120M5 5L5 5' };
    expect(checkTermsSignature(sig)).toEqual(sig);
  });

  it('accepts a typed name, trimmed with runs of spaces folded', () => {
    expect(checkTermsSignature({ kind: 'typed', name: '  Mira   K  ' })).toEqual({ kind: 'typed', name: 'Mira K' });
    expect(checkTermsSignature({ kind: 'typed', name: 'x'.repeat(MAX_TYPED_NAME) })).toEqual({ kind: 'typed', name: 'x'.repeat(MAX_TYPED_NAME) });
  });

  it('refuses a missing signature with signature-required', () => {
    expect(code(() => checkTermsSignature(undefined))).toBe('signature-required');
    expect(code(() => checkTermsSignature(null))).toBe('signature-required');
  });

  it('refuses the wrong type or shape with signature-invalid', () => {
    const bad: unknown[] = [
      'M0 0L1 1', 7, true, [], ['drawn'],
      {}, { kind: 'png', data: 'iVBORw0KGgo=' },
      { kind: 'drawn', width: 320, height: 120 },
      { kind: 'drawn', width: 320, height: 120, path: '' },
      { kind: 'drawn', width: 320, height: 120, path: 'L0 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M0 0 L1 1' },
      { kind: 'drawn', width: 320, height: 120, path: 'M0,0L1,1' },
      { kind: 'drawn', width: 320, height: 120, path: 'M321 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M0 121' },
      { kind: 'drawn', width: 320, height: 120, path: 'M-1 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M01 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M1.5 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M0 0Z' },
      { kind: 'drawn', width: 320, height: 120, path: '<svg onload=alert(1)>' },
      { kind: 'drawn', width: 0, height: 120, path: 'M0 0' },
      { kind: 'drawn', width: 320.5, height: 120, path: 'M0 0' },
      { kind: 'drawn', width: 5000, height: 120, path: 'M0 0' },
      { kind: 'drawn', width: '320', height: 120, path: 'M0 0' },
      { kind: 'drawn', width: 320, height: 120, path: 'M0 0', ip: '10.0.0.1' },
      { kind: 'typed', name: '' },
      { kind: 'typed', name: '   ' },
      { kind: 'typed', name: 7 },
      { kind: 'typed', name: 'a\u0000b' },
      { kind: 'typed', name: 'a‮b' },
      { kind: 'typed', name: 'a\ud800b' },
      { kind: 'typed', name: 'ab\udc00' },
      ...['\u061c', '\u200b', '\u200e', '\u200f', '\u2060', '\u2062', '\u2064', '\ufeff', '\u{e0001}', '\u{e0041}', '\u{e007f}'].map((c) => ({ kind: 'typed', name: `Mi${c}ra` })),
      { kind: 'typed', name: '\u200c' },
      { kind: 'typed', name: ' \u200d\u200c ' },
      { kind: 'typed', name: 'x'.repeat(MAX_TYPED_NAME + 1) },
      { kind: 'typed', name: 'Mira', userAgent: 'x' },
    ];
    for (const b of bad) expect(code(() => checkTermsSignature(b)), JSON.stringify(b)).toBe('signature-invalid');
  });

  // Security review 2026-11-08, finding 7: each was accepted alone and inside a name.
  const INVISIBLE = [
    '\u00ad', '\u034f', '\u115f', '\u1160', '\u17b4', '\u180e', '\u2065', '\u2800', '\u3164', '\ufe0f', '\uffa0', '\ufff9', '\u{1bca0}', '\u{1d173}', '\u{e0100}',
  ];

  it('refuses every invisible character, alone as the whole name and inside one', () => {
    expect(INVISIBLE).toHaveLength(15);
    for (const c of INVISIBLE) {
      const hex = c.codePointAt(0)!.toString(16);
      expect(code(() => checkTermsSignature({ kind: 'typed', name: c })), `alone ${hex}`).toBe('signature-invalid');
      expect(code(() => checkTermsSignature({ kind: 'typed', name: `Mi${c}ra` })), `inside ${hex}`).toBe('signature-invalid');
    }
  });

  it('still takes ordinary names in any script, with accents and combining marks', () => {
    for (const name of ['José Núñez', "O'Neil-Smith", '李小龙', 'Анна', 'नमस्ते', 'X']) {
      expect(checkTermsSignature({ kind: 'typed', name })).toEqual({ kind: 'typed', name: name.normalize('NFC') });
    }
  });

  // Security review 2026-11-08, finding 6: JSON.stringify ran first and overflowed the stack.
  it('refuses deeply nested input as invalid, without overflowing the stack', () => {
    let deep: unknown = [];
    for (let i = 0; i < 200_000; i++) deep = [deep];
    const cases: unknown[] = [
      { a: deep }, deep, { kind: deep },
      { kind: 'typed', name: deep }, { kind: 'typed', name: 'Mira', extra: deep },
      { kind: 'drawn', width: deep, height: 120, path: 'M0 0' }, { kind: 'drawn', width: 320, height: deep, path: 'M0 0' },
      { kind: 'drawn', width: 320, height: 120, path: deep }, { kind: 'drawn', width: 320, height: 120, path: 'M0 0', extra: deep },
    ];
    for (const c of cases) expect(code(() => checkTermsSignature(c))).toBe('signature-invalid');
  });

  it('allows ZWNJ and ZWJ inside a name with visible characters', () => {
    expect(checkTermsSignature({ kind: 'typed', name: 'می\u200cخواهم' })).toEqual({ kind: 'typed', name: 'می\u200cخواهم' });
    expect(checkTermsSignature({ kind: 'typed', name: '👩\u200d💻' }).kind).toBe('typed');
  });

  it('refuses more than 64 KB with signature-too-large, before reading the path', () => {
    const point = 'L100 100';
    const path = `M0 0${point.repeat(Math.ceil(SIGNATURE_MAX_BYTES / point.length))}`;
    expect(code(() => checkTermsSignature({ kind: 'drawn', width: 320, height: 120, path }))).toBe('signature-too-large');
    // Too large wins even when the path is also malformed.
    expect(code(() => checkTermsSignature({ kind: 'drawn', width: 1, height: 1, path: 'x'.repeat(SIGNATURE_MAX_BYTES) }))).toBe('signature-too-large');
    // Just under the cap is fine.
    const fits = `M0 0${point.repeat(Math.floor((SIGNATURE_MAX_BYTES - 100) / point.length))}`;
    expect(checkTermsSignature({ kind: 'drawn', width: 320, height: 120, path: fits }).kind).toBe('drawn');
  });

  it('validPath is linear: a long malformed path is refused quickly', () => {
    const started = performance.now();
    expect(validPath(`${'M1 1L2 2'.repeat(8000)}Q`, 10, 10)).toBe(false);
    // A generous bound: it only catches a quadratic or worse regression, not a slow machine.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('measures a typed name against the cap too', () => {
    expect(code(() => checkTermsSignature({ kind: 'typed', name: 'x'.repeat(SIGNATURE_MAX_BYTES) }))).toBe('signature-too-large');
  });

  it('routes that take a signature have room for it in their body limit', () => {
    expect(SIGNED_BODY_LIMIT).toBe(BODY_LIMIT + SIGNATURE_BODY_ALLOWANCE);
    expect(SIGNATURE_BODY_ALLOWANCE).toBeGreaterThan(SIGNATURE_MAX_BYTES);
  });
});

// Security review 2026-11-08, finding 3.
describe('sealing a signature for storage', () => {
  const config = testConfig();
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const typed: TermsSignature = { kind: 'typed', name: 'Mira K' };
  const drawn: TermsSignature = { kind: 'drawn', width: 320, height: 120, path: 'M10 10L60 60' };

  it('opens to exactly what was sealed', () => {
    expect(openTermsSignature(config, sealTermsSignature(config, typed, A), A)).toEqual(typed);
    expect(openTermsSignature(config, sealTermsSignature(config, drawn, A), A)).toEqual(drawn);
  });

  it('shows nothing of the signature and differs every time', () => {
    const one = sealTermsSignature(config, typed, A);
    expect(one.includes('Mira')).toBe(false);
    expect(one.includes('typed')).toBe(false);
    expect(sealTermsSignature(config, typed, A).equals(one)).toBe(false);
  });

  it('does not open for another account, under another key, or when altered', () => {
    const sealed = sealTermsSignature(config, typed, A);
    expect(() => openTermsSignature(config, sealed, B)).toThrow();
    expect(() => openTermsSignature(testConfig(), sealed, A)).toThrow();
    const flipped = Buffer.from(sealed);
    flipped[14]! ^= 1;
    expect(() => openTermsSignature(config, flipped, A)).toThrow();
    expect(() => openTermsSignature(config, Buffer.alloc(27), A)).toThrow();
  });

  it('adds 28 bytes, so the largest signature fits the column', () => {
    const point = 'L100 100';
    const sig: TermsSignature = { kind: 'drawn', width: 320, height: 120, path: `M0 0${point.repeat(Math.floor((SIGNATURE_MAX_BYTES - 100) / point.length))}` };
    const size = Buffer.byteLength(JSON.stringify(sig), 'utf8');
    expect(size).toBeLessThanOrEqual(SIGNATURE_MAX_BYTES);
    expect(sealTermsSignature(config, sig, A)).toHaveLength(size + 28);
    expect(SIGNATURE_SEALED_MAX_BYTES).toBe(SIGNATURE_MAX_BYTES + 28);
  });
});

// Owner, 9 Nov 2026 (p11-13): "Erase it when the account closes." A close that deletes the account
// row takes the signature with it; a close that keeps the row (it sets `closed_at`, as the 60-day
// close on wip/lead-vendor does) must erase it in the same place. This scan fails when such a close
// lands without `eraseTermsSignature` or `terms_signature = null`.
describe('every account close erases the Terms signature (tripwire)', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? files(`${dir}${f}/`) : f.endsWith('.ts') ? [dir + f] : []));

  it('a statement that sets accounts.closed_at sits in a file that erases the signature', () => {
    const CLOSE = /update\s+accounts\b[^;`]*?\bclosed_at\s*=/s;
    // The 60-day close's statement on wip/lead-vendor (accountInactivity.ts) is one it catches.
    expect(CLOSE.test("update accounts a set disabled_at = $1, closed_at = $1, closed_reason = 'inactive' where a.id = $3")).toBe(true);
    const closes = files(SRC).filter((f) => CLOSE.test(readFileSync(f, 'utf8')));
    const missing = closes.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return !text.includes('eraseTermsSignature(') && !/terms_signature\s*=\s*null/.test(text);
    });
    expect(missing.map((f) => f.slice(SRC.length)), 'erase the signature in this account close (eraseTermsSignature)').toEqual([]);
  });
});
