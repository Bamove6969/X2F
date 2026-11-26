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
import { SESSION_KEY_HEADER, deviceBoundOn, needsProof, renewProof, sessionKeyHeader } from '../../session/deviceKey.js';
import { publishIdleReminder } from '../../session/idleReminderWatch.js';
import { publishSessionWatch } from '../../session/sessionWatch.js';
import { refreshSession } from '../../session/useSession.js';
import { CHANGES_PATH } from '../settings/holdCopy.js';
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

/**
 * S-085 (behind `VITE_X2F_DEVICE_BOUND=1`): every POST carries this browser's session key, so a
 * session the call opens is bound to it; a 401 `session-proof-required` renews the bound cookie
 * and retries once. A renewal that must wait (network, 5xx, 429) fails like the network; the
 * session is gone only when the renewal says so or the retry is refused again.
 */
const authFetch: typeof fetch = async (input, init) => {
  let sent = init;
  if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
    const key = await sessionKeyHeader();
    if (key !== null) {
      const headers = new Headers(init?.headers);
      headers.set(SESSION_KEY_HEADER, key);
      sent = { ...init, headers };
    }
  }
  let res = await globalThis.fetch(input, sent);
  if (deviceBoundOn() && (await needsProof(res))) {
    const r = await renewProof();
    // Review MF2: nothing is known about the session: fail like the network, never a logout.
    if (r === 'retry-later') throw new TypeError('x2f: the session proof could not be renewed now; try again');
    if (r === 'gone') {
      goLogin();
      return res;
    }
    // Review MF1: retried once, also after a refused renewal (another tab may have renewed it).
    res = await globalThis.fetch(input, sent);
    if (await needsProof(res)) {
      goLogin();
      return res;
    }
  }
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
 * FU-A shapes (owner, 2026-10-23; on the main line since 2026-10-27). PGP login takes the private
 * `loginName` with the pasted key (owner G6, 7 Nov 2026; a wrong name answers like an unknown key),
 * and password login takes the private `loginName`; the
 * server answers every password miss with 401 `credentials-invalid` and this browser's `misses`
 * count (`AuthApiError.misses`). These went through the raw client until FU-A's typed client
 * landed; `task30-tripwires.test.ts` fired on that merge and was retired.
 */
export function pgpLoginStart(loginName: string, key: string, o: { pendingId?: string } = {}): Promise<PgpChallenge> {
  return authApi.loginPgpStart({ loginName, key, ...o });
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
 * Continue goes on to `returnTo`; otherwise go straight to `returnTo`. A strong login while changes
 * wait lands on Account changes first (owner G58), after the session length, the Terms and News.
 *
 * Review 3: the login's `me` also sets up "Stay logged in?" (its end and the person's methods) and
 * the idle reminder, and the page's shared session answer is dropped (`refreshSession`) so the app
 * shell sees the new login.
 */
export async function afterLogin(navigate: (to: string) => void, returnTo: string): Promise<void> {
  // The screens behind the front door read the shared session answer: the one from before this
  // login says signed out (session/frontDoor.tsx), so drop it before going back to `returnTo`.
  refreshSession();
  let termsCurrent = true;
  // Session length (owner, 2 Nov 2026): a session with no length yet asks for it before anything else.
  let askLength = false;
  let land = returnTo;
  try {
    const me = await authApi.me();
    termsCurrent = me.termsCurrent;
    askLength = me.session != null && me.session.lengthHours === null;
    publishSessionWatch(me.session != null ? { info: me.session, methods: me.methods } : null);
    publishIdleReminder(me.kind === 'trader' ? (me.idleReminderMinutes ?? null) : null);
    refreshSession();
    // Owner G58 (7 Nov): a lead who logs in strongly while changes wait sees them first (before and
    // after, the countdown, Approve now, Cancel all, Make changes); its Continue goes on to `returnTo`.
    if ((me.pendingChanges ?? null) !== null && me.changesWait === false && (me.member ?? null) === null) {
      land = `${CHANGES_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
    }
  } catch {
    // The login itself succeeded; carry on. Any call that needs the new Terms still answers
    // `terms-required`, which the API client routes to the Terms screen.
  }
  // `after=login`: the News page that opened by itself offers "Don't show me this again".
  const next = (await hasUnseenNews()) ? `/news?after=login&returnTo=${encodeURIComponent(land)}` : land;
  const target = termsCurrent ? next : `/terms?returnTo=${encodeURIComponent(next)}`;
  navigate(askLength ? `${SESSION_LENGTH_PATH}?returnTo=${encodeURIComponent(target)}` : target);
}
