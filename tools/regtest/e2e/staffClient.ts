/**
 * Plan 4 Task 21: a staff browser as Node sees it, for the regtest stack's owner setup
 * (staffStack.ts) and the dispute specs (apps/staff-web/e2e). It talks to the staff API's own
 * plain listener on 127.0.0.1 and sends the staff origin (https://localhost:<port>, the TLS front
 * the browsers use) as its Origin, with its own cookie jar, as the staff app's pages do.
 * TEST ONLY.
 */
import * as openpgp from 'openpgp';
import { authenticate, register, registerPasskey, type CaData, type KeyData } from './softKey.js';

export class StaffClient {
  readonly jar = new Map<string, string>();
  constructor(readonly api: string, readonly origin: string) {}

  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        origin: this.origin,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.jar.size > 0 ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body === undefined ? null : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      // A cleared cookie (Max-Age=0 or an expiry in the past) leaves the jar.
      if (value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T };
  }

  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, path, body);
    if (r.status >= 300) throw new Error(`staff ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export interface PgpPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export async function newPgp(name: string): Promise<PgpPair> {
  const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name }], format: 'armored' });
  const fingerprint = (await openpgp.readKey({ armoredKey: k.publicKey })).getFingerprint();
  return { publicKey: k.publicKey, privateKey: k.privateKey, fingerprint };
}

/** The code in a PGP challenge X2F encrypted to `pair` ("X2F login code: …"). */
export async function pgpCode(encryptedMessage: string, pair: PgpPair): Promise<string> {
  const message = await openpgp.readMessage({ armoredMessage: encryptedMessage });
  const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: pair.privateKey });
  const text = (await openpgp.decrypt({ message, decryptionKeys })).data as string;
  const m = /X2F (?:login )?code: (\S+)/m.exec(text);
  if (!m) throw new Error('staff: no code in the PGP challenge');
  return m[1]!;
}

/** Registers `key` through a `{start,finish}` pair of routes that hand out `options`. */
export async function addKey(
  c: StaffClient,
  start: { path: string; body: Record<string, unknown> },
  finish: (opts: { challengeId?: string; options: never }, response: unknown) => { path: string; body: Record<string, unknown> },
  key: KeyData,
  ca: CaData | null,
): Promise<unknown> {
  const s = await c.ok<{ challengeId?: string; options: never }>('POST', start.path, start.body);
  const response = ca === null ? registerPasskey(key, s.options, c.origin) : register(key, ca, s.options, c.origin);
  const f = finish(s, response);
  return c.ok('POST', f.path, f.body);
}

/**
 * The staff login with two methods: the security key, then the PGP key (Plan 2's plugins as the
 * staff API mounts them). The client then holds the staff session cookie.
 */
export async function staffLogin(c: StaffClient, who: { loginName: string; key: KeyData; pgp: PgpPair }): Promise<void> {
  const s = await c.ok<{ challengeId: string; options: never }>('POST', '/staff/v1/login/security-key/start', { loginName: who.loginName });
  const first = await c.ok<{ pendingId?: string }>('POST', '/staff/v1/login/security-key/finish', {
    challengeId: s.challengeId, response: authenticate(who.key, s.options, c.origin), deviceLabel: 'e2e',
  });
  if (first.pendingId === undefined) return;
  const p = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/staff/v1/login/pgp/start', { key: who.pgp.publicKey, pendingId: first.pendingId });
  await c.ok('POST', '/staff/v1/login/pgp/finish', { challengeId: p.challengeId, code: await pgpCode(p.encryptedMessage, who.pgp), deviceLabel: 'e2e', pendingId: first.pendingId });
}
