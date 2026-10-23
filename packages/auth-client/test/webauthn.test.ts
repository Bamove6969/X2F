import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { describe, expect, it, vi } from 'vitest';
import {
  addWebAuthnKey,
  confirmWithWebAuthn,
  loginWithPasskey,
  loginWithSecurityKey,
  registerWithWebAuthn,
  type AuthApi,
} from '../src/index.js';

const CREATE = { challenge: 'c1', rp: { name: 'X2F', id: 'x2f.test' } } as unknown as PublicKeyCredentialCreationOptionsJSON;
const GET = { challenge: 'c2', rpId: 'x2f.test' } as unknown as PublicKeyCredentialRequestOptionsJSON;
const REG = { id: 'cred', type: 'public-key' } as unknown as RegistrationResponseJSON;
const ASSERT = { id: 'cred', type: 'public-key' } as unknown as AuthenticationResponseJSON;

/** Only the routes a wrapper may call, each recording its argument. */
function fakeApi() {
  const api = {
    registerWebAuthnStart: vi.fn(async () => ({ challengeId: 'ch-reg', options: CREATE })),
    registerWebAuthnFinish: vi.fn(async () => ({ username: 'alice' })),
    loginWebAuthnStart: vi.fn(async () => ({ challengeId: 'ch-login', options: GET })),
    loginWebAuthnFinish: vi.fn(async () => ({ status: 'ok' as const })),
    confirmWebAuthnStart: vi.fn(async () => ({ challengeId: 'ch-confirm', options: GET })),
    confirmWebAuthnFinish: vi.fn(async () => ({ confirmToken: 'tok' })),
    addWebAuthnStart: vi.fn(async () => ({ challengeId: 'ch-add', options: CREATE })),
    addWebAuthnFinish: vi.fn(async () => undefined),
  };
  return { api: api as unknown as AuthApi, calls: api };
}

const registration = () => ({ startRegistration: vi.fn(async () => REG) });
const authentication = () => ({ startAuthentication: vi.fn(async () => ASSERT) });

describe('WebAuthn ceremony wrappers', () => {
  it('registerWithWebAuthn: start, the ceremony on the server options, finish with the Terms version', async () => {
    const { api, calls } = fakeApi();
    const ceremony = registration();
    await expect(registerWithWebAuthn(api, 'alice', 'passkey', 'Browser on Linux', '2026-10-17', ceremony)).resolves.toEqual({ username: 'alice' });
    expect(calls.registerWebAuthnStart).toHaveBeenCalledWith({ username: 'alice', kind: 'passkey' });
    expect(ceremony.startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE });
    expect(calls.registerWebAuthnFinish).toHaveBeenCalledWith({
      challengeId: 'ch-reg', response: REG, deviceLabel: 'Browser on Linux', acceptedTerms: '2026-10-17',
    });
  });

  it('registerWithWebAuthn passes a credential label when given', async () => {
    const { api, calls } = fakeApi();
    await registerWithWebAuthn(api, 'alice', 'security-key', 'Browser', 'v', registration(), { label: 'YubiKey' });
    expect(calls.registerWebAuthnFinish).toHaveBeenCalledWith(expect.objectContaining({ label: 'YubiKey' }));
  });

  it('loginWithPasskey asks for discoverable options (no username)', async () => {
    const { api, calls } = fakeApi();
    const ceremony = authentication();
    await expect(loginWithPasskey(api, 'Browser', ceremony)).resolves.toEqual({ status: 'ok' });
    expect(calls.loginWebAuthnStart).toHaveBeenCalledWith({});
    expect(ceremony.startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET });
    expect(calls.loginWebAuthnFinish).toHaveBeenCalledWith({ challengeId: 'ch-login', response: ASSERT, deviceLabel: 'Browser' });
  });

  it('loginWithSecurityKey names the user, and carries a pending login to both steps', async () => {
    const { api, calls } = fakeApi();
    await loginWithSecurityKey(api, 'crew01', 'Browser', authentication());
    expect(calls.loginWebAuthnStart).toHaveBeenLastCalledWith({ username: 'crew01' });
    expect(calls.loginWebAuthnFinish).toHaveBeenLastCalledWith({ challengeId: 'ch-login', response: ASSERT, deviceLabel: 'Browser' });
    await loginWithSecurityKey(api, 'crew01', 'Browser', authentication(), { pendingId: 'p-1' });
    expect(calls.loginWebAuthnStart).toHaveBeenLastCalledWith({ username: 'crew01', pendingId: 'p-1' });
    expect(calls.loginWebAuthnFinish).toHaveBeenLastCalledWith({ challengeId: 'ch-login', response: ASSERT, deviceLabel: 'Browser', pendingId: 'p-1' });
  });

  it('confirmWithWebAuthn returns the confirm token for exactly the action', async () => {
    const { api, calls } = fakeApi();
    const action = { kind: 'payout-wait-off' } as const;
    await expect(confirmWithWebAuthn(api, action, authentication())).resolves.toBe('tok');
    expect(calls.confirmWebAuthnStart).toHaveBeenCalledWith({ action });
    expect(calls.confirmWebAuthnFinish).toHaveBeenCalledWith({ challengeId: 'ch-confirm', response: ASSERT });
  });

  it('addWebAuthnKey sends the kind and any confirm token, then the label', async () => {
    const { api, calls } = fakeApi();
    await addWebAuthnKey(api, 'passkey', {}, registration());
    expect(calls.addWebAuthnStart).toHaveBeenLastCalledWith({ kind: 'passkey' });
    expect(calls.addWebAuthnFinish).toHaveBeenLastCalledWith({ challengeId: 'ch-add', response: REG });
    await addWebAuthnKey(api, 'security-key', { confirmToken: 'tok', label: 'Spare key' }, registration());
    expect(calls.addWebAuthnStart).toHaveBeenLastCalledWith({ kind: 'security-key', confirmToken: 'tok' });
    expect(calls.addWebAuthnFinish).toHaveBeenLastCalledWith({ challengeId: 'ch-add', response: REG, label: 'Spare key' });
  });

  it('a cancelled ceremony stops the flow before finish', async () => {
    const { api, calls } = fakeApi();
    const cancelled = new Error('NotAllowedError');
    await expect(loginWithPasskey(api, 'Browser', { startAuthentication: async () => Promise.reject(cancelled) })).rejects.toBe(cancelled);
    expect(calls.loginWebAuthnFinish).not.toHaveBeenCalled();
    await expect(registerWithWebAuthn(api, 'a', 'passkey', 'B', 'v', { startRegistration: async () => Promise.reject(cancelled) })).rejects.toBe(cancelled);
    expect(calls.registerWebAuthnFinish).not.toHaveBeenCalled();
  });
});
