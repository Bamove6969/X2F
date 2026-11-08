/**
 * DEMO ONLY: seeds the demo traders and offers through the real API (sign-up with a password,
 * first payout wallet, offers), exactly as a browser would. Run by demo.ts after the stack is up.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_DIR, DEMO_PASSWORD } from './config.js';
import { assertDemo } from './guard.js';
import { throwawayAddress } from './secrets.js';
import { TERMS_TEXT_VERSION } from '../../apps/web/src/screens/setup/termsText.js';

const ORIGIN = process.env.DEMO_ORIGIN ?? '';
await assertDemo(process.env, process.env.MONERO_DAEMON_URI ?? '');

/** A browser-like client with its own cookie jar. */
export class DemoClient {
  private jar = new Map<string, string>();
  constructor(readonly origin: string) {}
  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.origin}${path}`, {
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
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      this.jar.set(pair!.slice(0, at), pair!.slice(at + 1));
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
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

interface Person {
  displayName: string;
  loginName: string;
  offers: Array<Record<string, unknown>>;
}

const market = (marginBps: number) => ({ mode: 'market', marginBps });
const offer = (side: 'sell' | 'buy', methodId: string, currency: string, min: number, max: number, pricing: unknown, terms: string, extra: Record<string, unknown> = {}) => ({
  side, methodId, currency, pricing, minFiatCents: String(min * 100), maxFiatCents: String(max * 100), minTrades: 0, terms, ...extra,
});

// The design's cast (design/x2f-app), each with offers in USD and CAD.
const CAST: Person[] = [
  { displayName: 'satoshi_ghost', loginName: 'satoshi-login', offers: [
    offer('sell', 'ZELLE', 'USD', 20, 150, market(200), 'Zelle only from a bank in your own name. Fast replies 9am-11pm ET.'),
    offer('sell', 'CASH_APP', 'USD', 20, 120, market(250), 'Cash App with the trade code as the note.'),
  ] },
  { displayName: 'mira.k', loginName: 'mira-login', offers: [
    offer('sell', 'INTERAC_E_TRANSFER', 'CAD', 25, 200, market(150), 'Interac e-Transfer, autodeposit please. Usually online evenings.'),
    offer('buy', 'INTERAC_E_TRANSFER', 'CAD', 25, 200, market(-100), 'I pay by e-Transfer within 10 minutes of the escrow being secured.'),
  ] },
  { displayName: 'nightowl_44', loginName: 'nightowl-login', offers: [
    offer('buy', 'ZELLE', 'USD', 20, 150, market(-50), 'Night shift trader. I pay by Zelle right after escrow is secured.'),
    offer('sell', 'VENMO', 'USD', 20, 100, market(300), 'Venmo friends and family only.'),
  ] },
  { displayName: 'kettle.moss', loginName: 'kettle-login', offers: [
    offer('sell', 'AMAZON_GIFT_CARD', 'USD', 25, 100, market(600), 'US Amazon gift cards only. Send the claim code in chat.', { country: 'US' }),
    offer('sell', 'AMAZON_GIFT_CARD', 'CAD', 25, 100, market(650), 'Amazon.ca gift cards only.', { country: 'CA' }),
  ] },
  { displayName: 'lowtide_rx', loginName: 'lowtide-login', offers: [
    offer('sell', 'TRANSFERWISE', 'CAD', 30, 200, market(120), 'Wise transfer in CAD. Include the trade code as the reference.'),
    offer('buy', 'PAYPAL', 'USD', 20, 100, market(-200), 'PayPal friends and family.'),
  ] },
];

// The owner's own accounts, to trade with himself (one per browser profile or device).
const OWNER: Person[] = [
  { displayName: 'demo_ana', loginName: 'ana-demo', offers: [] },
  { displayName: 'demo_ben', loginName: 'ben-demo', offers: [] },
  { displayName: 'demo_cy', loginName: 'cy-demo', offers: [] },
];

async function signUp(p: Person): Promise<DemoClient> {
  const c = new DemoClient(ORIGIN);
  await c.ok('GET', '/v1/site');
  await c.ok('POST', '/v1/register/password', {
    displayName: p.displayName, loginName: p.loginName, password: DEMO_PASSWORD, deviceLabel: 'Demo seed', acceptedTerms: TERMS_TEXT_VERSION,
  });
  await c.ok('POST', '/v1/wallets', { app: 'cake', label: 'Demo wallet', address: await throwawayAddress() });
  return c;
}

const failures: string[] = [];
for (const p of [...CAST, ...OWNER]) {
  const c = await signUp(p);
  for (const o of p.offers) {
    const r = await c.call('POST', '/v1/offers', o);
    if (r.status >= 300) failures.push(`${p.displayName} ${String(o.methodId)} ${String(o.currency)}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  // Logged out again: a login while the account has an open session elsewhere waits for that
  // device's approval (Plan 2 Task 16), and nobody holds the seed's session.
  await c.ok('POST', '/v1/logout');
  console.log(`demo seed: ${p.displayName}`);
}
for (const f of failures) console.log(`demo seed: offer refused: ${f}`);

const logins = [
  'X2F demo logins (password for all: ' + DEMO_PASSWORD + ')',
  '',
  'Your accounts (trade with yourself; use one browser profile or device per account):',
  ...OWNER.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName}`),
  '',
  'The cast (offers already posted):',
  ...CAST.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName}`),
];
writeFileSync(join(DEMO_DIR, 'logins.txt'), `${logins.join('\n')}\n`);
