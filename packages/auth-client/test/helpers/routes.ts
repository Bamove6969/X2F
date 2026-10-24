import type { AuthApi } from '../../src/index.js';

const UUID = '00000000-0000-4000-8000-000000000000';
const RESPONSE = { id: 'x', rawId: 'x', type: 'public-key', response: {}, clientExtensionResults: {} } as never;

/**
 * One call per `AuthApi` method, with arguments of the right type (the server may refuse them):
 * the type makes a new method without an entry here a compile error.
 */
export const SAMPLE_CALLS: { [K in keyof AuthApi]: Parameters<AuthApi[K]> } = {
  getTerms: [],
  getPgpSigningKey: [],
  registerPassword: [{ displayName: 'Sample01', loginName: 'sample.login', password: 'x', deviceLabel: 'B', acceptedTerms: 'v' }],
  loginPassword: [{ loginName: 'sample.login', password: 'x', deviceLabel: 'B' }],
  loginSecondFactor: [{ pendingId: UUID, code: '000000' }],
  loginBackup: [{ loginName: 'sample.login', kind: 'recovery-code', code: 'x', deviceLabel: 'B' }],
  registerPgpStart: [{ displayName: 'Sample01', loginName: 'sample.login', publicKey: 'x' }],
  registerPgpFinish: [{ challengeId: UUID, code: 'x', deviceLabel: 'B', acceptedTerms: 'v' }],
  loginPgpStart: [{ key: 'x' }],
  loginPgpFinish: [{ challengeId: UUID, code: 'x', deviceLabel: 'B' }],
  registerWebAuthnStart: [{ displayName: 'Sample01', loginName: 'sample.login', kind: 'passkey' }],
  registerWebAuthnFinish: [{ challengeId: UUID, response: RESPONSE, deviceLabel: 'B', acceptedTerms: 'v' }],
  loginWebAuthnStart: [{}],
  loginWebAuthnFinish: [{ challengeId: UUID, response: RESPONSE, deviceLabel: 'B' }],
  logout: [],
  confirmPassword: [{ password: 'x', action: { kind: 'set-password' } }],
  confirmPgpStart: [{ action: { kind: 'set-password' } }],
  confirmPgpFinish: [{ challengeId: UUID, code: 'x' }],
  confirmWebAuthnStart: [{ action: { kind: 'set-password' } }],
  confirmWebAuthnFinish: [{ challengeId: UUID, response: RESPONSE }],
  setPassword: [{ password: 'x' }],
  addPgpKeyStart: [{ publicKey: 'x' }],
  addPgpKeyFinish: [{ challengeId: UUID, code: 'x' }],
  addWebAuthnStart: [{ kind: 'passkey' }],
  addWebAuthnFinish: [{ challengeId: UUID, response: RESPONSE }],
  addTotpStart: [{}],
  addTotpFinish: [{ challengeId: UUID, code: '000000' }],
  newRecoveryCodes: [{}],
  cancelRecoverySession: [UUID],
  listMethods: [],
  removeMethod: ['pgp', UUID, {}],
  me: [],
  acceptTerms: [{ version: 'v' }],
  listSessions: [],
  endSession: [UUID],
  listAlerts: [],
  markAlertSeen: [UUID],
  listWallets: [],
  addWallet: [{ app: 'cake', label: 'Main', address: 'x' }],
  removeWallet: [UUID],
  setPayoutWait: [{ enabled: true }],
};

/**
 * The route each method must reach: its HTTP method and the server's route pattern. A method sent
 * to the wrong route (even one that exists) fails the coverage test in flows.test.ts.
 */
export const ROUTES: { [K in keyof AuthApi]: `${'GET' | 'POST' | 'PUT' | 'DELETE'} /v1/${string}` } = {
  getTerms: 'GET /v1/terms',
  getPgpSigningKey: 'GET /v1/pgp/signing-key',
  registerPassword: 'POST /v1/register/password',
  loginPassword: 'POST /v1/login/password',
  loginSecondFactor: 'POST /v1/login/second-factor',
  loginBackup: 'POST /v1/login/backup',
  registerPgpStart: 'POST /v1/register/pgp/start',
  registerPgpFinish: 'POST /v1/register/pgp/finish',
  loginPgpStart: 'POST /v1/login/pgp/start',
  loginPgpFinish: 'POST /v1/login/pgp/finish',
  registerWebAuthnStart: 'POST /v1/register/webauthn/start',
  registerWebAuthnFinish: 'POST /v1/register/webauthn/finish',
  loginWebAuthnStart: 'POST /v1/login/webauthn/start',
  loginWebAuthnFinish: 'POST /v1/login/webauthn/finish',
  logout: 'POST /v1/logout',
  confirmPassword: 'POST /v1/confirm/password',
  confirmPgpStart: 'POST /v1/confirm/pgp/start',
  confirmPgpFinish: 'POST /v1/confirm/pgp/finish',
  confirmWebAuthnStart: 'POST /v1/confirm/webauthn/start',
  confirmWebAuthnFinish: 'POST /v1/confirm/webauthn/finish',
  setPassword: 'PUT /v1/account/password',
  addPgpKeyStart: 'POST /v1/account/pgp/start',
  addPgpKeyFinish: 'POST /v1/account/pgp/finish',
  addWebAuthnStart: 'POST /v1/account/webauthn/start',
  addWebAuthnFinish: 'POST /v1/account/webauthn/finish',
  addTotpStart: 'POST /v1/account/totp/start',
  addTotpFinish: 'POST /v1/account/totp/finish',
  newRecoveryCodes: 'POST /v1/account/recovery-codes',
  cancelRecoverySession: 'DELETE /v1/account/recovery-sessions/:id',
  listMethods: 'GET /v1/account/methods',
  removeMethod: 'DELETE /v1/account/methods/:type/:id',
  me: 'GET /v1/account/me',
  acceptTerms: 'POST /v1/account/terms',
  listSessions: 'GET /v1/account/sessions',
  endSession: 'DELETE /v1/account/sessions/:id',
  listAlerts: 'GET /v1/account/alerts',
  markAlertSeen: 'POST /v1/account/alerts/:id/seen',
  listWallets: 'GET /v1/wallets',
  addWallet: 'POST /v1/wallets',
  removeWallet: 'DELETE /v1/wallets/:id',
  setPayoutWait: 'PUT /v1/account/security/payout-wait',
};

export const methodNames = (): Array<keyof AuthApi> => Object.keys(SAMPLE_CALLS) as Array<keyof AuthApi>;

/** Calls `name` on `api` with its sample arguments; whether the server accepts them does not matter. */
export async function callSample(api: AuthApi, name: keyof AuthApi): Promise<void> {
  const fn = api[name] as (...args: unknown[]) => Promise<unknown>;
  await fn.apply(api, SAMPLE_CALLS[name] as unknown[]).catch(() => undefined);
}
