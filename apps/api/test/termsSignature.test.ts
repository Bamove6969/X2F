import { describe, expect, it } from 'vitest';
import { BODY_LIMIT } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import {
  MAX_TYPED_NAME, SIGNATURE_BODY_ALLOWANCE, SIGNATURE_MAX_BYTES, SIGNED_BODY_LIMIT, checkTermsSignature, validPath,
} from '../src/termsSignature.js';

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
      { kind: 'typed', name: 'x'.repeat(MAX_TYPED_NAME + 1) },
      { kind: 'typed', name: 'Mira', userAgent: 'x' },
    ];
    for (const b of bad) expect(code(() => checkTermsSignature(b)), JSON.stringify(b)).toBe('signature-invalid');
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
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('routes that take a signature have room for it in their body limit', () => {
    expect(SIGNED_BODY_LIMIT).toBe(BODY_LIMIT + SIGNATURE_BODY_ALLOWANCE);
    expect(SIGNATURE_BODY_ALLOWANCE).toBeGreaterThan(SIGNATURE_MAX_BYTES);
  });
});
