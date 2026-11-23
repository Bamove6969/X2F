import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuideHandler, guidePage, guideSteps, type SeedSummary } from '../demo/guide-page.js';

const SUMMARY: SeedSummary = {
  owner: [{ login: 'ana-demo', shown: 'demo_ana', vendor: true }, { login: 'ben-demo', shown: 'demo_ben', vendor: false }],
  cast: [{ login: 'lowtide-login', shown: 'lowtide_rx', offers: ['SEPA_INSTANT EUR'] }],
  trades: [
    { code: 'OPEN-1234', buyer: 'lowtide-login', seller: 'satoshi-login', offer: 'CASH_APP USD 40', fiat: '40 USD', state: 'setup', at: '2026-11-23T12:00:00.000Z' },
    { code: 'DONE-5678', buyer: 'lowtide-login', seller: 'mira-login', offer: 'INTERAC_E_TRANSFER CAD 50', fiat: '50 CAD', state: 'cancelled', at: '2026-11-23T12:00:00.000Z' },
  ],
  failures: ['kettle.moss <b>x</b>: 409'],
};

describe('demo guide page (/__demo/guide)', () => {
  it('lists every feature the owner walks, each with a screen link and an account', () => {
    const titles = guideSteps(SUMMARY).map((s) => s.title.replace(/^\d+\. /, ''));
    for (const t of ['Sign up', 'Log in', 'Browse and buy', 'Sell and post an offer', 'The trade room and chat', 'Payment proof and blur', 'Release', 'Rating', 'My trades', 'Wallets', 'Team members', 'Profile and badges', 'Alerts', 'Help, news and feedback', 'A dispute', 'Staff screens']) {
      expect(titles).toContain(t);
    }
    for (const s of guideSteps(SUMMARY)) expect(s.who.length).toBeGreaterThan(0);
    const html = guidePage(SUMMARY);
    for (const path of ['/login', '/buy', '/post', '/trades', '/wallets', '/settings/team', '/profile', '/settings/badges', '/settings/security', '/help', '/__demo/codes']) {
      expect(html).toContain(`href="${path}"`);
    }
  });

  it('links the seeded trades and names their account; the open one says when the timer cancels it, in BC time', () => {
    const html = guidePage(SUMMARY);
    expect(html).toContain('href="/trade/OPEN-1234"');
    expect(html).toContain('href="/trade/DONE-5678"');
    expect(html).toContain('<code>lowtide-login</code>');
    // A currency that is not a dollar opens on its own currency.
    expect(html).toContain('href="/buy/SEPA_INSTANT?currency=EUR"');
    // 12:00 UTC + 60 min = 13:00 UTC = 06:00 at UTC-7.
    expect(html).toContain('06:00 BC time');
  });

  it('escapes what the seed wrote, and says so when there is no summary', () => {
    expect(guidePage(SUMMARY)).toContain('kettle.moss &#60;b&#62;x&#60;/b&#62;: 409');
    expect(guidePage(SUMMARY)).not.toContain('<b>x</b>');
    expect(guidePage(null)).toContain('has not written its summary');
    expect(guidePage(null)).not.toContain('href="/trade/');
  });

  describe('the handler', () => {
    let srv: Server | null = null;
    afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));
    /** fetch() may not set Host, so a plain node:http request. */
    function get(base: string, headers: Record<string, string>, method = 'GET'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
      return new Promise((done, fail) => {
        const req = request(`${base}/__demo/guide`, { method, headers }, (res) => {
          let text = '';
          res.on('data', (c: Buffer) => (text += c.toString()));
          res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
        });
        req.on('error', fail);
        req.end();
      });
    }
    async function serve(): Promise<string> {
      const h = createGuideHandler({ origins: new Set(['http://localhost:4400']), summary: () => SUMMARY });
      srv = createServer(h);
      await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    }

    it('serves the page to a demo origin with a script-free CSP, no-store', async () => {
      const base = await serve();
      const res = await get(base, { host: 'localhost:4400' });
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'$/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toContain('Demo guide');
    });

    it('refuses another host (unless through an https front) and any method but GET or HEAD', async () => {
      const base = await serve();
      expect((await get(base, { host: 'evil.example' })).status).toBe(403);
      expect((await get(base, { host: 'x.ts.net:8443', 'x-forwarded-proto': 'https' })).status).toBe(200);
      expect((await get(base, { host: 'localhost:4400' }, 'POST')).status).toBe(405);
    });
  });
});
