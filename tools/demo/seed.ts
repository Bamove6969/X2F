/**
 * DEMO ONLY: seeds the demo traders and offers through the real API (sign-up with a throwaway PGP
 * key, an authenticator app as the second kind of login method, first payout wallet, offers),
 * exactly as a browser would. Run by demo.ts after the stack is up.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_DIR, ENV_FILE } from './config.js';
import { SEED_SUMMARY_FILE } from './guide-page.js';
import { TRADERS_FILE, type TraderSecret } from './door.js';
import { assertDemo } from './guard.js';
import { throwawayAddress } from './secrets.js';
import { stepOf, TOTP_FILE, totpCode } from './totp.js';
import pg from 'pg';
import { GIFT_CARD_TERMS_VERSION } from '../../packages/trade/src/giftCards.js';
import { atomicForFiat, fiatCents } from '../../packages/trade/src/money.js';
import { TERMS_TEXT_VERSION } from '../../apps/web/src/screens/setup/termsText.js';
import { NEW_NAME_MIN, checkDisplayName, checkLoginName } from '../../packages/accounts/src/index.js';
import { loginTag } from '../../apps/api/src/accounts.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { applyEvent } from '../../apps/api/src/trades/store.js';
import { newPgp, pgpCode, type PgpPair } from '../regtest/e2e/staffClient.js';

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
    // A currency that is not a dollar (demo r5): euros by SEPA Instant, pounds by Faster Payments.
    offer('sell', 'SEPA_INSTANT', 'EUR', 20, 150, 180, 'SEPA Instant from an account in your own name. Include the trade code as the reference.', HOW_TO_PAY),
    offer('sell', 'FASTER_PAYMENTS', 'GBP', 20, 120, 200, 'UK Faster Payments only, from your own account.', HOW_TO_PAY),
  ] },
];

// The owner's own accounts, to trade with himself (one per browser profile or device).
const OWNER: Person[] = [
  { displayName: 'demo_ana', loginName: 'ana-demo', vendor: true, offers: [] },
  { displayName: 'demo_ben', loginName: 'ben-demo', vendor: false, offers: [] },
  { displayName: 'demo_cy', loginName: 'cy-demo', vendor: false, offers: [] },
];

/**
 * DEMO ONLY (owner demo notes #126 and #127, 23 Nov 2026): a new login or display name is 8 to 20
 * characters, but the demo keeps the names the owner already uses (`cy-demo`, `demo_cy`, `mira.k`),
 * as an account made before the notes keeps its 5-7 character names. Such a name signs up with
 * `.seed` added (`seedName`), and `restoreNames` then writes the real one straight into the demo's
 * own throwaway database, as stored names are (the display name as typed, the login name only as
 * its tag under the API's current key, FU-D). Lookups take 5-20 (`checkLoginName`,
 * `checkDisplayName`), so these accounts log in and show as before.
 */
const seedName = (name: string): string => ([...name].length >= NEW_NAME_MIN ? name : `${name}.seed`);

async function restoreNames(db: pg.Client, p: Person): Promise<void> {
  if (seedName(p.displayName) !== p.displayName) {
    const d = checkDisplayName(p.displayName);
    if (!d.ok) throw new Error(`demo seed: ${p.displayName} is not a valid stored display name`);
    const r = await db.query('update accounts set display_name = $2, display_key = $3 where display_key = $1', [seedName(p.displayName).toLowerCase(), d.name, d.key]);
    if (r.rowCount !== 1) throw new Error(`demo seed: could not restore the display name ${p.displayName}`);
  }
  if (seedName(p.loginName) !== p.loginName) {
    const l = checkLoginName(p.loginName);
    if (!l.ok) throw new Error(`demo seed: ${p.loginName} is not a valid stored login name`);
    const ring = loadConfig(JSON.parse(readFileSync(ENV_FILE, 'utf8')) as Record<string, string>).loginNameKeys;
    const key = ring.keys.get(ring.current)!;
    const r = await db.query('update accounts set login_tag = $2 where login_tag = $1 and login_tag_key_id = $3', [
      loginTag(key, seedName(p.loginName)), loginTag(key, l.key), ring.current,
    ]);
    if (r.rowCount !== 1) throw new Error(`demo seed: could not restore the login name ${p.loginName}`);
  }
}

/**
 * Owner, 26 Nov 2026 (no passwords): an account holds at least two kinds of login method among
 * passkey, security key, PGP key and authenticator app, or its sessions are setup-only. The seed
 * signs up with a throwaway PGP key and adds an authenticator app in sign-up's window (no confirm
 * needed): two kinds. The PGP key is the one that logs in (an authenticator app never logs in
 * alone); the gateway's /__demo/login uses it (door.ts).
 */
