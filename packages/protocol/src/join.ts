import type { Role } from '@x2f/core';
import { isRole } from './roles.js';

const JOIN_DOMAIN = 'x2f/relay-join/v1\0';
/**
 * Canonical standard base64 of exactly 32 bytes: 42 free characters, then one whose two low
 * bits are zero (the 2 padding bits), then '='.
 */
const CHALLENGE_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

/**
 * Bytes a party signs to join a trade on the relay:
 * "x2f/relay-join/v1\0" + code + "\0" + role + "\0" + challenge.
 * The challenge must be canonical base64 of exactly 32 bytes.
 */
export function joinMessage(code: string, role: Role, challengeB64: string): Uint8Array {
  if (!isRole(role)) throw new TypeError('joinMessage: unknown role');
  if (typeof code !== 'string' || code.includes('\0')) throw new TypeError('joinMessage: invalid code');
  if (typeof challengeB64 !== 'string' || !CHALLENGE_B64.test(challengeB64)) {
    throw new TypeError('joinMessage: challenge must be canonical base64 of 32 bytes');
  }
  return new TextEncoder().encode(`${JOIN_DOMAIN}${code}\0${role}\0${challengeB64}`);
}
