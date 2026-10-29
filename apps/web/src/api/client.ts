import { useMemo } from 'react';

/**
 * A refused API call, shaped like Plan 2's `AuthApiError`: the HTTP status, the API's error code
 * and any extra fields the API sent with it (`version`, `retryAfterSeconds`, `missing`, ...).
 */
export class ApiCallError extends Error {
  readonly status: number;
  // TODO(Plan 2 auth-client): type as `ApiErrorCode` and use `AuthApiError` once @x2f/auth-client lands.
  readonly code: string;
  readonly detail?: string;
  readonly retryAfterSeconds?: number;
  readonly missing?: string[];
  readonly holdUntil?: string;
  /** Plan 2 Task 17: when the cooling-off ends (403 `cooling-off`). */
  readonly coolingUntil?: string;
  readonly version?: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiCallError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    if (typeof extra.detail === 'string') this.detail = extra.detail;
    if (typeof extra.retryAfterSeconds === 'number') this.retryAfterSeconds = extra.retryAfterSeconds;
    if (Array.isArray(extra.missing)) this.missing = extra.missing.filter((m): m is string => typeof m === 'string');
    if (typeof extra.holdUntil === 'string') this.holdUntil = extra.holdUntil;
    if (typeof extra.coolingUntil === 'string') this.coolingUntil = extra.coolingUntil;
    if (typeof extra.version === 'string') this.version = extra.version;
  }
}

export interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON; bigints go as decimal strings. */
  body?: unknown;
  signal?: AbortSignal;
}

type Where = { pathname: string; search: string };
type Go = (to: string) => void;

const browserWhere = (): Where => ({ pathname: window.location.pathname, search: window.location.search });
const browserGo: Go = (to) => window.location.assign(to);

let go: Go = browserGo;
let where: () => Where = browserWhere;

/** The app shell hands in the router's navigate (no full reload); `null` restores the defaults. */
export function setNavigator(navigate: Go | null, current?: () => Where): void {
  go = navigate ?? browserGo;
  where = current ?? browserWhere;
}

export const DEFAULT_RETURN = '/sell';

/** The longest `returnTo` followed, before and after normalising. */
export const MAX_RETURN_TO = 2048;
const RETURN_BASE = 'https://x.invalid';

/**
 * A `returnTo` value that can only lead back into this app: a path starting with exactly one '/',
 * with no '\\' and no control characters (browsers drop tabs and newlines, so "/\\t/evil.com"
 * would become "//evil.com"), at most MAX_RETURN_TO characters. It is resolved as a URL and must
 * stay on this origin with a normalised path that does not start with '//' ("/..//evil.com"
 * normalises to "//evil.com"); the normalised path, query and fragment are returned. Anything
 * else, including another origin or a `javascript:` or `data:` URL, becomes DEFAULT_RETURN. Use it
 * both when building and when following a `returnTo`.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_TO) return DEFAULT_RETURN;
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN;
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_RETURN;
  let url: URL;
  try {
    url = new URL(raw, RETURN_BASE);
  } catch {
    return DEFAULT_RETURN;
  }
  if (url.origin !== RETURN_BASE || url.pathname.startsWith('//')) return DEFAULT_RETURN;
  const path = url.pathname + url.search + url.hash;
  return path.length > MAX_RETURN_TO ? DEFAULT_RETURN : path;
}

/** The `returnTo` to follow from a query string such as `location.search`, always through safeReturnTo. */
export function returnToFrom(search: string): string {
  return safeReturnTo(new URLSearchParams(search).get('returnTo'));
}

/** Sends the page to `pathname` (with `returnTo` = here), unless it is already there. */
function redirect(pathname: string, query: string): void {
  const here = where();
  if (here.pathname === pathname) return;
  const returnTo = encodeURIComponent(safeReturnTo(here.pathname + here.search));
  go(`${pathname}?${query}${query ? '&' : ''}returnTo=${returnTo}`);
}

/**
 * Sends the page to `/login` with `returnTo` = here (Task 30): an expired session anywhere routes
 * to the login screen, which returns to this screen once the person logs back in. A no-op on
 * `/login` itself, so a login call that is refused never loops.
 */
export function goLogin(): void {
  redirect('/login', '');
}

const json = (body: unknown) => JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

/**
 * Calls the X2F API on this origin. A 403 `terms-required` from any call goes to the Terms screen
 * (Plan 2 R10) and a 409 `no-wallet` to Add a wallet (spec 6.4), each with `returnTo`; the call
 * still throws, so the caller stops.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const req: RequestInit = { method: init.method ?? 'GET', credentials: 'same-origin', headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    req.body = json(init.body);
  }
  if (init.signal) req.signal = init.signal;

  const res = await fetch(path, req);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return data as T;

  const body = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const { error, ...extra } = body;
  const err = new ApiCallError(res.status, typeof error === 'string' ? error : 'internal', extra);
  if (err.status === 403 && err.code === 'terms-required') redirect('/terms', '');
  if (err.status === 409 && err.code === 'no-wallet') redirect('/wallets', 'add=1');
  throw err;
}

/**
 * A clock that follows the server: `serverNow` is the server's time as it sent a response, and
 * the returned function adds the device time elapsed since. Deadlines and what buttons allow use
 * this, never the device clock alone.
 */
export function serverClock(serverNow: string | Date, deviceNow: () => number = Date.now): () => Date {
  const server = serverNow instanceof Date ? serverNow.getTime() : Date.parse(serverNow);
  if (!Number.isFinite(server)) throw new Error('serverClock: unreadable server time');
  const offset = server - deviceNow();
  return () => new Date(deviceNow() + offset);
}

/** `serverClock` for a component; a new `serverNow` re-anchors it. */
export function useServerClock(serverNow: string | Date): () => Date {
  const key = serverNow instanceof Date ? serverNow.toISOString() : serverNow;
  return useMemo(() => serverClock(key), [key]);
}
