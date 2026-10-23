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
  registerPassword: [{ username: 'sample01', password: 'x', deviceLabel: 'B', acceptedTerms: 'v' }],
  loginPassword: [{ username: 'sample01', password: 'x', deviceLabel: 'B' }],
  loginSecondFactor: [{ pendingId: UUID, code: '000000' }],
  loginBackup: [{ username: 'sample01', kind: 'recovery-code', code: 'x', deviceLabel: 'B' }],
  registerPgpStart: [{ username: 'sample01', publicKey: 'x' }],
  registerPgpFinish: [{ challengeId: UUID, code: 'x', deviceLabel: 'B', acceptedTerms: 'v' }],
  loginPgpStart: [{ username: 'sample01' }],
  loginPgpFinish: [{ challengeId: UUID, code: 'x', deviceLabel: 'B' }],
  registerWebAuthnStart: [{ username: 'sample01', kind: 'passkey' }],
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

/** Methods whose routes come with Plan 2 Tasks 10-12, which are not on the main line yet. */
export const NEEDS_TASKS_10_TO_12: ReadonlySet<keyof AuthApi> = new Set<keyof AuthApi>([
  // Task 10: login-method policy, listing and removal (`PUT /v1/account/password` lives there too).
  'listMethods', 'removeMethod', 'setPassword',
  // Task 11: account overview, devices, alerts and the Terms of Service.
  'getTerms', 'me', 'acceptTerms', 'listSessions', 'endSession', 'listAlerts', 'markAlertSeen',
  // Task 12: wallets and the 24-hour wait.
  'listWallets', 'addWallet', 'removeWallet', 'setPayoutWait',
]);

export const methodNames = (): Array<keyof AuthApi> => Object.keys(SAMPLE_CALLS) as Array<keyof AuthApi>;

/** Calls `name` on `api` with its sample arguments; whether the server accepts them does not matter. */
export async function callSample(api: AuthApi, name: keyof AuthApi): Promise<void> {
  const fn = api[name] as (...args: unknown[]) => Promise<unknown>;
  await fn.apply(api, SAMPLE_CALLS[name] as unknown[]).catch(() => undefined);
}
