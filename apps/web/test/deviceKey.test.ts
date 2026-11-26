// S-085 device-bound sessions, web side: the device key in IndexedDB, the X2F-Session-Key header on
// auth POSTs, renewing the bound cookie with a signed challenge, the retry in api() and the auth
// client, and the refresh timer. All behind VITE_X2F_DEVICE_BOUND=1.
import { createPublicKey, verify } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, api, setNavigator, setSessionGoneListener } from '../src/api/client.js';
import {
  DEVICE_KEY_DB, REFRESH_EVERY_MS, deviceKey, proofMessage, renewProof, sessionKeyHeader, setDeviceKeyFactory,
  setProofLock, startProofRefresh, stopProofRefresh,
} from '../src/session/deviceKey.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CHALLENGE = 'c'.repeat(75);
const SESSION = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const ORIGIN = 'https://x2f.test';

let idb: IDBFactory;
beforeEach(() => {
  idb = new IDBFactory();
  setDeviceKeyFactory(idb);
  vi.stubEnv('VITE_X2F_DEVICE_BOUND', '1');
  vi.stubGlobal('location', { origin: ORIGIN, pathname: '/sell', search: '' });
});
afterEach(() => {
  stopProofRefresh();
  setSessionGoneListener(null);
  setProofLock(undefined);
  setNavigator(null);
  setDeviceKeyFactory(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const b64urlToBuf = (s: string) => Buffer.from(s, 'base64url');

/** A server that answers the two proof routes, checking the signature against `spki`. */
function proofServer(spki: () => string, rest: (url: string, init?: RequestInit) => Response = () => json(200, {})) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    if (url === '/v1/account/session/proof/challenge') return json(200, { challenge: CHALLENGE, session: SESSION });
    if (url === '/v1/account/session/proof') {
      const { challenge, signature } = JSON.parse(init!.body as string) as { challenge: string; signature: string };
      const key = createPublicKey({ key: b64urlToBuf(spki()), format: 'der', type: 'spki' });
      const ok = challenge === CHALLENGE && /^[A-Za-z0-9_-]{86}$/.test(signature)
        && verify('sha256', Buffer.from(proofMessage(ORIGIN, SESSION, challenge)), { key, dsaEncoding: 'ieee-p1363' }, b64urlToBuf(signature));
      return ok ? json(200, { boundUntil: 'x' }) : json(401, { error: 'session-proof-invalid' });
    }
    return rest(url, init);
  });
  vi.stubGlobal('fetch', f);
  return { f, seen };
}

