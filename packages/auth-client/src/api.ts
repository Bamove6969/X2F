/**
 * The typed browser client for the X2F auth API (Plan 2): one method per route, named verb + noun
 * from its path. Requests go to the same origin by default (X9) with `credentials: 'same-origin'`,
 * and carry JSON only. Any non-2xx answer throws `AuthApiError`.
 *
 * Wire shapes are written out here rather than imported, because the server's own types hold
 * `Date`s and rows that never reach the browser; `ApiErrorCode` and the login results are taken
 * from `@x2f/api` as types only, so the two cannot drift apart.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type { AccountKind, ConfirmAction, MethodType } from '@x2f/accounts';
import type { ApiErrorCode, ApprovalView, ApprovalWait, IssuedChallenge, LoginResult, TermsSignature } from '@x2f/api';

export type { ApiErrorCode, ApprovalView, ApprovalWait, LoginResult, TermsSignature };

/** A refused call: the HTTP status, the API's error code and the extra fields it sent. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** A plain sentence about a refused PGP key (only ever about the key the person pasted). */
  readonly detail?: string;
  /** How long to wait before trying again (429 `slow-down` / `locked`, 503 `busy`), kept within 1 second to one day. */
  readonly retryAfterSeconds?: number;
  /** The current Terms version (403 `terms-required`, 400 `terms-not-accepted`). */
  readonly version?: string;
  /** The kind of action that needs a confirm token (403 `confirm-required`). */
  readonly action?: string;
  /** The open full sessions to choose from (409 `too-many-devices`, Task 16). */
  readonly sessions?: Array<{ id: string; deviceLabel: string; lastSeenAt: string; current: boolean }>;
  /** Why a 429 `slow-down` was sent: `approvals` for the hourly cap on login approvals (Task 16), else absent (a throttle on tries). */
  readonly reason?: string;
  /** How a decided approval ended (409 `approval-ended`, Task 16). */
  readonly outcome?: 'approved' | 'blocked' | 'expired';
  /** The team member limit (409 `too-many-members`, Plan 2 Task 18). */
  readonly max?: number;

  constructor(status: number, code: ApiErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
    if (typeof extra.detail === 'string') this.detail = extra.detail;
    if (typeof extra.retryAfterSeconds === 'number' && Number.isFinite(extra.retryAfterSeconds)) {
      // At least 1 s; capped only at one day (the TOTP-backup daily cap waits until UTC midnight).
      this.retryAfterSeconds = Math.min(86_400, Math.max(1, Math.ceil(extra.retryAfterSeconds)));
    }
    if (typeof extra.version === 'string') this.version = extra.version;
    if (typeof extra.action === 'string') this.action = extra.action;
    if (Array.isArray(extra.sessions)) {
      this.sessions = extra.sessions.filter(
        (s): s is { id: string; deviceLabel: string; lastSeenAt: string; current: boolean } =>
          s !== null && typeof s === 'object' && typeof s.id === 'string' && typeof s.deviceLabel === 'string' &&
          typeof s.lastSeenAt === 'string' && typeof s.current === 'boolean',
      );
    }
    if (typeof extra.reason === 'string' && /^[a-z-]{1,40}$/.test(extra.reason)) this.reason = extra.reason;
    if (extra.outcome === 'approved' || extra.outcome === 'blocked' || extra.outcome === 'expired') this.outcome = extra.outcome;
    if (typeof extra.max === 'number' && Number.isInteger(extra.max) && extra.max > 0) this.max = extra.max;
  }
}

// ---------------------------------------------------------------------------------------------
// Wire shapes

export type WebAuthnKind = 'passkey' | 'security-key';

/** A PGP challenge: the armored message to decrypt in the person's own PGP app. */
export type PgpChallenge = IssuedChallenge;

