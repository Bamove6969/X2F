import type { ConfirmAction, MethodType } from '@x2f/accounts';
import { ApiError } from '../errors.js';

const METHODS: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'password', 'totp', 'recovery-codes'];
const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS_END = /^[1-9A-HJ-NP-Za-km-z]{1,6}$/; // base58, as Monero addresses are written
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// 1 to MAX_WALLET_BATCH (10) address ends, comma-separated.
const ADDRESS_ENDS = /^[1-9A-HJ-NP-Za-km-z]{1,6}(,[1-9A-HJ-NP-Za-km-z]{1,6}){0,9}$/;

/** The keys each action carries besides `kind`, with a check for each value. */
const SHAPES: Record<ConfirmAction['kind'], Record<string, (v: string) => boolean>> = {
  'add-wallet': { addressHash: (v) => HEX64.test(v), addressEnd: (v) => ADDRESS_END.test(v) },
  'add-wallets': { addressesHash: (v) => HEX64.test(v), addressEnds: (v) => ADDRESS_ENDS.test(v) },
  'add-method': { method: (v) => (METHODS as readonly string[]).includes(v) },
  'remove-method': { method: (v) => (METHODS as readonly string[]).includes(v), id: (v) => ID.test(v) },
  'set-password': {},
  'new-recovery-codes': {},
  'add-device-key': { signPublicHash: (v) => HEX64.test(v) },
};

/**
 * The `action` of a confirm request (Tasks 6-8), checked against the exact shape of one
 * `ConfirmAction`: known kind, exactly its keys, every value a well-formed string. Anything else →
 * 400 `bad-request`, so a token is only ever issued for an action some route can redeem.
 */
export function parseConfirmAction(raw: unknown): ConfirmAction {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const rec = raw as Record<string, unknown>;
  const kind = rec.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(SHAPES, kind)) throw new ApiError(400, 'bad-request');
  const shape = SHAPES[kind as ConfirmAction['kind']];
  const keys = Object.keys(rec);
  if (keys.length !== Object.keys(shape).length + 1) throw new ApiError(400, 'bad-request');
  const out: Record<string, string> = { kind };
  for (const [key, ok] of Object.entries(shape)) {
    const v = rec[key];
    if (!Object.hasOwn(rec, key) || typeof v !== 'string' || !ok(v)) throw new ApiError(400, 'bad-request');
    out[key] = v;
  }
  return out as unknown as ConfirmAction;
}
