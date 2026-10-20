import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, api, serverClock, setNavigator } from '../src/api/client.js';

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const here = { pathname: '/sell/zelle', search: '?sort=rate' };

afterEach(() => {
  vi.unstubAllGlobals();
  setNavigator(null);
});

describe('api()', () => {
  it('sends same-origin credentials and bigints as strings', async () => {
    const f = respond(200, { ok: true });
    vi.stubGlobal('fetch', f);
    await expect(api('/v1/offers', { method: 'POST', body: { amountAtomic: 1250000000000n, nested: [2n] } })).resolves.toEqual({ ok: true });
    const [url, init] = vi.mocked(f).mock.calls[0]!;
    expect(url).toBe('/v1/offers');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ amountAtomic: '1250000000000', nested: ['2'] });
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('a GET sends no body and no content type', async () => {
    const f = respond(200, []);
    vi.stubGlobal('fetch', f);
    await api('/v1/methods');
    const [, init] = vi.mocked(f).mock.calls[0]!;
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
  });

  it('throws an AuthApiError-shaped error with status, code and extra fields', async () => {
    vi.stubGlobal('fetch', respond(429, { error: 'busy', retryAfterSeconds: 7 }));
    const err = await api('/v1/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiCallError);
    expect(err).toMatchObject({ status: 429, code: 'busy', retryAfterSeconds: 7 });
  });

  it('a body that is not JSON becomes code internal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(api('/v1/x')).rejects.toMatchObject({ status: 502, code: 'internal' });
  });

  it('403 terms-required goes to /terms with returnTo', async () => {
    const go = vi.fn();
    setNavigator(go, () => here);
    vi.stubGlobal('fetch', respond(403, { error: 'terms-required', version: '2026-10-17' }));
    await expect(api('/v1/offers')).rejects.toMatchObject({ code: 'terms-required', version: '2026-10-17' });
    expect(go).toHaveBeenCalledExactlyOnceWith('/terms?returnTo=%2Fsell%2Fzelle%3Fsort%3Drate');
  });

  it('409 no-wallet goes to /wallets?add=1 with returnTo', async () => {
    const go = vi.fn();
    setNavigator(go, () => here);
    vi.stubGlobal('fetch', respond(409, { error: 'no-wallet' }));
    await expect(api('/v1/offers/x/take', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'no-wallet' });
    expect(go).toHaveBeenCalledExactlyOnceWith('/wallets?add=1&returnTo=%2Fsell%2Fzelle%3Fsort%3Drate');
  });

  it('does not navigate again when already on the target screen', async () => {
    const go = vi.fn();
    setNavigator(go, () => ({ pathname: '/terms', search: '?returnTo=%2Fsell' }));
    vi.stubGlobal('fetch', respond(403, { error: 'terms-required', version: 'v' }));
    await expect(api('/v1/account/me')).rejects.toMatchObject({ code: 'terms-required' });
    expect(go).not.toHaveBeenCalled();
  });

  it('other errors do not navigate', async () => {
    const go = vi.fn();
    setNavigator(go, () => here);
    vi.stubGlobal('fetch', respond(403, { error: 'wrong-account-kind' }));
    await expect(api('/v1/offers')).rejects.toMatchObject({ code: 'wrong-account-kind' });
    expect(go).not.toHaveBeenCalled();
  });
});

describe('serverClock', () => {
  it('follows the server, not the device clock', () => {
    let device = Date.parse('2026-10-18T12:10:00Z'); // device runs 10 min fast
    const now = serverClock('2026-10-18T12:00:00Z', () => device);
    expect(now().toISOString()).toBe('2026-10-18T12:00:00.000Z');
    device += 61_000;
    expect(now().toISOString()).toBe('2026-10-18T12:01:01.000Z');
  });

  it('refuses an unreadable server time', () => {
    expect(() => serverClock('soon')).toThrow(/server time/);
  });
});