async function signUp(p: Person): Promise<DemoClient> {
  const c = new DemoClient(ORIGIN);
  await c.ok('GET', '/v1/site');
  const key = await newPgp(`${p.displayName} (demo, not real)`);
  const s = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/v1/register/pgp/start', {
    displayName: seedName(p.displayName), loginName: seedName(p.loginName), publicKey: key.publicKey,
  });
  await c.ok('POST', '/v1/register/pgp/finish', {
    // A trader agrees to the Terms with the tick alone, no signature (owner demo note #187).
    challengeId: s.challengeId, code: await pgpCode(s.encryptedMessage, key), deviceLabel: 'Demo seed', acceptedTerms: TERMS_TEXT_VERSION,
  });
  pgp[p.loginName] = key;
  await c.ok('POST', '/v1/wallets', { app: 'cake', label: 'Demo wallet', address: await throwawayAddress() });
  const start = await c.ok<{ challengeId: string; secret: string }>('POST', '/v1/account/totp/start', {});
  await c.ok('POST', '/v1/account/totp/finish', { challengeId: start.challengeId, code: totpCode(start.secret, stepOf(Date.now())) });
  totp[p.loginName] = start.secret;
  return c;
}

const totp: Record<string, string> = {};
const pgp: Record<string, PgpPair> = {};

/**
 * DEMO ONLY: the real way to become a vendor needs a key confirm (PUT /v1/account/type). So the demo marks its posting
 * accounts as vendors straight in its own throwaway database, as the switch itself would
 * (account_type, vendor_since), and the offers then go through the real API.
 */
async function makeVendor(db: pg.Client, displayName: string): Promise<void> {
  const r = await db.query("update accounts set account_type = 'vendor', vendor_since = now() where display_name = $1 and account_type = 'trader'", [displayName]);
  if (r.rowCount !== 1) throw new Error(`demo seed: could not make ${displayName} a vendor`);
}

