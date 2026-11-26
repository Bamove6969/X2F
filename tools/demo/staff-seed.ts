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
import { evidenceSha256, newsPublishIntent, type KeyTapIntent } from '@x2f/staff';
import pg from 'pg';
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
const owner: Staffer = { displayName: ownerPlan.displayName, loginName: ownerPlan.loginName, role: 'owner', keys: [newKey(), newKey()], pgp: await newPgp(ownerPlan.displayName), client: new StaffClient(API, ORIGIN) };
{
  const c = new StaffClient(API, ORIGIN);
  await c.ok('POST', '/staff/v1/setup/code', { code });
  await c.ok('POST', '/staff/v1/setup/account', { displayName: owner.displayName, loginName: owner.loginName });
  for (const [i, k] of owner.keys.entries()) {
    await addKey(c, '/staff/v1/setup/key/start', {}, '/staff/v1/setup/key/finish', (s, response) => ({ challengeId: s.challengeId, response, label: i === 0 ? 'Main key (demo)' : 'Spare key (demo)' }), k, true);
  }
  const ps = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/staff/v1/setup/pgp/start', { publicKey: owner.pgp.publicKey });
  await c.ok('POST', '/staff/v1/setup/pgp/finish', { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, owner.pgp) });
  await c.ok('POST', '/staff/v1/setup/finish', { deviceLabel: 'Demo seed' });
}
await login(owner);
console.log(`demo staff seed: ${owner.displayName} (owner)`);

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
    await c.ok('POST', url('/account'), { displayName: plan.displayName, loginName: plan.loginName, acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: plan.displayName } });
    const key = newKey();
    await addKey(c, url('/key/start'), { kind: 'security-key' }, url('/key/finish'), (_s, response) => ({ kind: 'security-key', response }), key, true);
    const passkey = newKey();
    await addKey(c, url('/key/start'), { kind: 'passkey' }, url('/key/finish'), (_s, response) => ({ kind: 'passkey', response }), passkey, false);
    const pgp = await newPgp(plan.displayName);
    const ps = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', url('/pgp/start'), { publicKey: pgp.publicKey });
    await c.ok('POST', url('/pgp/finish'), { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, pgp) });
    await c.ok('POST', url('/finish'), {});
    const p: Staffer = { displayName: plan.displayName, loginName: plan.loginName, role: plan.role, keys: [key, passkey], pgp, client: new StaffClient(API, ORIGIN) };
    await login(p);
    staff.push(p);
    console.log(`demo staff seed: ${p.displayName} (${p.role})`);
  } catch (e) {
    failures.push(`${plan.displayName}: ${(e as Error).message}`);
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
    console.log(`demo staff seed: ${senior.displayName} took ${disputed[0]}`);
  } catch (e) {
    failures.push(`take ${disputed[0]}: ${(e as Error).message}`);
  }
}

// ── staff pay (owner 26 Nov 2026, PR #23): the owner's pay settings and one person's own share ─
// Each with the owner's tap, through the real routes (Settings, Staff pay).
const PAY = {
  modDisputeUsdCents: 500, // a moderator's minimum per dispute: $5
  seniorDisputeUsdCents: 800, // a senior moderator's minimum: $8
  seniorLargeTradeBp: 1000, // 10% of the fee on a large trade
  largeTradeThresholdUsd: 1000,
  modFeeBp: 3000, // 30% of the 1% fee
  seniorFeeBp: 4000, // 40% of the 1% fee
  modFlatUsdCents: 200, // $2 flat on top
  seniorFlatUsdCents: 300, // $3 flat on top
};
const paid: string[] = [];
try {
  const tapId = await tap(owner, { kind: 'pay-settings', ...PAY });
  await owner.client.ok('PUT', '/staff/v1/pay/settings', { ...PAY, tapId });
  paid.push('pay settings: moderator 30% of the fee + $2 (min $5), senior 40% + $3 (min $8)');
  const members = (await owner.client.ok<{ members: Array<{ staffId: string; displayName: string; role: string }> }>('GET', '/staff/v1/pay/staff')).members;
  const mod = members.find((m) => m.role === 'mod');
  if (mod) {
    const feeBp = 5000;
    const t = await tap(owner, { kind: 'staff-pay', accountId: mod.staffId, feeBp });
    await owner.client.ok('PUT', `/staff/v1/pay/staff/${mod.staffId}`, { feeBp, tapId: t });
    paid.push(`${mod.displayName}'s own share: 50% of the fee`);
  }
  console.log('demo staff seed: staff pay set');
} catch (e) {
  failures.push(`staff pay: ${(e as Error).message}`);
}