export interface RegistrationChallenge {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface AuthenticationChallenge {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

/**
 * Task 16: the new device's poll. `ok`: the session has started (`loggedOut` names the devices
 * this login logged out); `blocked`: a logged-in device said no or a wrong number was tapped.
 */
export type ApprovalPoll =
  | { status: 'waiting'; expiresAt: string }
  | { status: 'ok'; loggedOut: string[] }
  | { status: 'blocked' }
  | { status: 'expired' };

/** Task 16: the logged-in device's answer: the number it tapped (and, at the device limit, the session to log out), or a block. */
export type ApprovalDecision = { choice: number; logOut?: string } | { block: true };

/** Task 16: the device limit and "One device at a time". */
export interface DeviceSettings {
  oneDevice: boolean;
  maxDevices: number;
}

export interface ConfirmTokenResult {
  confirmToken: string;
}

/** A field the person may leave out until `withConfirm` supplies it. */
type Token = { confirmToken?: string | undefined };

/** Task 10: one login method of the account (nothing secret). */
export interface MethodEntry {
  type: MethodType;
  /** A UUID; for TOTP and recovery codes the type's own name. */
  id: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export type Suggestion = 'add-authenticator' | 'add-backup';

/** Task 11: `GET /v1/account/me`. */
export interface AccountOverview {
  /** The public Trade Tag; the private login name is never sent. */
  tradeTag: string;
  /** True for an account made before login names existed (migration 009): it still logs in by its public Trade Tag and should set a private login name (`setLoginName`). */
  needsLoginName: boolean;
  kind: AccountKind;
  level: 'full';
  /** A recovery-code login may change anything without confirming until this time (one hour), else null. Optional: older API builds do not send it. */
  recoveryUntil?: string | null;
  /** A trader's starter-limits stage (spec 2.3), null for staff and owner. Optional: older API builds do not send it. */
  stage?: 'starter' | 'building' | 'graduated' | null;
  /** Plan 5 Task 6: a trader's completed trades (for "How's X2F doing?"), null for staff and owner. Optional: older API builds do not send it. */
  completedTrades?: number | null;
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  termsCurrent: boolean;
  /**
   * This session is setup-only (the account holds fewer than two kinds of login method, its sign-up
   * window over): only adding a method, the recovery code and logging out work. Optional: older API
   * builds do not send it.
   */
  setupOnly?: boolean;
  /** A new recovery code may be shown once (`revealRecoveryCode`). Optional: older API builds do not send it. */
  recoveryCodeToShow?: boolean;
  /**
   * Plan 2 Task 18: set when the caller is a team member (the overview is of the account they work
   * for, with their own login methods); null for the account owner. Optional: older API builds do not send it.
   */
  member?: {
    name: string;
    roles: TeamRole[];
    /** Job 1c: the member's ticked boxes (`GET /v1/team/permissions` names them). Optional: older API builds do not send them. */
    abilities?: string[];
    preset?: string | null;
    chatLabel?: string;
    /** J-20 review F8 (owner question p11-136): the member's own limits; absent while the API's MEMBER_SEES_OWN_LIMITS is off, or on older builds. */
    limits?: { band: TradeBand | null; hours: WorkingHours };
  } | null;
  /**
   * The calling session's length (owner, 2 Nov 2026): set for a full trader session, null for staff,
   * owner and backup sessions. Optional: older API builds do not send it.
   */
  session?: SessionInfo | null;
  /**
   * The person's idle reminder (owner, Q75, 6 Nov 2026): minutes without activity before the app
   * reminds them (never a logout), or null when off (the default). A team member's is their own.
   * Optional: older API builds do not send it.
   */
  idleReminderMinutes?: number | null;
  /**
   * Owner 2 Nov 2026: 'trader' (takes offers) or 'vendor' (posts offers, may have team members,
   * pays the 1% fee); a member sees the account they work for. Optional: older API builds do not
   * send it (read it with `isVendor`).
   */
  accountType?: AccountType;
  /**
   * Owner demo note #6 (16 Nov 2026) and his answers of 17 Nov: the trader account's rating by its
   * login methods, decided by the API alone (apps/api/src/auth/rating.ts). `high` (a passkey, security
   * key or PGP key) may add a payout address on the trade screen; `weak` (no key) adds them in
   * Settings; `medium` is no longer given (it was a password with the authenticator app). Null for
   * team members, staff and owner. Optional: older API builds do not send it (read it as not high).
   */
  securityRating?: SecurityRating | null;
}

/** Owner demo note #6: an account's rating by the login methods it holds. */
export type SecurityRating = 'weak' | 'medium' | 'high';

/** The Away switch (owner, 26 Nov 2026): on since `since` (ISO), or off with `since` null. */
export interface AwayState {
  away: boolean;
  since: string | null;
}

/**
 * Why Away could not turn one offer back on: a relist check of `POST /v1/account/offers/status`
 * (the API's OfferSwitchRefusal), kept open as a string for codes a newer API adds.
 */
export interface AwayOfferResult {
  id: string;
  status?: 'live' | 'paused';
  refused?: string;
}

/** `PUT /v1/account/away`: on answers the offers it paused, off each offer's relist result. */
export type AwayResult = AwayState & { paused?: string[]; resumed?: AwayOfferResult[] };

/** Owner 2 Nov 2026: Trader and Vendor accounts. */
export type AccountType = 'trader' | 'vendor';

/** True only when the API says the account is a vendor (an older API build that sends nothing: false). */
export function isVendor(me: Pick<AccountOverview, 'accountType'> | null | undefined): boolean {
  return me?.accountType === 'vendor';
}

/** Plan 2 Task 18: a team member's roles (spec 6.7). */
export type TeamRole = 'offers' | 'trades';

/** J-20 (owner p7-4): a member's trade-size band, XMR atomic units as decimal strings, both ends included. */
export interface TradeBand {
  minAtomic: string;
  maxAtomic: string;
}

/** J-20 (owner p7-11): a member's working hours: any time, or days and a daily window in an IANA time zone. */
export type WorkingHours = 'any' | { days: ('Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat')[]; start: string; end: string; tz: string };

/** One of a team member's signed-in sessions, as the account owner sees it (`GET /v1/team/members/:id/sessions`). */
export interface MemberSession {
  id: string;
  deviceLabel: string;
  /** When the member signed in. */
  createdAt: string;
  lastSeenAt: string;
}

/** Plan 2 Task 18: one member or open invite, as the account owner sees it (`GET /v1/team`). */
export interface TeamMember {
  id: string;
  tradeTag: string;
  /** The old roles the member's boxes read as (Job 1c). */
  roles: TeamRole[];
  /** Job 1c: the boxes, in catalogue order, and the preset they match (null: none). Optional: older API builds do not send them. */
  abilities?: string[];
  preset?: string | null;
  /** True when the roles above do not describe the boxes exactly (a custom set): show "Custom", not the roles. */
  custom?: boolean;
  status: 'invited' | 'joining' | 'active';
  /** Owner p11-25 (S-105): how trade chats show the member, "<lead's Trade Tag> Assistant N". Optional: older API builds do not send it. */
  chatLabel?: string;
  /** J-20: the trade-size band (null: none) and working hours (null: stored value invalid, never inside). Optional: older API builds do not send them. */
  band?: TradeBand | null;
  hours?: WorkingHours | null;
  inviteExpiresAt: string | null;
  joinedAt: string | null;
  createdAt: string;
}

/** One box a team member holds, in the catalogue's words (`GET /v1/team/me`). */
export interface MyTeamBox {
  id: string;
  label: string;
  does: string;
  /** Always on for every member, not the lead's choice. */
  always: boolean;
  /** False when the box is ticked but X2F does not offer what it allows yet. */
  ready: boolean;
}

/** A team member's own access, read only (`GET /v1/team/me`; the account owner gets 403 `forbidden`). */
export interface MyTeamAccess {
  name: string;
  chatLabel: string;
  /** The account owner the member works for. */
  lead: { tradeTag: string };
  preset: string | null;
  /** The boxes the member holds, by catalogue group, in catalogue order. */
  groups: { id: string; label: string; boxes: MyTeamBox[] }[];
  /** The band (null: none) and hours, whether `serverNow` is inside them, and when the current window ends (null: any time). Absent when the API does not show a member their limits. */
  limits?: { band: TradeBand | null; hours: WorkingHours; insideNow: boolean; workingUntil: string | null };
  serverNow: string;
}

/**
 * Plan 2 Task 18: an invite as the person invited sees it (`POST /v1/team/invite`). It never names
 * the team account: the vendor is named only once the member is inside (review 2026-11-08 F3).
 */
export interface TeamInviteView {
  tradeTag: string;
  roles: TeamRole[];
  expiresAt: string;
}

/** Plan 2 Task 18: one row of the account owner's audit log. */
export interface TeamAuditEntry {
  id: string;
  at: string;
  /** Null on the account owner's own rows and X2F's (team audit v2). */
  memberId: string | null;
  memberName: string | null;
  /** Team audit v2: 'work', 'team' or 'access' (absent from an older API: work). */
  category?: TeamLogCategory;
  action: string;
  tradeCode: string | null;
  detail: unknown;
}

/** Team audit v2 (migration 855): what a team log row is about. */
export type TeamLogCategory = 'work' | 'team' | 'access';

/** One row of the team log (`GET /v1/team/log`). */
export interface TeamLogEntry {
  id: string;
  at: string;
  /** Who acted: a member, the account owner (`lead`) or X2F itself. */
  actorKind: 'member' | 'lead' | 'system';
  memberId: string | null;
  memberName: string | null;
  byLead: boolean;
  /** The member the row is about. */
  subjectId: string | null;
  subjectName: string | null;
  category: TeamLogCategory;
  action: string;
  tradeCode: string | null;
  detail: unknown;
  /** The chain link (hex SHA-256) and the one before it. */
  hash: string;
  prevHash: string | null;
}

export interface TeamLogFilter {
  from?: string;
  to?: string;
  members?: readonly string[];
  categories?: readonly TeamLogCategory[];
  actions?: readonly string[];
  trade?: string;
  before?: string;
  limit?: number;
}

export interface TeamLogIntegrity {
  ok: boolean;
  entries: number;
  brokenAt: string | null;
  head: { id: string; hash: string } | null;
  fingerprint?: { id: string; matches: boolean };
}

export interface TeamLogMemberSummary {
  memberId: string;
  name: string;
  status: 'invited' | 'active' | 'removed';
  work: number;
  logins: number;
  refused: number;
  changes: number;
  lastActionAt: string | null;
  lastLoginAt: string | null;
}

/** The query string for a team log filter (shared by `teamLog` and `teamLogExport`). */
export function teamLogQuery(q: TeamLogFilter, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (q.from !== undefined) p.set('from', q.from);
  if (q.to !== undefined) p.set('to', q.to);
  if (q.members !== undefined && q.members.length > 0) p.set('member', q.members.join(','));
  if (q.categories !== undefined && q.categories.length > 0) p.set('category', q.categories.join(','));
  if (q.actions !== undefined && q.actions.length > 0) p.set('action', q.actions.join(','));
  if (q.trade !== undefined && q.trade !== '') p.set('trade', q.trade);
  if (q.before !== undefined) p.set('before', q.before);
  if (q.limit !== undefined) p.set('limit', String(q.limit));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** The path of a team log download (`teamLogExport` fetches it; paging fields are dropped). */
export function teamLogExportPath(q: TeamLogFilter, format: 'json' | 'csv'): string {
  const { before: _b, limit: _l, ...rest } = q;
  return `/v1/team/log/export${teamLogQuery(rest, { format })}`;
}

/** A team log download: the file's bytes and the name the server gave it. */
export interface TeamLogExport {
  blob: Blob;
  filename: string;
}

/** The file name of a `content-disposition: attachment; filename="..."` header, or null. */
export function attachmentName(header: string | null): string | null {
  const m = header === null ? null : /filename="([^"\\/]+)"/.exec(header);
  return m === null ? null : m[1]!;
}

/** Task 11: one signed-in device. */
export interface SessionEntry {
  id: string;
  deviceLabel: string;
  level: 'full';
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
  /** Plan 2 Task 18: the team member's name for a member's session, else null (optional on older builds). */
  member?: string | null;
}

/** Task 11: one security alert. */
export interface AlertEntry {
  id: string;
  kind: string;
  detail: unknown;
  createdAt: string;
  seenAt: string | null;
}

/** Task 12: the wallet apps a person can pick (spec 6.4). */
export type WalletApp = 'cake' | 'edge' | 'feather' | 'monerujo' | 'stack' | 'monero-gui-cli' | 'ledger-trezor' | 'other';

/** Task 12: a payout wallet (never a balance). */
export interface Wallet {
  id: string;
  app: WalletApp;
  label: string;
  address: string;
  addressEnd: string;
  usableFrom: string;
  usable: boolean;
  /**
   * Owner demo note #6: for one trade only; the trade that uses it removes it from the list. Optional:
   * older API builds do not send it (saved for future trades).
   */
  oneTime?: boolean;
  /**
   * Owner, 17 Nov 2026: the default the trade screen picks first (the chosen one, else the only usable
   * saved wallet). Optional: older API builds do not send it (no default).
   */
  isDefault?: boolean;
  /**
   * Review 17 Nov (b) M1: the code of the trade, still in setup, that used up this one-time wallet; it
   * is listed (never usable) so it can be removed before it comes back. Absent or null: an open wallet.
   */
  inUseByTrade?: string | null;
}

/** One wallet of an add (the fields the person fills in). */
export interface WalletDraft {
  app: WalletApp;
  label: string;
  address: string;
  /** Owner demo note #6: true for one trade only; absent or false saves it for future trades. */
  oneTime?: boolean;
}

/**
 * `GET /v1/wallets/rule` (owner, 2026-10-24): what adding wallets will do for this account, for the
 * Add a wallet screen to explain before anything is entered. `firstWallet`: the account never had
 * one, so the sign-up session adds it without a confirm. `strongMethods`: the methods it holds to
 * confirm with. No wallet waits (owner, 26 Nov 2026).
 */
export interface WalletRule {
  firstWallet: boolean;
  strongMethods: Array<'pgp' | 'passkey' | 'security-key'>;
}

/**
 * A session's length (owner, 2 Nov 2026): chosen after every login (`lengthHours` null until then,
 * from `choices`); it ends at `expiresAt` unless "Stay logged in" extends it (`extendSession`).
 */
export interface SessionInfo {
  lengthHours: number | null;
  choices: number[];
  expiresAt: string;
  /** True for every full trader session, a team member's included (owner Q73, 6 Nov 2026). */
  canExtend: boolean;
  /** The server's time as it answered (for `serverClock`). */
  serverNow: string;
}

/**
 * Owner rule p5-7: secure Jabber account-change alerts (`GET /v1/account/jabber`). Addresses come
 * back masked only (`mira…@xmpp.example.org`).
 */
export interface JabberStatus {
  /** False until the deployment has a sending account (`jabber-unavailable` on every write). */
  available: boolean;
  /** `broken`: proven, but sealed under a key the server no longer holds; it needs setting up again. */
  state: 'off' | 'on' | 'paused' | 'broken';
  address: string | null;
  pendingAddress: string | null;
  lastSentAt: string | null;
}

/** W-021: the Jabber notice kinds a user can turn on or off (`NOTICE_KINDS` in apps/api jabber/sender.ts; J-20 adds the first login). The page lists whatever the API answers. */
export type JabberEventKind = 'account-change' | 'trade-attention' | 'team-member-first-login';

/** W-021 (owner p11-27): which events send a Jabber notice (`GET /v1/account/jabber/events`), every kind in the server's order. */
export interface JabberEvents {
  /** `canTurnOff: false`: a security notice that stays on (review F1; 409 `jabber-event-always-on`). */
  events: Array<{ kind: JabberEventKind; on: boolean; canTurnOff: boolean }>;
}

/**
 * Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md; `apps/api` disputes/lienRoutes.ts): one
 * of the account's own liens. Amounts are atomic XMR as decimal strings; `rateBps` is the share of
 * each completed trade's proceeds that goes to the creditor (default `defaultRateBps`, 100%). No
 * account ids, no addresses.
 */
export interface LienView {
  id: string;
  status: 'active' | 'suspended' | 'repaid';
  amountAtomic: string;
  recoveredAtomic: string;
  remainingAtomic: string;
  rateBps: number;
  defaultRateBps: number;
  fromCode: string;
}

/**
 * `GET /v1/account/liens`: what the account owes (never a repaid one) and the liens owed to it.
 * Owed to it: totals only (review M4, provisional owner answer Q4: no per-trade rows, no times, no
 * rate), and whether the creditor has signed a recovery address (Q2).
 */
export interface MyLiens {
  owes: LienView[];
  owedTo: Array<Pick<LienView, 'id' | 'status' | 'amountAtomic' | 'recoveredAtomic' | 'remainingAtomic' | 'fromCode'> & { recoveryAddressSet: boolean }>;
}

/**
 * J-23 chat-key courier (`apps/api` auth/chatKeys.ts): a box sealed by one of the person's devices
 * to another device's X25519 key. The API stores and serves it exactly as posted and opens nothing.
 */
export interface ChatKeyEnvelope {
  id: string;
  /** The receiving device's X25519 public key, 64 lower-case hex. */
  recipientPublic: string;
  /** The sealed box, base64url, exactly as posted. */
  sealed: string;
  epoch: number;
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------------------------
// The client

export interface AuthApi {
  // Public
  /** `GET /v1/terms` (Task 11): the Terms version a sign-up must accept. */
  getTerms(): Promise<{ version: string }>;
  /** `GET /v1/pgp/signing-key`: X2F's official PGP key, which signs every challenge (R7). */
  getPgpSigningKey(): Promise<{ fingerprint: string; publicKey: string }>;
  /**
   * `POST /v1/register/name-check`: the sign-up's live "is available" tick for the private username
   * (the login name). Advice only: register checks again. Paced per device (429 `slow-down`) and
   * site wide (503 `busy`), both with `retryAfterSeconds`; 400 `login-name-invalid` for a wrong shape.
   */
  nameAvailable(b: { loginName: string }): Promise<{ available: boolean }>;
  /** Both names are picked at sign-up (spec 6.1): the public `tradeTag` and the private `loginName`; they must differ. */
  /** `POST /v1/login/approval/:id/poll` (Task 16): only the browser that started the login, with its approval cookie; anything else 404. */
  pollLoginApproval(id: string): Promise<ApprovalPoll>;
  /** `POST /v1/login/approval/:id/cancel` (Task 16): stop waiting. */
  cancelLoginApproval(id: string): Promise<void>;
  /**
   * `POST /v1/login/backup`: a recovery code (the only backup way in) logs every other session out
   * and opens a full session that may change anything without confirming for an hour (owner, 26 Nov
   * 2026). The code is spent and a new one is shown once (`revealRecoveryCode`).
   */
  loginBackup(b: { loginName: string; kind: 'recovery-code'; code: string; deviceLabel: string }): Promise<{ status: 'ok' }>;
  registerPgpStart(b: { tradeTag: string; loginName: string; publicKey: string }): Promise<PgpChallenge & { fingerprint: string }>;
  registerPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; acceptedTerms: string }): Promise<{ tradeTag: string }>;
  /**
   * PGP login needs no name: `key` is the person's whole armored public key (an unknown key's decoy
   * goes to that key too). A fingerprint, or anything else, is 400 `key-unreadable`, the same for
   * every key. `pendingId`: the second step of a staff or owner login.
   */
  /** Owner G6 (7 Nov 2026): the trader login takes the private `loginName` with the key (400 without; a wrong name answers like an unknown key). */
  loginPgpStart(b: { loginName: string; key: string; pendingId?: string }): Promise<PgpChallenge>;
  loginPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  registerWebAuthnStart(b: { tradeTag: string; loginName: string; kind: WebAuthnKind }): Promise<RegistrationChallenge>;
  registerWebAuthnFinish(b: {
    challengeId: string;
    response: RegistrationResponseJSON;
    deviceLabel: string;
    acceptedTerms: string;
    label?: string;
  }): Promise<{ tradeTag: string }>;
  /** Without `loginName`: a discoverable passkey login (traders). */
  /** Without `loginName`: discoverable passkey login, or with `pendingId` the second step of a staff or owner login (the pending login names the account). */
  loginWebAuthnStart(b: { loginName?: string; pendingId?: string }): Promise<AuthenticationChallenge>;
  loginWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  /** `POST /v1/account/login-name` (review I3): a pre-009 account sets its private login name once, with a `set-login-name` confirm token (`withConfirm`); 409 `login-name-set` afterwards, 409 `names-unavailable` for a taken name in either namespace, 400 `names-same` / `login-name-invalid`. */
  setLoginName(b: { loginName: string; confirmToken?: string }): Promise<{ ok: true }>;

