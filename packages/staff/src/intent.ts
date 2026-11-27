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
 * Plan 4 Task 26: the stages a recommended account limit can hold an account to (the two with a
 * cap; Graduated is no limit).
 */
export const LIMIT_STAGES = ['starter', 'building'] as const;
export type LimitStage = (typeof LIMIT_STAGES)[number];

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
  // Chat membership design task 8 (lead 18 Nov): a staff member's own device certification and
  // revocation. The gate ages a certification (365 days) from this signed start time.
  'certify-device', 'revoke-device',
  // Lead call (18 Nov, batch 10a merge): a tapped ban and its lift carry the signed start time too
  // (the API checks it on use; the moderation gate does not read ban taps).
  'ban-account', 'lift-ban',
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
  // Plan 4 Task 27 with D-017: a ban placed outside a ruling, bound to the account, the ban's id, its
  // kind, its rule and its end (null = lifetime); and lifting one.
  | { kind: 'ban-account'; accountId: string; banId: string; banKind: 'trade' | 'site'; ruleId: string; until: string | null; issuedAt?: string }
  | { kind: 'lift-ban'; accountId: string; banId: string; issuedAt?: string }
  // D-059 (J-14, ported): lifting the lock a "My account has been compromised" report put on an
  // account (perm accounts.freeze: a senior moderator or the owner), bound to the account and the report.
  | { kind: 'unlock-account'; accountId: string; ticketId: string }
  | { kind: 'add-owner-key'; credentialId: string; publicKeySha256: string; issuedAt?: string }
  | { kind: 'settings'; largeTradeLimitUsd: number; firstResponseH: number; appealWindowH: number; issuedAt?: string }
  // Chat membership design task 8 (design section 4, lead 18 Nov): a staff member certifies one of
  // their own staff-web device keys (Ed25519 signing key and X25519 box key, lower-case hex), named
  // by its id `staffDeviceKeyId(signPublic)`; and revokes one by that id.
  | { kind: 'certify-device'; accountId: string; deviceKeyId: string; signPublic: string; boxPublic: string; issuedAt?: string }
  | { kind: 'revoke-device'; accountId: string; deviceKeyId: string; issuedAt?: string }
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
      // Owner 26 Nov 2026: each role's default share of X2F's 1% fee on a disputed trade, in basis
      // points of the fee (10000 = 100%); the US-cent amounts above are then the minimum per dispute.
      modFeeBp: number | null;
      seniorFeeBp: number | null;
      // Owner 26 Nov 2026: a flat amount per dispute for each role, US cents, on top of the share.
      modFlatUsdCents: number | null;
      seniorFlatUsdCents: number | null;
    }
  // Owner 26 Nov 2026: one moderator's or senior moderator's own share of the fee (basis points of
  // the fee, 0-10000), overriding their role's default; null = back to the role's default.
  | { kind: 'staff-pay'; accountId: string; feeBp: number | null }
  // Spec 6.6 "Settings" / 2.3 (owner 2026-10-24: "The owner can change every number in Settings"):
  // the starter limits as they will be after the change (whole numbers; `@x2f/staff`'s
  // STARTER_FIELDS). They decide how big a trade a new account can be part of, so they are tapped.
  | {
      kind: 'starter-limits';
      starterCapUsd: number;
      starterMaxOpenTrades: number;
      buildingCapUsd: number;
      buildingMinTrades: number;
      buildingMinDays: number;
      graduatedMinTrades: number;
      graduatedMinDays: number;
    }
  // Plan 4 Task 26: a senior moderator's or the owner's decision on a moderator's recommended
  // account limits, bound to the recommendation and to what it would set (a cap in whole US dollars
  // or a stage; exactly one is non-null).
  | { kind: 'account-limit'; recId: string; accountId: string; approve: boolean; capUsd: number | null; stage: LimitStage | null }
  // Review p4t22 m2 (lead default; owner question OQ3 for the rest): what a stolen owner session
  // without the key could otherwise do to every user at once. Maintenance switched on (the whole
  // trader API on 503, every trade and dispute timer paused), bound to its kind, the message as sent
  // (SHA-256 of its UTF-8, null for none) and the back-by time as sent (null for none); a News message
  // published or edited (`newsId` null for a new one), bound to its title and body as sent; the
  // site banner shown, bound to its kind and text as sent. Switching maintenance off and removing a
  // banner or a message stay untapped.
  /**
   * `messageSha256` (review p4t22 N2): of the message the switch-on shows, which for a planned
   * switch-on with no message of its own is the announced plan's (it inherits it).
   */
  | { kind: 'maintenance-on'; maintenanceKind: 'planned' | 'unplanned'; messageSha256: string | null; backBy: string | null }
  /** Review p4t22 N2: announcing a planned maintenance, its start and end as sent and its message's SHA-256. */
  | { kind: 'maintenance-planned'; startsAt: string; endsAt: string; messageSha256: string | null }
  | { kind: 'news-publish'; newsId: string | null; titleSha256: string; bodySha256: string }
  | { kind: 'banner-publish'; bannerKind: 'info' | 'warning'; textSha256: string }
  // Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): a senior moderator (or the owner)
  // approves a moderator's request to change how much of a debtor's proceeds each trade recovers
  // (basis points). It changes who gets money, so it is tapped and bound to exactly that request.
  | { kind: 'lien-rate'; lienId: string; requestId: string; rateBps: number }
  // Owner 26 Nov 2026: the owner writes a lien off as uncollectible (it ends; the trade can then go).
  | { kind: 'lien-uncollectible'; lienId: string }
  // Owner 26 Nov 2026 (5:43 PM, docs/lien-recovery.md "Grace"): a lien given 7 days to pay the agreed
  // way is switched to collecting from the debtor's later trades (money starts to move), bound to it
  // and to the share the moderator entered (owner 5:51 PM; under 100% it also needs a senior's
  // `lien-rate` tap before the moderation service applies it).
  | { kind: 'lien-collect'; lienId: string; rateBps: number }
  // Review of feat/lien-grace item 3: staff end a lien as repaid off the platform (the traders settled
  // it themselves), at any point while it binds; bound to the lien.
  | { kind: 'lien-paid-off-platform'; lienId: string }
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
  'ban-account',
  'lift-ban',
  'unlock-account',
  'add-owner-key',
  'settings',
  'add-pgp-key',
  'remove-method',
  'set-grants',
  'fee-sweep',
  'payout-address',
  'pay-settings',
  'staff-pay',
  'starter-limits',
  'certify-device',
  'revoke-device',
  'account-limit',
  'maintenance-on',
  'maintenance-planned',
  'news-publish',
  'banner-publish',
  'lien-rate',
  'lien-uncollectible',
  'lien-collect',
  'lien-paid-off-platform',
  'ruling',
] as const satisfies readonly KeyTapIntent['kind'][];

