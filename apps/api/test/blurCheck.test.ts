import type { FastifyInstance } from 'fastify';
import { newProofId } from '@x2f/proof';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { purgeBlurChecks } from '../src/proof/blurCheck.js';
import { seedAccount } from './helpers/accounts.js';
import { StaffBrowser, TRADER_ORIGIN, insertSession, seedStaff, staffApps } from './helpers/staffApp.js';
import { seedTrade } from './helpers/trades.js';

// P-012 (owner Q47, 6 Nov 2026) and P-013 (owner p9-8, 8 Nov): "Was this proof blurred correctly?"
// asked of BOTH parties on every proof for the first weeks, then on every Nth proof (a setting:
// owner_settings `blur_check_all_until` YYYYMMDD and `blur_check_every_nth`). A No asks for a
// comment that goes to the feedback readers (perm feedback.read). Kept to the minimum: the answer,
// the comment, the payment method, whether the blur was automatic or manual, the uploader or
// receiver role and the day. Never the image, the trade, the proof id or who answered. Real Postgres.

let app: FastifyInstance;
let trader: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;

const T0 = new Date('2026-11-12T12:00:00Z');

beforeAll(async () => {
  ({ app, trader, deps, setNow, close } = await staffApps());
  setNow(T0);
  owner = new StaffBrowser(app).withSession((await insertSession(deps, (await seedStaff(deps, { role: 'owner' })).id, 'staff')).token);
});
afterAll(async () => close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query(`delete from owner_settings where key in ('blur_check_all_until', 'blur_check_every_nth')`);
});

interface Who { id: string; token: string }
async function person(): Promise<Who> {
  const id = await seedAccount(deps, { loginName: `bc${Math.random().toString(36).slice(2, 10)}` });
  return { id, token: (await insertSession(deps, id, 'trader')).token };
}
const call = (who: Who, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  trader.inject({ method, url, headers: { origin: TRADER_ORIGIN }, cookies: { [SESSION_COOKIE]: who.token }, ...(payload === undefined ? {} : { payload: payload as object }) });

async function pair() {
  const seller = await person();
  const buyer = await person();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE' });
  return { seller, buyer, code: trade.code };
}
const posted = (who: Who, code: string, proofId: string, blur = 'auto') => call(who, 'POST', `/v1/trades/${code}/proofs/${proofId}/blur-check`, { blur });
const pending = async (who: Who, code: string) => {
  const res = await call(who, 'GET', `/v1/trades/${code}/blur-checks`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { checks: { proofId: string; role: string }[] }).checks;
};
const answer = (who: Who, code: string, proofId: string, body: unknown) => call(who, 'POST', `/v1/trades/${code}/blur-checks/${proofId}`, body);
const setting = (key: string, value: number) =>
  deps.db.query(`insert into owner_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value`, [key, value]);

describe('who is asked, and when', () => {
  it('in the first weeks every proof asks both parties: the uploader and the receiver', async () => {
    const { seller, buyer, code } = await pair();
    const proofId = newProofId();
    const res = await posted(buyer, code, proofId, 'both');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ask: true });
    expect(await pending(buyer, code)).toEqual([{ proofId, role: 'uploader' }]);
    expect(await pending(seller, code)).toEqual([{ proofId, role: 'receiver' }]);
    // Telling the server twice about the same proof changes nothing.
    expect((await posted(buyer, code, proofId)).json()).toEqual({ ask: true });
    expect(await pending(seller, code)).toHaveLength(1);
  });

  it('after the date, only every Nth proof on the site is asked', async () => {
    await setting('blur_check_all_until', 20261111);
    await setting('blur_check_every_nth', 3);
    const { seller, buyer, code } = await pair();
    const asks: boolean[] = [];
    for (let i = 0; i < 6; i++) asks.push(((await posted(buyer, code, newProofId())).json() as { ask: boolean }).ask);
    expect(asks.filter(Boolean)).toHaveLength(2);
    expect(await pending(seller, code)).toHaveLength(2);
  });

  it('a bad setting row falls back to the defaults (every proof with no end date)', async () => {
    await setting('blur_check_all_until', 12345);
    await setting('blur_check_every_nth', 0);
    const { buyer, code } = await pair();
    expect((await posted(buyer, code, newProofId())).json()).toEqual({ ask: true });
  });

  it('only a participant, a real proof id and a known blur kind; a stranger gets 404', async () => {
    const { buyer, code } = await pair();
    const stranger = await person();
    expect((await posted(stranger, code, newProofId())).statusCode).toBe(404);
    expect((await call(stranger, 'GET', `/v1/trades/${code}/blur-checks`)).statusCode).toBe(404);
    expect((await posted(buyer, code, 'not-a-proof-id')).statusCode).toBe(400);
    expect((await posted(buyer, code, newProofId(), 'blurry')).statusCode).toBe(400);
    expect((await call(buyer, 'POST', `/v1/trades/${code}/proofs/${newProofId()}/blur-check`, { blur: 'auto', image: 'x' })).statusCode).toBe(400);
    expect((await trader.inject({ method: 'GET', url: `/v1/trades/${code}/blur-checks` })).statusCode).toBe(401);
  });

  it('caps the proofs one trade can announce', async () => {
    const { buyer, code } = await pair();
    for (let i = 0; i < 20; i++) expect((await posted(buyer, code, newProofId())).statusCode).toBe(200);
    const res = await posted(buyer, code, newProofId());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'too-many-proofs' });
  });
});

