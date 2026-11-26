/**
 * DEMO ONLY: the seeded staff accounts (staff-seed.ts makes them through the staff API's real
 * routes) and their way in from a browser with no hardware key (the staff gateway's demo login,
 * staff-gateway-core.ts).
 *
 * Staff logins are two methods by design: a security key (or passkey) and a PGP key (D-070, owner
 * G3); there is no password or authenticator code for staff. The seed gives every staff account
 * software keys, as the regtest e2e stack does (tools/regtest/e2e/softKey.ts): attested by the
 * demo's own throwaway CA (staff-mds.ts), and a PGP key. They are kept in .demo/secrets/staff.json
 * (0600). The demo login does the real two-step staff login with them, from the gateway, exactly as
 * the e2e specs' `staffLogin` does, and hands the browser the staff session cookie the API set.
 * Nothing in apps/ changes: the API checks every signature and code as in production.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { StaffRole } from '@x2f/staff';
import { authenticate, type KeyData } from '../regtest/e2e/softKey.js';
import { pgpCode, type PgpPair } from '../regtest/e2e/staffClient.js';
import { STAFF_FILE } from './config.js';

/** One seeded staff account, as the seed planned it. */
export interface StaffPerson {
  tradeTag: string;
  loginName: string;
  role: Exclude<StaffRole, 'helper'>;
  /** Which screens this account shows (the guide and logins.txt). */
  sees: string;
}

/** The demo's staff: the owner, a senior moderator and two moderators. */
export const STAFF_CAST: readonly StaffPerson[] = [
  { tradeTag: 'Lumen_Prime', loginName: 'lumen-demo', role: 'owner', sees: 'everything: Overview (site controls, news, maintenance), Disputes, Past reputation, Staff (invites, grants), Performance, Prices, Training, Activity log, Feedback, Settings, Alerts' },
  { tradeTag: 'Vale_Hartley', loginName: 'vale-demo', role: 'senior', sees: 'Disputes (and approving rulings), Past reputation, Training, Activity log, Feedback; freezes and bans' },
  { tradeTag: 'Kestrel_Ash', loginName: 'kestrel-demo', role: 'mod', sees: 'Disputes (the queue and a case), Past reputation, Training, Activity log' },
  { tradeTag: 'Wren_Calloway', loginName: 'wren-demo', role: 'mod', sees: 'Disputes (the queue and a case), Past reputation, Training, Activity log' },
];

/** A seeded staff account with its throwaway keys (keys[0] is the one the demo login uses). */
export interface StaffSecret {
  tradeTag: string;
  loginName: string;
  role: StaffPerson['role'];
  keys: KeyData[];
  pgp: PgpPair;
}

export function readStaffSecrets(file = STAFF_FILE): StaffSecret[] {
  if (!existsSync(file)) return [];
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(v) ? (v as StaffSecret[]) : [];
  } catch {
    return [];
  }
}

/**
 * A key's next signature counter: never below what this process used, and else a clock reading
 * (as staffKit.ts does), so a gateway restart or the seed's own logins never make it go back.
 */
export function bumpCounter(k: KeyData, nowMs: number): void {
  k.counter = Math.max(k.counter, Math.floor(nowMs / 1000) - 1_700_000_000);
}

/** The name=value pairs of a Cookie header. */
export function parseCookieHeader(h: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (h ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

/**
 * The real staff login with `who`'s software keys, from Node, on the staff API at `api`, as a
 * browser on `origin` would make it: the security key first, then the PGP key when the API asks
 * for a second step. `cookies` is what the browser already holds (its device cookie, so the
 * session belongs to that browser). Returns the Set-Cookie headers the API sent, for the browser.
 */
export async function softStaffLogin(
  o: { api: string; origin: string; rpId: string; now?: () => number; fetchImpl?: typeof fetch },
  who: StaffSecret,
  cookies: Map<string, string>,
): Promise<string[]> {
  const doFetch = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
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
  const key = who.keys[0];
  if (!key) throw new Error(`${who.loginName} has no key`);
  const s = await post<{ challengeId: string; options: never }>('/staff/v1/login/security-key/start', { loginName: who.loginName });
  bumpCounter(key, now());
  const first = await post<{ pendingId?: string }>('/staff/v1/login/security-key/finish', {
    challengeId: s.challengeId, response: authenticate(key, s.options, o.origin, o.rpId), deviceLabel: 'Demo login',
  });
  if (first.pendingId !== undefined) {
    const p = await post<{ challengeId: string; encryptedMessage: string }>('/staff/v1/login/pgp/start', { key: who.pgp.publicKey, pendingId: first.pendingId });
    await post('/staff/v1/login/pgp/finish', { challengeId: p.challengeId, code: await pgpCode(p.encryptedMessage, who.pgp), deviceLabel: 'Demo login', pendingId: first.pendingId });
  }
  return [...setCookies.values()];
}
