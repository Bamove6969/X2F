import { canonicalJson, type Participants } from '@x2f/protocol';
import { WORDLIST } from './wordlist.js';

/**
 * Escrow-check words: four words both trader apps show so each can read them aloud and confirm
 * they joined the same escrow (spec 6.3). They derive from SHA-256 over the attested participants
 * and the multisig address, so a man-in-the-middle who swapped either would show different words.
 *
 * Browser-safe: WebCrypto only (so it is async, like `channelFor`), and a bundled wordlist — the
 * standard BIP-39 English 2048-word list, never fetched at runtime.
 */
const DOMAIN = 'x2f/escrow-check/v1\0';
const WORDS = 4;
const BITS_PER_WORD = 11; // 2^11 = 2048
const MASK = (1n << BigInt(BITS_PER_WORD)) - 1n;

export async function escrowCheckWords(
  participants: Participants,
  escrowAddress: string,
): Promise<[string, string, string, string]> {
  if (typeof escrowAddress !== 'string' || escrowAddress.length === 0) {
    throw new TypeError('escrowCheckWords: invalid escrow address');
  }
  const bytes = new TextEncoder().encode(`${DOMAIN}${canonicalJson(participants)}\0${escrowAddress}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  // The high 44 bits of the digest, as four 11-bit indices (most significant first).
  let acc = 0n;
  for (let i = 0; i < 6; i++) acc = (acc << 8n) | BigInt(digest[i] ?? 0);
  acc >>= BigInt(48 - WORDS * BITS_PER_WORD); // drop the 4 low bits of the 6 bytes read
  const out: string[] = [];
  for (let k = WORDS - 1; k >= 0; k--) {
    const word = WORDLIST[Number((acc >> BigInt(k * BITS_PER_WORD)) & MASK)];
    if (word === undefined) throw new Error('escrowCheckWords: word index out of range');
    out.push(word);
  }
  return out as [string, string, string, string];
}
