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

/**
 * Lead call on mod-gate review P4 (12 Nov): the owner registry kinds the moderation gate orders
 * carry `issuedAt`, the API's own start time of the tap (`startKeyTap` stamps it; a client never
 * sends it), as an ISO UTC time with milliseconds. Signed with the rest of the intent, so the gate
 * can tell a switch-on made after a switch-off it saw from an older one held back. A tap of these
 * kinds without it has no valid challenge.
 */
export const ISSUED_AT_KINDS = [
  'create-invite', 'set-role', 'switch-on', 'settings', 'add-owner-key', 'remove-staff', 'emergency-stop', 'resume-trading',
  // Lead call on the D-032 reset gap: the gate orders the owner's tapped reset like the others.
  'reset-staff-security',
] as const;
const ISSUED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const hasIssuedAt = (kind: string): boolean => (ISSUED_AT_KINDS as readonly string[]).includes(kind);

/** The intent as the API stores it for a tap started at `at`: `issuedAt` set on the kinds that carry one. */
export function stampIssuedAt(i: KeyTapIntent, at: Date): KeyTapIntent {
  return hasIssuedAt(i.kind) ? ({ ...i, issuedAt: at.toISOString() } as KeyTapIntent) : i;
}

/** What a security-key tap authorises (Task 5 binds each tap to exactly one of these). */
export type KeyTapIntent =
  | { kind: 'emergency-stop'; issuedAt?: string }
  | { kind: 'resume-trading'; issuedAt?: string }
  | { kind: 'create-invite'; inviteId: string; role: Invitable; tokenHash: string; expiresAt: string; issuedAt?: string }
  | { kind: 'switch-on'; accountId: string; role: Invitable; issuedAt?: string }
  | { kind: 'set-role'; accountId: string; role: Invitable; issuedAt?: string }
  // Owner G4 (7 Nov): permanently removing a staff member is tapped.
  | { kind: 'remove-staff'; accountId: string; issuedAt?: string }
  // D-032 (owner G60): the owner's reset of a staff member's security, bound to the person and to the
  // re-enrolment link (its id, the token's hash and the expiry), as `create-invite` binds an invite.
  | { kind: 'reset-staff-security'; accountId: string; inviteId: string; tokenHash: string; expiresAt: string; issuedAt?: string }
  | { kind: 'add-owner-key'; credentialId: string; publicKeySha256: string; issuedAt?: string }
  | { kind: 'settings'; largeTradeLimitUsd: number; firstResponseH: number; appealWindowH: number; issuedAt?: string }
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
  // Plan 4 Task 33 / D-041 (owner 2026-10-29 lead calls q5): a staff member pre-approves one of
  // their own payout addresses; adding one needs the strong login, so it is tapped and bound to
  // exactly that address.
  | { kind: 'payout-address'; address: string }
  // Plan 4 Task 33 / D-042, D-043: the owner's pay settings as they will be after the change (US
  // cents per completed dispute for each role, the senior large-trade share in basis points of the
  // fee and the large-trade threshold in whole US dollars; null = not set). They set what X2F pays.
  | {
      kind: 'pay-settings';
      modDisputeUsdCents: number | null;
      seniorDisputeUsdCents: number | null;
      seniorLargeTradeBp: number | null;
      largeTradeThresholdUsd: number | null;
    }
  // Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): a senior moderator (or the owner)
  // approves a moderator's request to change how much of a debtor's proceeds each trade recovers
  // (basis points). It changes who gets money, so it is tapped and bound to exactly that request.
  | { kind: 'lien-rate'; lienId: string; requestId: string; rateBps: number }
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
      /**
       * Round 2: the id of the round-1 ruling this appeal ruling reviews; round 1: null. Signed so
       * the moderation gate's R37 check rests on the ruling the taps agreed to review, never on the
       * database's word (mod-gate review B2).
       */
      round1Id: string | null;
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
  'payout-address',
  'pay-settings',
  'lien-rate',
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  const issued = (i as { issuedAt?: unknown }).issuedAt;
  if (hasIssuedAt(i.kind) ? typeof issued !== 'string' || !ISSUED_AT.test(issued) || Number.isNaN(Date.parse(issued)) : issued !== undefined) {
    throw new TypeError('tapChallenge: an owner registry intent carries its issuedAt, any other none');
  }
  if (i.kind === 'ruling') {
    const code = normalizeTradeCode(i.code);
    if (code === null) throw new TypeError('tapChallenge: invalid trade code');
    if (i.round === 1 ? i.round1Id !== null : typeof i.round1Id !== 'string' || !UUID.test(i.round1Id)) {
      throw new TypeError('tapChallenge: a round-2 ruling names its round-1 ruling, a round-1 ruling none');
    }
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

/**
 * Re-verify round 3, X2 (lead call): every WebAuthn ceremony on the staff site signs a challenge in
 * its own domain, which the staff site derives itself from a server nonce (64 lower-case hex), so
 * no login or setup assertion can ever be a tap's (`x2f-keytap-v1`) or another ceremony's.
 */
const NONCE_HEX = /^[0-9a-f]{64}$/;
function domainChallenge(prefix: string, nonceHex: string): Uint8Array {
  if (typeof nonceHex !== 'string' || !NONCE_HEX.test(nonceHex)) throw new TypeError(`${prefix}: the nonce must be 64 lower-case hex characters`);
  return sha256(utf8(`${prefix}\n${nonceHex}`));
}

/** The staff login's WebAuthn challenge: SHA-256 of `"x2f-staff-login-v1\n" + nonce`. */
export function staffLoginChallenge(nonceHex: string): Uint8Array {
  return domainChallenge('x2f-staff-login-v1', nonceHex);
}

/** The owner setup's key-registration challenge: SHA-256 of `"x2f-owner-setup-v1\n" + nonce`. */
export function ownerSetupChallenge(nonceHex: string): Uint8Array {
  return domainChallenge('x2f-owner-setup-v1', nonceHex);
}

/** An invite token's hash (lower-case hex SHA-256 of its UTF-8): what the owner's tap and the registration challenge bind. */
export function inviteTokenHash(token: string): string {
  return toHex(sha256(utf8(token)));
}

/** The registration challenge for an invited staff member's key: SHA-256 of `"x2f-invite-v1\n" + tokenHash`. */
export function inviteRegistrationChallenge(tokenHash: string): Uint8Array {
  return sha256(utf8(`x2f-invite-v1\n${tokenHash}`));
}
