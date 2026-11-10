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
import type { ApiErrorCode, ApprovalView, ApprovalWait, IssuedChallenge, LoginResult } from '@x2f/api';

export type { ApiErrorCode, ApprovalView, ApprovalWait, LoginResult };

/**
 * Plan 2 Task 17: a security change made from a login with only one way of proving it's you
 * (202): nothing changed yet; the change waits until `holdUntil` (the account's 24-hour hold), and
 * a strong login with a method held before the hold cancels it.
 */
export interface Held {
  status: 'held';
  holdUntil: string;
}

/** True for a change that waits out the 24-hour hold (202 `{ status: 'held', holdUntil }`). */
export function isHeld(x: unknown): x is Held {
  return x !== null && typeof x === 'object' && (x as { status?: unknown }).status === 'held' && typeof (x as { holdUntil?: unknown }).holdUntil === 'string';
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
export type PasswordLoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: ['totp'] } | ApprovalWait;

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
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  termsCurrent: boolean;
  /** Task 17: when the account's 24-hour hold ends, while one runs (any session of the account). Optional: older API builds do not send it. */
  accountHoldUntil?: string | null;
  /**
   * Plan 2 Task 18: set when the caller is a team member (the overview is of the account they work
   * for, with their own login methods); null for the account owner. Optional: older API builds do not send it.
   */
  member?: { name: string; roles: TeamRole[] } | null;
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
}

/** Owner 2 Nov 2026: Trader and Vendor accounts. */
export type AccountType = 'trader' | 'vendor';

/** True only when the API says the account is a vendor (an older API build that sends nothing: false). */
export function isVendor(me: Pick<AccountOverview, 'accountType'> | null | undefined): boolean {
  return me?.accountType === 'vendor';
}

/** Plan 2 Task 18: a team member's roles (spec 6.7). */
export type TeamRole = 'offers' | 'trades';

/** Plan 2 Task 18: one member or open invite, as the account owner sees it (`GET /v1/team`). */
export interface TeamMember {
  id: string;
  displayName: string;
  roles: TeamRole[];
  status: 'invited' | 'joining' | 'active';
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
}

/** One wallet of an add (the fields the person fills in). */
export interface WalletDraft {
  app: WalletApp;
  label: string;
  address: string;
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

// ---------------------------------------------------------------------------------------------
// The client

export interface AuthApi {
  // Public
  /** `GET /v1/terms` (Task 11): the Terms version a sign-up must accept. */
  getTerms(): Promise<{ version: string }>;
  /** `GET /v1/pgp/signing-key`: X2F's official PGP key, which signs every challenge (R7). */
  getPgpSigningKey(): Promise<{ fingerprint: string; publicKey: string }>;
  /** Both names are picked at sign-up (spec 6.1): the public `displayName` and the private `loginName`; they must differ. */
  registerPassword(b: { displayName: string; loginName: string; password: string; deviceLabel: string; acceptedTerms: string }): Promise<{
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
  /** `POST /v1/login/backup`: opens a recovery session (TOTP: held 24 hours). */
  loginBackup(b: { loginName: string; kind: 'totp' | 'recovery-code'; code: string; deviceLabel: string }): Promise<{
    status: 'ok';
    level: 'recovery';
    holdUntil: string | null;
  }>;
  registerPgpStart(b: { displayName: string; loginName: string; publicKey: string }): Promise<PgpChallenge & { fingerprint: string }>;
  registerPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; acceptedTerms: string }): Promise<{ displayName: string }>;
  /**
   * PGP login needs no name: `key` is the person's whole armored public key (an unknown key's decoy
   * goes to that key too). A fingerprint, or anything else, is 400 `key-unreadable`, the same for
   * every key. `pendingId`: the second step of a staff or owner login.
   */
  loginPgpStart(b: { key: string; pendingId?: string }): Promise<PgpChallenge>;
  loginPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  registerWebAuthnStart(b: { displayName: string; loginName: string; kind: WebAuthnKind }): Promise<RegistrationChallenge>;
  registerWebAuthnFinish(b: {
    challengeId: string;
    response: RegistrationResponseJSON;
    deviceLabel: string;
    acceptedTerms: string;
    label?: string;
  }): Promise<{ displayName: string }>;
  /** Without `loginName`: a discoverable passkey login (traders). */
  /** Without `loginName`: discoverable passkey login, or with `pendingId` the second step of a staff or owner login (the pending login names the account). */
  loginWebAuthnStart(b: { loginName?: string; pendingId?: string }): Promise<AuthenticationChallenge>;
  loginWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  /** `POST /v1/account/login-name` (review I3): a pre-009 account sets its private login name once, with a `set-login-name` confirm token (`withConfirm`); 409 `login-name-set` afterwards, 409 `names-unavailable` for a taken name in either namespace, 400 `names-same` / `login-name-invalid`. */
  setLoginName(b: { loginName: string; confirmToken?: string }): Promise<{ ok: true } | Held>;

