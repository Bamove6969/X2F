import type { Role } from '@x2f/core';
import { isRole } from './roles.js';

const JOIN_DOMAIN = 'x2f/relay-join/v1\0';

/** Bytes a party signs to join a trade on the relay: domain + code + NUL + role + NUL + challenge. */
export function joinMessage(code: string, role: Role, challengeB64: string): Uint8Array {
  if (!isRole(role)) throw new TypeError('joinMessage: unknown role');
  if (typeof code !== 'string' || typeof challengeB64 !== 'string') throw new TypeError('joinMessage: strings required');
  if (code.includes('\0') || challengeB64.includes('\0')) throw new TypeError('joinMessage: NUL not allowed');
  return new TextEncoder().encode(`${JOIN_DOMAIN}${code}\0${role}\0${challengeB64}`);
}