  // Confirm it's you: each returns a single-use token bound to this session and exactly `action`.
  confirmPgpStart(b: { action: ConfirmAction }): Promise<PgpChallenge>;
  confirmPgpFinish(b: { challengeId: string; code: string }): Promise<ConfirmTokenResult>;
  confirmWebAuthnStart(b: { action: ConfirmAction }): Promise<AuthenticationChallenge>;
  confirmWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<ConfirmTokenResult>;
  /** Review L1 (#94): the same finish for the `key-test` action, which answers `{ tested: true }` and no token. */
  keyTestWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<{ tested: true }>;

  // Login methods of the account
  addPgpKeyStart(b: { publicKey: string } & Token): Promise<PgpChallenge>;
  addPgpKeyFinish(b: { challengeId: string; code: string }): Promise<{ fingerprint: string }>;
  addWebAuthnStart(b: { kind: WebAuthnKind } & Token): Promise<RegistrationChallenge>;
  addWebAuthnFinish(b: { challengeId: string; response: RegistrationResponseJSON; label?: string }): Promise<void>;
  /** `secret` (base32) and `otpauthUri` are for the authenticator app only: show them, never keep them. */
  addTotpStart(b: Token): Promise<{ challengeId: string; otpauthUri: string; secret: string }>;
  addTotpFinish(b: { challengeId: string; code: string }): Promise<void>;
  /** One code at a time: a new one cancels the old one. */
  newRecoveryCodes(b: Token): Promise<{ codes: string[] }>;
  /** `POST /v1/account/recovery-code/reveal`, once, by the owner's session opened with or after a recovery-code login. */
  revealRecoveryCode(): Promise<{ code: string }>;
  /** `POST /v1/account/onboarding/end`: closes this session's sign-up window when sign-up ends (review M1). */
  endOnboarding(): Promise<{ ok: true }>;
  /** Lien recovery: `GET /v1/account/liens`, the account's own liens, both ways. */
  listLiens(): Promise<MyLiens>;
  /** `GET /v1/account/methods` (Task 10). */
  listMethods(): Promise<MethodEntry[]>;
  /** `DELETE /v1/account/methods/:type/:id` (Task 10), the token in a JSON body (R17). */
  removeMethod(type: MethodType, id: string, b: Token): Promise<void>;
  /**
   * `PUT /v1/account/webauthn/label` (owner 25 Nov security-key report): names one of the account's
   * passkeys or security keys by its credential ID (the registration response's `id`). Answers the
   * name as stored; 400 `key-name-invalid` `{ reason }` for a name outside `checkKeyName`.
   */
  renameWebAuthnKey(b: { credentialId: string; label: string }): Promise<{ label: string }>;