/** An offer as the log names it: its payment types and currencies (J-16 flex offers carry lists). */
function offerLabel(o: Record<string, unknown>): string {
  const methods = (o.methods as Array<{ methodId?: string }> | undefined)?.map((m) => m.methodId).join('+') ?? String(o.methodId);
  const currencies = (o.currencies as Array<{ currency?: string }> | undefined)?.map((x) => x.currency).join('+') ?? String(o.currency);
  return `${methods} ${currencies}`;
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const failures: string[] = [];
const clients = new Map<string, DemoClient>();
/** Each posted offer's id, by its poster's login name, its side and its label (offerLabel). */
const posted = new Map<string, string>();
for (const p of [...CAST, ...OWNER]) {
  const c = await signUp(p);
  clients.set(p.loginName, c);
  await restoreNames(db, p);
  if (p.vendor) await makeVendor(db, p.displayName);
  for (const o of p.offers) {
    // The API's exchange rates (CAD and the rest) arrive with its first rate poll, a little after it
    // starts: an offer refused for a missing price is tried again for up to 3 minutes.
    let r = await c.call<{ id?: string }>('POST', '/v1/offers', o);
    for (let waited = 0; r.status === 409 && (r.body as { error?: string } | null)?.error === 'price-unavailable' && waited < 180_000; waited += 5_000) {
      await new Promise((done) => setTimeout(done, 5_000));
      r = await c.call<{ id?: string }>('POST', '/v1/offers', o);
    }
    if (r.status >= 300) failures.push(`${p.displayName} ${offerLabel(o)}: ${r.status} ${JSON.stringify(r.body)}`);
    else if (r.body?.id) posted.set(`${p.loginName} ${String(o.side)} ${offerLabel(o)}`, r.body.id);
  }
  console.log(`demo seed: ${p.displayName}`);
}

/**
 * Demo r5: trades for My trades, through the real API as a browser would. lowtide_rx takes two of
 * the cast's sell offers as the buyer: one stays open (in setup: the escrow is never set up, since
 * the escrow keys live in a browser; the API's timer cancels it 60 minutes after the seed, and it
 * then moves to Completed), and one the buyer cancels at once (closed, so Completed has a row from
 * the start). No escrow, no XMR and no fiat moves: a trade in setup has no escrow yet.
 */
interface SeededTrade { code: string; buyer: string; seller: string; offer: string; fiat: string; state: string; at: string }
const trades: SeededTrade[] = [];
/**
 * DEMO ONLY (the staff panel's queue): a trade the seller disputes. The escrow lives in a browser,
 * so the seed moves the trade from setup to secured with the system events the moderation
 * service's chain watcher would report (setup-done, then the chain), through the API's own store
 * on its throwaway database, with a throwaway escrow address no wallet watches (the moderation
 * service never attested these trades, so it ignores them). The seller then opens the dispute
 * through the real API, as the trade room's Dispute button does.
 */
async function disputeTrade(code: string, seller: DemoClient, reason: 'silent' | 'other', note: string): Promise<void> {
  const deps = { db: tradePool, clock: () => new Date() };
  const t = await applyEvent(deps, code, { type: 'setup-done', escrowAddress: await throwawayAddress() }, 'system');
  const funds = t.sellerFundsAtomic;
  await applyEvent(deps, code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: 0n, confirmations: 1 }, 'system');
  await applyEvent(deps, code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, 'system');
  await seller.ok('POST', `/v1/trades/${code}/dispute`, { reason, note });
}
const tradePool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function seedTrade(takerLogin: string, posterLogin: string, label: string, methodId: string, currency: string, fiatWhole: number, then: 'open' | 'cancel' | { reason: 'silent' | 'other'; note: string }): Promise<void> {
  const cancel = then === 'cancel';
  const what = `${takerLogin} takes ${posterLogin} ${label}`;
  // The taker buys: the poster's sell offer.
  const offerId = posted.get(`${posterLogin} sell ${label}`);
  const c = clients.get(takerLogin)!;
  if (!offerId) return void failures.push(`trade ${what}: the offer was not posted`);
  try {
    const wallets = await c.ok<Array<{ id: string }>>('GET', '/v1/wallets');
    const walletId = wallets[0]?.id;
    if (!walletId) throw new Error('no wallet');
    let res: { status: number; body: unknown } = { status: 0, body: null };
    for (let i = 0; i < 3; i++) {
      const d = await c.ok<{ rate: string | null }>('GET', `/v1/offers/${offerId}?method=${methodId}&currency=${currency}`);
      if (d.rate === null) throw new Error('no rate');
      const rate = { currency, centsPerXmr: BigInt(d.rate) };
      const amountAtomic = atomicForFiat(BigInt(fiatWhole * 100), rate);
      res = await c.call('POST', `/v1/offers/${offerId}/take`, {
        amountAtomic: amountAtomic.toString(), walletId, centsPerXmr: d.rate, fiatCents: fiatCents(amountAtomic, rate).toString(), methodId, currency,
      });
      if (!(res.status === 409 && (res.body as { error?: string } | null)?.error === 'price-changed')) break;
    }
    if (res.status >= 300) throw new Error(`take → ${res.status} ${JSON.stringify(res.body)}`);
    const code = (res.body as { code: string }).code;
    if (cancel) await c.ok('POST', `/v1/trades/${code}/events`, { type: 'buyer-cancel' });
    if (typeof then === 'object') await disputeTrade(code, clients.get(posterLogin)!, then.reason, then.note);
    const state = cancel ? 'cancelled' : typeof then === 'object' ? 'disputed' : 'setup';
    trades.push({ code, buyer: takerLogin, seller: posterLogin, offer: `${label} ${fiatWhole}`, fiat: `${fiatWhole} ${currency}`, state, at: new Date().toISOString() });
    console.log(`demo seed: trade ${code} (${what}, ${state})`);
  } catch (e) {
    failures.push(`trade ${what}: ${(e as Error).message}`);
  }
}
// The cancelled one first: a buyer may have only so many trades waiting on setup at once.
await seedTrade('lowtide-login', 'mira-login', 'INTERAC_E_TRANSFER CAD', 'INTERAC_E_TRANSFER', 'CAD', 50, 'cancel');
await seedTrade('lowtide-login', 'satoshi-login', 'CASH_APP USD', 'CASH_APP', 'USD', 40, 'open');
// Two open disputes for the staff panel's queue (staff-seed.ts has the senior moderator take one).
await seedTrade('nightowl-login', 'satoshi-login', 'ZELLE USD', 'ZELLE', 'USD', 60, { reason: 'silent', note: 'The buyer stopped answering after the escrow was secured.' });
await seedTrade('mira-login', 'lowtide-login', 'SEPA_INSTANT EUR', 'SEPA_INSTANT', 'EUR', 45, { reason: 'other', note: 'The buyer asked me to send the euros to a different name than on the account.' });
await tradePool.end();

/**
 * DEMO ONLY (the Teams features): demo_ana's team, two members invited and joined through the real
 * routes. An invite needs a confirm: ana confirms each one with her throwaway PGP key on the
 * session her sign-up started. Each member joins with two throwaway PGP keys (a member's login is PGP plus a second
 * method); their keys are not kept, the members are there to be seen on the team page.
 */
