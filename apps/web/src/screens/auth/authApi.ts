/**
 * The web app's single auth client (Plan 2 `@x2f/auth-client`) and the few flows the login and
 * security screens need on top of it. The client talks to the same origin.
 *
 * Only a 401 `not-authenticated` means the session has gone: then the page routes to `/login` with
 * a `returnTo` (Task 30) and the call still throws so the caller stops. Every other 401 is the
 * person's own mistake — a wrong password or code (`credentials-invalid`, `code-invalid`) or a
 * failed key tap (`webauthn-failed`) — and stays on the screen as an error there.
 */
import { createAuthApi, defaultDeviceLabel, type LoginResult, type PasswordLoginResult, type PgpChallenge } from '@x2f/auth-client';
import { api, goLogin } from '../../api/client.js';

/** Reads the error code of a 401 without consuming the body the client still has to read. */
async function sessionGone(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as unknown;
    return body !== null && typeof body === 'object' && (body as { error?: unknown }).error === 'not-authenticated';
  } catch {
    return false;
  }
}

const authFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  if (await sessionGone(res)) goLogin();
  return res;
};

export const authApi = createAuthApi({ fetch: authFetch });

/** This browser's coarse device label for the session list (never the raw user-agent string). */
export function deviceLabel(): string {
  // `userAgentData` is not in the DOM lib's `Navigator` type; `defaultDeviceLabel` only reads it.
  const nav = typeof navigator === 'undefined' ? {} : (navigator as { userAgentData?: { platform?: string } });
  return defaultDeviceLabel(nav);
}

/*
 * FU-A shapes (owner, 2026-10-23; the lead's wip/lead-p2-fua, not on the main line yet). PGP login
 * takes the pasted key alone (`{ key }`, never a login name), and password login takes the private
 * `loginName`; the server answers every password miss with 401 `credentials-invalid` and this
 * browser's `misses` count. These go through the raw client, which keeps every field of an error,
 * until FU-A's typed client lands; `task30-tripwires.test.ts` fails then, the signal to switch.
 */
export function pgpLoginStart(key: string, o: { pendingId?: string } = {}): Promise<PgpChallenge> {
  return api<PgpChallenge>('/v1/login/pgp/start', { method: 'POST', body: { key, ...o } });
}

export function pgpLoginFinish(challengeId: string, code: string): Promise<LoginResult> {
  return api<LoginResult>('/v1/login/pgp/finish', { method: 'POST', body: { challengeId, code, deviceLabel: deviceLabel() } });
}

export function passwordLogin(loginName: string, password: string): Promise<PasswordLoginResult> {
  return api<PasswordLoginResult>('/v1/login/password', { method: 'POST', body: { loginName, password, deviceLabel: deviceLabel() } });
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
