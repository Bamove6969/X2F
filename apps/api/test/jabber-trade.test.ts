// Lead default for p11-16 (design's suggestion; the owner called such notices "Jabber worthy" in
// p11-4): when a dispute is opened on a trade by the other side or by X2F, the payer (the buyer)
// gets one Jabber notice, behind the same opt-in as the account-change notices (migration 331),
// saying only that a trade needs attention. One path for both kinds: jabber_outbox.kind (332).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { sealJid } from '../src/jabber/address.js';
import { queueTradeAttention, sendDueNotices } from '../src/jabber/outbox.js';
import { ACCOUNT_CHANGE_TEXT, NOTICE_KINDS, TRADE_ATTENTION_TEXT, messageText, type JabberMessage, type JabberSender } from '../src/jabber/sender.js';
import { applyEvent } from '../src/trades/store.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

const sent: Array<{ to: string; message: JabberMessage }> = [];
const fake: JabberSender = {
  async send(to, message) {
    sent.push({ to, message });
  },
};

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { jabberSender: fake }));
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  sent.length = 0;
});

/** Turns Jabber alerts on for the account with a proven address (as the set-up routes leave it). */
async function jabberOn(accountId: string): Promise<string> {
  const jid = `trade-user${++n}@xmpp.example.org`;
  await deps.db.query('insert into jabber_contacts (account_id, jid_sealed, verified_at, enabled) values ($1, $2, $3, true)', [
    accountId, sealJid(deps.config.jabberKeys!, accountId, jid), deps.clock(),
  ]);
  return jid;
}

const kinds = async (accountId: string) =>
  (await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1 order by id', [accountId])).rows.map((r) => r.kind);
const sendAll = () => sendDueNotices({ db: deps.db, clock: deps.clock, config: deps.config, sender: fake });

async function securedTrade() {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'secured');
  return { seller, buyer, t };
}

describe('the notice kinds', () => {
  it('are one small enum, each one fixed sentence with no trade detail', () => {
    expect(NOTICE_KINDS).toEqual(['account-change', 'trade-attention']);
    expect(messageText({ kind: 'trade-attention' })).toBe(TRADE_ATTENTION_TEXT);
    expect(TRADE_ATTENTION_TEXT).toBe('A trade on your X2F account needs your attention.');
    expect(messageText({ kind: 'account-change' })).toBe(ACCOUNT_CHANGE_TEXT);
    expect(() => messageText({ kind: 'trade-details' } as unknown as JabberMessage)).toThrow();
  });

  it('the database takes only those kinds', async () => {
    const t = await trader();
    await expect(
      deps.db.query("insert into jabber_outbox (account_id, jid_sealed, txid, kind) values ($1, '\\x00', 1, 'trade-details')", [t.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('a dispute queues the payer a trade-attention notice', () => {
  it("the seller's dispute before I've paid: the buyer with Jabber on gets one, sent as that kind; the seller gets none", async () => {
    const { seller, buyer, t } = await securedTrade();
    const jid = await jabberOn(buyer.id);
    await jabberOn(seller.id);
    expect((await seller.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'other', note: '' })).statusCode).toBe(200);
    // Exactly one trade notice (the dispute may also queue account-change notices, e.g. for a trading hold).
    expect((await kinds(buyer.id)).filter((k) => k === 'trade-attention')).toHaveLength(1);
    expect(await kinds(seller.id)).not.toContain('trade-attention');
    await sendAll();
    expect(sent).toContainEqual({ to: jid, message: { kind: 'trade-attention' } });
    expect(await kinds(buyer.id)).toEqual([]);
  });

  it('no Jabber alerts (or alerts switched off): nothing is queued, and the dispute still opens', async () => {
    const { seller, buyer, t } = await securedTrade();
    expect((await seller.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'other', note: '' })).statusCode).toBe(200);
    expect(await kinds(buyer.id)).not.toContain('trade-attention');

    const b = await securedTrade();
    await jabberOn(b.buyer.id);
    await deps.db.query('update jabber_contacts set enabled = false where account_id = $1', [b.buyer.id]);
    await deps.db.query('delete from jabber_outbox where account_id = $1', [b.buyer.id]);
    expect((await b.seller.browser.post(`/v1/trades/${b.t.code}/dispute`, { reason: 'other', note: '' })).statusCode).toBe(200);
    expect(await kinds(b.buyer.id)).not.toContain('trade-attention');
  });

  it("the buyer's own dispute queues them nothing", async () => {
    const { buyer, t } = await securedTrade();
    await jabberOn(buyer.id);
    await applyEvent(deps, t.code, { type: 'mark-paid', fiatCents: t.fiatCents }, 'buyer');
    const until = (await deps.db.query<{ c: Date }>('select confirm_by as c from trades where code = $1', [t.code])).rows[0]!.c;
    await deps.db.query('update trades set confirm_by = $2 where code = $1', [t.code, new Date(until.getTime() - 10 * 86_400_000)]);
    const res = await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await kinds(buyer.id)).not.toContain('trade-attention');
  });

  it("X2F's own escalation (a system dispute) queues the buyer one too", async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'settling');
    await jabberOn(buyer.id);
    const next = await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    expect(next.state).toBe('disputed');
    expect((await kinds(buyer.id)).filter((k) => k === 'trade-attention')).toHaveLength(1);
  });

  it('a rollback queues nothing (the notice is written in the dispute transaction)', async () => {
    const t = await trader();
    await jabberOn(t.id);
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await queueTradeAttention(c, t.id);
      await c.query('rollback');
    } finally {
      c.release();
    }
    expect(await kinds(t.id)).toEqual([]);
  });
});
