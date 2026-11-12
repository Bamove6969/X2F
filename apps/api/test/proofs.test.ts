// Plan 5 Task 14: the server's proof storage. The API stores each proof as the ciphertext the
// uploader's device made (@x2f/proof encryptProof); the key never reaches it (it travels in a sealed
// chat envelope), so the server can neither read nor check the picture, and never parses the body.
//
// PUT /v1/trades/:code/proofs/:id?kind=   (a party to the trade, octet-stream, at most PROOF_MAX_CIPHERTEXT)
//   proof      the buyer only, in securing | secured | paid | refund_requested | disputed
//   evidence   either side, while a dispute is open (P5-A30)
//   unblurred  only the side a moderator asked (Plan 4's request on the dispute), once per request
// GET /v1/trades/:code/proofs/:id         (a party) the ciphertext of proof or evidence; unblurred is 404 to everyone
//
// Ids are used once (a re-used id is 409 proof-exists, even after its proof is gone), at most
// PROOF_MAX_PER_SIDE proofs per side per trade, owner-only like the chat (members have no chat keys
// yet: proof-upload and proof-see-partner are waits-member-chat-key), and the proofs go with the
// trade and on the chat's retention.
import { PROOF_MAX_CIPHERTEXT, newProofId } from '@x2f/proof';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { PROOF_MAX_PER_SIDE, purgeProofs } from '../src/proofs/store.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { startDispute } from '../src/disputes/store.js';
import { loadTrade } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { ORIGIN, Browser } from './helpers/totp.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-10-17T12:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(START.getTime() + ms);