  // Confirm it's you: each returns a single-use token bound to this session and exactly `action`.
  confirmPassword(b: { password: string; action: ConfirmAction; totp?: string }): Promise<ConfirmTokenResult>;
  confirmPgpStart(b: { action: ConfirmAction }): Promise<PgpChallenge>;
  confirmPgpFinish(b: { challengeId: string; code: string }): Promise<ConfirmTokenResult>;
  confirmWebAuthnStart(b: { action: ConfirmAction }): Promise<AuthenticationChallenge>;
  confirmWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<ConfirmTokenResult>;

  // Login methods of the account
  /**
   * Task 17: each change below answers `Held` (202) instead when made from a login with only one
   * way of proving it's you: nothing changed yet, it waits out the 24-hour hold (`isHeld`).
   */
  /** `PUT /v1/account/password` (Task 10). */
  setPassword(b: { password: string } & Token): Promise<Held | undefined>;
  addPgpKeyStart(b: { publicKey: string } & Token): Promise<PgpChallenge>;
  addPgpKeyFinish(b: { challengeId: string; code: string }): Promise<{ fingerprint: string } & Partial<Held>>;
  addWebAuthnStart(b: { kind: WebAuthnKind } & Token): Promise<RegistrationChallenge>;
  addWebAuthnFinish(b: { challengeId: string; response: RegistrationResponseJSON; label?: string }): Promise<Held | undefined>;
  /** `secret` (base32) and `otpauthUri` are for the authenticator app only: show them, never keep them. */
  addTotpStart(b: Token): Promise<{ challengeId: string; otpauthUri: string; secret: string }>;
  addTotpFinish(b: { challengeId: string; code: string }): Promise<Held | undefined>;
  newRecoveryCodes(b: Token): Promise<{ codes: string[] } & Partial<Held>>;
  cancelRecoverySession(id: string): Promise<void>;
  /** `GET /v1/account/methods` (Task 10). */
  listMethods(): Promise<MethodEntry[]>;
  /** `DELETE /v1/account/methods/:type/:id` (Task 10), the token in a JSON body (R17). */
  removeMethod(type: MethodType, id: string, b: Token): Promise<Held | undefined>;

  // Account overview (Task 11)
  me(): Promise<AccountOverview>;
  acceptTerms(b: { version: string }): Promise<void>;
  listSessions(): Promise<SessionEntry[]>;
  endSession(id: string): Promise<void>;
  listAlerts(): Promise<AlertEntry[]>;
  markAlertSeen(id: string): Promise<void>;

  // New-device approval (Task 16): full trader sessions only.
  /** `GET /v1/account/approvals`: the logins waiting for this account's approval. */
  listApprovals(): Promise<ApprovalView[]>;
  getApproval(id: string): Promise<ApprovalView>;
  /** 409 `too-many-devices` (`AuthApiError.sessions`) at the limit without `logOut`; 409 `approval-ended` (`outcome`). */
  decideApproval(id: string, b: ApprovalDecision): Promise<{ outcome: 'approved' | 'blocked' }>;
  getDeviceSettings(): Promise<DeviceSettings>;
  /** Confirm-it's-you for `{ kind: 'set-one-device', on }` (`withConfirm`). */
  setOneDevice(b: { on: boolean } & Token): Promise<DeviceSettings | Held>;

  // Wallets (Task 12)
  listWallets(): Promise<Wallet[]>;
  /**
   * The first wallet during sign-up needs no token; every later one does (P2-C2): use `withConfirm`.
   * Confirmed with PGP, a passkey or a security key it is usable at once; with a password (and any
   * TOTP code) `usableFrom` is 24 hours later. From a login that waits (Task 17; PGP alone
   * included, lead decision 2026-10-30) nothing is added yet: 202 `Held` (the 24-hour hold).
   */
  addWallet(b: WalletDraft & Token): Promise<Wallet | Held>;
  /**
   * Several wallets (1-10) under one confirm, action `add-wallets` (see `walletsAction`). They share
   * one `usableFrom`: one wait for the batch, not one each.
   */
  addWallets(b: { wallets: WalletDraft[] } & Token): Promise<Wallet[] | Held>;
  getWalletRule(): Promise<WalletRule>;
  /** Needs no confirm; the server always records a `wallet-removed` alert. */
  removeWallet(id: string): Promise<void>;
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