// ── rulings, so the pay pages have earned items (pay accrues when round 1 is published) ─────
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
type Outcome = 'release-to-buyer' | 'refund-to-seller';
/** One ruling's propose or approve tap over exactly what the route stores (disputes/rulings.ts). */
function rulingTap(step: 'propose' | 'approve', a: { rulingId: string; code: string; round: 1 | 2; outcome: Outcome; amountAtomic: string; reason: string; evidence: string[] }): KeyTapIntent {
  return {
    kind: 'ruling', step, rulingId: a.rulingId, code: a.code, round: a.round, outcome: a.outcome, accountAction: { kind: 'none' },
    amountAtomic: a.amountAtomic, reasonSha256: sha(a.reason), evidenceSha256: evidenceSha256(a.evidence), round1Id: null,
  };
}
async function propose(p: Staffer, code: string, outcome: Outcome, reason: string, evidence: string[]): Promise<{ rulingId: string; status: string; round: 1 | 2; amountAtomic: string }> {
  const v = await p.client.ok<{ round: 1 | 2; escrow: { amountAtomic: string } }>('GET', `/staff/v1/disputes/${code}`);
  const a = { rulingId: randomUUID(), code, round: v.round, outcome, amountAtomic: v.escrow.amountAtomic, reason, evidence };
  const tapId = await tap(p, rulingTap('propose', a));
  await p.client.ok('POST', `/staff/v1/disputes/${code}/rulings`, { rulingId: a.rulingId, outcome, accountAction: { kind: 'none' }, reason, evidence, tapId });
  const after = await p.client.ok<{ status: string }>('GET', `/staff/v1/disputes/${code}`);
  return { rulingId: a.rulingId, status: after.status, round: v.round, amountAtomic: v.escrow.amountAtomic };
}
const ruled: string[] = [];
const mods = staff.filter((p) => p.role === 'mod');
// The senior moderator rules the case they took (a USD trade under the limit: one person decides).
if (senior && taken[0]) {
  try {
    const r = await propose(senior, taken[0], 'refund-to-seller', 'The buyer stopped answering after the escrow was secured and never showed any payment, so the XMR goes back to the seller.', ['Trade chat: no reply from the buyer after the escrow was secured.']);
    ruled.push(`${taken[0]}: refund to the seller (${senior.displayName}, ${r.status})`);
    console.log(`demo staff seed: ${senior.displayName} ruled ${taken[0]} (${r.status})`);
  } catch (e) {
    failures.push(`ruling ${taken[0]}: ${(e as Error).message}`);
  }
}
// A moderator takes the other case and proposes; a non-USD trade needs a second person, so the
// senior moderator approves it.
const other = disputed.find((c) => !taken.includes(c));
if (mods[0] && senior && other) {
  try {
    await mods[0].client.ok('POST', `/staff/v1/disputes/${other}/take`, {});
    taken.push(other);
    const reason = 'The buyer showed a SEPA Instant payment from an account in their own name for the full amount, so the XMR is released to the buyer.';
    const evidence = ['Bank screenshot: SEPA Instant for the trade total, sender name matches the buyer.'];
    const r = await propose(mods[0], other, 'release-to-buyer', reason, evidence);
    if (r.status === 'awaiting-approval') {
      const t = await tap(senior, rulingTap('approve', { rulingId: r.rulingId, code: other, round: r.round, outcome: 'release-to-buyer', amountAtomic: r.amountAtomic, reason, evidence }));
      await senior.client.ok('POST', `/staff/v1/disputes/${other}/rulings/${r.rulingId}/approve`, { tapId: t });
    }
    ruled.push(`${other}: release to the buyer (${mods[0].displayName}, approved by ${senior.displayName})`);
    console.log(`demo staff seed: ${mods[0].displayName} ruled ${other}, ${senior.displayName} approved`);
  } catch (e) {
    failures.push(`ruling ${other}: ${(e as Error).message}`);
  }
}