  // Account overview (Task 11)
  me(): Promise<AccountOverview>;
  /**
   * `POST /v1/account/terms`: a changed Terms version, accepted with the tick. A trader sends no
   * signature (owner demo note #187, 25 Nov 2026); a team member's session still signs (owner, 9 Nov
   * 2026, p11-14), so `signature` is there for them.
   */
  acceptTerms(b: { version: string; signature?: TermsSignature }): Promise<void>;
  listSessions(): Promise<SessionEntry[]>;
  endSession(id: string): Promise<void>;
  listAlerts(): Promise<AlertEntry[]>;
  markAlertSeen(id: string): Promise<void>;

  // Owner rule p5-7: secure Jabber account-change alerts (boards JabberSetup, Alerts).
  getJabber(): Promise<JabberStatus>;
  /** Sends the test code; 429 `slow-down` `{ retryAfterSeconds }`, 400 `jabber-address-invalid`, 503 `jabber-unavailable`. */
  sendJabberTest(b: { address: string }): Promise<{ pendingAddress: string; resendAfterSeconds: number }>;
  /** 400 `code-invalid`, 409 `challenge-expired` (send a new code). */
  verifyJabber(b: { code: string }): Promise<JabberStatus>;
  setJabberEnabled(b: { on: boolean }): Promise<JabberStatus>;
  turnOffJabber(): Promise<void>;
  /** W-021: which events send a Jabber notice. */
  getJabberEvents(): Promise<JabberEvents>;
  /** W-021: turns one event on or off; 404 `not-found` until an address is proven. */
  setJabberEvent(b: { kind: JabberEventKind; on: boolean }): Promise<JabberEvents>;

