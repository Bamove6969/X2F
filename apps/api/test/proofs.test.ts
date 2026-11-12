// Plan 5 Task 14: the server's proof storage. The API stores each proof as the ciphertext the
// uploader's device made (@x2f/proof encryptProof); the key never reaches it (it travels in a sealed
// chat envelope), so the server can neither read nor check the picture, and never parses the body.
//
// PUT /v1/trades/:code/proofs/:id?kind=   (a party to the trade, octet-stream, at most PROOF_MAX_CIPHERTEXT)
//   proof      the buyer only, in secured | paid | refund_requested | disputed (not while securing)
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
import { EVIDENCE_MAX_PER_SIDE, PROOF_MAX_PER_SIDE, purgeProofs } from '../src/proofs/store.js';
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
    for (const state of ['secured', 'paid'] as const) {
      const { buyer, code } = await tradeIn(state);
      expect((await put(buyer, code, newProofId(), 'proof')).statusCode, state).toBe(204);
    }
  });

  it('lead 2026-11-12 (proof-upload review M4): no payment proof while the escrow is still securing; nothing is stored', async () => {
    const { buyer, code } = await tradeIn('securing');
    const id = newProofId();
    const res = await put(buyer, code, id, 'proof');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
    expect(await stored(id)).toBeUndefined();
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

  it('review M1: with no session the PUT is 401 before its body is read, even one over the size cap', async () => {
    const { code } = await tradeIn('secured');
    for (const n of [PROOF_MAX_CIPHERTEXT, PROOF_MAX_CIPHERTEXT + 1]) {
      const res = await app.inject({ method: 'PUT', url: url(code, newProofId(), 'proof'), headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' }, payload: body(n) });
      expect(res.statusCode, String(n)).toBe(401);
    }
  });

  it("review M2: an outsider's PUT never waits on (or locks) the trade's row: 404 at once, as for an unknown code", async () => {
    const { buyer, code } = await tradeIn('secured');
    const other = await trader();
    const lock = await deps.db.connect();
    try {
      await lock.query('begin');
      await lock.query('select 1 from trades where code = $1 for update', [code]);
      const res = await Promise.race([put(other, code, newProofId(), 'proof'), new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 3000))]);
      expect(res === 'blocked' ? 'blocked' : res.statusCode).toBe(404);
    } finally {
      await lock.query('rollback');
      lock.release();
    }
    // The party still gets through once the row is free.
    expect((await put(buyer, code, newProofId(), 'proof')).statusCode).toBe(204);
  });

  it('review M3: an id\'s one-time tag keeps the day it was used, not the time', async () => {
    const { rows: cols } = await deps.db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_name = 'proof_id_tags' order by ordinal_position`,
    );
    expect(cols).toEqual([
      { column_name: 'tag', data_type: 'bytea' },
      { column_name: 'used_on', data_type: 'date' },
    ]);
    const { buyer, code } = await tradeIn('secured');
    // The clock is START (2026-10-17T12:00Z): only its UTC day is kept.
    const id = newProofId();
    expect((await put(buyer, code, id, 'proof')).statusCode).toBe(204);
    const { rows } = await deps.db.query<{ d: string }>(
      `select to_char(used_on, 'YYYY-MM-DD') as d from proof_id_tags where tag = sha256(convert_to('x2f/proof-id/v1|' || $1::text, 'UTF8'))`,
      [id],
    );
    expect(rows).toEqual([{ d: '2026-10-17' }]);
  });

  it('lead 2026-11-12: a per-account budget on the PUT (429 slow-down), taken before the body is read; another account is not charged', async () => {
    const { PROOF_PUT_BUCKET } = await import('../src/limits.js');
    expect(PROOF_PUT_BUCKET.capacity).toBeGreaterThanOrEqual(2 * PROOF_MAX_PER_SIDE);
    const { buyer, seller, code } = await tradeIn('secured');
    // Every try counts, refused ones too (past the cap these are too-many-proofs).
    for (let i = 0; i < PROOF_PUT_BUCKET.capacity; i++) expect((await put(buyer, code, newProofId(), 'proof', body(64))).statusCode, `try ${i}`).not.toBe(429);
    const over = await put(buyer, code, newProofId(), 'proof', body(PROOF_MAX_CIPHERTEXT + 1));
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe('slow-down');
    expect((over.json() as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect((await put(seller, code, newProofId(), 'proof', body(64))).statusCode).toBe(403);
    // It refills with time.
    setNow(new Date(deps.clock().getTime() + Math.ceil(60_000 / PROOF_PUT_BUCKET.perMinute)));
    expect((await put(buyer, code, newProofId(), 'proof', body(64))).statusCode).not.toBe(429);
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

  it('review M4 (lead 2026-11-12): evidence has its own 5 per side, and an unblurred copy never counts', async () => {
    expect(EVIDENCE_MAX_PER_SIDE).toBe(5);
    const { buyer, code } = await tradeIn('paid');
    for (let i = 0; i < PROOF_MAX_PER_SIDE; i++) expect((await put(buyer, code, newProofId(), 'proof', body(64))).statusCode).toBe(204);
    await openDispute(code);
    for (let i = 0; i < EVIDENCE_MAX_PER_SIDE; i++) expect((await put(buyer, code, newProofId(), 'evidence', body(64))).statusCode, `evidence ${i}`).toBe(204);
    const sixth = await put(buyer, code, newProofId(), 'evidence', body(64));
    expect(sixth.statusCode).toBe(409);
    expect(errorOf(sixth)).toBe('too-many-proofs');
    expect(errorOf(await put(buyer, code, newProofId(), 'proof', body(64)))).toBe('too-many-proofs');
    // The moderator's request can always be answered.
    await requestUnblurred(code, 'buyer');
    expect((await put(buyer, code, newProofId(), 'unblurred', body(64))).statusCode).toBe(204);
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

  it('review M2: a dispute not yet committed makes the purge wait on the trade, and the proofs stay', async () => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, at(DAY)]);
    const dispute = await deps.db.connect();
    try {
      // As applyEvent does when a dispute opens: the trade's row lock, the state, then the dispute row.
      await dispute.query('begin');
      await dispute.query('select 1 from trades where code = $1 for update', [code]);
      await dispute.query(`update trades set state = 'disputed', closed_at = null where code = $1`, [code]);
      await dispute.query(
        `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents)
         values ($1, 1, 'system', 'escalated', $2, 'open', $2, $2, 0, 100000)`,
        [code, at(30 * DAY)],
      );
      const purge = purgeProofs(deps.db, at(40 * DAY));
      for (let i = 0; ; i++) {
        const { rows } = await deps.db.query(
          `select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for share%'`,
        );
        if (rows.length > 0) break;
        if (i > 200) throw new Error('the purge never waited on the trade lock');
        await new Promise((r) => setTimeout(r, 25));
      }
      await dispute.query('commit');
      expect(await purge).toBe(0);
    } finally {
      dispute.release();
    }
    expect(await stored(id)).toBeDefined();
  });

  // The rule says due, so only the delete's own checks can keep the proofs: one case per check, so
  // that removing either is caught by itself (review M2, as chat.test.ts M3 for the chat).
  it.each([
    ['a dispute row not yet closed, on a trade already closed', { state: 'released', closed: true, row: true }],
    ['a trade in dispute with no dispute row', { state: 'disputed', closed: false, row: false }],
  ])('the delete keeps proofs the rule calls due: %s', async (_name, c) => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    await deps.db.query(`update trades set state = $2, closed_at = $3 where code = $1`, [code, c.state, c.closed ? at(DAY) : null]);
    if (c.row) {
      await deps.db.query(
        `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents)
         values ($1, 1, 'system', 'escalated', $2, 'open', $2, $2, 0, 100000)`,
        [code, at(DAY)],
      );
    }
    const seen: string[] = [];
    const removed = await purgeProofs(deps.db, at(500 * DAY), (_facts, _now, rowCode) => {
      if (rowCode !== code) return false;
      seen.push(rowCode);
      return true;
    });
    expect(seen).toEqual([code]);
    expect(removed).toBe(0);
    expect(await stored(id)).toBeDefined();
  });

  it('an open trade keeps its proofs', async () => {
    const { buyer, code } = await tradeIn('paid');
    const id = newProofId();
    await put(buyer, code, id, 'proof');
    await purgeProofs(deps.db, at(1000 * DAY));
    expect(await stored(id)).toBeDefined();
  });
});
