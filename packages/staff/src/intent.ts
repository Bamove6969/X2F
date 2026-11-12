import { normalizeTradeCode } from '@x2f/core';
import { canonicalJson } from './canonical.js';
import type { StaffRole } from './roles.js';
import { sha256, toHex, utf8 } from './sha256.js';

/** How an escrow dispute can end: the escrow pays the whole balance to one side. */
export type EscrowOutcome = 'release-to-buyer' | 'refund-to-seller';
/**
 * How a dispute after a refund can end (A6). `seller-sends-xmr` and `seller-returns-fiat` order
 * restitution the escrow cannot pay. `seller-sends-xmr` puts a lien on the seller at publish (Task
 * 25, `lienSteps`); `seller-returns-fiat` does not yet (NEEDS_OWNER_FIAT_LIEN in lien.ts).
 */
export type AfterRefundOutcome = 'seller-sends-xmr' | 'seller-returns-fiat' | 'no-action';
export type RulingOutcome = EscrowOutcome | AfterRefundOutcome;

export const ESCROW_OUTCOMES = ['release-to-buyer', 'refund-to-seller'] as const satisfies readonly EscrowOutcome[];
export const AFTER_REFUND_OUTCOMES = [
  'seller-sends-xmr',
  'seller-returns-fiat',
  'no-action',
] as const satisfies readonly AfterRefundOutcome[];

/**
 * The general reason a ban shows (Revision 2026-10-29b, lead default, owner may change; the
 * wording is `COPY-UNSIGNED` and lives with the screens): "Breaking the Terms of Service",
 * "Problems in trades", "Abuse of other traders", "Account security".
 */
export const BAN_REASON_CODES = ['terms', 'trade-problems', 'abuse', 'account-security'] as const;
export type BanReasonCode = (typeof BAN_REASON_CODES)[number];

/**
 * The account action a ruling carries. Revisions: the `hold` action is gone (2026-10-29c: replaced
 * by the lien of Task 25, which follows from the outcome and is not chosen); the single `ban` is
 * replaced by the owner's ban stages (Task 27): a trade ban or a site ban, each until an exact
 * ISO time or, with `until: null`, permanent. Any ban needs a second approver (Task 2), who is a
 * senior moderator or the owner, so a moderator alone can never ban.
 * D-015 (owner 2026-11-02 08:12): the freeze is NOT an account action of a ruling. It is only a
 * separate, later act on a party who ignored the dispute or the ruling (`POST
 * /staff/v1/disputes/:code/freeze`), never an option on the ruling card.
 */
export type AccountAction =
  | { kind: 'none' }
  | { kind: 'trade-ban' | 'site-ban'; until: string | null; reasonCode: BanReasonCode };

type Invitable = Exclude<StaffRole, 'owner'>;

/** What a security-key tap authorises (Task 5 binds each tap to exactly one of these). */
export type KeyTapIntent =
  | { kind: 'emergency-stop' }
  | { kind: 'resume-trading' }
  | { kind: 'create-invite'; inviteId: string; role: Invitable; tokenHash: string; expiresAt: string }
  | { kind: 'switch-on'; accountId: string; role: Invitable }
  | { kind: 'set-role'; accountId: string; role: Invitable }
  // Owner G4 (7 Nov): permanently removing a staff member is tapped.
  | { kind: 'remove-staff'; accountId: string }
  // D-032 (owner G60): the owner's reset of a staff member's security, bound to the person and to the
  // re-enrolment link (its id, the token's hash and the expiry), as `create-invite` binds an invite.
  | { kind: 'reset-staff-security'; accountId: string; inviteId: string; tokenHash: string; expiresAt: string }
  | { kind: 'add-owner-key'; credentialId: string; publicKeySha256: string }
  | { kind: 'settings'; largeTradeLimitUsd: number; firstResponseH: number; appealWindowH: number }
  // Lead re-review 6 Nov item 1: a staff member or the owner changes their own login methods on the
  // staff site, each change confirmed by a tap of one of their security keys.
  | { kind: 'add-pgp-key'; fingerprint: string }
  // Owner Q60/Q16: the per-person checkboxes (`grants`, sorted), set by the owner with a tap.
  | { kind: 'set-grants'; accountId: string; grants: string[] }
  | { kind: 'remove-method'; methodType: 'pgp' | 'security-key' | 'passkey'; methodId: string }
  // Plan 4 Task 9 / B-006 (owner 2026-10-29 q7): the fee wallet's automatic sweep to the owner's
  // cold address, as it will be after the change (amounts in atomic units as decimal strings; a
  // null threshold turns the sweep off). It names where X2F's money goes, so it is tapped.
  | { kind: 'fee-sweep'; thresholdAtomic: string | null; floatAtomic: string | null; coldAddress: string | null }
  | {
      kind: 'ruling';
      step: 'propose' | 'approve';
      rulingId: string;
      code: string;
      round: 1 | 2;
      outcome: RulingOutcome;
      accountAction: AccountAction;
      amountAtomic: string;
      reasonSha256: string;
      /**
       * Review mod-screens M1: the evidence lines both traders read beside the reason, as the ruling
       * stores them (in order), bound like the reason: `evidenceSha256(lines)`.
       */
      evidenceSha256: string;
    };

