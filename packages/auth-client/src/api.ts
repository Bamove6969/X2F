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
import type { ApiErrorCode, IssuedChallenge, LoginResult } from '@x2f/api';

export type { ApiErrorCode, LoginResult };

/** A refused call: the HTTP status, the API's error code and the extra fields it sent. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** A plain sentence about a refused PGP key (only ever about the key the person pasted). */
  readonly detail?: string;
  /** How long to wait before trying again (429 `slow-down` / `locked`, 503 `busy`). */
  readonly retryAfterSeconds?: number;
  /** The password rules not met (400 `password-weak`). */
  readonly missing?: string[];
  /** When a held recovery session may make changes (403 `recovery-hold`). */
  readonly holdUntil?: string;
  /** The current Terms version (403 `terms-required`, 400 `terms-not-accepted`). */
  readonly version?: string;
  /** The kind of action that needs a confirm token (403 `confirm-required`). */
  readonly action?: string;

  constructor(status: number, code: ApiErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
    if (typeof extra.detail === 'string') this.detail = extra.detail;
    if (typeof extra.retryAfterSeconds === 'number' && Number.isFinite(extra.retryAfterSeconds)) {
      this.retryAfterSeconds = extra.retryAfterSeconds;
    }
    if (Array.isArray(extra.missing)) this.missing = extra.missing.filter((m): m is string => typeof m === 'string');
    if (typeof extra.holdUntil === 'string') this.holdUntil = extra.holdUntil;
    if (typeof extra.version === 'string') this.version = extra.version;
    if (typeof extra.action === 'string') this.action = extra.action;
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

/** A password login: a session, or (TOTP enrolled) a pending login for `loginSecondFactor`. */
export type PasswordLoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: ['totp'] };

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
  username: string;
  kind: AccountKind;
  level: 'full' | 'recovery';
  holdUntil: string | null;
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  payoutWait: PayoutWait;
  termsCurrent: boolean;
}

/** Task 11: one signed-in device. */
export interface SessionEntry {
  id: string;
  deviceLabel: string;
  level: 'full' | 'recovery';
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
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

/** Task 12: the opt-in 24-hour wait; `offAt` while a switch-off is scheduled. */
export interface PayoutWait {
  enabled: boolean;
  offAt: string | null;
}

// ---------------------------------------------------------------------------------------------
// The client

export interface AuthApi {
  // Public
  /** `GET /v1/terms` (Task 11): the Terms version a sign-up must accept. */
  getTerms(): Promise<{ version: string }>;
  /** `GET /v1/pgp/signing-key`: X2F's official PGP key, which signs every challenge (R7). */
  getPgpSigningKey(): Promise<{ fingerprint: string; publicKey: string }>;
  registerPassword(b: { username: string; password: string; deviceLabel: string; acceptedTerms: string }): Promise<{ username: string }>;
  loginPassword(b: { username: string; password: string; deviceLabel: string }): Promise<PasswordLoginResult>;
  /** `POST /v1/login/second-factor`: the TOTP code for a password login's `pendingId`. */
  loginSecondFactor(b: { pendingId: string; code: string }): Promise<{ status: 'ok' }>;
  /** `POST /v1/login/backup`: opens a recovery session (TOTP: held 24 hours). */
  loginBackup(b: { username: string; kind: 'totp' | 'recovery-code'; code: string; deviceLabel: string }): Promise<{
    status: 'ok';
    level: 'recovery';
    holdUntil: string | null;
  }>;
  registerPgpStart(b: { username: string; publicKey: string }): Promise<PgpChallenge & { fingerprint: string }>;
  registerPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; acceptedTerms: string }): Promise<{ username: string }>;
  /** `pendingId`: the second step of a staff or owner login. */
  loginPgpStart(b: { username: string; refreshedKey?: string; pendingId?: string }): Promise<PgpChallenge>;
  loginPgpFinish(b: { challengeId: string; code: string; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  registerWebAuthnStart(b: { username: string; kind: WebAuthnKind }): Promise<RegistrationChallenge>;
  registerWebAuthnFinish(b: {
    challengeId: string;
    response: RegistrationResponseJSON;
    deviceLabel: string;
    acceptedTerms: string;
    label?: string;
  }): Promise<{ username: string }>;
  /** Without `username`: a discoverable passkey login (traders). */
  loginWebAuthnStart(b: { username?: string; pendingId?: string }): Promise<AuthenticationChallenge>;
  loginWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON; deviceLabel: string; pendingId?: string }): Promise<LoginResult>;
  logout(): Promise<void>;

  // Confirm it's you: each returns a single-use token bound to this session and exactly `action`.
  confirmPassword(b: { password: string; action: ConfirmAction; totp?: string }): Promise<ConfirmTokenResult>;
  confirmPgpStart(b: { action: ConfirmAction }): Promise<PgpChallenge>;
  confirmPgpFinish(b: { challengeId: string; code: string }): Promise<ConfirmTokenResult>;
  confirmWebAuthnStart(b: { action: ConfirmAction }): Promise<AuthenticationChallenge>;
  confirmWebAuthnFinish(b: { challengeId: string; response: AuthenticationResponseJSON }): Promise<ConfirmTokenResult>;

  // Login methods of the account
  /** `PUT /v1/account/password` (Task 10). */
  setPassword(b: { password: string } & Token): Promise<void>;
  addPgpKeyStart(b: { publicKey: string } & Token): Promise<PgpChallenge>;
  addPgpKeyFinish(b: { challengeId: string; code: string }): Promise<{ fingerprint: string }>;
  addWebAuthnStart(b: { kind: WebAuthnKind } & Token): Promise<RegistrationChallenge>;
  addWebAuthnFinish(b: { challengeId: string; response: RegistrationResponseJSON; label?: string }): Promise<void>;
  /** `secret` (base32) and `otpauthUri` are for the authenticator app only: show them, never keep them. */
  addTotpStart(b: Token): Promise<{ challengeId: string; otpauthUri: string; secret: string }>;
  addTotpFinish(b: { challengeId: string; code: string }): Promise<void>;
  newRecoveryCodes(b: Token): Promise<{ codes: string[] }>;
  cancelRecoverySession(id: string): Promise<void>;
  /** `GET /v1/account/methods` (Task 10). */
  listMethods(): Promise<MethodEntry[]>;
  /** `DELETE /v1/account/methods/:type/:id` (Task 10), the token in a JSON body (R17). */
  removeMethod(type: MethodType, id: string, b: Token): Promise<void>;

  // Account overview (Task 11)
  me(): Promise<AccountOverview>;
  acceptTerms(b: { version: string }): Promise<void>;
  listSessions(): Promise<SessionEntry[]>;
  endSession(id: string): Promise<void>;
  listAlerts(): Promise<AlertEntry[]>;
  markAlertSeen(id: string): Promise<void>;

  // Wallets (Task 12)
  listWallets(): Promise<Wallet[]>;
  /** The first wallet during sign-up needs no token; every later one does (P2-C2): use `withConfirm`. */
  addWallet(b: { app: WalletApp; label: string; address: string } & Token): Promise<Wallet>;
  removeWallet(id: string): Promise<void>;
  /** Switching the wait off needs a `payout-wait-off` token and takes effect after 24 hours. */
  setPayoutWait(b: { enabled: boolean } & Token): Promise<PayoutWait>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

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

