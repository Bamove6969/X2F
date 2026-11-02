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
import { goLogin } from '../../api/client.js';
import { hasUnseenNews } from '../news-model.js';
import { SESSION_LENGTH_PATH } from './sessionCopy.js';

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
 * FU-A shapes (owner, 2026-10-23; on the main line since 2026-10-27). PGP login takes the pasted
 * key alone (`{ key }`, never a login name), and password login takes the private `loginName`; the
 * server answers every password miss with 401 `credentials-invalid` and this browser's `misses`
 * count (`AuthApiError.misses`). These went through the raw client until FU-A's typed client
 * landed; `task30-tripwires.test.ts` fired on that merge and was retired.
 */
export function pgpLoginStart(key: string, o: { pendingId?: string } = {}): Promise<PgpChallenge> {
  return authApi.loginPgpStart({ key, ...o });
}

export function pgpLoginFinish(challengeId: string, code: string): Promise<LoginResult> {
  return authApi.loginPgpFinish({ challengeId, code, deviceLabel: deviceLabel() });
}

export function passwordLogin(loginName: string, password: string): Promise<PasswordLoginResult> {
  return authApi.loginPassword({ loginName, password, deviceLabel: deviceLabel() });
}

/**
 * Where a fresh login lands: a session with no length yet first asks for one (`/session-length`,
 * owner 2 Nov 2026) and carries the rest on as `returnTo`. `me().termsCurrent === false` means the Terms changed, so the Terms
 * screen comes first and carries `returnTo` on (Plan 2 R10). Then, when this device has not shown
 * the newest News message yet (Plan 4 Task 28, owner 2026-10-29), the News page opens and its
 * Continue goes on to `returnTo`; otherwise go straight to `returnTo`.
 */
export async function afterLogin(navigate: (to: string) => void, returnTo: string): Promise<void> {
  let termsCurrent = true;
  // Session length (owner, 2 Nov 2026): a session with no length yet asks for it before anything else.
  let askLength = false;
  try {
    const me = await authApi.me();
    termsCurrent = me.termsCurrent;
    askLength = me.session != null && me.session.lengthHours === null;
  } catch {
    // The login itself succeeded; carry on. Any call that needs the new Terms still answers
    // `terms-required`, which the API client routes to the Terms screen.
  }
  const next = (await hasUnseenNews()) ? `/news?returnTo=${encodeURIComponent(returnTo)}` : returnTo;
  const target = termsCurrent ? next : `/terms?returnTo=${encodeURIComponent(next)}`;
  navigate(askLength ? `${SESSION_LENGTH_PATH}?returnTo=${encodeURIComponent(target)}` : target);
}