  /**
   * Owner 2 Nov 2026: switch to a vendor account. Confirm `become-vendor` (`becomeVendorAction`;
   * only a passkey, security key or PGP key may confirm it). 403 `vendor-needs-key` without one.
   */
  becomeVendor(b: Token): Promise<{ accountType: 'vendor' }>;

  // Team members (Plan 2 Task 18). The account owner's side: a member gets 403 `owner-only`.
  getTeam(): Promise<{ members: TeamMember[]; max: number }>;
  /** Confirm `team-invite` (`teamInviteAction`); 409 `too-many-members` `{ max }`, 409 `display-name-taken`. `invite` is shown once. */
  inviteMember(b: { displayName: string; roles: TeamRole[] } & Token): Promise<{ id: string; invite: string; expiresAt: string }>;
  /** Confirm `team-roles` (`teamRolesAction`). */
  setMemberRoles(id: string, b: { roles: TeamRole[] } & Token): Promise<TeamMember>;
  /** Confirm `team-remove` (`teamRemoveAction`); the member's sessions end at once. */
  removeMember(id: string, b: Token): Promise<void>;
  /** Newest first, at most 200 rows. */
  teamAudit(q?: { from?: string; to?: string; member?: string }): Promise<TeamAuditEntry[]>;
  // The invited person's side (no session yet).
  readInvite(b: { invite: string }): Promise<TeamInviteView>;
  /** `acceptedTerms`: the Terms version the member read and accepted (review 2026-11-08 F1). */
  joinStart(b: { invite: string; loginName: string; publicKey: string; acceptedTerms: string }): Promise<PgpChallenge & { fingerprint: string }>;
  /** The PGP key proved: the member's login exists, no session yet; add the second factor before `setupUntil`. */
  joinFinish(b: { challengeId: string; code: string }): Promise<{ setupId: string; needs: ('security-key' | 'passkey' | 'pgp')[]; setupUntil: string }>;
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
  /** Nothing, or the `Held` answer of a change that waits out the hold (Task 17). */
  const heldOrDone = async (p: Promise<unknown>): Promise<Held | undefined> => {
    const r = await p;
    return isHeld(r) ? r : undefined;
  };

  return {
    getTerms: () => get('/v1/terms'),
    getPgpSigningKey: () => get('/v1/pgp/signing-key'),
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

    setPassword: (b) => heldOrDone(call('PUT', '/v1/account/password', b)),
    addPgpKeyStart: (b) => post('/v1/account/pgp/start', b),
    addPgpKeyFinish: (b) => post('/v1/account/pgp/finish', b),
    addWebAuthnStart: (b) => post('/v1/account/webauthn/start', b),
    addWebAuthnFinish: (b) => heldOrDone(post('/v1/account/webauthn/finish', b)),
    addTotpStart: (b) => post('/v1/account/totp/start', b),
    addTotpFinish: (b) => heldOrDone(post('/v1/account/totp/finish', b)),
    newRecoveryCodes: (b) => post('/v1/account/recovery-codes', b),
    cancelRecoverySession: (id) => done(call('DELETE', `/v1/account/recovery-sessions/${seg(id)}`)),
    listMethods: () => get('/v1/account/methods'),
    removeMethod: (type, id, b) => heldOrDone(call('DELETE', `/v1/account/methods/${seg(type)}/${seg(id)}`, b)),

    me: () => get('/v1/account/me'),
    acceptTerms: (b) => done(post('/v1/account/terms', b)),
    listSessions: () => get('/v1/account/sessions'),
    endSession: (id) => done(call('DELETE', `/v1/account/sessions/${seg(id)}`)),
    listAlerts: () => get('/v1/account/alerts'),
    markAlertSeen: (id) => done(post(`/v1/account/alerts/${seg(id)}/seen`)),
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
    setSessionLength: (b) => call('PUT', '/v1/account/session/length', b),
    extendSession: (b) => post('/v1/account/session/extend', b),
    setIdleReminder: (b) => call('PUT', '/v1/account/idle-reminder', b),

    becomeVendor: (b) => call('PUT', '/v1/account/type', { type: 'vendor', ...b }),

    getTeam: () => get('/v1/team'),
    inviteMember: (b) => post('/v1/team/invites', b),
    setMemberRoles: (id, b) => call('PATCH', `/v1/team/members/${seg(id)}`, b),
    removeMember: (id, b) => done(call('DELETE', `/v1/team/members/${seg(id)}`, b)),
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
