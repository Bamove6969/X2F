import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuideHandler, guidePage, guideSteps, legalPage, newSteps, renderMarkdown, type SeedSummary } from '../demo/guide-page.js';

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

  it('opens with what is new in r6, each screen with its owner note numbers (demo r6)', () => {
    const html = guidePage(SUMMARY);
    expect(html).toContain('New in this demo (r6)');
    const all = newSteps();
    const notes = new Set(all.flatMap((s) => s.notes));
    // Sign-up ticks, PGPony, recovery code + type-back, swipe-back gate, Terms v2026-11-23, wallet
    // list + Edge, Welcome rating, tour, Settings tabs, Ctrl-A, no spaces, Test this key now.
    for (const n of [27, 77, 28, 29, 89, 93, 102, 107, 96, 97, 99, 100, 101, 98, 108, 94]) expect(notes).toContain(n);
    for (const s of all) {
      expect(s.notes.length).toBeGreaterThan(0);
      expect(html).toContain(`#${s.notes[0]}`);
    }
    for (const path of ['/setup', '/setup/login', '/setup/backup', '/setup/wallet', '/setup/welcome', '/welcome', '/settings/alerts', '/settings/account', '/settings/help', '/__demo/guide/legal']) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html).toContain('2026-11-23');
    // Each item is a section a comment records (demo r6: comment on a guide item directly).
    expect(html).toContain('<section data-screen="guide-new-A" id="new-A">');
    expect(html).toContain('<section data-screen="guide-step-5" id="step-5">');
    expect(html).toContain('<body data-screen="demo-guide">');
    expect(html.match(/<section/g)?.length).toBe(html.match(/<\/section>/g)?.length);
  });

  it('renders the legal review Markdown without passing raw HTML through', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code` <script>x</script>.\n\n### 1. A point\n\n- **Current:** a\n  - (a) nested\n- next\n\nAfter.');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<h4>1. A point</h4>');
    expect(html).toContain('<ul><li><b>Current:</b> a<ul><li>(a) nested</li></ul></li><li>next</li></ul><p>After.</p>');
    expect(legalPage(null)).toContain('not in this demo');
    // Each proposal is its own section, so a comment on it records its number (data-screen).
    const legal = legalPage('## Proposals\n\n### 7. Data retention\n\n- **Current:** x\n\n### 8. Collect\n\nText.\n\n## Questions\n\n- q');
    expect(legal).toContain('<script src="/__demo/notes.js" defer></script>');
    expect(legal).toContain('<section data-screen="legal-proposal-7" id="proposal-7"><h4>7. Data retention</h4>');
    expect(legal).toContain('</section><section data-screen="legal-proposal-8" id="proposal-8"><h4>8. Collect</h4><p>Text.</p></section><section data-screen="legal-questions"');
    expect(legal.match(/<section/g)?.length).toBe(legal.match(/<\/section>/g)?.length);
    expect(legalPage('## Proposals')).toContain('<h3>Proposals</h3>');
  });

  describe('the handler', () => {
    let srv: Server | null = null;
    afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));
    /** fetch() may not set Host, so a plain node:http request. */
    function get(base: string, headers: Record<string, string>, method = 'GET', path = '/__demo/guide'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
      return new Promise((done, fail) => {
        const req = request(`${base}${path}`, { method, headers }, (res) => {
          let text = '';
          res.on('data', (c: Buffer) => (text += c.toString()));
          res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
        });
        req.on('error', fail);
        req.end();
      });
    }
    async function serve(): Promise<string> {
      const h = createGuideHandler({ origins: new Set(['http://localhost:4400']), summary: () => SUMMARY, legal: () => '## Proposals\n\n### 1. Fee' });
      srv = createServer(h);
      await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    }

    it('serves the page to a demo origin with a same-origin-script CSP (the Comment button), no-store', async () => {
      const base = await serve();
      const res = await get(base, { host: 'localhost:4400' });
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toMatch(/^default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'sha256-[A-Za-z0-9+/=]+'$/);
      expect(res.text).toContain('<script src="/__demo/notes.js" defer></script>');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toContain('Demo guide');
    });

    it('serves the Legal suggestions page at /__demo/guide/legal', async () => {
      const base = await serve();
      const res = await get(base, { host: 'localhost:4400' }, 'GET', '/__demo/guide/legal');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Legal suggestions');
      expect(res.text).toContain('<h4>1. Fee</h4>');
      expect((await get(base, { host: 'evil.example' }, 'GET', '/__demo/guide/legal')).status).toBe(403);
    });

    it('refuses another host (unless through an https front) and any method but GET or HEAD', async () => {
      const base = await serve();
      expect((await get(base, { host: 'evil.example' })).status).toBe(403);
      expect((await get(base, { host: 'x.ts.net:8443', 'x-forwarded-proto': 'https' })).status).toBe(200);
      expect((await get(base, { host: 'localhost:4400' }, 'POST')).status).toBe(405);
    });
  });
});
