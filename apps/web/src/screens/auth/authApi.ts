/**
 * The web app's single auth client (Plan 2 `@x2f/auth-client`) and the few flows the login and
 * security screens need on top of it. The client talks to the same origin; a 401 from any call
 * means the session has gone, so the page routes to `/login` with a `returnTo` (Task 30) and the
 * call still throws so the caller stops.
 */
import { createAuthApi, defaultDeviceLabel, type LoginResult, type PgpChallenge } from '@x2f/auth-client';
import { api, goLogin } from '../../api/client.js';

/** Routes an expired session to `/login` (a no-op while already there), then lets the call throw. */
const authFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  if (res.status === 401) goLogin();
  return res;
};

export const authApi = createAuthApi({ fetch: authFetch });

/** This browser's coarse device label for the session list (never the raw user-agent string). */
export function deviceLabel(): string {
  // `userAgentData` is not in the DOM lib's `Navigator` type; `defaultDeviceLabel` only reads it.
  const nav = typeof navigator === 'undefined' ? {} : (navigator as { userAgentData?: { platform?: string } });
  return defaultDeviceLabel(nav);
}

/**
 * PGP login needs no login name (owner, 2026-10-23, spec §6.2): the person pastes their public key
 * and X2F encrypts a one-time code to it. The typed client's `loginPgpStart` still takes a
 * username (the staff flow); until the by-key endpoint lands in `@x2f/auth-client` these two call
 * the route directly. `task30-tripwires.test.ts` fails once the typed client gains the by-key form,
 * which is the signal to switch these over.
 */
export function pgpLoginStart(publicKey: string): Promise<PgpChallenge> {
  return api<PgpChallenge>('/v1/login/pgp/start', { method: 'POST', body: { publicKey } });
}

export function pgpLoginFinish(challengeId: string, code: string): Promise<LoginResult> {
  return api<LoginResult>('/v1/login/pgp/finish', { method: 'POST', body: { challengeId, code, deviceLabel: deviceLabel() } });
}

/**
 * Where a fresh login lands: `me().termsCurrent === false` means the Terms changed, so the Terms
 * screen comes first and carries `returnTo` on to the original screen (Plan 2 R10); otherwise go
 * straight to `returnTo`.
 */
export async function afterLogin(navigate: (to: string) => void, returnTo: string): Promise<void> {
  let termsCurrent = true;
  try {
    termsCurrent = (await authApi.me()).termsCurrent;
  } catch {
    // The login itself succeeded; carry on. Any call that needs the new Terms still answers
    // `terms-required`, which the API client routes to the Terms screen.
  }
  navigate(termsCurrent ? returnTo : `/terms?returnTo=${encodeURIComponent(returnTo)}`);
}
