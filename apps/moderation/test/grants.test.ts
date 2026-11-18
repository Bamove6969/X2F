// Design build task 6 (design-chat-membership-keys-2026-11-08 section 3, T1): moderation accepts a
// trader's dispute grant only when its own records agree: a chat it attested, a key record and a
// grant signed by the attested traders they name, the same tkh, and a wrap that opens with its
// sealed moderator identity to that key. Then it records the acceptance and reports it signed.
import { randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, makeChatGrant, makeChatKeyRecord, newChatKey, verifyGrantAccepted, type Identity, type Participants } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { grantPass } from '../src/grants.js';
import { saveChatIdentity } from '../src/keystore.js';
import type { ChatGrantItem, Link } from '../src/link.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const NOW = new Date('2026-11-18T12:00:00Z');
let db: pg.Pool;
let keystoreKey: Uint8Array;

beforeAll(async () => {
  const admin = inject('modPgUrl');
  const name = `x2f_mod_gr_${randomBytes(8).toString('hex')}`;
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

interface Case {
  chat: string;
  channel: string;
  ids: Record<'buyer' | 'seller' | 'mod', Identity>;
  participants: Participants;
  tk: Uint8Array;
  record: unknown;
}

async function attested(): Promise<Case> {
  const chat = newTradeCode();
  const channel = await channelFor(chat, 'chat');
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  await saveChatIdentity(db, keystoreKey, chat, ids.mod);
  await db.query('insert into signed_chats (chat, attestation, sig) values ($1, $2, $3)', [chat, { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: NOW.toISOString() }, 'aa']);
  const tk = await newChatKey();
  const record = await makeChatKeyRecord({ chat: channel, by: 'buyer', tk, me: ids.buyer, participants });
  return { chat, channel, ids, participants, tk, record };
}

const grant = (c: Case, o: { by?: 'buyer' | 'seller'; tk?: Uint8Array; me?: Identity } = {}) => {
  const by = o.by ?? 'buyer';
  return makeChatGrant({ chat: c.channel, by, tk: o.tk ?? c.tk, disputeAt: NOW.toISOString(), me: o.me ?? c.ids[by], participants: o.me ? { ...c.participants, [by]: { signPublic: o.me.signPublic, boxPublic: o.me.boxPublic } } : c.participants });
};

function fakeLink(items: () => ChatGrantItem[], status = 201): Link & { reports: unknown[] } {
  const reports: unknown[] = [];
  return {
    reports,
    pullChatGrants: async () => items(),
    postReport: async (r: unknown) => {
      reports.push(r);
      return status;
    },
  } as unknown as Link & { reports: unknown[] };
}

const run = async (link: Link, reasons: string[] = []) => grantPass({ link, db, keystoreKey, now: () => NOW, log: (e) => reasons.push(e.reason) });

describe('the grant pass', () => {
  it('accepts a good grant: records it and reports an acceptance the moderator identity signed for exactly that grant', async () => {
    const c = await attested();
    const g = await grant(c);
    const link = fakeLink(() => [{ chat: c.chat, grant: g, record: c.record }]);
    expect(await run(link)).toEqual([c.chat]);
    const report = link.reports[0] as { kind: string; chat: string; accepted: unknown };
    expect(report.kind).toBe('chat-grant-accepted');
    expect(report.chat).toBe(c.chat);
    const acc = await verifyGrantAccepted(report.accepted, { chat: c.channel, participants: c.participants });
    expect({ by: acc.grantBy, sig: acc.grantSig, tkh: acc.tkh }).toEqual({ by: 'buyer', sig: g.sig, tkh: g.tkh });
    const { rows } = await db.query('select grant_by, grant_sig, tkh from mod_chat_grants where chat = $1', [c.chat]);
    expect(rows).toEqual([{ grant_by: 'buyer', grant_sig: g.sig, tkh: g.tkh }]);
    // The key itself is stored nowhere in this database.
    const dump = JSON.stringify((await db.query('select * from mod_chat_grants')).rows);
    expect(dump).not.toContain(Buffer.from(c.tk).toString('hex'));
  });

  it('refuses a grant whose wrap is of another key (a cheater\'s garbage), signed by a stranger, of another tkh than the record, or for a chat it never attested; no acceptance is reported, only the refusal of that exact grant (review F2)', async () => {
    const c = await attested();
    const stranger = await generateIdentity();
    const otherTk = await newChatKey();
    const unattested = newTradeCode();
    const cases: Array<[string, ChatGrantItem, string]> = [
      ['wrong key, same claimed tkh', { chat: c.chat, grant: { ...(await grant(c, { tk: otherTk })), tkh: (await grant(c)).tkh }, record: c.record }, 'chat-grant-bad'],
      ['a grant of another key', { chat: c.chat, grant: await grant(c, { tk: otherTk }), record: c.record }, 'chat-grant-bad'],
      ['stranger', { chat: c.chat, grant: await grant(c, { me: stranger }), record: c.record }, 'chat-grant-bad'],
      ['unattested', { chat: unattested, grant: await grant(c), record: c.record }, 'chat-grant-unattested'],
      ['malformed chat', { chat: 'nope', grant: await grant(c), record: c.record }, 'bad-chat-grant'],
    ];
    for (const [why, item, reason] of cases) {
      const reasons: string[] = [];
      const link = fakeLink(() => [item]);
      expect(await run(link, reasons), why).toEqual([]);
      const g = item.grant as { by: string; sig: string };
      const want = { bad: 'bad', 'chat-grant-bad': 'bad', 'chat-grant-unattested': 'unattested' }[reason as 'chat-grant-bad' | 'chat-grant-unattested'];
      // A malformed chat names no chat to refuse in: nothing is reported at all.
      expect(link.reports, why).toEqual(reason === 'bad-chat-grant' ? [] : [{ kind: 'chat-grant-refused', chat: item.chat, grantBy: g.by, grantSig: g.sig, reason: want }]);
      expect(reasons, why).toContain(reason);
    }
    expect((await db.query('select 1 from mod_chat_grants where chat = $1', [c.chat])).rows).toEqual([]);
  });

  it('a wrap that does not open to the grant\'s tkh is not accepted (the counterparty then grants instead)', async () => {
    const c = await attested();
    const g = await grant(c);
    // A real grant signature over a wrap of garbage cannot be made without the trader's key, so
    // the mod identity is swapped instead: the wrap is not for this process's key.
    const c2 = { ...c, ids: { ...c.ids, mod: await generateIdentity() } };
    await db.query('delete from mod_chat_identities where chat = $1', [c.chat]);
    await saveChatIdentity(db, keystoreKey, c.chat, c2.ids.mod);
    const reasons: string[] = [];
    const link = fakeLink(() => [{ chat: c.chat, grant: g, record: c.record }]);
    expect(await run(link, reasons)).toEqual([]);
    expect(reasons).toContain('chat-grant-wrong-key');
  });

  it('the grant list unavailable is logged; an acceptance the API refuses is logged and not counted', async () => {
    const reasons: string[] = [];
    const down = { pullChatGrants: async () => { throw new Error('down'); } } as unknown as Link;
    expect(await run(down, reasons)).toEqual([]);
    expect(reasons).toEqual(['chat-grants-unavailable']);
    const c = await attested();
    const g = await grant(c);
    const refused = fakeLink(() => [{ chat: c.chat, grant: g, record: c.record }], 400);
    const r2: string[] = [];
    expect(await run(refused, r2)).toEqual([]);
    expect(r2).toContain('chat-grant-report-refused-400');
  });
});

describe('review fixes of tasks 3-6 (F2, F4)', () => {
  it('F2: 101 bad grants and then a good one in one list: each bad one is refused by name and the good one is accepted in the same pass', async () => {
    const c = await attested();
    const otherTk = await newChatKey();
    const items: ChatGrantItem[] = [];
    for (let i = 0; i < 101; i++) {
      const g = await grant(c, { tk: otherTk });
      items.push({ chat: c.chat, grant: { ...g, tkh: (await grant(c)).tkh }, record: c.record });
    }
    const good = await grant(c);
    items.push({ chat: c.chat, grant: good, record: c.record });
    const link = fakeLink(() => items);
    expect(await run(link)).toEqual([c.chat]);
    const kinds = (link.reports as Array<{ kind: string }>).map((r) => r.kind);
    expect(kinds.filter((k) => k === 'chat-grant-refused')).toHaveLength(101);
    expect(kinds.filter((k) => k === 'chat-grant-accepted')).toHaveLength(1);
  });

  it('F4: once a grant of one key is accepted for a chat, a grant of another key is refused (other-key), even with a matching record', async () => {
    const c = await attested();
    const first = await grant(c);
    expect(await run(fakeLink(() => [{ chat: c.chat, grant: first, record: c.record }]))).toEqual([c.chat]);
    const tk2 = await newChatKey();
    const record2 = await makeChatKeyRecord({ chat: c.channel, by: 'seller', tk: tk2, me: c.ids.seller, participants: c.participants });
    const second = await grant(c, { by: 'seller', tk: tk2 });
    const reasons: string[] = [];
    const link = fakeLink(() => [{ chat: c.chat, grant: second, record: record2 }]);
    expect(await run(link, reasons)).toEqual([]);
    expect(reasons).toContain('chat-grant-other-key');
    expect(link.reports).toEqual([{ kind: 'chat-grant-refused', chat: c.chat, grantBy: 'seller', grantSig: second.sig, reason: 'other-key' }]);
  });
});