  // J-23 chat-key courier (dormant groundwork): full trader sessions of the owner.
  /** `GET /v1/account/chat-keys`: the account's current epoch and its open envelopes, oldest first. */
  listChatKeys(): Promise<{ epoch: number; envelopes: ChatKeyEnvelope[] }>;
  /** `POST /v1/account/chat-keys`: 400 `bad-request` with `{ epoch }` when `epoch` is not the account's current one; 429 `slow-down`. */
  postChatKey(b: { recipientPublic: string; sealed: string; epoch: number }): Promise<{ id: string; expiresAt: string }>;
  /** `DELETE /v1/account/chat-keys/:id`: collects (deletes) an envelope; 404 `not-found`; 429 `slow-down`. */
  collectChatKey(id: string): Promise<void>;

  // New-device approval (Task 16): full trader sessions only.
  /** `GET /v1/account/approvals`: the logins waiting for this account's approval. */
  listApprovals(): Promise<ApprovalView[]>;
  getApproval(id: string): Promise<ApprovalView>;
  /** 409 `too-many-devices` (`AuthApiError.sessions`) at the limit without `logOut`; 409 `approval-ended` (`outcome`). */
  decideApproval(id: string, b: ApprovalDecision): Promise<{ outcome: 'approved' | 'blocked' }>;
  getDeviceSettings(): Promise<DeviceSettings>;
  /** Confirm-it's-you for `{ kind: 'set-one-device', on }` (`withConfirm`). */
  setOneDevice(b: { on: boolean } & Token): Promise<DeviceSettings>;

