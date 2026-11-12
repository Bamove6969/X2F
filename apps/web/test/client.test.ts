import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, api, returnToFrom, safeReturnTo, serverClock, setNavigator } from '../src/api/client.js';

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

  it('Plan 4 Task 27: 403 banned goes to the ban notice', async () => {
    const go = vi.fn();
    setNavigator(go, () => here);
    vi.stubGlobal('fetch', respond(403, { error: 'banned', kind: 'site', reasonCode: 'abuse', until: null }));
    await expect(api('/v1/wallets')).rejects.toMatchObject({ code: 'banned', reasonCode: 'abuse' });
    expect(go).toHaveBeenCalledExactlyOnceWith('/account/banned?returnTo=%2Fsell%2Fzelle%3Fsort%3Drate');
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

describe('safeReturnTo', () => {
  it.each([
    '//evil.com',
    '//evil.com/sell',
    '/\\evil.com',
    '/sell\\..\\x',
    'https://evil.com',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'sell',
    '',
    ' /sell',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/sell\r\n',
    '/..//evil.com',
    '/.//evil.com',
    '/./..//evil.com/sell',
    '/%2e%2e//evil.com',
    '/sell/..//evil.com',
    'data:text/html,<script>alert(1)</script>',
    '/%2F%2Fevil.com',
    '/%2f%2fevil.com',
    '/%2e%2e%2f%2fevil.com',
    '/%5Cevil.com',
    '/%5cevil.com',
    '/sell%2F..%2F..%2F%2Fevil.com',
    '/%00/evil.com',
    '/%09/evil.com',
    '/%0A/evil.com',
    '/%0d/evil.com',
    '/%1F/evil.com',
    '/%7f/evil.com',
    '/%7F/evil.com',
  ])('refuses %j and falls back to /sell', (raw) => {
    expect(safeReturnTo(raw)).toBe('/sell');
  });

  it('refuses an encoded slash, backslash or control character that arrives through the query string', () => {
    expect(returnToFrom('?returnTo=%2F%252F%252Fevil.com')).toBe('/sell');
    expect(returnToFrom('?returnTo=%2F%255Cevil.com')).toBe('/sell');
    expect(returnToFrom('?returnTo=%2F%2509%2Fevil.com')).toBe('/sell');
  });

  it.each(['/sell/%20zelle', '/sell?q=%7E', '/sell?q=%25', '/wallets?add=1&returnTo=%2Fsell%2Fzelle', '/sell#%2F%2F'])(
    'keeps other percent-encoded characters, and encoded slashes in the query or fragment: %j',
    (raw) => {
      expect(safeReturnTo(raw)).toBe(raw);
    },
  );

  it('refuses a missing value', () => {
    expect(safeReturnTo(null)).toBe('/sell');
    expect(safeReturnTo(undefined)).toBe('/sell');
  });

  it.each(['/sell', '/sell/zelle?sort=rate', '/trade/ABCD-EFGH-JKMN-PQRS', '/wallets?add=1#x'])('keeps the in-app path %j', (raw) => {
    expect(safeReturnTo(raw)).toBe(raw);
  });

  it('keeps a path of exactly 2048 characters and refuses a longer one', () => {
    const raw = '/' + 'a'.repeat(2047);
    expect(safeReturnTo(raw)).toBe(raw);
    expect(safeReturnTo(raw + 'a')).toBe('/sell');
    expect(returnToFrom(`?returnTo=${encodeURIComponent(raw)}`)).toBe(raw);
    expect(returnToFrom(`?returnTo=${encodeURIComponent(raw + 'a')}`)).toBe('/sell');
  });

  it('refuses a path that only grows past 2048 characters once normalised', () => {
    // 683 × "{" (684 characters) become 683 × "%7B": 2,050 characters after normalising.
    expect(safeReturnTo('/' + '{'.repeat(683))).toBe('/sell');
    expect(safeReturnTo('/' + '{'.repeat(682))).toBe('/' + '%7B'.repeat(682));
  });

  it.each([
    ['/sell/../buy', '/buy'],
    ['/./sell', '/sell'],
    ['/sell/zelle/..?sort=rate', '/sell/?sort=rate'],
  ])('returns the normalised in-app path: %j gives %j', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it('a redirect never carries an unsafe returnTo', async () => {
    const go = vi.fn();
    setNavigator(go, () => ({ pathname: '//evil.com', search: '' }));
    vi.stubGlobal('fetch', respond(409, { error: 'no-wallet' }));
    await expect(api('/v1/offers')).rejects.toMatchObject({ code: 'no-wallet' });
    expect(go).toHaveBeenCalledExactlyOnceWith('/wallets?add=1&returnTo=%2Fsell');
  });

  it.each([
    ['?returnTo=%2Fsell%2Fzelle%3Fsort%3Drate', '/sell/zelle?sort=rate'],
    ['?returnTo=%2F%2Fevil.com', '/sell'],
    ['?returnTo=%2F%5Cevil.com', '/sell'],
    ['?returnTo=https%3A%2F%2Fevil.com', '/sell'],
    ['?returnTo=javascript%3Aalert(1)', '/sell'],
    ['?returnTo=%2F..%2F%2Fevil.com', '/sell'],
    ['?returnTo=%2F.%2F%2Fevil.com', '/sell'],
    ['?returnTo=data%3Atext%2Fhtml%2Cx', '/sell'],
    ['?returnTo=%2Fsell%0D', '/sell'],
    ['?returnTo=%2Fsell%2F..%2Fbuy', '/buy'],
    ['?add=1', '/sell'],
    ['', '/sell'],
  ])('reading returnTo from %j gives %j', (search, expected) => {
    expect(returnToFrom(search)).toBe(expected);
  });
});
