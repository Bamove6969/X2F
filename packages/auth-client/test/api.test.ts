import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIG } from './helpers/routes.js';
import { AuthApiError, MISSES_BEFORE_SENDING_AWAY, PASSWORD_LOGIN_MISMATCH, createAuthApi, shouldSendAway } from '../src/index.js';

interface Sent {
  url: string;
  init: RequestInit;
}

/** A fetch that records each request and answers with `reply`. */
function recorder(reply: () => Response = () => Response.json({ ok: true })) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init: init ?? {} });
    return reply();
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

const headersOf = (s: Sent) => new Headers(s.init.headers);
const bodyOf = (s: Sent): unknown => (typeof s.init.body === 'string' ? JSON.parse(s.init.body) : s.init.body);

async function refusal(res: Response): Promise<AuthApiError> {
  const { fetch } = recorder(() => res);
  const e = await createAuthApi({ fetch }).loginPassword({ loginName: 'alice', password: 'x', deviceLabel: 'Browser' }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AuthApiError);
  return e as AuthApiError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAuthApi requests', () => {
  it('posts JSON to the route on the same origin by default, with same-origin credentials', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ fetch }).loginPgpStart({ key: 'KEY' });
    expect(sent).toHaveLength(1);
    const s = sent[0]!;
    expect(s.url).toBe('/v1/login/pgp/start');
    expect(s.init.method).toBe('POST');
    expect(s.init.credentials).toBe('same-origin');
    expect(headersOf(s).get('content-type')).toBe('application/json');
    expect(bodyOf(s)).toEqual({ key: 'KEY' });
  });

  it('puts baseUrl in front of the path', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ baseUrl: 'http://127.0.0.1:4000', fetch }).loginPgpStart({ key: 'KEY' });
    expect(sent[0]!.url).toBe('http://127.0.0.1:4000/v1/login/pgp/start');
  });

  it('sends a GET with no body and no content type', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ fetch }).me();
    const s = sent[0]!;
    expect(s.url).toBe('/v1/account/me');
    expect(s.init.method).toBe('GET');
    expect(s.init.body).toBeUndefined();
    expect(headersOf(s).has('content-type')).toBe(false);
    expect(s.init.credentials).toBe('same-origin');
  });

  it('sends a DELETE without a body when the route takes none, and encodes path ids', async () => {
    const { sent, fetch } = recorder(() => new Response(null, { status: 204 }));
    await expect(createAuthApi({ fetch }).removeWallet('a/b?c')).resolves.toBeUndefined();
    const s = sent[0]!;
    expect(s.url).toBe('/v1/wallets/a%2Fb%3Fc');
    expect(s.init.method).toBe('DELETE');
    expect(s.init.body).toBeUndefined();
    expect(headersOf(s).has('content-type')).toBe(false);
  });

  it('sends removeMethod as a DELETE with the confirm token in a JSON body (R17)', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ fetch }).removeMethod('pgp', 'id/1', { confirmToken: 'tok' });
    const s = sent[0]!;
    expect(s.url).toBe('/v1/account/methods/pgp/id%2F1');
    expect(s.init.method).toBe('DELETE');
    expect(headersOf(s).get('content-type')).toBe('application/json');
    expect(bodyOf(s)).toEqual({ confirmToken: 'tok' });
  });

  it('leaves out fields that are undefined (no confirm token yet)', async () => {
    const { sent, fetch } = recorder(() => Response.json({ id: 'w' }, { status: 201 }));
    await createAuthApi({ fetch }).addWallet({ app: 'cake', label: 'Main', address: 'addr', confirmToken: undefined });
    expect(bodyOf(sent[0]!)).toEqual({ app: 'cake', label: 'Main', address: 'addr' });
  });

  it('posts a batch of wallets with one confirm token to POST /v1/wallets and returns the list', async () => {
    const out = [{ id: 'w1' }, { id: 'w2' }];
    const { sent, fetch } = recorder(() => Response.json(out, { status: 201 }));
    const wallets = [
      { app: 'cake' as const, label: 'A', address: 'a1' },
      { app: 'feather' as const, label: 'B', address: 'b2' },
    ];
    await expect(createAuthApi({ fetch }).addWallets({ wallets, confirmToken: 'tok' })).resolves.toEqual(out);
    const s = sent[0]!;
    expect(s.url).toBe('/v1/wallets');
    expect(s.init.method).toBe('POST');
    expect(bodyOf(s)).toEqual({ wallets, confirmToken: 'tok' });
  });

  it('leaves the token out of a batch that has none yet, and surfaces confirm-required naming add-wallets', async () => {
    const { sent, fetch } = recorder(() => Response.json({ error: 'confirm-required', action: 'add-wallets' }, { status: 403 }));
    const e = await createAuthApi({ fetch })
      .addWallets({ wallets: [{ app: 'cake', label: 'A', address: 'a1' }], confirmToken: undefined })
      .catch((x: unknown) => x);
    expect(bodyOf(sent[0]!)).toEqual({ wallets: [{ app: 'cake', label: 'A', address: 'a1' }] });
    expect(e).toBeInstanceOf(AuthApiError);
    expect((e as AuthApiError).code).toBe('confirm-required');
    expect((e as AuthApiError).action).toBe('add-wallets');
  });

  it('reads the wallet rule with a GET to /v1/wallets/rule', async () => {
    const rule = { firstWallet: false, strongMethods: ['passkey'], password: 'waits', waitHours: 24 };
    const { sent, fetch } = recorder(() => Response.json(rule));
    await expect(createAuthApi({ fetch }).getWalletRule()).resolves.toEqual(rule);
    expect(sent[0]!.url).toBe('/v1/wallets/rule');
    expect(sent[0]!.init.method).toBe('GET');
    expect(sent[0]!.init.body).toBeUndefined();
  });

  it('posts an empty JSON object to routes that take no input', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ fetch }).logout();
    expect(sent[0]!.url).toBe('/v1/logout');
    expect(bodyOf(sent[0]!)).toEqual({});
    expect(headersOf(sent[0]!).get('content-type')).toBe('application/json');
  });

  it('uses PUT for setting the password and the logout timer', async () => {
    const { sent, fetch } = recorder(() => Response.json({ idleHours: 6, adjustable: true }));
    const api = createAuthApi({ fetch });
    await api.setPassword({ password: 'x' });
    await expect(api.setLogoutTimer({ idleHours: 6 })).resolves.toEqual({ idleHours: 6, adjustable: true });
    expect(sent.map((s) => [s.init.method, s.url])).toEqual([
      ['PUT', '/v1/account/password'],
      ['PUT', '/v1/account/security/logout-timer'],
    ]);
    expect(bodyOf(sent[1]!)).toEqual({ idleHours: 6 });
  });

  it('returns the parsed JSON body of a 2xx and undefined for a 204', async () => {
    const { fetch } = recorder(() => Response.json({ status: 'second-factor', pendingId: 'p', needs: ['totp'] }));
    await expect(createAuthApi({ fetch }).loginPassword({ loginName: 'a', password: 'b', deviceLabel: 'c' })).resolves.toEqual({
      status: 'second-factor', pendingId: 'p', needs: ['totp'],
    });
    const empty = recorder(() => new Response(null, { status: 204 }));
    await expect(createAuthApi({ fetch: empty.fetch }).acceptTerms({ version: 'v', signature: SIG })).resolves.toBeUndefined();
  });

  it('refuses redirects instead of following them', async () => {
    const { sent, fetch } = recorder();
    await createAuthApi({ fetch }).loginPgpStart({ key: 'KEY' });
    await createAuthApi({ fetch }).me();
    expect(sent.map((s) => s.init.redirect)).toEqual(['error', 'error']);
  });

  it('takes as baseUrl only an http(s) origin with no path, or the empty string', () => {
    for (const ok of ['', 'http://127.0.0.1:4000', 'https://x2f.example', 'https://x2f.example:8443']) {
      expect(() => createAuthApi({ baseUrl: ok }), ok).not.toThrow();
    }
    for (const bad of [
      '/', '/api', 'https://x2f.example/', 'https://x2f.example/api', 'https://x2f.example?x=1', 'https://x2f.example#x',
      'https://user:pw@x2f.example', 'ftp://x2f.example', 'javascript:alert(1)', 'x2f.example', '//x2f.example', ' https://x2f.example',
    ]) {
      expect(() => createAuthApi({ baseUrl: bad }), bad).toThrow(/baseUrl/);
    }
  });

  it('uses the global fetch at call time when none is given', async () => {
    const { sent, fetch } = recorder();
    const api = createAuthApi();
    vi.stubGlobal('fetch', fetch);
    await api.getPgpSigningKey();
    expect(sent[0]!.url).toBe('/v1/pgp/signing-key');
  });
});