/** Review p4t22 m2: SHA-256 of a text's UTF-8 bytes, lower-case hex (what the publish taps bind). */
export function textSha256(text: string): string {
  if (typeof text !== 'string') throw new TypeError('textSha256: text must be a string');
  return toHex(sha256(utf8(text)));
}

/**
 * Review p4t22 m2: the tap intents of the owner's publishing acts, built one way by the staff site
 * and the API (which rebuilds them from the request body as sent).
 */
export function maintenanceOnIntent(a: { maintenanceKind: 'planned' | 'unplanned'; message: string | null; backBy: string | null }): KeyTapIntent {
  return { kind: 'maintenance-on', maintenanceKind: a.maintenanceKind, messageSha256: a.message === null ? null : textSha256(a.message), backBy: a.backBy };
}
/** Review p4t22 N2: the tap of a planned maintenance's announcement, from its start, end and message as sent. */
export function maintenancePlannedIntent(a: { startsAt: string; endsAt: string; message: string | null }): KeyTapIntent {
  return { kind: 'maintenance-planned', startsAt: a.startsAt, endsAt: a.endsAt, messageSha256: a.message === null ? null : textSha256(a.message) };
}
export function newsPublishIntent(a: { newsId: number | null; title: string; body: string }): KeyTapIntent {
  return { kind: 'news-publish', newsId: a.newsId === null ? null : String(a.newsId), titleSha256: textSha256(a.title), bodySha256: textSha256(a.body) };
}
export function bannerPublishIntent(a: { bannerKind: 'info' | 'warning'; text: string }): KeyTapIntent {
  return { kind: 'banner-publish', bannerKind: a.bannerKind, textSha256: textSha256(a.text) };
}

/**
 * Lead 18 Nov (design task 8): a staff device key's id, SHA-256 of its 32-byte Ed25519 signing
 * public key (given as 64 lower-case hex), as hex, first 32 characters (128 bits). The staff site,
 * the API and the moderation gate all derive it this one way.
 */
export function staffDeviceKeyId(signPublicHex: string): string {
  if (typeof signPublicHex !== 'string' || !/^[0-9a-f]{64}$/.test(signPublicHex)) throw new TypeError('staffDeviceKeyId: signPublic must be 64 lower-case hex characters');
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = Number.parseInt(signPublicHex.slice(i * 2, i * 2 + 2), 16);
  return toHex(sha256(b)).slice(0, 32);
}

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