beforeAll(async () => {
  ({ app, deps, trader, setNow, logs } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

type Who = Awaited<ReturnType<typeof trader>>;
const url = (code: string, id: string, kind?: string) => `/v1/trades/${code}/proofs/${id}${kind === undefined ? '' : `?kind=${kind}`}`;
/** A ciphertext stand-in: random bytes (the server never looks inside). */
const body = (n = 4096) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
};

async function put(who: { browser: Browser }, code: string, id: string, kind: string, payload: Buffer = body(), type = 'application/octet-stream') {
  return app.inject({ method: 'PUT', url: url(code, id, kind), headers: { origin: ORIGIN, 'content-type': type }, cookies: who.browser.cookies, payload });
}
const get = (who: { browser: Browser }, code: string, id: string) => who.browser.get(url(code, id));
const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

async function tradeIn(state: Parameters<typeof driveTo>[2]): Promise<{ seller: Who; buyer: Who; code: string }> {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  await driveTo(deps, trade, state);
  return { seller, buyer, code: trade.code };
}

/** Opens a dispute directly: the trade's columns and the dispute machine's own row (startDispute; the route's rules are disputes.test.ts's). */
async function openDispute(code: string, side: 'buyer' | 'seller' = 'buyer') {
  const t = (await loadTrade(deps.db, code))!;
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await client.query(`update trades set state = 'disputed', dispute_by = $2, dispute_at = $3 where code = $1`, [code, side, deps.clock()]);
    await startDispute(client, t, { openedBy: side, reason: 'paid', note: '', afterRefund: false, now: deps.clock(), prices: null });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Plan 4's request for the unblurred proof, as the staff route records it on the dispute. */
async function requestUnblurred(code: string, side: 'buyer' | 'seller', when = deps.clock()) {
  await deps.db.query(`update disputes set proof_request_side = $2, proof_requested_at = $3, proof_requested_by = 'Mod Ana' where code = $1`, [code, side, when]);
}

const stored = async (id: string) =>
  (await deps.db.query<{ trade_code: string; uploader_role: string; kind: string; ciphertext: Buffer }>('select trade_code, uploader_role, kind, ciphertext from trade_proofs where id = $1', [id])).rows[0];

describe('PUT /v1/trades/:code/proofs/:id: the payment proof', () => {
  it('the buyer stores a ciphertext; both parties read back exactly those bytes, never cached', async () => {
    const { buyer, seller, code } = await tradeIn('secured');
    const id = newProofId();
    const b = body(10_000);
    const res = await put(buyer, code, id, 'proof', b);
    expect(res.statusCode).toBe(204);
    expect(await stored(id)).toMatchObject({ trade_code: code, uploader_role: 'buyer', kind: 'proof' });
    expect(Buffer.from((await stored(id))!.ciphertext).equals(b)).toBe(true);
    for (const who of [buyer, seller]) {
      const r = await get(who, code, id);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('application/octet-stream');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.rawPayload.equals(b)).toBe(true);
    }
  });

  it('the seller sending a payment proof is wrong-party; nothing is stored', async () => {
    const { seller, code } = await tradeIn('paid');
    const id = newProofId();
    const res = await put(seller, code, id, 'proof');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('wrong-party');
    expect(await stored(id)).toBeUndefined();
  });

  it('only while the trade is being paid: before funding or after release is wrong-state', async () => {
    for (const state of ['funding', 'released'] as const) {
      const { buyer, code } = await tradeIn(state);
      const res = await put(buyer, code, newProofId(), 'proof');
      expect(res.statusCode, state).toBe(409);
      expect(errorOf(res)).toBe('wrong-state');
    }
    for (const state of ['securing', 'paid'] as const) {
      const { buyer, code } = await tradeIn(state);
      expect((await put(buyer, code, newProofId(), 'proof')).statusCode, state).toBe(204);
    }
  });

  it('someone outside the trade gets 404 for both routes, as for an unknown trade', async () => {
    const { buyer, code } = await tradeIn('secured');
    const id = newProofId();
    expect((await put(buyer, code, id, 'proof')).statusCode).toBe(204);
    const other = await trader();
    expect((await put(other, code, newProofId(), 'proof')).statusCode).toBe(404);
    expect((await get(other, code, id)).statusCode).toBe(404);
    expect((await get(buyer, 'AAAA-BBBB-CCCC-DDDD', id)).statusCode).toBe(404);
  });

  it(`size: at most PROOF_MAX_CIPHERTEXT (413 one byte over), at least a nonce and a tag (400)`, async () => {
    const { buyer, code } = await tradeIn('secured');
    const over = await put(buyer, code, newProofId(), 'proof', body(PROOF_MAX_CIPHERTEXT + 1));
    expect(over.statusCode).toBe(413);
    const exact = newProofId();
    expect((await put(buyer, code, exact, 'proof', body(PROOF_MAX_CIPHERTEXT))).statusCode).toBe(204);
    expect((await put(buyer, code, newProofId(), 'proof', body(39))).statusCode).toBe(400);
  });

  it('octet-stream only (415 for JSON or a form); a bad id or kind is 400', async () => {
    const { buyer, code } = await tradeIn('secured');
    expect((await put(buyer, code, newProofId(), 'proof', Buffer.from('{"a":1}'), 'application/json')).statusCode).toBe(415);
    expect((await put(buyer, code, newProofId(), 'proof', body(), 'multipart/form-data; boundary=x')).statusCode).toBe(415);
    expect((await put(buyer, code, 'not-an-id', 'proof')).statusCode).toBe(400);
    expect((await put(buyer, code, newProofId().toLowerCase(), 'proof')).statusCode).toBe(400);
    expect((await put(buyer, code, newProofId(), 'photo')).statusCode).toBe(400);
    expect((await put(buyer, code, newProofId(), '')).statusCode).toBe(400);
    expect((await get(buyer, code, 'not-an-id')).statusCode).toBe(400);
  });

  it(`at most PROOF_MAX_PER_SIDE (${5}) per side per trade: the next is too-many-proofs`, async () => {
    expect(PROOF_MAX_PER_SIDE).toBe(5);
    const { buyer, code } = await tradeIn('secured');
    for (let i = 0; i < PROOF_MAX_PER_SIDE; i++) expect((await put(buyer, code, newProofId(), 'proof', body(64))).statusCode).toBe(204);
    const res = await put(buyer, code, newProofId(), 'proof', body(64));
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('too-many-proofs');
    const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from trade_proofs where trade_code = $1', [code]);
    expect(rows[0]!.n).toBe(PROOF_MAX_PER_SIDE);
  });

  it('parallel uploads cannot pass the cap', async () => {
    const { buyer, code } = await tradeIn('secured');
    const rs = await Promise.all(Array.from({ length: PROOF_MAX_PER_SIDE + 3 }, () => put(buyer, code, newProofId(), 'proof', body(64))));
    expect(rs.filter((r) => r.statusCode === 204)).toHaveLength(PROOF_MAX_PER_SIDE);
    expect(rs.filter((r) => r.statusCode === 409).every((r) => errorOf(r) === 'too-many-proofs')).toBe(true);
  });

  it('an id is used once: again (same or another trade, even after the proof is gone) is proof-exists, and the stored bytes are unchanged', async () => {
    const { buyer, code } = await tradeIn('secured');
    const id = newProofId();
    const first = body(100);
    expect((await put(buyer, code, id, 'proof', first)).statusCode).toBe(204);
    const again = await put(buyer, code, id, 'proof', body(100));
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('proof-exists');
    expect(Buffer.from((await stored(id))!.ciphertext).equals(first)).toBe(true);
    const other = await tradeIn('secured');
    expect(errorOf(await put(other.buyer, other.code, id, 'proof'))).toBe('proof-exists');
    await deps.db.query('delete from trade_proofs where id = $1', [id]);
    expect(errorOf(await put(buyer, code, id, 'proof'))).toBe('proof-exists');
  });

  it('a team member is refused (owner-only, as the chat: members have no chat keys yet)', async () => {
    const { buyer, code } = await tradeIn('secured');
    const id = newProofId();
    expect((await put(buyer, code, id, 'proof')).statusCode).toBe(204);
    const loginId = await seedAccount(deps, { loginName: `mproof${Date.now()}x`, displayName: 'm-proof-placeholder', kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Proofer', 'proofer', $2, $3, $4, $3, $3)`,
      [buyer.id, ['proof-upload', 'proof-see-partner', 'trades-mark-paid'], deps.clock(), loginId],
    );
    const m = { browser: new Browser(app) };
    expect((await m.browser.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const up = await put(m, code, newProofId(), 'proof');
    expect(up.statusCode).toBe(403);
    expect(errorOf(up)).toBe('owner-only');
    const read = await get(m, code, id);
    expect(read.statusCode).toBe(403);
    expect(errorOf(read)).toBe('owner-only');
  });
});

describe('dispute evidence and the unblurred copy', () => {
  it('evidence: either side, only while a dispute is open', async () => {
    const { buyer, seller, code } = await tradeIn('paid');
    expect(errorOf(await put(seller, code, newProofId(), 'evidence'))).toBe('wrong-state');
    await openDispute(code);
    const s = newProofId();
    expect((await put(seller, code, s, 'evidence')).statusCode).toBe(204);
    expect((await put(buyer, code, newProofId(), 'evidence')).statusCode).toBe(204);
    expect((await get(buyer, code, s)).statusCode).toBe(200);
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, deps.clock()]);
    await deps.db.query(`update trades set state = 'released' where code = $1`, [code]);
    expect(errorOf(await put(seller, code, newProofId(), 'evidence'))).toBe('wrong-state');
  });

  it('unblurred: not-requested until a moderator asks; then the named side, once; nobody can GET it', async () => {
    const { buyer, seller, code } = await tradeIn('paid');
    await openDispute(code);
    expect(errorOf(await put(buyer, code, newProofId(), 'unblurred'))).toBe('not-requested');
    await requestUnblurred(code, 'buyer');
    expect(errorOf(await put(seller, code, newProofId(), 'unblurred'))).toBe('not-requested');
    const id = newProofId();
    expect((await put(buyer, code, id, 'unblurred')).statusCode).toBe(204);
    expect((await stored(id))!.kind).toBe('unblurred');
    // That request is answered: another needs a new request.
    expect(errorOf(await put(buyer, code, newProofId(), 'unblurred'))).toBe('not-requested');
    setNow(at(1000));
    await requestUnblurred(code, 'buyer', at(1000));
    for (const who of [buyer, seller]) {
      await who.browser.post('/t/login', { accountId: who.id });
      const r = await get(who, code, id);
      expect(r.statusCode).toBe(404);
      expect(r.rawPayload.length).toBeLessThan(100);
    }
    expect((await put(buyer, code, newProofId(), 'unblurred')).statusCode).toBe(204);
  });

  it('a request on a closed dispute does not count', async () => {
    const { buyer, code } = await tradeIn('paid');
    await openDispute(code);
    await requestUnblurred(code, 'buyer');
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, deps.clock()]);
    expect(errorOf(await put(buyer, code, newProofId(), 'unblurred'))).toBe('not-requested');
  });
});

describe('privacy: no request body, proof id, trade code or byte count in the logs', () => {
  it('a full flow, refusals and an over-size body included, logs none of them', async () => {
    const before = logs.length;
    const { buyer, seller, code } = await tradeIn('secured');
    const id = newProofId();
    const b = body(12_345);
    await put(buyer, code, id, 'proof', b);
    await get(seller, code, id);
    await put(seller, code, newProofId(), 'proof');
    await put(buyer, code, id, 'proof', body(12_345));
    await put(buyer, code, newProofId(), 'proof', body(PROOF_MAX_CIPHERTEXT + 1));
    await put(buyer, code, newProofId(), 'proof', Buffer.from('{}'), 'application/json');
    const text = logs.slice(before).join('\n');
    for (const s of [id, code, code.replace(/-/g, ''), '12345', String(PROOF_MAX_CIPHERTEXT + 1), b.subarray(0, 16).toString('hex'), b.subarray(0, 16).toString('base64')]) {
      expect(text, s).not.toContain(s);
    }
  });
});

describe('retention: proofs go with the trade, on the chat rule', () => {
  it('the table cascades from trades, and purgeProofs is a retention job', async () => {
    const { rows } = await deps.db.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint where conrelid = 'trade_proofs'::regclass and contype = 'f'`,
    );
    expect(rows.map((r) => r.confdeltype)).toEqual(['c']);
    expect(RETENTION_JOBS.map((j) => j.name)).toContain('purgeProofs');
  });

  it('an undisputed trade: kept 30 days after it closes, then deleted', async () => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    const closed = (await deps.db.query<{ closed_at: Date }>(`update trades set state = 'released', closed_at = $2 where code = $1 returning closed_at`, [code, at(DAY)])).rows[0]!.closed_at;
    await purgeProofs(deps.db, new Date(closed.getTime() + 29 * DAY));
    expect(await stored(id)).toBeDefined();
    await purgeProofs(deps.db, new Date(closed.getTime() + 31 * DAY));
    expect(await stored(id)).toBeUndefined();
  });

  it('a disputed trade: never while the dispute is open; 90 days after it closes', async () => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    await openDispute(code);
    await deps.db.query(`update trades set closed_at = $2 where code = $1`, [code, at(DAY)]);
    await purgeProofs(deps.db, at(400 * DAY));
    expect(await stored(id)).toBeDefined();
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, at(10 * DAY)]);
    await deps.db.query(`update trades set state = 'released' where code = $1`, [code]);
    await purgeProofs(deps.db, at(99 * DAY));
    expect(await stored(id)).toBeDefined();
    await purgeProofs(deps.db, at(101 * DAY));
    expect(await stored(id)).toBeUndefined();
  });

  it('an open trade keeps its proofs', async () => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    await purgeProofs(deps.db, at(1000 * DAY));
    expect(await stored(id)).toBeDefined();
  });
});
