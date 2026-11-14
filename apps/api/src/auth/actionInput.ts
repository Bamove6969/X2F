import type { ConfirmAction, MethodType } from '@x2f/accounts';
import { ApiError } from '../errors.js';
import { parseAbilities, TEAM_ROLES as ROLE_ORDER } from '../team/abilities.js';
import { bandFromKey, hoursFromKey } from '../team/limits.js';

const METHODS: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'password', 'totp', 'recovery-codes'];
const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS_END = /^[1-9A-HJ-NP-Za-km-z]{1,6}$/; // base58, as Monero addresses are written
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Plan 2 Task 18: a team member's roles, in their fixed order (owner p4-8 adds the hold rights):
// the same list `parseRoles` accepts (team/abilities.ts `TEAM_ROLES`).
const TEAM_ROLES = {
  test(v: string): boolean {
    const parts = v.split(',');
    const idx = parts.map((p) => (ROLE_ORDER as readonly string[]).indexOf(p));
    return parts.length >= 1 && idx.every((i, k) => i >= 0 && (k === 0 || i > idx[k - 1]!));
  },
};
// Job 1c (J-10): a member's boxes, as the routes bind them: grantable ids, comma-separated, in catalogue order.
function teamAbilities(v: string): boolean {
  try {
    return parseAbilities(v.split(',')).join(',') === v;
  } catch {
    return false;
  }
}
// A member's name as typed (the display-name shape; the full rules run at the invite itself).
const TEAM_NAME = /^[A-Za-z0-9._-]{1,20}$/;
// 1 to MAX_WALLET_BATCH (10) address ends, comma-separated.
const ADDRESS_ENDS = /^[1-9A-HJ-NP-Za-km-z]{1,6}(,[1-9A-HJ-NP-Za-km-z]{1,6}){0,9}$/;

/** The keys each action carries besides `kind`, with a check for each value. */
const SHAPES: Record<ConfirmAction['kind'], Record<string, (v: string) => boolean>> = {
  'add-wallet': { addressHash: (v) => HEX64.test(v), addressEnd: (v) => ADDRESS_END.test(v) },
  'add-wallets': { addressesHash: (v) => HEX64.test(v), addressEnds: (v) => ADDRESS_ENDS.test(v) },
  'add-method': { method: (v) => (METHODS as readonly string[]).includes(v) },
  'remove-method': { method: (v) => (METHODS as readonly string[]).includes(v), id: (v) => ID.test(v) },
  'set-password': {},
  'set-login-name': {},
  'new-recovery-codes': {},
  'set-one-device': { on: (v) => v === 'on' || v === 'off' },
  'add-device-key': { signPublicHash: (v) => HEX64.test(v) },
  'team-invite': { name: (v) => TEAM_NAME.test(v), roles: (v) => TEAM_ROLES.test(v) },
  'team-roles': { memberId: (v) => UUID.test(v), roles: (v) => TEAM_ROLES.test(v) },
  'team-invite-abilities': { name: (v) => TEAM_NAME.test(v), abilities: teamAbilities },
  'team-abilities': { memberId: (v) => UUID.test(v), abilities: teamAbilities },
  'team-remove': { memberId: (v) => UUID.test(v) },
  // J-20: exactly the keys the limits route binds (team/limits.ts `bandKey`, `hoursKey`).
  'team-limits': { memberId: (v) => UUID.test(v), band: (v) => bandFromKey(v) !== undefined, hours: (v) => hoursFromKey(v) !== undefined },
  'extend-session': {},
  'become-vendor': {},
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
