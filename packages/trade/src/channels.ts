import { normalizeTradeCode } from '@x2f/core';

export const CHANNEL_KINDS = ['escrow', 'signals', 'chat'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHANNEL_BYTES = 10; // 80 bits = 16 Crockford base32 characters

/**
 * The relay channel ID for one of a trade's channels: the first 10 bytes of
 * HKDF-SHA256(ikm = normalized code, salt = empty, info = "x2f/relay-channel/v1/<kind>"), as
 * 16 Crockford base32 characters grouped like a trade code, so the relay's
 * normalizeTradeCode accepts it. The relay and its logs never see the trade code itself.
 * Async because it uses WebCrypto, which works the same in browsers and Node.
 */
export async function channelFor(code: string, kind: ChannelKind): Promise<string> {
  const normalized = normalizeTradeCode(code);
  if (normalized === null) throw new TypeError('channelFor: invalid trade code');
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) throw new TypeError('channelFor: unknown channel kind');
  const enc = new TextEncoder();
  const ikm = await globalThis.crypto.subtle.importKey('raw', enc.encode(normalized), 'HKDF', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(`x2f/relay-channel/v1/${kind}`) },
    ikm,
    CHANNEL_BYTES * 8,
  );
  let n = 0n;
  for (const b of new Uint8Array(bits)) n = (n << 8n) | BigInt(b);
  let raw = '';
  for (let i = 15; i >= 0; i--) raw += ALPHABET[Number((n >> BigInt(i * 5)) & 31n)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}