describe('the device key', () => {
  it('flag off: no key is made, no header, nothing renewed', async () => {
    vi.stubEnv('VITE_X2F_DEVICE_BOUND', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await sessionKeyHeader()).toBeNull();
    expect(await renewProof()).toBe('not-bound');
    startProofRefresh();
    expect(f).not.toHaveBeenCalled();
    expect((await idb.databases()).map((d) => d.name)).not.toContain(DEVICE_KEY_DB);
  });

  it('is a non-extractable P-256 signing key, made once and kept across page loads', async () => {
    const h1 = await sessionKeyHeader();
    expect(h1).toMatch(/^[A-Za-z0-9_-]+$/);
    const pub = createPublicKey({ key: b64urlToBuf(h1!), format: 'der', type: 'spki' });
    expect(pub.asymmetricKeyType).toBe('ec');
    expect(pub.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    const k = await deviceKey();
    expect(k!.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', k!.privateKey)).rejects.toThrow();
    // A new page load (cache dropped) reads the same key from IndexedDB.
    setDeviceKeyFactory(idb);
    expect(await sessionKeyHeader()).toBe(h1);
    // Another profile (another IndexedDB) has another key.
    setDeviceKeyFactory(new IDBFactory());
    expect(await sessionKeyHeader()).not.toBe(h1);
  });

  it('no IndexedDB: no header, the session stays unbound', async () => {
    setDeviceKeyFactory(null);
    expect(await sessionKeyHeader()).toBeNull();
  });
});

describe('renewProof', () => {
  it('signs the server challenge with the device key', async () => {
    const spki = (await sessionKeyHeader())!;
    const { seen } = proofServer(() => spki);
    expect(await renewProof()).toBe('renewed');
    expect(seen.map((s) => s.url)).toEqual(['/v1/account/session/proof/challenge', '/v1/account/session/proof']);
    expect(seen[0]!.init?.credentials).toBe('same-origin');
  });

  it('a server holding another key refuses it: failed', async () => {
    await sessionKeyHeader();
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const otherSpki = Buffer.from(await crypto.subtle.exportKey('spki', other.publicKey)).toString('base64url');
    proofServer(() => otherSpki);
    expect(await renewProof()).toBe('failed');
  });

  it('signs the v2 message: this origin, the session the server names, the challenge (S1)', async () => {
    expect(proofMessage('https://a.example', 's', 'c')).toBe('x2f-session-proof-v2\nhttps://a.example\ns\nc');
    const spki = (await sessionKeyHeader())!;
    proofServer(() => spki);
    expect(await renewProof()).toBe('renewed');
  });

  it('refuses to sign a challenge or session id of the wrong shape', async () => {
    await sessionKeyHeader();
    for (const body of [{ challenge: 'c\nx', session: SESSION }, { challenge: CHALLENGE, session: 'x\ny' }, { challenge: CHALLENGE }]) {
      const f = vi.fn(async () => json(200, body));
      vi.stubGlobal('fetch', f);
      expect(await renewProof()).toBe('failed');
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('409 not-bound and the flag-off 404 are not-bound; not-authenticated is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'not-bound' })));
    expect(await renewProof()).toBe('not-bound');
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'not-found' })));
    expect(await renewProof()).toBe('not-bound');
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'not-authenticated' })));
    expect(await renewProof()).toBe('gone');
  });

  it('MF2: a network error, a 5xx or a 429 on either step is retry-later, never gone or failed', async () => {
    const spki = (await sessionKeyHeader())!;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await renewProof()).toBe('retry-later');
    for (const status of [500, 502, 503, 429]) {
      vi.stubGlobal('fetch', vi.fn(async () => json(status, { error: status === 429 ? 'slow-down' : 'busy' })));
      expect(await renewProof(), `challenge ${status}`).toBe('retry-later');
      proofServer(() => spki);
      const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const real = f.getMockImplementation() as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      f.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === '/v1/account/session/proof' ? json(status, {}) : real(input, init)));
      expect(await renewProof(), `proof ${status}`).toBe('retry-later');
    }
    proofServer(() => spki);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const real = f.getMockImplementation() as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/v1/account/session/proof') throw new TypeError('network');
      return real(input, init);
    });
    expect(await renewProof()).toBe('retry-later');
  });

  it('MF1: renewals are serialised across tabs with the x2f-proof lock', async () => {
    const spki = (await sessionKeyHeader())!;
    const { seen } = proofServer(() => spki);
    const names: string[] = [];
    let tail = Promise.resolve();
    // One lock for every "tab": each module instance below goes through it.
    setProofLock(async (name, fn) => {
      names.push(name);
      const run = tail.then(fn);
      tail = run.then(() => undefined, () => undefined);
      return run;
    });
    // A second instance of the module, as another tab has (a query makes Vite load it again).
    // @ts-expect-error: a query import has no declaration of its own (it is the same module).
    const other = (await import('../src/session/deviceKey.js?tab=2')) as typeof import('../src/session/deviceKey.js');
    other.setDeviceKeyFactory(idb);
    other.setProofLock((name, fn) => {
      names.push(name);
      const run = tail.then(fn);
      tail = run.then(() => undefined, () => undefined);
      return run;
    });
    expect(await Promise.all([renewProof(), other.renewProof()])).toEqual(['renewed', 'renewed']);
    expect(names).toEqual(['x2f-proof', 'x2f-proof']);
    // Not interleaved: one tab's challenge and proof, then the other's.
    expect(seen.map((x) => x.url.split('/').pop())).toEqual(['challenge', 'proof', 'challenge', 'proof']);
  });

  it('concurrent callers share one attempt', async () => {
    const spki = (await sessionKeyHeader())!;
    const { f } = proofServer(() => spki);
    const rs = await Promise.all([renewProof(), renewProof(), renewProof()]);
    expect(rs).toEqual(['renewed', 'renewed', 'renewed']);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('api() and session-proof-required', () => {
  it('renews and retries once', async () => {
    const spki = (await sessionKeyHeader())!;
    let calls = 0;
    proofServer(() => spki, () => (++calls === 1 ? json(401, { error: 'session-proof-required' }) : json(200, { ok: true })));
    await expect(api('/v1/offers')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('a session that cannot prove its key is gone, once the retry is refused too (MF1)', async () => {
    await sessionKeyHeader();
    const gone = vi.fn();
    setSessionGoneListener(gone);
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return json(200, { challenge: CHALLENGE, session: SESSION });
      if (url.endsWith('/proof')) return json(401, { error: 'session-proof-invalid' });
      calls++;
      return json(401, { error: 'session-proof-required' });
    }));
    const err = await api('/v1/offers').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiCallError);
    expect((err as ApiCallError).code).toBe('session-proof-required');
    expect(calls).toBe(2);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('MF1: a failed renewal retries the request once; another tab renewed the shared cookie, so it succeeds and nothing ends', async () => {
    await sessionKeyHeader();
    const gone = vi.fn();
    setSessionGoneListener(gone);
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return json(200, { challenge: CHALLENGE, session: SESSION });
      if (url.endsWith('/proof')) return json(401, { error: 'session-proof-invalid' });
      return ++calls === 1 ? json(401, { error: 'session-proof-required' }) : json(200, { ok: true });
    }));
    await expect(api('/v1/offers')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(gone).not.toHaveBeenCalled();
  });

  it('MF2: a renewal that must be retried later raises a network error and never ends the session', async () => {
    await sessionKeyHeader();
    const gone = vi.fn();
    setSessionGoneListener(gone);
    for (const path of ['/v1/offers', '/v1/account/me']) {
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/challenge')) return json(503, { error: 'busy' });
        calls++;
        return json(401, { error: 'session-proof-required' });
      }));
      const err = await api(path).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect(err).not.toBeInstanceOf(ApiCallError);
      expect(calls).toBe(1);
    }
    expect(gone).not.toHaveBeenCalled();
  });

  it('flag off: a 401 session-proof-required is not retried', async () => {
    vi.stubEnv('VITE_X2F_DEVICE_BOUND', '');
    const f = vi.fn(async () => json(401, { error: 'session-proof-required' }));
    vi.stubGlobal('fetch', f);
    await expect(api('/v1/offers')).rejects.toBeInstanceOf(ApiCallError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('the auth client', () => {
  it('sends X2F-Session-Key on POSTs, so the new session is bound', async () => {
    const spki = (await sessionKeyHeader())!;
    const f = vi.fn(async () => json(401, { error: 'credentials-invalid', misses: 1 }));
    vi.stubGlobal('fetch', f);
    const { passwordLogin } = await import('../src/screens/auth/authApi.js');
    await passwordLogin('someone', 'pw').catch(() => undefined);
    const init = (f.mock.calls as unknown as [RequestInfo, RequestInit][])[0]![1];
    expect(new Headers(init.headers).get('x2f-session-key')).toBe(spki);
  });

  it('flag off: no header', async () => {
    vi.stubEnv('VITE_X2F_DEVICE_BOUND', '');
    const f = vi.fn(async () => json(401, { error: 'credentials-invalid', misses: 1 }));
    vi.stubGlobal('fetch', f);
    const { passwordLogin } = await import('../src/screens/auth/authApi.js');
    await passwordLogin('someone', 'pw').catch(() => undefined);
    const init = (f.mock.calls as unknown as [RequestInfo, RequestInit][])[0]![1];
    expect(new Headers(init.headers).get('x2f-session-key')).toBeNull();
  });
});

describe('the auth client and renewal (MF1, MF2)', () => {
  it('a renewal that must be retried later does not send the person to the login', async () => {
    await sessionKeyHeader();
    const go = vi.fn();
    setNavigator(go, () => ({ pathname: '/sell', search: '' }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) throw new TypeError('network');
      return json(401, { error: 'session-proof-required' });
    }));
    const { passwordLogin } = await import('../src/screens/auth/authApi.js');
    await passwordLogin('someone', 'pw').catch(() => undefined);
    expect(go).not.toHaveBeenCalled();
  });

  it('a failed renewal retries once; still refused, the session is gone', async () => {
    await sessionKeyHeader();
    const go = vi.fn();
    setNavigator(go, () => ({ pathname: '/sell', search: '' }));
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return json(200, { challenge: CHALLENGE, session: SESSION });
      if (url.endsWith('/proof')) return json(401, { error: 'session-proof-invalid' });
      calls++;
      return json(401, { error: 'session-proof-required' });
    }));
    const { passwordLogin } = await import('../src/screens/auth/authApi.js');
    await passwordLogin('someone', 'pw').catch(() => undefined);
    expect(calls).toBe(2);
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe('the refresh timer', () => {
  it('renews at a third of the bound cookie and stops when the session is not bound', async () => {
    await sessionKeyHeader();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? json(200, { challenge: CHALLENGE, session: SESSION }) : n === 2 ? json(200, {}) : json(409, { error: 'not-bound' }))));
    startProofRefresh();
    startProofRefresh(); // idempotent
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS - 1);
    expect(n).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    // The signature is made by WebCrypto off the fake clock: wait for it, not for fake time.
    await vi.waitFor(() => expect(n).toBe(2));
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS);
    await vi.waitFor(() => expect(n).toBe(3));
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 3);
    expect(n).toBe(3);
    expect(REFRESH_EVERY_MS).toBe(200_000);
  });
});