describe('answers', () => {
  it('Yes and No (with a comment) are stored with the minimum, and each party answers once', async () => {
    const { seller, buyer, code } = await pair();
    const proofId = newProofId();
    await posted(buyer, code, proofId, 'manual');
    expect((await answer(buyer, code, proofId, { correct: true })).statusCode).toBe(204);
    expect((await answer(seller, code, proofId, { correct: false, comment: 'The account number was readable.' })).statusCode).toBe(204);
    expect(await pending(buyer, code)).toEqual([]);
    expect(await pending(seller, code)).toEqual([]);
    expect((await answer(buyer, code, proofId, { correct: true })).statusCode).toBe(404);
    const { rows } = await deps.db.query('select * from blur_check_answers order by role');
    const mine = rows.filter((r: { comment: string | null }) => r.comment === null || r.comment === 'The account number was readable.').slice(-2);
    expect(Object.keys(rows[0] as object).sort()).toEqual(['answered_on', 'blur', 'comment', 'correct', 'id', 'method_id', 'role']);
    expect(mine.map((r: Record<string, unknown>) => [r.role, r.correct, r.comment, r.method_id, r.blur])).toEqual(
      expect.arrayContaining([['uploader', true, null, 'ZELLE', 'manual'], ['receiver', false, 'The account number was readable.', 'ZELLE', 'manual']]),
    );
    // No column can lead back to the trade, the proof or a person.
    const cols = (await deps.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'blur_check_answers'`)).rows.map((r) => r.column_name);
    for (const c of ['trade_code', 'proof_id', 'account_id', 'created_at']) expect(cols).not.toContain(c);
  });

  it('refuses a comment on a Yes, an over-long comment, and an answer with no question asked', async () => {
    const { buyer, code } = await pair();
    const proofId = newProofId();
    await posted(buyer, code, proofId);
    expect((await answer(buyer, code, proofId, { correct: true, comment: 'ok' })).json()).toMatchObject({ error: 'comment-on-yes' });
    expect((await answer(buyer, code, proofId, { correct: false, comment: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await answer(buyer, code, newProofId(), { correct: true })).statusCode).toBe(404);
  });

  it('the asks go with their trade; the answers outlive it and are deleted after 90 days', async () => {
    const { seller, buyer, code } = await pair();
    const proofId = newProofId();
    await posted(buyer, code, proofId);
    expect((await answer(buyer, code, proofId, { correct: false, comment: 'Old one' })).statusCode).toBe(204);
    const fk = async (t: string) => (await deps.db.query<{ ref: string; del: string }>(
      `select confrelid::regclass::text as ref, confdeltype as del from pg_constraint where conrelid = $1::regclass and contype = 'f'`, [t],
    )).rows;
    expect(await fk('blur_check_proofs')).toEqual([{ ref: 'trades', del: 'c' }]);
    expect(await fk('blur_check_asks')).toEqual([{ ref: 'blur_check_proofs', del: 'c' }]);
    expect(await fk('blur_check_answers')).toEqual([]);
    expect(await pending(seller, code)).toHaveLength(1);
    await purgeBlurChecks.run(deps.db, new Date(T0.getTime() + 89 * 86_400_000));
    expect((await deps.db.query(`select 1 from blur_check_answers where comment = 'Old one'`)).rowCount).toBe(1);
    const n = await purgeBlurChecks.run(deps.db, new Date(T0.getTime() + 91 * 86_400_000));
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await deps.db.query(`select 1 from blur_check_answers where comment = 'Old one'`)).rowCount).toBe(0);
  });
});

describe('the feedback readers (staff perm feedback.read)', () => {
  it('lists the answers, newest day first, with no link to a trade or a person', async () => {
    const { seller, buyer, code } = await pair();
    const proofId = newProofId();
    await posted(buyer, code, proofId, 'auto');
    await answer(seller, code, proofId, { correct: false, comment: 'Name visible at the top.' });
    const res = await owner.get('/staff/v1/feedback/blur-checks');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Record<string, unknown>[]; counts: { yes: number; no: number }; next: string | null };
    const item = body.items.find((i) => i.comment === 'Name visible at the top.');
    expect(item).toMatchObject({ correct: false, role: 'receiver', method: 'Zelle', blur: 'auto', createdOn: '2026-11-12' });
    expect(Object.keys(item!).sort()).toEqual(['blur', 'comment', 'correct', 'createdOn', 'id', 'method', 'role']);
    expect(body.counts.no).toBeGreaterThanOrEqual(1);
  });
});