describe('AuthApiError', () => {
  it('carries the status and code, and the fields the API sent', async () => {
    const e = await refusal(Response.json({ error: 'password-weak', missing: ['upper', 'symbol'] }, { status: 400 }));
    expect(e.status).toBe(400);
    expect(e.code).toBe('password-weak');
    expect(e.missing).toEqual(['upper', 'symbol']);
    expect(e.name).toBe('AuthApiError');
    expect(e.message).toBe('password-weak');
  });

  it('reads retryAfterSeconds from the body, else from the Retry-After header', async () => {
    expect((await refusal(Response.json({ error: 'slow-down', retryAfterSeconds: 12 }, { status: 429 }))).retryAfterSeconds).toBe(12);
    const headerOnly = await refusal(Response.json({ error: 'locked' }, { status: 429, headers: { 'retry-after': '30' } }));
    expect(headerOnly.code).toBe('locked');
    expect(headerOnly.retryAfterSeconds).toBe(30);
    const garbage = await refusal(Response.json({ error: 'locked' }, { status: 429, headers: { 'retry-after': 'soon' } }));
    expect(garbage.retryAfterSeconds).toBeUndefined();
  });

  it('keeps retryAfterSeconds between 1 second and 1 day, from the body or the header', async () => {
    const body = async (n: number) => (await refusal(Response.json({ error: 'slow-down', retryAfterSeconds: n }, { status: 429 }))).retryAfterSeconds;
    const header = async (v: string) => (await refusal(Response.json({ error: 'locked' }, { status: 429, headers: { 'retry-after': v } }))).retryAfterSeconds;
    expect(await body(0)).toBe(1);
    expect(await body(-5)).toBe(1);
    expect(await body(0.2)).toBe(1);
    expect(await body(45)).toBe(45);
    expect(await body(86_400)).toBe(86_400);
    expect(await body(90_000)).toBe(86_400);
    expect(await body(7)).toBe(7);
    expect(await header('0')).toBe(1);
    expect(await header('120')).toBe(120);
    expect(await header('3600')).toBe(3600);
    expect(await header('999999999')).toBe(86_400);
    expect(await header('9')).toBe(9);
  });

  it('carries detail, holdUntil, version and action', async () => {
    expect((await refusal(Response.json({ error: 'key-expired', detail: 'This key expired.' }, { status: 400 }))).detail).toBe('This key expired.');
    const hold = await refusal(Response.json({ error: 'recovery-hold', holdUntil: '2026-10-18T12:00:00.000Z' }, { status: 403 }));
    expect(hold.holdUntil).toBe('2026-10-18T12:00:00.000Z');
    expect((await refusal(Response.json({ error: 'terms-required', version: '2026-10-17' }, { status: 403 }))).version).toBe('2026-10-17');
    expect((await refusal(Response.json({ error: 'confirm-required', action: 'add-wallet' }, { status: 403 }))).action).toBe('add-wallet');
  });

  it('drops fields of the wrong type', async () => {
    const e = await refusal(Response.json({ error: 'password-weak', missing: 'upper', retryAfterSeconds: '5', detail: 7 }, { status: 400 }));
    expect(e.missing).toBeUndefined();
    expect(e.retryAfterSeconds).toBeUndefined();
    expect(e.detail).toBeUndefined();
    const mixed = await refusal(Response.json({ error: 'password-weak', missing: ['upper', 3] }, { status: 400 }));
    expect(mixed.missing).toEqual(['upper']);
  });

  it('answers internal for a reply that is not an API error (a proxy page, no error code)', async () => {
    const html = await refusal(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(html.status).toBe(502);
    expect(html.code).toBe('internal');
    const noCode = await refusal(Response.json({ error: 42 }, { status: 500 }));
    expect(noCode.code).toBe('internal');
  });
});

describe('password-login misses (owner, 2026-10-23)', () => {
  it('reads the server’s per-browser miss count and says when to send the visitor away', async () => {
    const at = async (misses: unknown) => refusal(Response.json({ error: 'credentials-invalid', misses }, { status: 401 }));
    expect((await at(3)).misses).toBe(3);
    expect(shouldSendAway(await at(MISSES_BEFORE_SENDING_AWAY - 1))).toBe(false);
    expect(shouldSendAway(await at(MISSES_BEFORE_SENDING_AWAY))).toBe(true);
    expect(shouldSendAway(await at(MISSES_BEFORE_SENDING_AWAY + 5))).toBe(true);
    for (const junk of ['10', -1, 2.5, null]) expect((await at(junk)).misses).toBeUndefined();
    expect(shouldSendAway(await refusal(Response.json({ error: 'busy', misses: 50 }, { status: 503 })))).toBe(false);
    expect(shouldSendAway(new Error('x'))).toBe(false);
    expect(shouldSendAway(undefined)).toBe(false);
    expect(MISSES_BEFORE_SENDING_AWAY).toBe(10);
    expect(PASSWORD_LOGIN_MISMATCH).toBe("That login name and password don't match");
  });
});
