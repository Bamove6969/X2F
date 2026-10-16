import { ROLES, type Role } from '@x2f/core';

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}

/** A plain object: prototype Object.prototype or null (no arrays, no class instances). */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Own enumerable string keys equal `keys` exactly, and no symbol keys. */
export function hasExactKeys(o: object, keys: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

export const MAX_TRADE_LEN = 256;
