/**
 * DEMO ONLY: seeds the staff side through the staff API's real routes, as the owner and the staff
 * would in a browser (the regtest e2e stack's steps, tools/regtest/e2e/staffStack.ts and
 * apps/staff-web/e2e/staffKit.ts): the owner's first-run setup with the one-time setup code the API
 * printed to its log, two software security keys and a PGP key; a senior moderator and two
 * moderators hired through the owner's tapped invites; a News item (a tapped publish); and the
 * senior moderator taking one of the open disputes seed.ts opened. Every step writes the activity
 * log as it would in production. Run by demo.ts after seed.ts.
 *
 * The keys are throwaway software keys attested by the demo's own CA (staff-mds.ts), kept in
 * .demo/secrets/staff.json (0600) for the staff gateway's demo login (staff-accounts.ts).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newsPublishIntent, type KeyTapIntent } from '@x2f/staff';
import { TERMS_TEXT_VERSION } from '../../apps/web/src/screens/setup/termsText.js';
import { authenticate, newKey, register, registerPasskey, type CaData, type KeyData } from '../regtest/e2e/softKey.js';
import { newPgp, pgpCode, StaffClient } from '../regtest/e2e/staffClient.js';
import { DEMO_DIR, STAFF_FILE } from './config.js';
import { readSeedSummary } from './guide-page.js';
import { assertDemo } from './guard.js';
import { STAFF_CAST, bumpCounter, type StaffSecret } from './staff-accounts.js';
import { STAFF_SUMMARY_FILE, type StaffSummary } from './staff-summary.js';

await assertDemo(process.env, process.env.MONERO_DAEMON_URI ?? '');
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`demo staff seed: ${k} is missing`);
  return v;
};
const API = need('DEMO_STAFF_API');
const ORIGIN = need('DEMO_STAFF_ORIGIN');
const RP_ID = need('DEMO_STAFF_RP_ID');
const API_LOG = need('DEMO_API_LOG');
const CA = JSON.parse(readFileSync(need('DEMO_STAFF_CA'), 'utf8')) as CaData;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Staffer extends StaffSecret {
  client: StaffClient;
}

/** A key's registration through a `{start,finish}` pair of staff routes. */
async function addKey(c: StaffClient, startPath: string, startBody: Record<string, unknown>, finishPath: string, finishBody: (s: { challengeId?: string }, response: unknown) => Record<string, unknown>, key: KeyData, attested: boolean): Promise<void> {
  const s = await c.ok<{ challengeId?: string; options: never }>('POST', startPath, startBody);
  const response = attested ? register(key, CA, s.options, ORIGIN, RP_ID) : registerPasskey(key, s.options, ORIGIN, RP_ID);
  await c.ok('POST', finishPath, finishBody(s, response));
}

/** The two-step staff login (security key, then PGP when asked), as the e2e `staffLogin`. */
async function login(p: Staffer): Promise<void> {
  const key = p.keys[0]!;
  const s = await p.client.ok<{ challengeId: string; options: never }>('POST', '/staff/v1/login/security-key/start', { loginName: p.loginName });
  bumpCounter(key, Date.now());
  const first = await p.client.ok<{ pendingId?: string }>('POST', '/staff/v1/login/security-key/finish', {
    challengeId: s.challengeId, response: authenticate(key, s.options, ORIGIN, RP_ID), deviceLabel: 'Demo seed',
  });
  if (first.pendingId === undefined) return;
  const g = await p.client.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/staff/v1/login/pgp/start', { key: p.pgp.publicKey, pendingId: first.pendingId });
  await p.client.ok('POST', '/staff/v1/login/pgp/finish', { challengeId: g.challengeId, code: await pgpCode(g.encryptedMessage, p.pgp), deviceLabel: 'Demo seed', pendingId: first.pendingId });
}

/** A finished key tap for `intent`, signed with the person's first key; returns its id. */
async function tap(p: Staffer, intent: KeyTapIntent): Promise<string> {
  const key = p.keys[0]!;
  const start = await p.client.ok<{ tapId: string; options: never }>('POST', '/staff/v1/taps/start', intent);
  bumpCounter(key, Date.now());
  await p.client.ok('POST', `/staff/v1/taps/${start.tapId}/finish`, { response: authenticate(key, start.options, ORIGIN, RP_ID) });
  return start.tapId;
}

// ── the owner's first-run setup ─────────────────────────────────────────────
let code: string | null = null;
for (let i = 0; i < 120 && code === null; i++) {
  const m = existsSync(API_LOG) ? /X2F owner setup code: (\S+)/.exec(readFileSync(API_LOG, 'utf8')) : null;
  if (m) code = m[1]!;
  else await sleep(500);
}
if (code === null) throw new Error(`demo staff seed: the API printed no owner setup code (see ${API_LOG})`);

