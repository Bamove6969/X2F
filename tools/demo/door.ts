/**
 * DEMO ONLY: lets the seeded demo traders in from a fresh browser (the gateway's /__demo/login).
 *
 * Owner, 26 Nov 2026: there are no passwords. A trader logs in with a passkey, a security key or a
 * PGP key (an authenticator app counts as a second kind of method but never logs in alone), and
 * every account holds at least two kinds. The seed (seed.ts) signs every demo trader up with a
 * throwaway PGP key and adds an authenticator app, through the real routes. The browser holds
 * neither key, so the demo login page does the real PGP login from the gateway, with the account's
 * throwaway key (`/v1/login/pgp/start` then `finish`, as the web app's PGP login does), and hands
 * the browser the session cookie the API set. The API checks the code as in production; a login
 * while the account is logged in elsewhere still waits for that device's approval.
 * The keys are kept in .demo/secrets/traders.json (0600). Accounts made by hand get none of this.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRETS_DIR } from './config.js';
import { pgpCode, type PgpPair } from '../regtest/e2e/staffClient.js';

/** The seeded traders and their throwaway PGP keys, written by seed.ts. */
export const TRADERS_FILE = join(SECRETS_DIR, 'traders.json');

export interface TraderSecret {
  displayName: string;
  loginName: string;
  pgp: PgpPair;
}

export function readTraderSecrets(file = TRADERS_FILE): TraderSecret[] {
  if (!existsSync(file)) return [];
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(v) ? (v as TraderSecret[]).filter((t) => typeof t?.loginName === 'string' && typeof t?.pgp?.privateKey === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The real trader PGP login with `who`'s throwaway key, from Node, on the API at `api`, as a browser
 * on `origin` would make it. `cookies` is what the browser already holds (its device cookie, so the
 * session belongs to that browser). Returns the Set-Cookie headers the API sent, for the browser.
 * Throws when the API answers anything but a session (an approval wait included).
 */
export async function softTraderLogin(
  o: { api: string; origin: string; fetchImpl?: typeof fetch },
  who: TraderSecret,
  cookies: Map<string, string>,
): Promise<string[]> {
  const doFetch = o.fetchImpl ?? fetch;
  const jar = new Map(cookies);
  const setCookies = new Map<string, string>();
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await doFetch(`${o.api}${path}`, {
      method: 'POST',
      headers: {
        origin: o.origin,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(jar.size > 0 ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';', 1)[0]!;
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at);
      jar.set(name, pair.slice(at + 1));
      setCookies.set(name, c);
    }
    const text = await res.text();
    if (res.status >= 300) throw new Error(`${path} answered ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  };
  const s = await post<{ challengeId: string; encryptedMessage: string }>('/v1/login/pgp/start', { key: who.pgp.publicKey, loginName: who.loginName });
  const done = await post<{ status?: string }>('/v1/login/pgp/finish', {
    challengeId: s.challengeId, code: await pgpCode(s.encryptedMessage, who.pgp), deviceLabel: 'Demo login',
  });
  if (done?.status === 'approve-on-device') throw new Error(`${who.loginName} is logged in on another device: approve this login there, or log it out there first`);
  if (done?.status !== 'ok') throw new Error(`login answered ${JSON.stringify(done)}`);
  return [...setCookies.values()];
}
