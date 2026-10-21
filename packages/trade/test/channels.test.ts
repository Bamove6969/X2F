import { newTradeCode, normalizeTradeCode } from '@x2f/core';
import { describe, expect, it } from 'vitest';
import { CHANNEL_KINDS, channelFor } from '../src/index.js';

const bare = (s: string): string => s.replaceAll('-', '');

describe('channelFor', () => {
  it('is deterministic and accepts any spelling of the same code', async () => {
    const code = newTradeCode();
    const a = await channelFor(code, 'escrow');
    expect(await channelFor(code, 'escrow')).toBe(a);
    expect(await channelFor(bare(code).toLowerCase(), 'escrow')).toBe(a);
  });

  it('is shaped like a trade code, so the relay accepts it', async () => {
    for (const kind of CHANNEL_KINDS) {
      const ch = await channelFor(newTradeCode(), kind);
      expect(ch).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      expect(normalizeTradeCode(ch)).toBe(ch);
    }
  });

  it('differs per kind and per code', async () => {
    const code = newTradeCode();
    const chans = await Promise.all(CHANNEL_KINDS.map((k) => channelFor(code, k)));
    expect(new Set(chans).size).toBe(3);
    expect(await channelFor(newTradeCode(), 'escrow')).not.toBe(chans[0]);
  });

  it('never equals or contains the code', async () => {
    for (let i = 0; i < 200; i++) {
      const code = newTradeCode();
      for (const kind of CHANNEL_KINDS) {
        const ch = await channelFor(code, kind);
        expect(ch).not.toBe(code);
        expect(bare(ch).includes(bare(code))).toBe(false);
        // Not even a group of the code in the same place.
        expect(ch.split('-').filter((g, j) => g === code.split('-')[j]).length).toBeLessThan(4);
      }
    }
  });

  it('matches a fixed vector (HKDF-SHA256, empty salt, first 10 bytes)', async () => {
    // Computed independently with node:crypto hkdfSync('sha256', code, '', info, 10).
    const { hkdfSync } = await import('node:crypto');
    const code = '0123-4567-89AB-CDEF';
    const bytes = new Uint8Array(hkdfSync('sha256', code, new Uint8Array(0), 'x2f/relay-channel/v1/escrow', 10));
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let bits = 0n;
    for (const b of bytes) bits = (bits << 8n) | BigInt(b);
    let raw = '';
    for (let i = 15; i >= 0; i--) raw += alphabet[Number((bits >> BigInt(i * 5)) & 31n)];
    const expected = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    expect(await channelFor(code, 'escrow')).toBe(expected);
  });

  it('refuses a bad code or kind', async () => {
    await expect(channelFor('nope', 'escrow')).rejects.toThrow(TypeError);
    await expect(channelFor(newTradeCode(), 'other' as never)).rejects.toThrow(TypeError);
  });
});
