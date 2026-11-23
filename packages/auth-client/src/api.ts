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

/**
 * Hold model v3: a security change made from a login with just a username and password (202): nothing
 * changed yet; it is a draft of this session (`changeId`) to review and submit (`submitHoldChanges`),
 * then applies on its own 24 h after the account's latest submission (owner Q14). A login with a
 * passkey, security key or PGP key held before discards it; any session of the owner cancels it.
 */
export interface Staged {
  status: 'staged';
  changeId: string;
}

/** True for a change staged by hold model v3 (202 `{ status: 'staged', changeId }`). */
export function isStaged(x: unknown): x is Staged {
  return x !== null && typeof x === 'object' && (x as { status?: unknown }).status === 'staged' && typeof (x as { changeId?: unknown }).changeId === 'string';
}

/** Hold model v3: what a staged or waiting change is (never a secret, an address or a key). */
export interface HoldChangeSummary {
  kind: string;
  method?: string;
  wallets?: number;
  /** Wallets: each new address's last 6 characters. Optional: older API builds do not send it. */
  addressEnds?: string[];
  /** Wallets (owner note #6): for each, in order, whether it is for one trade only. Absent from older API builds. */
  oneTime?: boolean[];
  on?: boolean;
  memberId?: string;
  roles?: string[];
  /** A member's new boxes (Job 1c, `team-abilities`): their ids, and each one's catalogue label. */
  abilities?: string[];
  abilityLabels?: string[];
  /** A wallet removed (owner p5-7): its label (and `addressEnds` its address's last 6). */
  label?: string;
  /** J-20 (`team-limits`): a member's new trade-size band (null: none) and working hours. */
  band?: TradeBand | null;
  hours?: WorkingHours;
}

/** Hold model v3: `GET /v1/account/hold`. */
export interface HoldView {
  /** The account's hold (a recovery-code login's), while one runs. */
  accountHold: { until: string; reason: string } | null;
  /** Every waiting (submitted) change of the account, each with its own date (lead review 8 Nov I4); `takesEffectAt` is the next one. */
  changes: {
    count: number;
    takesEffectAt: string | null;
    items: Array<HoldChangeSummary & { id: string; createdAt: string; submittedAt: string; takesEffectAt?: string; by: string | null; mine: boolean }>;
  };
  /** This session's drafts, to review and submit. */
  drafts: Array<HoldChangeSummary & { id: string; createdAt: string }>;
  /** This session's changes are staged instead of applied. */
  changesWait: boolean;
  /**
   * Owner p4-8: set for a team member only, their "Holds and waiting changes" right (`none`: they
   * see only that a hold is on, no list), and `lead`, the team's name.
   */
  rights?: 'none' | 'see' | 'cancel' | 'end';
  lead?: string;
}

/** A refused call: the HTTP status, the API's error code and the extra fields it sent. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** A plain sentence about a refused PGP key (only ever about the key the person pasted). */
  readonly detail?: string;
  /** How long to wait before trying again (429 `slow-down` / `locked`, 503 `busy`), kept within 1 second to one day. */
  readonly retryAfterSeconds?: number;
  /** The password rules not met (400 `password-weak`). */
  readonly missing?: string[];
  /** When a held recovery session may make changes (403 `recovery-hold`). */
  readonly holdUntil?: string;
  /** The current Terms version (403 `terms-required`, 400 `terms-not-accepted`). */
  readonly version?: string;
  /** The kind of action that needs a confirm token (403 `confirm-required`). */
  readonly action?: string;
  /** This browser's password-login misses in a row (401 `credentials-invalid` from `loginPassword`); see `shouldSendAway`. */
  readonly misses?: number;
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
    if (Array.isArray(extra.missing)) this.missing = extra.missing.filter((m): m is string => typeof m === 'string');
    if (typeof extra.holdUntil === 'string') this.holdUntil = extra.holdUntil;
    if (typeof extra.version === 'string') this.version = extra.version;
    if (typeof extra.action === 'string') this.action = extra.action;
    if (typeof extra.misses === 'number' && Number.isInteger(extra.misses) && extra.misses > 0) this.misses = extra.misses;
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