const TEAM = [
  { displayName: 'ana_desk', loginName: 'ana-desk-login', roles: ['trades'] },
  { displayName: 'ana_nights', loginName: 'ana-nights-login', roles: ['offers'] },
];
const team: Array<{ shown: string; login: string; roles: string[] }> = [];
try {
  const ana = clients.get('ana-demo')!;
  for (const m of TEAM) {
    const action = { kind: 'team-invite', name: m.displayName, roles: m.roles.join(',') };
    const cs = await ana.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/v1/confirm/pgp/start', { action });
    const { confirmToken } = await ana.ok<{ confirmToken: string }>('POST', '/v1/confirm/pgp/finish', { challengeId: cs.challengeId, code: await pgpCode(cs.encryptedMessage, pgp['ana-demo']!) });
    const inv = await ana.ok<{ invite: string }>('POST', '/v1/team/invites', { displayName: m.displayName, roles: m.roles, confirmToken });
    const member = new DemoClient(ORIGIN);
    await member.ok('POST', '/v1/team/invite', { invite: inv.invite });
    const first = await newPgp(m.displayName);
    const s1 = await member.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/v1/team/join/start', { invite: inv.invite, loginName: m.loginName, publicKey: first.publicKey, acceptedTerms: TERMS_TEXT_VERSION });
    const joined = await member.ok<{ setupId: string }>('POST', '/v1/team/join/finish', { challengeId: s1.challengeId, code: await pgpCode(s1.encryptedMessage, first), termsSignature: { kind: 'typed', name: m.displayName } });
    const second = await newPgp(`${m.displayName} spare`);
    const s2 = await member.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/v1/team/join/second/pgp/start', { setupId: joined.setupId, publicKey: second.publicKey });
    await member.ok('POST', '/v1/team/join/second/pgp/finish', { setupId: joined.setupId, challengeId: s2.challengeId, code: await pgpCode(s2.encryptedMessage, second), deviceLabel: 'Demo seed' });
    await member.call('POST', '/v1/logout');
    team.push({ shown: m.displayName, login: m.loginName, roles: m.roles });
    console.log(`demo seed: team member ${m.displayName} (demo_ana's team, ${m.roles.join(', ')})`);
  }
} catch (e) {
  failures.push(`team: ${(e as Error).message}`);
}

// Logged out again: a login while the account has an open session elsewhere waits for that
// device's approval (Plan 2 Task 16), and nobody holds the seed's sessions.
// call, not ok: a client the team step logged out and could not log in again holds no session.
for (const c of clients.values()) await c.call('POST', '/v1/logout');
for (const f of failures) console.log(`demo seed: refused: ${f}`);

const logins = [
  'X2F demo logins (no passwords): open /__demo/login on the demo and tap the account; the demo does the real PGP login with its throwaway key.',
  'Each account also has an authenticator app (its second kind of method): npm run demo:code <login name>, or add the secret below to an authenticator app.',
  '',
  'Your accounts (trade with yourself; use one browser profile or device per account):',
  ...OWNER.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName.padEnd(14)} authenticator secret ${totp[p.loginName]}`),
  '',
  'The cast (offers already posted):',
  ...CAST.map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName.padEnd(14)} authenticator secret ${totp[p.loginName]}`),
  '',
  ...(team.length > 0 ? [`demo_ana's team (Settings, Team on ana-demo): ${team.map((m) => `${m.shown} (${m.roles.join(', ')})`).join(', ')}`] : []),
  ...(trades.some((t) => t.state === 'disputed') ? [`Open disputes (the staff queue): ${trades.filter((t) => t.state === 'disputed').map((t) => `${t.code} (${t.buyer} buys from ${t.seller})`).join(', ')}`] : []),
];
writeFileSync(TOTP_FILE, JSON.stringify(totp, null, 2), { mode: 0o600 });
// What the seed made, for the demo guide page (/__demo/guide, guide-page.ts). No secrets in it.
writeFileSync(SEED_SUMMARY_FILE, JSON.stringify({
  owner: OWNER.map((p) => ({ login: p.loginName, shown: p.displayName, vendor: p.vendor })),
  cast: CAST.map((p) => ({ login: p.loginName, shown: p.displayName, offers: p.offers.map(offerLabel) })),
  trades,
  team,
  failures,
}, null, 2));
// The accounts the gateway's /__demo/login lets in from a fresh browser, with their keys (door.ts).
const traders: TraderSecret[] = [...OWNER, ...CAST].filter((p) => pgp[p.loginName]).map((p) => ({ displayName: p.displayName, loginName: p.loginName, pgp: pgp[p.loginName]! }));
writeFileSync(TRADERS_FILE, JSON.stringify(traders, null, 2), { mode: 0o600 });
await db.end();
writeFileSync(join(DEMO_DIR, 'logins.txt'), `${logins.join('\n')}\n`);
// monero-ts keeps a worker alive: exit once the seed is written.
process.exit(0);