const ownerPlan = STAFF_CAST.find((p) => p.role === 'owner')!;
const owner: Staffer = { tradeTag: ownerPlan.tradeTag, loginName: ownerPlan.loginName, role: 'owner', keys: [newKey(), newKey()], pgp: await newPgp(ownerPlan.tradeTag), client: new StaffClient(API, ORIGIN) };
{
  const c = new StaffClient(API, ORIGIN);
  await c.ok('POST', '/staff/v1/setup/code', { code });
  await c.ok('POST', '/staff/v1/setup/account', { tradeTag: owner.tradeTag, loginName: owner.loginName });
  for (const [i, k] of owner.keys.entries()) {
    await addKey(c, '/staff/v1/setup/key/start', {}, '/staff/v1/setup/key/finish', (s, response) => ({ challengeId: s.challengeId, response, label: i === 0 ? 'Main key (demo)' : 'Spare key (demo)' }), k, true);
  }
  const ps = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/staff/v1/setup/pgp/start', { publicKey: owner.pgp.publicKey });
  await c.ok('POST', '/staff/v1/setup/pgp/finish', { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, owner.pgp) });
  await c.ok('POST', '/staff/v1/setup/finish', { deviceLabel: 'Demo seed' });
}
await login(owner);
console.log(`demo staff seed: ${owner.tradeTag} (owner)`);

// ── staff hired through the owner's invites ─────────────────────────────────
const failures: string[] = [];
const staff: Staffer[] = [owner];
for (const plan of STAFF_CAST.filter((p) => p.role !== 'owner')) {
  try {
    const role = plan.role as 'senior' | 'mod';
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const inviteId = randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const tapId = await tap(owner, { kind: 'create-invite', inviteId, role, tokenHash, expiresAt });
    await owner.client.ok('POST', '/staff/v1/invites', { role, hours: 'any', inviteId, token, expiresAt, tapId });
    const c = new StaffClient(API, ORIGIN);
    const url = (step = '') => `/staff/v1/invites/accept/${token}${step}`;
    await c.ok('GET', url());
    await c.ok('POST', url('/account'), { tradeTag: plan.tradeTag, loginName: plan.loginName, acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: plan.tradeTag } });
    const key = newKey();
    await addKey(c, url('/key/start'), { kind: 'security-key' }, url('/key/finish'), (_s, response) => ({ kind: 'security-key', response }), key, true);
    const passkey = newKey();
    await addKey(c, url('/key/start'), { kind: 'passkey' }, url('/key/finish'), (_s, response) => ({ kind: 'passkey', response }), passkey, false);
    const pgp = await newPgp(plan.tradeTag);
    const ps = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', url('/pgp/start'), { publicKey: pgp.publicKey });
    await c.ok('POST', url('/pgp/finish'), { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, pgp) });
    await c.ok('POST', url('/finish'), {});
    const p: Staffer = { tradeTag: plan.tradeTag, loginName: plan.loginName, role: plan.role, keys: [key, passkey], pgp, client: new StaffClient(API, ORIGIN) };
    await login(p);
    staff.push(p);
    console.log(`demo staff seed: ${p.tradeTag} (${p.role})`);
  } catch (e) {
    failures.push(`${plan.tradeTag}: ${(e as Error).message}`);
  }
}

// ── a News item, published with the owner's tap ─────────────────────────────
const NEWS = {
  title: 'Welcome to the X2F demo',
  body: 'This is a regtest demo with fake money only. Trade with the seeded accounts, try a dispute, and leave comments with the Comment button.',
};
try {
  const tapId = await tap(owner, newsPublishIntent({ newsId: null, ...NEWS }));
  await owner.client.ok('POST', '/staff/v1/news', { ...NEWS, tapId });
  console.log('demo staff seed: news published');
} catch (e) {
  failures.push(`news: ${(e as Error).message}`);
}

// ── the senior moderator takes one of the open disputes (seed.ts opened them) ─
const disputed = (readSeedSummary()?.trades ?? []).filter((t) => t.state === 'disputed').map((t) => t.code);
const taken: string[] = [];
const senior = staff.find((p) => p.role === 'senior');
if (senior && disputed[0]) {
  try {
    await senior.client.ok('POST', `/staff/v1/disputes/${disputed[0]}/take`, {});
    taken.push(disputed[0]);
    console.log(`demo staff seed: ${senior.tradeTag} took ${disputed[0]}`);
  } catch (e) {
    failures.push(`take ${disputed[0]}: ${(e as Error).message}`);
  }
}

// Logged out again: the seed holds no staff session.
for (const p of staff) await p.client.call('POST', '/staff/v1/logout');
for (const f of failures) console.log(`demo staff seed: refused: ${f}`);

const secrets: StaffSecret[] = staff.map(({ client: _c, ...s }) => s);
writeFileSync(STAFF_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
const summary: StaffSummary = {
  origin: ORIGIN,
  people: staff.map((p) => ({ login: p.loginName, shown: p.tradeTag, role: p.role })),
  disputes: disputed,
  taken,
  news: NEWS.title,
  failures,
};
writeFileSync(STAFF_SUMMARY_FILE, JSON.stringify(summary, null, 2));
const role = (r: string) => (r === 'mod' ? 'moderator' : r === 'senior' ? 'senior moderator' : 'owner');
appendFileSync(join(DEMO_DIR, 'logins.txt'), [
  '',
  `Staff (the staff app, its own origin: ${ORIGIN}):`,
  `  Log in at ${ORIGIN}/__demo/staff (one tap: the demo holds each account's throwaway security key and PGP key and does the real two-step staff login).`,
  ...STAFF_CAST.filter((p) => staff.some((s) => s.loginName === p.loginName)).map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.tradeTag.padEnd(14)} ${role(p.role)}: ${p.sees}`),
  ...(disputed.length > 0 ? [`  Open disputes in the queue: ${disputed.join(', ')}${taken.length > 0 ? ` (${taken.join(', ')} taken by the senior moderator)` : ''}`] : []),
  '',
].join('\n'));
process.exit(0);
