// Crockford base32: no I, L, O or U, so codes can't be misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 16;
const LOOK_ALIKES: Record<string, string> = { O: '0', I: '1', L: '1' };

function group(chars: string): string {
  return chars.match(/.{4}/g)!.join('-');
}

export function newTradeCode(): string {
  // 32 divides 256 evenly, so taking each byte mod 32 has no bias.
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return group(out);
}

export function normalizeTradeCode(input: string): string | null {
  let out = '';
  for (const raw of input.toUpperCase()) {
    if (raw === ' ' || raw === '-') continue;
    const c = LOOK_ALIKES[raw] ?? raw;
    if (!ALPHABET.includes(c)) return null;
    out += c;
  }
  return out.length === LENGTH ? group(out) : null;
}