// ── past shifts (DEMO ONLY): a few clocked hours over the last week for each moderator ──────
// A shift is written by the staff login itself (migration 420's session trigger), so the seed's
// logins make today's; earlier ones are written straight into the demo's own throwaway database
// (no session behind them), so Work and hours and the pay pages have a week to show.
if (process.env.DATABASE_URL) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const day = 86_400_000;
    for (const [i, p] of staff.filter((s) => s.role !== 'owner').entries()) {
      const id = (await db.query<{ id: string }>('select id::text from accounts where display_name = $1', [p.displayName])).rows[0]?.id;
      if (!id) continue;
      for (const [d, hours, ended] of [[6, 3.5, 'clock-out'], [4, 5, 'clock-out'], [2, 2.25, 'auto-logout'], [1, 4 + i, 'clock-out']] as const) {
        const start = new Date(Date.now() - d * day - (9 + i) * 3_600_000);
        const end = new Date(start.getTime() + hours * 3_600_000);
        await db.query('insert into staff_shifts (session_id, staff_id, clocked_in_at, ended_at, ended) values ($1, $2, $3, $4, $5)', [randomUUID(), id, start, end, ended]);
      }
    }
    console.log('demo staff seed: past shifts written');
  } catch (e) {
    failures.push(`shifts: ${(e as Error).message}`);
  } finally {
    await db.end().catch(() => undefined);
  }
}

// Logged out again: the seed holds no staff session.
for (const p of staff) await p.client.call('POST', '/staff/v1/logout');
for (const f of failures) console.log(`demo staff seed: refused: ${f}`);

const secrets: StaffSecret[] = staff.map(({ client: _c, ...s }) => s);
writeFileSync(STAFF_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
const summary: StaffSummary = {
  origin: ORIGIN,
  people: staff.map((p) => ({ login: p.loginName, shown: p.displayName, role: p.role })),
  disputes: disputed,
  taken,
  news: NEWS.title,
  pay: paid,
  ruled,
  failures,
};
writeFileSync(STAFF_SUMMARY_FILE, JSON.stringify(summary, null, 2));
const role = (r: string) => (r === 'mod' ? 'moderator' : r === 'senior' ? 'senior moderator' : 'owner');
appendFileSync(join(DEMO_DIR, 'logins.txt'), [
  '',
  `Staff (the staff app, its own origin: ${ORIGIN}):`,
  `  Log in at ${ORIGIN}/__demo/staff (one tap: the demo holds each account's throwaway security key and PGP key and does the real two-step staff login).`,
  ...STAFF_CAST.filter((p) => staff.some((s) => s.loginName === p.loginName)).map((p) => `  login name ${p.loginName.padEnd(16)} shown as ${p.displayName.padEnd(14)} ${role(p.role)}: ${p.sees}`),
  ...(disputed.length > 0 ? [`  Disputes in the queue: ${disputed.join(', ')}${taken.length > 0 ? ` (${taken.join(', ')} taken)` : ''}`] : []),
  ...ruled.map((r) => `  Ruled: ${r}`),
  ...paid.map((p) => `  Staff pay: ${p}`),
  '',
].join('\n'));
process.exit(0);