export const KEY_TAP_KINDS = [
  'emergency-stop',
  'resume-trading',
  'create-invite',
  'switch-on',
  'set-role',
  'remove-staff',
  'reset-staff-security',
  'add-owner-key',
  'settings',
  'add-pgp-key',
  'remove-method',
  'set-grants',
  'fee-sweep',
  'ruling',
] as const satisfies readonly KeyTapIntent['kind'][];

/**
 * Review mod-screens M1: what a ruling tap binds of its evidence lines. SHA-256 (lower-case hex) of
 * the UTF-8 bytes of `canonicalJson(lines)`: a JSON array of the lines as strings, in their order,
 * with no whitespace (`["a","b"]`), so the order, the split into lines and every character count.
 * The staff web, the API (which rebuilds it from the lines it stores) and the moderation gate all
 * use this one function.
 */
export function evidenceSha256(lines: readonly string[]): string {
  if (!Array.isArray(lines) || lines.some((l) => typeof l !== 'string')) throw new TypeError('evidenceSha256: lines must be strings');
  return toHex(sha256(utf8(canonicalJson([...lines]))));
}

/** Shortest nonce accepted (bytes). The server issues 16 (Task 5, `startKeyTap`). */
const MIN_NONCE = 16;

/**
 * The WebAuthn challenge for a tap: SHA-256 of `"x2f-keytap-v1\n" + canonicalJson(intent) + "\n" +
 * hex(nonce)`. A ruling's trade code is normalised first, so a code typed with or without dashes
 * binds the same ruling; an invalid code, an unknown kind or a short nonce throws TypeError.
 */
export function tapChallenge(i: KeyTapIntent, nonce: Uint8Array): Uint8Array {
  if (!(KEY_TAP_KINDS as readonly string[]).includes(i.kind)) throw new TypeError('tapChallenge: unknown intent kind');
  if (!(nonce instanceof Uint8Array) || nonce.length < MIN_NONCE) throw new TypeError('tapChallenge: nonce too short');
  let intent: KeyTapIntent = i;
  if (i.kind === 'ruling') {
    const code = normalizeTradeCode(i.code);
    if (code === null) throw new TypeError('tapChallenge: invalid trade code');
    intent = { ...i, code };
  }
  return sha256(utf8(`x2f-keytap-v1\n${canonicalJson(intent)}\n${toHex(nonce)}`));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A key's check code, shown on the locked setup page and by `pin-owner`: the first 80 bits of
 * SHA-256 of the public key in Crockford base32, grouped `XXXX-XXXX-XXXX-XXXX` like a trade code.
 */
export function keyCheckCode(publicKey: Uint8Array): string {
  const d = sha256(publicKey);
  let bits = 0n;
  for (let i = 0; i < 10; i++) bits = (bits << 8n) | BigInt(d[i]!);
  let raw = '';
  for (let i = 15; i >= 0; i--) raw += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/** The registration challenge for an invited staff member's key: SHA-256 of `"x2f-invite-v1\n" + tokenHash`. */
export function inviteRegistrationChallenge(tokenHash: string): Uint8Array {
  return sha256(utf8(`x2f-invite-v1\n${tokenHash}`));
}