export function createAuthApi(o: { baseUrl?: string; fetch?: typeof fetch } = {}): AuthApi {
  const baseUrl = o.baseUrl ?? '';
  // Looked up at call time, so a page (or a test) that replaces `fetch` later is honoured.
  const send: typeof fetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(method: Method, path: string, body?: object): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const init: RequestInit = { method, credentials: 'same-origin', headers };
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

  return {
    getTerms: () => get('/v1/terms'),
    getPgpSigningKey: () => get('/v1/pgp/signing-key'),
    registerPassword: (b) => post('/v1/register/password', b),
    loginPassword: (b) => post('/v1/login/password', b),
    loginSecondFactor: (b) => post('/v1/login/second-factor', b),
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

    confirmPassword: (b) => post('/v1/confirm/password', b),
    confirmPgpStart: (b) => post('/v1/confirm/pgp/start', b),
    confirmPgpFinish: (b) => post('/v1/confirm/pgp/finish', b),
    confirmWebAuthnStart: (b) => post('/v1/confirm/webauthn/start', b),
    confirmWebAuthnFinish: (b) => post('/v1/confirm/webauthn/finish', b),

    setPassword: (b) => done(call('PUT', '/v1/account/password', b)),
    addPgpKeyStart: (b) => post('/v1/account/pgp/start', b),
    addPgpKeyFinish: (b) => post('/v1/account/pgp/finish', b),
    addWebAuthnStart: (b) => post('/v1/account/webauthn/start', b),
    addWebAuthnFinish: (b) => done(post('/v1/account/webauthn/finish', b)),
    addTotpStart: (b) => post('/v1/account/totp/start', b),
    addTotpFinish: (b) => done(post('/v1/account/totp/finish', b)),
    newRecoveryCodes: (b) => post('/v1/account/recovery-codes', b),
    cancelRecoverySession: (id) => done(call('DELETE', `/v1/account/recovery-sessions/${seg(id)}`)),
    listMethods: () => get('/v1/account/methods'),
    removeMethod: (type, id, b) => done(call('DELETE', `/v1/account/methods/${seg(type)}/${seg(id)}`, b)),

    me: () => get('/v1/account/me'),
    acceptTerms: (b) => done(post('/v1/account/terms', b)),
    listSessions: () => get('/v1/account/sessions'),
    endSession: (id) => done(call('DELETE', `/v1/account/sessions/${seg(id)}`)),
    listAlerts: () => get('/v1/account/alerts'),
    markAlertSeen: (id) => done(post(`/v1/account/alerts/${seg(id)}/seen`)),

    listWallets: () => get('/v1/wallets'),
    addWallet: (b) => post('/v1/wallets', b),
    removeWallet: (id) => done(call('DELETE', `/v1/wallets/${seg(id)}`)),
    setPayoutWait: (b) => call('PUT', '/v1/account/security/payout-wait', b),
  };
}