/**
 * The one sentence for every failed password login (owner, 2026-10-23): an unknown login name, a
 * wrong password and a name the server is quietly not checking all read the same. Show no wait.
 */
export const PASSWORD_LOGIN_MISMATCH = "That login name and password don't match";

/** After about this many password-login misses in a row, the page sends the visitor away from the site. */
export const MISSES_BEFORE_SENDING_AWAY = 10;

/**
 * True when a refused `loginPassword` call says this browser has missed `MISSES_BEFORE_SENDING_AWAY`
 * times in a row: the login page should then send the visitor away (the redirect itself is Plan 3's
 * screen). The count comes from the server (per browser, never per name), so a reload does not
 * reset it. Any other error, or none, is false.
 */
export function shouldSendAway(e: unknown): boolean {
  return e instanceof AuthApiError && e.code === 'credentials-invalid' && (e.misses ?? 0) >= MISSES_BEFORE_SENDING_AWAY;
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
 * A password login: a session, (TOTP enrolled) a pending login for `loginSecondFactor`, or (Task 16)
 * a wait for a logged-in device to approve this one (`pollLoginApproval`).
 */
/** Review M2: `setupOnly` when the account's only login is the password: the session may only add a second method. */
export type PasswordLoginResult = { status: 'ok'; setupOnly?: true } | { status: 'second-factor'; pendingId: string; needs: ['totp'] } | ApprovalWait;

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
  /** A UUID; for password, TOTP and recovery codes the type's own name. */
  id: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export type Suggestion = 'add-authenticator' | 'add-backup';

/** Task 11: `GET /v1/account/me`. */
export interface AccountOverview {
  /** The public display name; the private login name is never sent. */
  displayName: string;
  /** True for an account made before login names existed (migration 009): it still logs in by its public display name and should set a private login name (`setLoginName`). */
  needsLoginName: boolean;
  kind: AccountKind;
  level: 'full' | 'recovery';
  holdUntil: string | null;
  /** A trader's starter-limits stage (spec 2.3), null for staff and owner. Optional: older API builds do not send it. */
  stage?: 'starter' | 'building' | 'graduated' | null;
  /** Plan 5 Task 6: a trader's completed trades (for "How's X2F doing?"), null for staff and owner. Optional: older API builds do not send it. */
  completedTrades?: number | null;
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  termsCurrent: boolean;
  /**
   * Review M2: this session is setup-only (the account's only login is a password, its sign-up
   * window over): only adding a second method, the recovery code and logging out work. Optional:
   * older API builds do not send it.
   */
  setupOnly?: boolean;
  /** Task 17: when the account's 24-hour hold ends, while one runs (any session of the account). Optional: older API builds do not send it. */
  accountHoldUntil?: string | null;
  /** Hold model v3: the account's waiting changes (the banner), else null. Optional: older API builds do not send it. */
  pendingChanges?: { count: number; takesEffectAt: string } | null;
  /** Owner p4-8: for a team member, while the lead's changes wait, when they take effect (nothing more). */
  teamHold?: { takesEffectAt: string } | null;
  /** Hold model v3: this session's changes are staged and wait 24 h. Optional: older API builds do not send it. */
  changesWait?: boolean;
  /** Hold model v3: a new recovery code may be shown once (`revealRecoveryCode`). Optional: older API builds do not send it. */
  recoveryCodeToShow?: boolean;
  /**
   * Plan 2 Task 18: set when the caller is a team member (the overview is of the account they work
   * for, with their own login methods); null for the account owner. Optional: older API builds do not send it.
   */
  member?: {
    name: string;
    roles: TeamRole[];
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
   * key or PGP key, with or without a password) may add a payout address on the trade screen; `medium`
   * (a password with the authenticator app) and `weak` (a password alone) add them in Settings. Null for
   * team members, staff and owner. Optional: older API builds do not send it (read it as not high).
   */
  securityRating?: SecurityRating | null;
}

/** Owner demo note #6: an account's rating by the login methods it holds. */
export type SecurityRating = 'weak' | 'medium' | 'high';

/** Owner 2 Nov 2026: Trader and Vendor accounts. */
export type AccountType = 'trader' | 'vendor';

/** True only when the API says the account is a vendor (an older API build that sends nothing: false). */
export function isVendor(me: Pick<AccountOverview, 'accountType'> | null | undefined): boolean {
  return me?.accountType === 'vendor';
}

/** Plan 2 Task 18: a team member's roles (spec 6.7); owner p4-8 adds the hold rights (each includes the ones before it). */
export type TeamRole = 'offers' | 'trades' | 'hold-see' | 'hold-cancel' | 'hold-end';

/** J-20 (owner p7-4): a member's trade-size band, XMR atomic units as decimal strings, both ends included. */
export interface TradeBand {
  minAtomic: string;
  maxAtomic: string;
}

/** J-20 (owner p7-11): a member's working hours: any time, or days and a daily window in an IANA time zone. */
export type WorkingHours = 'any' | { days: ('Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat')[]; start: string; end: string; tz: string };

/** Plan 2 Task 18: one member or open invite, as the account owner sees it (`GET /v1/team`). */
export interface TeamMember {
  id: string;
  displayName: string;
  /** The old roles the member's boxes read as (Job 1c). */
  roles: TeamRole[];
  /** Job 1c: the boxes, in catalogue order, and the preset they match (null: none). Optional: older API builds do not send them. */
  abilities?: string[];
  preset?: string | null;
  /** True when the roles above do not describe the boxes exactly (a custom set): show "Custom", not the roles. */
  custom?: boolean;
  status: 'invited' | 'joining' | 'active';
  /** Owner p11-25 (S-105): how trade chats show the member, "<lead's display name> Assistant N". Optional: older API builds do not send it. */
  chatLabel?: string;
  /** J-20: the trade-size band (null: none) and working hours (null: stored value invalid, never inside). Optional: older API builds do not send them. */
  band?: TradeBand | null;
  hours?: WorkingHours | null;
  inviteExpiresAt: string | null;
  joinedAt: string | null;
  createdAt: string;
}

/**
 * Plan 2 Task 18: an invite as the person invited sees it (`POST /v1/team/invite`). It never names
 * the team account: the vendor is named only once the member is inside (review 2026-11-08 F3).
 */
export interface TeamInviteView {
  displayName: string;
  roles: TeamRole[];
  expiresAt: string;
}

/** Plan 2 Task 18: one row of the account owner's audit log. */
export interface TeamAuditEntry {
  id: string;
  at: string;
  memberId: string;
  memberName: string;
  action: string;
  tradeCode: string | null;
  detail: unknown;
}

/** Task 11: one signed-in device. */
export interface SessionEntry {
  id: string;
  deviceLabel: string;
  level: 'full' | 'recovery';
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
 * one, so the next add works at once whatever the method. `strongMethods`: the methods it holds
 * that make new wallets work at once. `password`: whether a password confirm is possible and would
 * wait (`none`, `immediate`, `waits`).
 */
export interface WalletRule {
  firstWallet: boolean;
  strongMethods: Array<'pgp' | 'passkey' | 'security-key'>;
  password: 'none' | 'immediate' | 'waits';
  waitHours: number;
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
  /** Both names are picked at sign-up (spec 6.1): the public `displayName` and the private `loginName`; they must differ. */
  /** `acceptedTerms` and `termsSignature`: the Terms version accepted and the signature given with it (owner, 8 Nov 2026). */
  registerPassword(b: {
    displayName: string;
    loginName: string;
    password: string;
    deviceLabel: string;
    acceptedTerms: string;
    termsSignature: TermsSignature;
  }): Promise<{
    displayName: string;
  }>;
  /** Every failure is 401 `credentials-invalid` (`PASSWORD_LOGIN_MISMATCH`) with `misses`; check `shouldSendAway`. */
  loginPassword(b: { loginName: string; password: string; deviceLabel: string }): Promise<PasswordLoginResult>;
  /** `POST /v1/login/second-factor`: the TOTP code for a password login's `pendingId`. */
  loginSecondFactor(b: { pendingId: string; code: string }): Promise<{ status: 'ok' } | ApprovalWait>;
  /** `POST /v1/login/approval/:id/poll` (Task 16): only the browser that started the login, with its approval cookie; anything else 404. */
  pollLoginApproval(id: string): Promise<ApprovalPoll>;
  /** `POST /v1/login/approval/:id/cancel` (Task 16): stop waiting. */
  cancelLoginApproval(id: string): Promise<void>;
  /**
   * `POST /v1/login/backup`: a recovery code (the only backup way in; an authenticator code is 400
   * `bad-request`) opens a recovery session held 24 hours.
   */
  loginBackup(b: { loginName: string; kind: 'recovery-code'; code: string; deviceLabel: string }): Promise<{
    status: 'ok';
    level: 'recovery';
    holdUntil: string | null;
  }>;
  registerPgpStart(b: { displayName: string; loginName: string; publicKey: string }): Promise<PgpChallenge & { fingerprint: string }>;
  registerPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; acceptedTerms: string; termsSignature: TermsSignature }): Promise<{ displayName: string }>;
  /**
   * PGP login needs no name: `key` is the person's whole armored public key (an unknown key's decoy
   * goes to that key too). A fingerprint, or anything else, is 400 `key-unreadable`, the same for
   * every key. `pendingId`: the second step of a staff or owner login.
   */
  /** Owner G6 (7 Nov 2026): the trader login takes the private `loginName` with the key (400 without; a wrong name answers like an unknown key). */
  loginPgpStart(b: { loginName: string; key: string; pendingId?: string }): Promise<PgpChallenge>;
  loginPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  registerWebAuthnStart(b: { displayName: string; loginName: string; kind: WebAuthnKind }): Promise<RegistrationChallenge>;
  registerWebAuthnFinish(b: {
    challengeId: string;
    response: RegistrationResponseJSON;
    deviceLabel: string;
    acceptedTerms: string;
    termsSignature: TermsSignature;
    label?: string;
  }): Promise<{ displayName: string }>;
  /** Without `loginName`: a discoverable passkey login (traders). */
  /** Without `loginName`: discoverable passkey login, or with `pendingId` the second step of a staff or owner login (the pending login names the account). */
  loginWebAuthnStart(b: { loginName?: string; pendingId?: string }): Promise<AuthenticationChallenge>;
  loginWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  /** `POST /v1/account/login-name` (review I3): a pre-009 account sets its private login name once, with a `set-login-name` confirm token (`withConfirm`); 409 `login-name-set` afterwards, 409 `names-unavailable` for a taken name in either namespace, 400 `names-same` / `login-name-invalid`. */
  setLoginName(b: { loginName: string; confirmToken?: string }): Promise<{ ok: true } | Staged>;

  // Confirm it's you: each returns a single-use token bound to this session and exactly `action`.
  confirmPassword(b: { password: string; action: ConfirmAction; totp?: string }): Promise<ConfirmTokenResult>;
  confirmPgpStart(b: { action: ConfirmAction }): Promise<PgpChallenge>;
  confirmPgpFinish(b: { challengeId: string; code: string }): Promise<ConfirmTokenResult>;
  confirmWebAuthnStart(b: { action: ConfirmAction }): Promise<AuthenticationChallenge>;
  confirmWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<ConfirmTokenResult>;
  /** Review L1 (#94): the same finish for the `key-test` action, which answers `{ tested: true }` and no token. */
  keyTestWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<{ tested: true }>;

  // Login methods of the account
  /**
   * Hold model v3: each change below answers `Staged` (202) instead when made from a login with just
   * a username and password: nothing changed yet; it is a draft to review and submit (`isStaged`).
   */
  /**
   * `PUT /v1/account/password` (Task 10). With `recoveryCode` (owner S-110) the change applies at
   * once, never staged, and the code is burned (the server answers `recoveryCodeBurned: true`).
   */
  setPassword(b: { password: string; recoveryCode?: string } & Token): Promise<Staged | undefined>;
  addPgpKeyStart(b: { publicKey: string } & Token): Promise<PgpChallenge>;
  addPgpKeyFinish(b: { challengeId: string; code: string }): Promise<{ fingerprint: string } & Partial<Staged>>;
  addWebAuthnStart(b: { kind: WebAuthnKind } & Token): Promise<RegistrationChallenge>;
  addWebAuthnFinish(b: { challengeId: string; response: RegistrationResponseJSON; label?: string }): Promise<Staged | undefined>;
  /** `secret` (base32) and `otpauthUri` are for the authenticator app only: show them, never keep them. */
  addTotpStart(b: Token): Promise<{ challengeId: string; otpauthUri: string; secret: string }>;
  addTotpFinish(b: { challengeId: string; code: string }): Promise<Staged | undefined>;
  newRecoveryCodes(b: Token): Promise<{ codes: string[] } & Partial<Staged>>;
  cancelRecoverySession(id: string): Promise<void>;
  /** Hold model v3: `POST /v1/account/recovery-code/reveal`, once, by a full session opened after a recovery-code login. */
  revealRecoveryCode(): Promise<{ code: string }>;
  /** `POST /v1/account/onboarding/end`: closes this session's sign-up window when sign-up ends (review M1). */
  endOnboarding(): Promise<{ ok: true }>;
  /** Hold model v3: `GET /v1/account/hold`. */
  holdView(): Promise<HoldView>;
  /** Hold model v3: `POST /v1/account/hold/changes/submit`, exactly the drafts reviewed (409 `changes-changed` otherwise). */
  submitHoldChanges(b: { ids: string[] }): Promise<{ status: 'queued'; count: number; takesEffectAt: string }>;
  /**
   * Owner G58: `POST /v1/account/hold/changes/approve { ids }`: a strong login approves waiting
   * changes now, so they apply at once. (The API route is being added on this branch.)
   */
  approveHoldChanges(b: { ids: string[] }): Promise<unknown>;
  /** Hold model v3: `DELETE /v1/account/hold/changes`: cancels every waiting change (and this session's drafts). */
  cancelHoldChanges(): Promise<void>;
  /** Hold model v3: `DELETE /v1/account/hold/changes/:id`: one waiting change or one of this session's drafts. */
  cancelHoldChange(id: string): Promise<void>;
  /** `GET /v1/account/methods` (Task 10). */
  listMethods(): Promise<MethodEntry[]>;
  /** `DELETE /v1/account/methods/:type/:id` (Task 10), the token in a JSON body (R17). */
  removeMethod(type: MethodType, id: string, b: Token): Promise<Staged | undefined>;

  // Account overview (Task 11)
  me(): Promise<AccountOverview>;
  /** `POST /v1/account/terms`: a changed Terms version, accepted with a new signature (owner, 8 Nov 2026). */
  acceptTerms(b: { version: string; signature: TermsSignature }): Promise<void>;
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

  // J-23 chat-key courier (dormant groundwork): full trader sessions of the owner, strong strictly
  // (403 `weak-session`), never during a hold (403 `recovery-hold`).
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
  setOneDevice(b: { on: boolean } & Token): Promise<DeviceSettings | Staged>;

  // Wallets (Task 12)
  listWallets(): Promise<Wallet[]>;
  /**
   * The first wallet during sign-up needs no token; every later one does (P2-C2): use `withConfirm`.
   * Confirmed with PGP, a passkey or a security key it is usable at once; with a password (and any
   * TOTP code) `usableFrom` is 24 hours later. From a login that waits (a username and
   * password; a PGP key login is strong, owner 6 Nov 2026 Q81) nothing is added yet: 202 (staged).
   */
  addWallet(b: WalletDraft & Token): Promise<Wallet | Staged>;
  /**
   * Several wallets (1-10) under one confirm, action `add-wallets` (see `walletsAction`). They share
   * one `usableFrom`: one wait for the batch, not one each.
   */
  addWallets(b: { wallets: WalletDraft[] } & Token): Promise<Wallet[] | Staged>;
  getWalletRule(): Promise<WalletRule>;
  /** Needs no confirm; the server always records a `wallet-removed` alert. */
  /** Owner p5-7: `Staged` (202) from a login with just a username and password: the wallet stays until it applies. */
  removeWallet(id: string): Promise<Staged | undefined>;
  /**
   * Owner, 17 Nov 2026 (note #6 Q1): makes an open saved wallet the default the trade screen picks
   * first (`PUT /v1/wallets/:id/default`, 204). 409 `wallet-one-time` for a one-time wallet,
   * 409 `wallet-not-ready` for a wallet still in its wait (review 17 Nov M1).
   */
  setDefaultWallet(id: string): Promise<void>;
  // Session length (owner, 2 Nov 2026). Full trader sessions only. Never staged (lead reading of
  // owner p11-26: a hold holds only the security changes made; see routes/account.ts).
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

  /**
   * Owner 2 Nov 2026: switch to a vendor account. Confirm `become-vendor` (`becomeVendorAction`;
   * only a passkey, security key or PGP key may confirm it). 403 `vendor-needs-key` without one.
   */
  becomeVendor(b: Token): Promise<{ accountType: 'vendor' }>;

  // Team members (Plan 2 Task 18). The account owner's side: a member gets 403 `owner-only`.
  getTeam(): Promise<{ members: TeamMember[]; max: number }>;
  /**
   * Confirm `team-invite` (`teamInviteAction`); 409 `too-many-members` `{ max }`, 409 `display-name-taken`. `invite` is shown once.
   * Owner p11-21 (S-104): from a login that waits (a username and password) the invite still goes out, and the answer is also
   * `Staged` (`isStaged`): the member's boxes are a draft that applies 24 h after it is submitted.
   */
  inviteMember(b: { displayName: string; roles: TeamRole[] } & Token): Promise<{ id: string; invite: string; expiresAt: string } & Partial<Staged>>;
  /** Confirm `team-roles` (`teamRolesAction`). From a login that waits (a username and password), 202 `Staged`. */
  setMemberRoles(id: string, b: { roles: TeamRole[] } & Token): Promise<TeamMember | Staged>;
  /** Confirm `team-remove` (`teamRemoveAction`); the member's sessions end at once. */
  /** Owner p5-7: `Staged` (202) from a login with just a username and password: the member keeps access until it applies. */
  removeMember(id: string, b: Token): Promise<Staged | undefined>;
  /** J-20: confirm `team-limits` (`teamLimitsAction`). From a login that waits (a username and password), 202 `Staged`. */
  setMemberLimits(id: string, b: { band: TradeBand | null; hours: WorkingHours } & Token): Promise<TeamMember | Staged>;
  /** Newest first, at most 200 rows. */
  teamAudit(q?: { from?: string; to?: string; member?: string }): Promise<TeamAuditEntry[]>;
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

  async function call<T>(method: Method, path: string, body?: object): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    // A redirect is never an auth API answer: refuse it rather than follow it somewhere else.
    const init: RequestInit = { method, credentials: 'same-origin', redirect: 'error', headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await send(`${baseUrl}${path}`, init);
    const data = await readJson(res);
    if (res.ok) return data as T;
    const rec = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const { error, ...extra } = rec;
    if (extra.retryAfterSeconds === undefined) {
      const header = retryAfterHeader(res);
      if (header !== undefined) extra.retryAfterSeconds = header;
    }
    // A reply that is not an API error (a proxy's error page, a body without a code) reads as `internal`.
    throw new AuthApiError(res.status, typeof error === 'string' ? (error as ApiErrorCode) : 'internal', extra);
  }

  const get = <T>(path: string) => call<T>('GET', path);
  const post = <T>(path: string, body: object = {}) => call<T>('POST', path, body);
  const done = async (p: Promise<unknown>): Promise<void> => {
    await p;
  };
  /** Nothing, or the `Staged` answer of a change staged for review (hold model v3). */
  const stagedOrDone = async (p: Promise<unknown>): Promise<Staged | undefined> => {
    const r = await p;
    return isStaged(r) ? r : undefined;
  };

  return {
    getTerms: () => get('/v1/terms'),
    getPgpSigningKey: () => get('/v1/pgp/signing-key'),
    nameAvailable: (b) => post('/v1/register/name-check', b),
    registerPassword: (b) => post('/v1/register/password', b),
    loginPassword: (b) => post('/v1/login/password', b),
    loginSecondFactor: (b) => post('/v1/login/second-factor', b),
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

    confirmPassword: (b) => post('/v1/confirm/password', b),
    confirmPgpStart: (b) => post('/v1/confirm/pgp/start', b),
    confirmPgpFinish: (b) => post('/v1/confirm/pgp/finish', b),
    confirmWebAuthnStart: (b) => post('/v1/confirm/webauthn/start', b),
    confirmWebAuthnFinish: (b) => post('/v1/confirm/webauthn/finish', b),
    keyTestWebAuthnFinish: (b) => post('/v1/confirm/webauthn/finish', b),

    setPassword: (b) => stagedOrDone(call('PUT', '/v1/account/password', b)),
    addPgpKeyStart: (b) => post('/v1/account/pgp/start', b),
    addPgpKeyFinish: (b) => post('/v1/account/pgp/finish', b),
    addWebAuthnStart: (b) => post('/v1/account/webauthn/start', b),
    addWebAuthnFinish: (b) => stagedOrDone(post('/v1/account/webauthn/finish', b)),
    addTotpStart: (b) => post('/v1/account/totp/start', b),
    addTotpFinish: (b) => stagedOrDone(post('/v1/account/totp/finish', b)),
    newRecoveryCodes: (b) => post('/v1/account/recovery-codes', b),
    cancelRecoverySession: (id) => done(call('DELETE', `/v1/account/recovery-sessions/${seg(id)}`)),
    revealRecoveryCode: () => post('/v1/account/recovery-code/reveal'),
    endOnboarding: () => post('/v1/account/onboarding/end'),
    holdView: () => get('/v1/account/hold'),
    submitHoldChanges: (b) => post('/v1/account/hold/changes/submit', b),
    approveHoldChanges: (b) => post('/v1/account/hold/changes/approve', b),
    cancelHoldChanges: () => done(call('DELETE', '/v1/account/hold/changes')),
    cancelHoldChange: (id) => done(call('DELETE', `/v1/account/hold/changes/${seg(id)}`)),
    listMethods: () => get('/v1/account/methods'),
    removeMethod: (type, id, b) => stagedOrDone(call('DELETE', `/v1/account/methods/${seg(type)}/${seg(id)}`, b)),

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
    removeWallet: (id) => stagedOrDone(call('DELETE', `/v1/wallets/${seg(id)}`)),
    setDefaultWallet: async (id) => {
      await call('PUT', `/v1/wallets/${seg(id)}/default`, {});
    },
    setSessionLength: (b) => call('PUT', '/v1/account/session/length', b),
    extendSession: (b) => post('/v1/account/session/extend', b),
    setIdleReminder: (b) => call('PUT', '/v1/account/idle-reminder', b),

    becomeVendor: (b) => call('PUT', '/v1/account/type', { type: 'vendor', ...b }),

    getTeam: () => get('/v1/team'),
    inviteMember: (b) => post('/v1/team/invites', b),
    setMemberRoles: (id, b) => call('PATCH', `/v1/team/members/${seg(id)}`, b),
    removeMember: (id, b) => stagedOrDone(call('DELETE', `/v1/team/members/${seg(id)}`, b)),
    setMemberLimits: (id, b) => call('PUT', `/v1/team/members/${seg(id)}/limits`, b),
    teamAudit: (q = {}) => {
      const p = new URLSearchParams();
      if (q.from !== undefined) p.set('from', q.from);
      if (q.to !== undefined) p.set('to', q.to);
      if (q.member !== undefined) p.set('member', q.member);
      const qs = p.toString();
      return get(`/v1/team/audit${qs === '' ? '' : `?${qs}`}`);
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
