// Design build task 7 (design-chat-membership-keys-2026-11-08 section 3, T2): moderation signs a
// dispute notice with the chat's moderator identity only when its own records agree: a chat it
// attested, its own link of that chat to the trade, its own view of the trade disputed, no grant it
// accepted and no notice it already signed for that dispute; a trader-opened dispute waits for the
// disputer's own grant first.
import { randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, verifyDisputeNotice, type Participants } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { saveChatIdentity } from '../src/keystore.js';
import type { ChatNoticeCandidate, Link } from '../src/link.js';
import { NOTICE_AFTER_TRADER_MS, noticePass } from '../src/notices.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const NOW = new Date('2026-11-18T12:00:00Z');
let db: pg.Pool;
let keystoreKey: Uint8Array;

beforeAll(async () => {
  const admin = inject('modPgUrl');
  const name = `x2f_mod_nt_${randomBytes(8).toString('hex')}`;
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  try {
    await c.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await c.end();
  }
  db = new pg.Pool({ connectionString: `${admin}/${name}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
});
afterAll(async () => {
  await db.end();
});

async function attested(o: { link?: boolean; seen?: boolean } = {}) {
  const chat = newTradeCode();
  const trade = newTradeCode();
  const channel = await channelFor(chat, 'chat');
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  await saveChatIdentity(db, keystoreKey, chat, ids.mod);
  await db.query('insert into signed_chats (chat, attestation, sig) values ($1, $2, $3)', [chat, { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: NOW.toISOString() }, 'aa']);
  if (o.link !== false) await db.query('insert into mod_chat_trade (chat, trade, first_seen_at, last_seen_at) values ($1, $2, $3, $3)', [chat, trade, NOW]);
  if (o.seen !== false) await db.query('insert into mod_dispute_seen (trade, first_seen_at, last_seen_at) values ($1, $2, $2)', [trade, NOW]);
  return { chat, trade, channel, participants };
}

function fakeLink(items: () => ChatNoticeCandidate[], status = 201): Link & { reports: unknown[] } {
  const reports: unknown[] = [];
  return {
    reports,
    pullChatNotices: async () => items(),
    postReport: async (r: unknown) => {
      reports.push(r);
      return status;
    },
  } as unknown as Link & { reports: unknown[] };
}

const run = (link: Link, reasons: string[] = [], at = NOW) => noticePass({ link, db, keystoreKey, now: () => at, log: (e) => reasons.push(e.reason) });
const cand = (c: { chat: string; trade: string }, o: Partial<ChatNoticeCandidate> = {}): ChatNoticeCandidate => ({
  chat: c.chat, trade: c.trade, disputeSeq: 1, openedAt: new Date(NOW.getTime() - 1000).toISOString(), openedBy: 'system', ...o,
});

describe('the dispute notice pass (T2)', () => {
  it('signs a notice for a system dispute its own records show, once per dispute, verifiable against the attested moderator identity', async () => {
    const c = await attested();
    const link = fakeLink(() => [cand(c)]);
    expect(await run(link)).toEqual([c.chat]);
    const r = link.reports[0] as { kind: string; chat: string; notice: unknown };
    expect({ kind: r.kind, chat: r.chat }).toEqual({ kind: 'chat-dispute-notice', chat: c.chat });
    const n = await verifyDisputeNotice(r.notice, { chat: c.channel, participants: c.participants });
    expect({ seq: n.disputeSeq, by: n.openedBy, at: n.openedAt }).toEqual({ seq: 1, by: 'system', at: cand(c).openedAt });
    // The same dispute listed again: no second notice. A later dispute of the same chat: a new one.
    expect(await run(link)).toEqual([]);
    expect(link.reports).toHaveLength(1);
    expect(await run(fakeLink(() => [cand(c, { disputeSeq: 2 })]))).toEqual([c.chat]);
  });

  it('signs nothing when its own records disagree: unattested, linked to another trade, not seen disputed, a grant already accepted, or a malformed item', async () => {
    const unlinked = await attested({ link: false });
    const unseen = await attested({ seen: false });
    const granted = await attested();
    await db.query('insert into mod_chat_grants (chat, grant_by, grant_sig, tkh, accepted_at) values ($1, $2, $3, $4, $5)', [granted.chat, 'buyer', 'c'.repeat(128), 'd'.repeat(64), NOW]);
    const other = await attested();
    const cases: Array<[string, ChatNoticeCandidate, string | null]> = [
      ['unattested', cand({ chat: newTradeCode(), trade: other.trade }), 'chat-notice-unattested'],
      ['unlinked', cand(unlinked), 'chat-notice-unlinked'],
      ['another trade', cand({ chat: other.chat, trade: unseen.trade }), 'chat-notice-unlinked'],
      ['not seen disputed', cand(unseen), 'chat-notice-not-disputed'],
      ['granted', cand(granted), null],
      ['malformed', cand(other, { openedBy: 'mod' }), 'bad-chat-notice'],
      ['bad seq', cand(other, { disputeSeq: 0 }), 'bad-chat-notice'],
    ];
    for (const [why, item, reason] of cases) {
      const reasons: string[] = [];
      const link = fakeLink(() => [item]);
      expect(await run(link, reasons), why).toEqual([]);
      expect(link.reports, why).toEqual([]);
      if (reason !== null) expect(reasons, why).toContain(reason);
    }
  });

  it('a dispute a trader opened waits NOTICE_AFTER_TRADER_MS for the disputer\'s own grant first', async () => {
    const c = await attested();
    const item = cand(c, { openedBy: 'buyer', openedAt: NOW.toISOString() });
    const link = fakeLink(() => [item]);
    expect(await run(link, [], new Date(NOW.getTime() + NOTICE_AFTER_TRADER_MS - 1))).toEqual([]);
    expect(await run(link, [], new Date(NOW.getTime() + NOTICE_AFTER_TRADER_MS))).toEqual([c.chat]);
  });

  it('the candidate list unavailable is logged; a notice the API refuses is logged, not counted, and never signed again: the same notice is posted again', async () => {
    const reasons: string[] = [];
    expect(await run({ pullChatNotices: async () => { throw new Error('down'); } } as unknown as Link, reasons)).toEqual([]);
    expect(reasons).toEqual(['chat-notices-unavailable']);
    const c = await attested();
    const refused = fakeLink(() => [cand(c)], 409);
    const r2: string[] = [];
    expect(await run(refused, r2)).toEqual([]);
    expect(r2).toContain('chat-notice-report-refused-409');
    // Review N3: while the API still lists it and it was never stored, the SAME signed notice goes again.
    expect(await run(refused)).toEqual([]);
    expect(refused.reports).toHaveLength(2);
    expect(refused.reports[1]).toEqual(refused.reports[0]);
  });

  it('review N3: a post that fails (a throw, then a 503) is posted again, identical, on the next passes until the API answers 201; then never again', async () => {
    const c = await attested();
    const reports: unknown[] = [];
    const answers: Array<number | 'throw'> = ['throw', 503, 201];
    const link = {
      pullChatNotices: async () => [cand(c)],
      postReport: async (r: unknown) => {
        reports.push(r);
        const a = answers.shift() ?? 201;
        if (a === 'throw') throw new Error('network');
        return a;
      },
    } as unknown as Link;
    const reasons: string[] = [];
    expect(await run(link, reasons)).toEqual([]);
    expect(reasons).toContain('chat-notice-failed');
    expect(await run(link)).toEqual([]);
    expect(await run(link)).toEqual([c.chat]);
    expect(reports).toHaveLength(3);
    expect(reports[1]).toEqual(reports[0]);
    expect(reports[2]).toEqual(reports[0]);
    // The notice read back from the record still verifies (jsonb keeps what is signed).
    await expect(verifyDisputeNotice((reports[2] as { notice: unknown }).notice, { chat: c.channel, participants: c.participants })).resolves.toBeDefined();
    // Stored once, with the notice and when the API took it.
    const { rows } = await db.query<{ notice: unknown; posted_at: Date | null }>('select notice, posted_at from mod_chat_notices where chat = $1', [c.chat]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notice).toEqual((reports[0] as { notice: unknown }).notice);
    expect(rows[0]!.posted_at).toEqual(NOW);
    // Posted: listed again (an API that lost it, say), nothing more is posted or signed.
    expect(await run(link)).toEqual([]);
    expect(reports).toHaveLength(3);
  });
});
