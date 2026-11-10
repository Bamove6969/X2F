/**
 * G37 (owner 7 Nov): a dispute's incident ID. Nine characters of Crockford base32
 * (`0-9A-Z` without I, L, O and U): eight random ones and a Luhn mod 32 check character. The API's
 * database makes them (migration 208, `x2f_incident_id()`); this module checks and reads them, in
 * the browser too.
 */
export const INCIDENT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INCIDENT_ID_LENGTH = 9;

/** The Luhn mod 32 check character for a payload of alphabet characters. */
export function incidentCheckChar(payload: string): string {
  let total = 0;
  let factor = 2;
  for (let i = payload.length - 1; i >= 0; i--) {
    const cp = INCIDENT_ALPHABET.indexOf(payload[i]!);
    if (cp < 0) throw new RangeError('incident payload outside the alphabet');
    const addend = factor * cp;
    total += Math.floor(addend / 32) + (addend % 32);
    factor = 3 - factor;
  }
  return INCIDENT_ALPHABET[(32 - (total % 32)) % 32]!;
}

/** Whether `s` is a well-formed incident ID exactly as stored (upper case, nine characters, check character right). */
export function isIncidentId(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== INCIDENT_ID_LENGTH) return false;
  for (const ch of s) if (!INCIDENT_ALPHABET.includes(ch)) return false;
  return incidentCheckChar(s.slice(0, 8)) === s[8];
}

/**
 * An incident ID as someone typed or read it out: case, spaces and hyphens are ignored, and the
 * look-alikes Crockford allows are read as their digits (I and L as 1, O as 0). Null unless the
 * result is a valid ID (a wrong check character included).
 */
export function normalizeIncidentId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return isIncidentId(s) ? s : null;
}
