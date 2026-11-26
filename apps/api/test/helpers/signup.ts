// Owner, 26 Nov 2026 (no passwords): the tests' sign-up, with a passkey on a soft authenticator.
import type { LightMyRequestResponse } from 'fastify';
import { SIG } from './signature.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './softAuthenticator.js';
import { ORIGIN } from './totp.js';

/** Any test browser: something that posts with its own cookies. */
export interface Poster {
  post(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
}

export interface SignUpBody {
  tradeTag: string;
  loginName: string;
  deviceLabel?: string;
  acceptedTerms?: string;
  termsSignature?: unknown;
  kind?: 'passkey' | 'security-key';
}

/**
 * Signs up in `b` with a new passkey (or security key): `register/webauthn/start` then `finish`.
 * Answers the start's response when the start is refused (a name rule), else the finish's.
 */
export async function signUpWithKey(
  b: Poster,
  body: SignUpBody,
  auth: SoftAuthenticator = createSoftAuthenticator({ backedUp: (body.kind ?? 'passkey') === 'passkey', userVerified: true }),
): Promise<{ res: LightMyRequestResponse; auth: SoftAuthenticator }> {
  const kind = body.kind ?? 'passkey';
  const start = await b.post('/v1/register/webauthn/start', { tradeTag: body.tradeTag, loginName: body.loginName, kind });
  if (start.statusCode !== 200) return { res: start, auth };
  const { challengeId, options } = start.json() as { challengeId: string; options: Parameters<SoftAuthenticator['register']>[0] };
  const finish: Record<string, unknown> = {
    challengeId, response: auth.register(options, ORIGIN), deviceLabel: body.deviceLabel ?? 'Laptop',
    termsSignature: body.termsSignature === undefined ? SIG : body.termsSignature,
  };
  if (body.acceptedTerms !== undefined) finish.acceptedTerms = body.acceptedTerms;
  const res = await b.post('/v1/register/webauthn/finish', finish);
  return { res, auth };
}

/** Logs in in `b` with `auth`'s passkey (discoverable): the finish's response. */
export async function logInWithKey(b: Poster, auth: SoftAuthenticator, deviceLabel = 'Laptop'): Promise<LightMyRequestResponse> {
  const s = (await b.post('/v1/login/webauthn/start', {})).json() as { challengeId: string; options: Parameters<SoftAuthenticator['authenticate']>[0] };
  return b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: auth.authenticate(s.options, ORIGIN), deviceLabel });
}
