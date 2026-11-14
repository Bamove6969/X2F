/**
 * DEMO ONLY: seeds the demo traders and offers through the real API (sign-up with a password,
 * first payout wallet, offers), exactly as a browser would. Run by demo.ts after the stack is up.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_DIR, DEMO_PASSWORD } from './config.js';
import { SEEDED_FILE } from './door.js';
import { assertDemo } from './guard.js';
import { throwawayAddress } from './secrets.js';
import { stepOf, TOTP_FILE, totpCode } from './totp.js';
import pg from 'pg';
import { GIFT_CARD_TERMS_VERSION } from '../../packages/trade/src/giftCards.js';
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
  /** Only a vendor posts offers (owner, 2 Nov 2026; apps/api routes/accountType.ts). */
  vendor: boolean;
  offers: Array<Record<string, unknown>>;
}

/**
 * One offer in the API's shape (J-16 flex offers): one currency with one band, one method with its
 * instructions. `marginBps` is the band's margin; the method's own price change is 0.
 */
const offer = (side: 'sell' | 'buy', methodId: string, currency: string, min: number, max: number, marginBps: number, terms: string, instructions: string, extra: Record<string, unknown> = {}) => ({
  side,
  currencies: [{ currency, bands: [{ min: String(min), max: String(max), marginBps, minTrades: null }] }],
  methods: [{ methodId, adjustBps: 0, instructions }],
  terms,
  ...extra,
});
/** The method's instructions on the offer; the real payment details go in the trade chat (J-08). */
const HOW_TO_PAY = 'Demo trader: my payment details come in the trade chat once the escrow is secured.';
const giftCard = (country: string) => ({ country, giftCardTerms: GIFT_CARD_TERMS_VERSION });

// The design's cast (design/x2f-app), each with offers in USD and CAD.
const CAST: Person[] = [
  { displayName: 'satoshi_ghost', loginName: 'satoshi-login', vendor: true, offers: [
    offer('sell', 'ZELLE', 'USD', 20, 150, 200, 'Zelle only from a bank in your own name. Fast replies 9am-11pm ET.', HOW_TO_PAY),
    offer('sell', 'CASH_APP', 'USD', 20, 120, 250, 'Cash App with the trade code as the note.', HOW_TO_PAY),
  ] },
  { displayName: 'mira.k', loginName: 'mira-login', vendor: true, offers: [
    offer('sell', 'INTERAC_E_TRANSFER', 'CAD', 25, 200, 150, 'Interac e-Transfer, autodeposit please. Usually online evenings.', HOW_TO_PAY),
    offer('buy', 'INTERAC_E_TRANSFER', 'CAD', 25, 200, -100, 'I pay by e-Transfer within 10 minutes of the escrow being secured.', HOW_TO_PAY),
  ] },
  { displayName: 'nightowl_44', loginName: 'nightowl-login', vendor: true, offers: [
    offer('buy', 'ZELLE', 'USD', 20, 150, -50, 'Night shift trader. I pay by Zelle right after escrow is secured.', HOW_TO_PAY),
    offer('sell', 'VENMO', 'USD', 20, 100, 300, 'Venmo friends and family only.', HOW_TO_PAY),
  ] },
  { displayName: 'kettle.moss', loginName: 'kettle-login', vendor: true, offers: [
    offer('sell', 'AMAZON_GIFT_CARD', 'USD', 25, 100, 600, 'US Amazon gift cards only. Send the claim code in chat.', HOW_TO_PAY, giftCard('US')),
    offer('sell', 'AMAZON_GIFT_CARD', 'CAD', 25, 100, 650, 'Amazon.ca gift cards only.', HOW_TO_PAY, giftCard('CA')),
  ] },
  { displayName: 'lowtide_rx', loginName: 'lowtide-login', vendor: true, offers: [
    offer('sell', 'TRANSFERWISE', 'CAD', 30, 200, 120, 'Wise transfer in CAD. Include the trade code as the reference.', HOW_TO_PAY),
    offer('buy', 'PAYPAL', 'USD', 20, 100, -200, 'PayPal friends and family.', HOW_TO_PAY),
  ] },
];

// The owner's own accounts, to trade with himself (one per browser profile or device).
const OWNER: Person[] = [
  { displayName: 'demo_ana', loginName: 'ana-demo', vendor: true, offers: [] },
  { displayName: 'demo_ben', loginName: 'ben-demo', vendor: false, offers: [] },
  { displayName: 'demo_cy', loginName: 'cy-demo', vendor: false, offers: [] },
];

async function signUp(p: Person): Promise<DemoClient> {
  const c = new DemoClient(ORIGIN);
  await c.ok('GET', '/v1/site');
  await c.ok('POST', '/v1/register/password', {
    displayName: p.displayName, loginName: p.loginName, password: DEMO_PASSWORD, deviceLabel: 'Demo seed', acceptedTerms: TERMS_TEXT_VERSION,
    // Every sign-up signs the Terms (migration 316): the seed types the display name, as someone
    // who cannot draw would.
    termsSignature: { kind: 'typed', name: p.displayName },
  });
  await c.ok('POST', '/v1/wallets', { app: 'cake', label: 'Demo wallet', address: await throwawayAddress() });
  // An authenticator (during sign-up's onboarding window, no confirm needed): password + code is a
  // strong login, so a demo login on a new browser never starts the 24-hour hold (R42).
  const start = await c.ok<{ challengeId: string; secret: string }>('POST', '/v1/account/totp/start', {});
  await c.ok('POST', '/v1/account/totp/finish', { challengeId: start.challengeId, code: totpCode(start.secret, stepOf(Date.now())) });
  totp[p.loginName] = start.secret;
  return c;
}

const totp: Record<string, string> = {};

/**
 * DEMO ONLY: the real way to become a vendor needs a passkey, security key or PGP key and a strong
 * confirm (PUT /v1/account/type), which a seed script has none of. So the demo marks its posting
 * accounts as vendors straight in its own throwaway database, as the switch itself would
 * (account_type, vendor_since), and the offers then go through the real API.
 */
async function makeVendor(db: pg.Client, displayName: string): Promise<void> {
  const r = await db.query("update accounts set account_type = 'vendor', vendor_since = now() where display_name = $1 and account_type = 'trader'", [displayName]);
  if (r.rowCount !== 1) throw new Error(`demo seed: could not make ${displayName} a vendor`);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const failures: string[] = [];
for (const p of [...CAST, ...OWNER]) {
  const c = await signUp(p);
  if (p.vendor) await makeVendor(db, p.displayName);
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
  'Then the authenticator code: npm run demo:code <login name> (or add the secret below to an authenticator app).',
  '',
  'Your accounts (trade with yourself; use one browser profile or device per account):',
  ...OWNER.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName.padEnd(14)} authenticator secret ${totp[p.loginName]}`),
  '',
  'The cast (offers already posted):',
  ...CAST.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName.padEnd(14)} authenticator secret ${totp[p.loginName]}`),
];
writeFileSync(TOTP_FILE, JSON.stringify(totp, null, 2), { mode: 0o600 });
// The accounts the gateway's door lets in from a fresh browser (door.ts).
const seeded = await db.query<{ id: string }>('select id from accounts where display_name = any($1)', [[...CAST, ...OWNER].map((p) => p.displayName)]);
writeFileSync(SEEDED_FILE, JSON.stringify(seeded.rows.map((r) => r.id)), { mode: 0o600 });
await db.end();
writeFileSync(join(DEMO_DIR, 'logins.txt'), `${logins.join('\n')}\n`);
// monero-ts keeps a worker alive: exit once the seed is written.
process.exit(0);