  // Wallets (Task 12)
  listWallets(): Promise<Wallet[]>;
  /**
   * The first wallet during sign-up needs no token; every later one does (P2-C2): use `withConfirm`.
   * Every wallet is usable at once (owner, 26 Nov 2026: no waits).
   */
  addWallet(b: WalletDraft & Token): Promise<Wallet>;
  /**
   * Several wallets (1-10) under one confirm, action `add-wallets` (see `walletsAction`). They share
   * one `usableFrom`: one wait for the batch, not one each.
   */
  addWallets(b: { wallets: WalletDraft[] } & Token): Promise<Wallet[]>;
  getWalletRule(): Promise<WalletRule>;
  /** Needs no confirm; the server always records a `wallet-removed` alert. */
  removeWallet(id: string): Promise<void>;
  /**
   * Owner, 17 Nov 2026 (note #6 Q1): makes an open saved wallet the default the trade screen picks
   * first (`PUT /v1/wallets/:id/default`, 204). 409 `wallet-one-time` for a one-time wallet,
   * 409 `wallet-not-ready` for a wallet still in its wait (review 17 Nov M1).
   */
  setDefaultWallet(id: string): Promise<void>;
  /**
   * Owner demo note #226: renames an open wallet (`PUT /v1/wallets/:id/label`, 204). The name only:
   * the address, the default and any wait stay as they are, so no confirm. 400 `bad-request` for a
   * name outside the rule (`cleanWalletLabel`), 404 `not-found` for a wallet not open on the account.
   */
  renameWallet(id: string, label: string): Promise<void>;
  // Session length (owner, 2 Nov 2026). Full trader sessions only.
  /** This session's length: before it is chosen, from the login; after, shorter applies now, longer from the next extend. */
  setSessionLength(b: { hours: number }): Promise<SessionInfo>;
  /**
   * "Stay logged in": confirm `{ kind: 'extend-session' }` with one of the person's own login methods
   * first (a team member's own too). `hours`, one of `SessionInfo.choices`, becomes the length and
   * counts from now (owner Q73); absent, the session's own length.
   */
  extendSession(b: Token & { hours?: number }): Promise<SessionInfo>;
  /** The person's idle reminder (owner Q75): one of IDLE_REMINDER_MINUTES, or null for off. */
  setIdleReminder(b: { minutes: number | null }): Promise<{ idleReminderMinutes: number | null }>;
  /** The Away switch (owner, 26 Nov 2026): whether it is on and since when. The account owner only (403 `owner-only`). */
  getAway(): Promise<AwayState>;
  /**
   * Away on pauses every live offer (`paused`: the ones it paused); off turns back on only those,
   * each through the relist checks (`resumed`: each offer's result, with `refused` when it stayed paused).
   */
  setAway(b: { away: boolean }): Promise<AwayResult>;

  /**
   * Owner 2 Nov 2026: switch to a vendor account. Confirm `become-vendor` (`becomeVendorAction`;
   * only a passkey, security key or PGP key may confirm it). 403 `vendor-needs-key` without one.
   */
  becomeVendor(b: Token): Promise<{ accountType: 'vendor' }>;

  // Team members (Plan 2 Task 18). The account owner's side: a member gets 403 `owner-only`.
  getTeam(): Promise<{ members: TeamMember[]; max: number }>;
  /**
   * Confirm `team-invite` (`teamInviteAction`); 409 `too-many-members` `{ max }`, 409 `trade-tag-taken`. `invite` is shown once.
   */
  /** Job 1c: with `abilities` (the boxes, in catalogue order) instead of `roles`, confirm `team-invite-abilities` (`teamInviteAbilitiesAction`). */
  inviteMember(b: ({ tradeTag: string; roles: TeamRole[] } | { tradeTag: string; abilities: string[] }) & Token): Promise<{ id: string; invite: string; expiresAt: string }>;
  /** Confirm `team-roles` (`teamRolesAction`). */
  setMemberRoles(id: string, b: { roles: TeamRole[] } & Token): Promise<TeamMember>;
  /** Job 1c: a member's boxes, in catalogue order; confirm `team-abilities` (`teamAbilitiesAction`). */
  setMemberAbilities(id: string, b: { abilities: string[] } & Token): Promise<TeamMember>;
  /** Confirm `team-remove` (`teamRemoveAction`); the member's sessions end at once. */
  removeMember(id: string, b: Token): Promise<void>;
  /** J-20: confirm `team-limits` (`teamLimitsAction`). */
  setMemberLimits(id: string, b: { band: TradeBand | null; hours: WorkingHours } & Token): Promise<TeamMember>;
  /** A team member's own access, read only: boxes, band, hours and team lead. The account owner gets 403 `forbidden`. */
  myTeamAccess(): Promise<MyTeamAccess>;
  /** A member's signed-in sessions, most recently seen first. 404 for a member not of this account. */
  memberSessions(id: string): Promise<{ sessions: MemberSession[] }>;
  /** Ends one of a member's sessions (the team log gets `session-ended`). */
  endMemberSession(id: string, sessionId: string): Promise<void>;
  /** Ends every session of a member; answers how many ended. */
  endMemberSessions(id: string): Promise<{ ended: number }>;
  /** Newest first, at most 200 rows. */
  teamAudit(q?: { from?: string; to?: string; member?: string }): Promise<TeamAuditEntry[]>;
  /** Team audit v2: one page of the team log, newest first (`next` → the following page's `before`). */
  teamLog(q?: TeamLogFilter): Promise<{ entries: TeamLogEntry[]; next: string | null }>;
  /** The hash-chain check, and with a kept fingerprint whether it still matches (account owner). */
  teamLogIntegrity(fp?: { id: string; hash: string }): Promise<TeamLogIntegrity>;
  /** Per-member counts over the last `days` (account owner). */
  teamLogSummary(days?: number): Promise<{ since: string; members: TeamLogMemberSummary[] }>;
  /**
   * Every row the filter matches as a file, fetched with the session like any other call (account
   * owner). `filename` is the server's (`x2f-team-log-<date>.<format>`). 429 `slow-down` past the
   * account's hourly budget.
   */
  teamLogExport(q: TeamLogFilter, format: 'json' | 'csv'): Promise<TeamLogExport>;
  // The invited person's side (no session yet).
  readInvite(b: { invite: string }): Promise<TeamInviteView>;
  /** `acceptedTerms`: the Terms version the member read and accepted (review 2026-11-08 F1). */
  joinStart(b: { invite: string; loginName: string; publicKey: string; acceptedTerms: string }): Promise<PgpChallenge & { fingerprint: string }>;
  /** The PGP key proved: the member's login exists, no session yet; add the second factor before `setupUntil`. */
  /** `termsSignature`: the signature given on the Terms step, with the version sent at `joinStart` (owner, 9 Nov 2026). */
  joinFinish(b: { challengeId: string; code: string; termsSignature: TermsSignature }): Promise<{ setupId: string; needs: ('security-key' | 'passkey' | 'pgp')[]; setupUntil: string }>;
  joinSecondPgpStart(b: { setupId: string; publicKey: string }): Promise<PgpChallenge & { fingerprint: string }>;
  joinSecondPgpFinish(b: { setupId: string; challengeId: string; code: string; deviceLabel: string }): Promise<{ status: 'ok' }>;
  joinSecondWebAuthnStart(b: { setupId: string; kind: WebAuthnKind }): Promise<RegistrationChallenge>;
  joinSecondWebAuthnFinish(b: { setupId: string; challengeId: string; response: RegistrationResponseJSON; deviceLabel: string; label?: string }): Promise<{
    status: 'ok';
  }>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A positive whole number of seconds from a `Retry-After` header; anything else (a date, junk) is ignored. */
function retryAfterHeader(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const seg = (s: string): string => encodeURIComponent(s);

/** `''` (the same origin) or exactly an http(s) origin such as `https://x2f.example:8443`; anything else throws. */
function checkBaseUrl(baseUrl: string): string {
  if (baseUrl === '') return baseUrl;
  let url: URL | undefined;
  try {
    url = new URL(baseUrl);
  } catch {
    url = undefined;
  }
  if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== baseUrl) {
    throw new TypeError('createAuthApi: baseUrl must be empty or an http(s) origin with no path or trailing slash');
  }
  return baseUrl;
}

export function createAuthApi(o: { baseUrl?: string; fetch?: typeof fetch } = {}): AuthApi {
  const baseUrl = checkBaseUrl(o.baseUrl ?? '');
  // Looked up at call time, so a page (or a test) that replaces `fetch` later is honoured.
  const send: typeof fetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init));

  /** One request; `accept` is JSON unless a download asks for its own type. */
  async function request(method: Method, path: string, body?: object, accept = 'application/json'): Promise<Response> {
    const headers: Record<string, string> = { accept };
    // A redirect is never an auth API answer: refuse it rather than follow it somewhere else.
    const init: RequestInit = { method, credentials: 'same-origin', redirect: 'error', headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return send(`${baseUrl}${path}`, init);
  }

  async function call<T>(method: Method, path: string, body?: object): Promise<T> {
    const res = await request(method, path, body);
    const data = await readJson(res);
    if (res.ok) return data as T;
    throw errorOf(res, data);
  }

  /** A file answer (a download): its bytes, or the same `AuthApiError` as `call`. */
  async function file(path: string, accept: string): Promise<{ blob: Blob; res: Response }> {
    const res = await request('GET', path, undefined, accept);
    if (res.ok) return { blob: await res.blob(), res };
    throw errorOf(res, await readJson(res));
  }

  function errorOf(res: Response, data: unknown): AuthApiError {
    const rec = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const { error, ...extra } = rec;
    if (extra.retryAfterSeconds === undefined) {
      const header = retryAfterHeader(res);
      if (header !== undefined) extra.retryAfterSeconds = header;
    }
    // A reply that is not an API error (a proxy's error page, a body without a code) reads as `internal`.
    return new AuthApiError(res.status, typeof error === 'string' ? (error as ApiErrorCode) : 'internal', extra);
  }

  const get = <T>(path: string) => call<T>('GET', path);
  const post = <T>(path: string, body: object = {}) => call<T>('POST', path, body);
  const done = async (p: Promise<unknown>): Promise<void> => {
    await p;
  };

  return {
    getTerms: () => get('/v1/terms'),
    getPgpSigningKey: () => get('/v1/pgp/signing-key'),
    nameAvailable: (b) => post('/v1/register/name-check', b),
    pollLoginApproval: (id) => post(`/v1/login/approval/${seg(id)}/poll`),
    cancelLoginApproval: (id) => done(post(`/v1/login/approval/${seg(id)}/cancel`)),
    loginBackup: (b) => post('/v1/login/backup', b),
    registerPgpStart: (b) => post('/v1/register/pgp/start', b),
    registerPgpFinish: (b) => post('/v1/register/pgp/finish', b),
    loginPgpStart: (b) => post('/v1/login/pgp/start', b),
    loginPgpFinish: (b) => post('/v1/login/pgp/finish', b),
    registerWebAuthnStart: (b) => post('/v1/register/webauthn/start', b),
    registerWebAuthnFinish: (b) => post('/v1/register/webauthn/finish', b),
    loginWebAuthnStart: (b) => post('/v1/login/webauthn/start', b),
    loginWebAuthnFinish: (b) => post('/v1/login/webauthn/finish', b),
    logout: () => done(post('/v1/logout')),
    setLoginName: (b) => post('/v1/account/login-name', b),

    confirmPgpStart: (b) => post('/v1/confirm/pgp/start', b),
    confirmPgpFinish: (b) => post('/v1/confirm/pgp/finish', b),
    confirmWebAuthnStart: (b) => post('/v1/confirm/webauthn/start', b),
    confirmWebAuthnFinish: (b) => post('/v1/confirm/webauthn/finish', b),
    keyTestWebAuthnFinish: (b) => post('/v1/confirm/webauthn/finish', b),

    addPgpKeyStart: (b) => post('/v1/account/pgp/start', b),
    addPgpKeyFinish: (b) => post('/v1/account/pgp/finish', b),
    addWebAuthnStart: (b) => post('/v1/account/webauthn/start', b),
    addWebAuthnFinish: (b) => done(post('/v1/account/webauthn/finish', b)),
    addTotpStart: (b) => post('/v1/account/totp/start', b),
    addTotpFinish: (b) => done(post('/v1/account/totp/finish', b)),
    newRecoveryCodes: (b) => post('/v1/account/recovery-codes', b),
    revealRecoveryCode: () => post('/v1/account/recovery-code/reveal'),
    endOnboarding: () => post('/v1/account/onboarding/end'),
    listLiens: () => get('/v1/account/liens'),
    listMethods: () => get('/v1/account/methods'),
    removeMethod: (type, id, b) => done(call('DELETE', `/v1/account/methods/${seg(type)}/${seg(id)}`, b)),
    renameWebAuthnKey: (b) => call('PUT', '/v1/account/webauthn/label', b),

    me: () => get('/v1/account/me'),
    acceptTerms: (b) => done(post('/v1/account/terms', b)),
    listSessions: () => get('/v1/account/sessions'),
    endSession: (id) => done(call('DELETE', `/v1/account/sessions/${seg(id)}`)),
    listAlerts: () => get('/v1/account/alerts'),
    markAlertSeen: (id) => done(post(`/v1/account/alerts/${seg(id)}/seen`)),
    getJabber: () => get('/v1/account/jabber'),
    sendJabberTest: (b) => post('/v1/account/jabber/test', b),
    verifyJabber: (b) => post('/v1/account/jabber/verify', b),
    setJabberEnabled: (b) => call('PUT', '/v1/account/jabber/enabled', b),
    turnOffJabber: () => done(call('DELETE', '/v1/account/jabber')),
    getJabberEvents: () => get('/v1/account/jabber/events'),
    setJabberEvent: (b) => call('PUT', '/v1/account/jabber/events', b),
    listChatKeys: () => get('/v1/account/chat-keys'),
    postChatKey: (b) => post('/v1/account/chat-keys', b),
    collectChatKey: (id) => done(call('DELETE', `/v1/account/chat-keys/${seg(id)}`)),
    listApprovals: () => get('/v1/account/approvals'),
    getApproval: (id) => get(`/v1/account/approvals/${seg(id)}`),
    decideApproval: (id, b) => post(`/v1/account/approvals/${seg(id)}`, b),
    getDeviceSettings: () => get('/v1/account/security/devices'),
    setOneDevice: (b) => call('PUT', '/v1/account/security/one-device', b),

    listWallets: () => get('/v1/wallets'),
    addWallet: (b) => post('/v1/wallets', b),
    addWallets: (b) => post('/v1/wallets', b),
    getWalletRule: () => get('/v1/wallets/rule'),
    removeWallet: (id) => done(call('DELETE', `/v1/wallets/${seg(id)}`)),
    setDefaultWallet: async (id) => {
      await call('PUT', `/v1/wallets/${seg(id)}/default`, {});
    },
    renameWallet: async (id, label) => {
      await call('PUT', `/v1/wallets/${seg(id)}/label`, { label });
    },
    setSessionLength: (b) => call('PUT', '/v1/account/session/length', b),
    extendSession: (b) => post('/v1/account/session/extend', b),
    setIdleReminder: (b) => call('PUT', '/v1/account/idle-reminder', b),
    getAway: () => get('/v1/account/away'),
    setAway: (b) => call('PUT', '/v1/account/away', b),

    becomeVendor: (b) => call('PUT', '/v1/account/type', { type: 'vendor', ...b }),

    getTeam: () => get('/v1/team'),
    inviteMember: (b) => post('/v1/team/invites', b),
    setMemberRoles: (id, b) => call('PATCH', `/v1/team/members/${seg(id)}`, b),
    setMemberAbilities: (id, b) => call('PATCH', `/v1/team/members/${seg(id)}`, b),
    removeMember: (id, b) => done(call('DELETE', `/v1/team/members/${seg(id)}`, b)),
    setMemberLimits: (id, b) => call('PUT', `/v1/team/members/${seg(id)}/limits`, b),
    myTeamAccess: () => get('/v1/team/me'),
    memberSessions: (id) => get(`/v1/team/members/${seg(id)}/sessions`),
    endMemberSession: (id, sessionId) => done(call('DELETE', `/v1/team/members/${seg(id)}/sessions/${seg(sessionId)}`)),
    endMemberSessions: (id) => call('DELETE', `/v1/team/members/${seg(id)}/sessions`),
    teamAudit: (q = {}) => {
      const p = new URLSearchParams();
      if (q.from !== undefined) p.set('from', q.from);
      if (q.to !== undefined) p.set('to', q.to);
      if (q.member !== undefined) p.set('member', q.member);
      const qs = p.toString();
      return get(`/v1/team/audit${qs === '' ? '' : `?${qs}`}`);
    },
    teamLog: (q = {}) => get(`/v1/team/log${teamLogQuery(q)}`),
    teamLogIntegrity: (fp) => get(`/v1/team/log/integrity${fp === undefined ? '' : `?id=${seg(fp.id)}&hash=${seg(fp.hash)}`}`),
    teamLogSummary: (days) => get(`/v1/team/log/summary${days === undefined ? '' : `?days=${days}`}`),
    teamLogExport: async (q, format) => {
      const { blob, res } = await file(teamLogExportPath(q, format), format === 'csv' ? 'text/csv' : 'application/json');
      return { blob, filename: attachmentName(res.headers.get('content-disposition')) ?? `x2f-team-log.${format}` };
    },
    readInvite: (b) => post('/v1/team/invite', b),
    joinStart: (b) => post('/v1/team/join/start', b),
    joinFinish: (b) => post('/v1/team/join/finish', b),
    joinSecondPgpStart: (b) => post('/v1/team/join/second/pgp/start', b),
    joinSecondPgpFinish: (b) => post('/v1/team/join/second/pgp/finish', b),
    joinSecondWebAuthnStart: (b) => post('/v1/team/join/second/webauthn/start', b),
    joinSecondWebAuthnFinish: (b) => post('/v1/team/join/second/webauthn/finish', b),
  };
}
