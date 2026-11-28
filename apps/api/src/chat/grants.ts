/**
 * Design build task 6 (design-chat-membership-keys-2026-11-08 section 3, T1): a trader's dispute grant
 * to the moderation service. The API is the courier: it checks the grant's signature against the
 * chat's registered (attested) identity of the side that sent it, that it is for this chat's channel,
 * that its `tkh` is the chat key record's, and that its signed `disputeAt` is near the server's time.
 * It cannot open the wrap, and it never can: only the chat's moderator identity does.
 *
 * - With the dispute (`POST /v1/trades/:code/dispute`, `grant`): required once the trade's chat has a
 *   key record (400 `grant-required`), refused when it has none (400 `bad-request`), stored in the
 *   same transaction as the dispute.
 * - The counterparty's fallback (`POST /v1/chats/:chat/grant`): only while the linked trade is
 *   disputed, only when the other side's grant is stored and not accepted, and only once per side
 *   (409 `grant-not-needed` otherwise). It is T1 by proxy: the counterparty's app acts only on a
 *   grant the disputer's own key signed, which the API cannot forge.
 * - Build task 7 (T2): the moderation service's signed dispute notice, for a dispute no trader's own
 *   grant reached it through. Moderation pulls the keyed chats of disputed trades with no accepted
 *   grant and no notice for the current dispute (`/internal/v1/chat-notices`) and reports the
 *   notice it signed (`chat-dispute-notice`), stored only when it verifies against the attested
 *   moderator identity and names the trade's current, open dispute exactly. With a stored notice
 *   and no accepted grant, either trader's device may grant (`POST /v1/chats/:chat/grant`, trigger
 *   `notice`), once per side.
 * - The moderation service pulls unaccepted grants (`/internal/v1/chat-grants`) with the key record,
 *   opens each wrap, checks it against the record's tkh, and reports a signed `chat-grant-accepted`,
 *   which is stored only when it verifies against the attested moderator identity.
 */
import { ProtocolError, verifyChatGrant, verifyDisputeNotice, verifyGrantAccepted, type ChatGrant, type DisputeNotice, type GrantAccepted } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/**
 * How far a grant's signed `disputeAt` may be from the server's clock (device clocks drift): at most
 * 10 minutes in the past and, review F6, at most 1 minute in the future, so a disputer cannot date a
 * grant ahead to stretch the counterparty's fallback wait.
 */
export const GRANT_SKEW_MS = 10 * 60_000;
export const GRANT_AHEAD_MS = 60_000;

interface Keyed {
  chat: string;
  channel: string;
  tkh: string;
  modBox: string;
  participants: Record<'buyer' | 'seller', { signPublic: string; boxPublic: string }>;
}

/** The chat's key and attested identities, or null when it has no key record. */
async function keyedChat(q: Queryable, chat: string): Promise<Keyed | null> {
  const k = await q.query<{ tkh: string; attestation: { participants?: { mod?: { boxPublic?: unknown } } } | null }>(
    'select k.tkh, a.attestation from chat_keys k left join chat_attestations a on a.chat = k.chat where k.chat = $1',
    [chat],
  );
  const row = k.rows[0];
  if (!row) return null;
  const modBox = row.attestation?.participants?.mod?.boxPublic;
  if (typeof modBox !== 'string') return null;
  const ids = await q.query<{ role: 'buyer' | 'seller'; sign_public: string; box_public: string }>('select role, sign_public, box_public from chat_identities where chat = $1', [chat]);
  const participants = {} as Keyed['participants'];
  for (const r of ids.rows) participants[r.role] = { signPublic: r.sign_public, boxPublic: r.box_public };
  return { chat, channel: await channelFor(chat, 'chat'), tkh: row.tkh, modBox, participants };
}

/** Verifies a grant from `side` for this keyed chat, or throws 400 `bad-grant`. */
async function checkedGrant(k: Keyed, side: 'buyer' | 'seller', raw: unknown, now: Date): Promise<ChatGrant> {
  let g: ChatGrant;
  try {
    g = await verifyChatGrant(raw, { chat: k.channel, participants: k.participants });
  } catch (e) {
    if (e instanceof ProtocolError) throw new ApiError(400, 'bad-grant');
    throw e;
  }
  const ahead = Date.parse(g.disputeAt) - now.getTime();
  if (g.by !== side || g.tkh !== k.tkh || ahead < -GRANT_SKEW_MS || ahead > GRANT_AHEAD_MS) throw new ApiError(400, 'bad-grant');
  return g;
}

async function storeGrant(q: Queryable, k: Keyed, g: ChatGrant, now: Date, trigger: 'dispute' | 'notice' = 'dispute'): Promise<boolean> {
  const { rowCount } = await q.query(
    `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig, grant_at, statement)
     values ($1, 'mod', 'mod', $2, $3, $4, $10, $5, $6, $7, $8, $9)
     on conflict (chat, member_ref, granted_by) where removed_at is null do nothing`,
    [k.chat, k.modBox, g.wrap, g.tkh, g.by, now, g.sig, g.disputeAt, g, trigger],
  );
  return rowCount === 1;
}

/**
 * For the dispute route: checks the grant for the trade's chat before the dispute opens. Null when
 * the trade has no keyed chat (and no grant was sent); otherwise a function that stores it in the
 * dispute's own transaction.
 */
export async function disputeGrant(q: Queryable, tradeCode: string, side: 'buyer' | 'seller', raw: unknown, now: Date): Promise<((c: Queryable) => Promise<void>) | null> {
  const chat = (await q.query<{ code: string }>('select code from chats where trade_code = $1', [tradeCode])).rows[0]?.code;
  const k = chat === undefined ? null : await keyedChat(q, chat);
  if (k === null) {
    if (raw !== undefined) throw new ApiError(400, 'bad-request');
    return null;
  }
  if (raw === undefined) throw new ApiError(400, 'grant-required');
  const g = await checkedGrant(k, side, raw, now);
  return async (c) => {
    await storeGrant(c, k, g, now);
  };
}

/** SQL over a trade code expression: the trade is disputed or still has an open dispute (matches retention.ts). */
export const IN_DISPUTE_SQL = (code: string) =>
  `(exists (select 1 from trades t where t.code = ${code} and t.state = 'disputed') or exists (select 1 from disputes d where d.code = ${code} and d.status <> 'closed'))`;

async function inDispute(q: Queryable, tradeCode: string | null): Promise<boolean> {
  if (tradeCode === null) return false;
  return (await q.query<{ ok: boolean }>(`select ${IN_DISPUTE_SQL('$1')} as ok`, [tradeCode])).rows[0]?.ok === true;
}

/**
 * The fallback grant: the counterparty's (T1 by proxy: the other side's grant is stored and not
 * accepted), or either side's on a stored dispute notice for the trade's current dispute while no
 * grant is accepted (T2, build task 7). Only while the trade is disputed or a dispute is open, once per side.
 */
export async function fallbackGrant(q: Queryable, chat: string, tradeCode: string | null, side: 'buyer' | 'seller', raw: unknown, now: Date): Promise<void> {
  const disputed = await inDispute(q, tradeCode);
  const k = await keyedChat(q, chat);
  if (!disputed || k === null) throw new ApiError(409, 'grant-not-needed');
  const g = await checkedGrant(k, side, raw, now);
  const other = side === 'buyer' ? 'seller' : 'buyer';
  const { rows } = await q.query<{ granted_by: string; accepted: unknown }>(
    `select granted_by, accepted from chat_members where chat = $1 and member_kind = 'mod' and removed_at is null`,
    [chat],
  );
  const theirs = rows.find((r) => r.granted_by === other);
  const byProxy = theirs !== undefined && theirs.accepted === null;
  const byNotice = !rows.some((r) => r.accepted !== null) && (await chatNotice(q, chat, tradeCode)) !== null;
  if (rows.some((r) => r.granted_by === side) || !(byProxy || byNotice)) throw new ApiError(409, 'grant-not-needed');
  if (!(await storeGrant(q, k, g, now, byProxy ? 'dispute' : 'notice'))) throw new ApiError(409, 'grant-not-needed');
}

/** The trade's current, open dispute: its seq, when and by whom it opened; null when none or closed. */
async function currentDispute(q: Queryable, tradeCode: string): Promise<{ seq: number; openedAt: Date; openedBy: string } | null> {
  const { rows } = await q.query<{ seq: number; status: string; opened_at: Date; opened_by: string }>(
    'select seq, status, opened_at, opened_by from disputes where code = $1 order by seq desc limit 1',
    [tradeCode],
  );
  const d = rows[0];
  return d === undefined || d.status === 'closed' ? null : { seq: d.seq, openedAt: d.opened_at, openedBy: d.opened_by };
}

/** Build task 7: the stored dispute notice for the trade's current open dispute, exactly as signed, or null. */
export async function chatNotice(q: Queryable, chat: string, tradeCode: string | null): Promise<unknown | null> {
  if (tradeCode === null) return null;
  const d = await currentDispute(q, tradeCode);
  if (d === null) return null;
  const { rows } = await q.query<{ notice: unknown }>('select notice from chat_dispute_notices where chat = $1 and dispute_seq = $2', [chat, d.seq]);
  return rows[0]?.notice ?? null;
}

/**
 * For moderation (build task 7): keyed chats whose current dispute is not closed, with no accepted
 * grant and no notice for that dispute yet. Every value is the API's word; moderation signs a
 * notice only when its own records agree.
 */
export async function noticeCandidates(q: Queryable, limit: number): Promise<Array<{ chat: string; trade: string; disputeSeq: number; openedAt: string; openedBy: string }>> {
  const { rows } = await q.query<{ chat: string; trade: string; seq: number; opened_at: Date; opened_by: string }>(
    `select c.code as chat, c.trade_code as trade, d.seq, d.opened_at, d.opened_by
       from chats c
       join chat_keys k on k.chat = c.code
       join lateral (select seq, status, opened_at, opened_by from disputes where code = c.trade_code order by seq desc limit 1) d on d.status <> 'closed'
      where not exists (select 1 from chat_members m where m.chat = c.code and m.member_kind = 'mod' and m.removed_at is null and m.accepted is not null)
        and not exists (select 1 from chat_dispute_notices n where n.chat = c.code and n.dispute_seq = d.seq)
      order by d.opened_at, c.code
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ chat: r.chat, trade: r.trade, disputeSeq: r.seq, openedAt: r.opened_at.toISOString(), openedBy: r.opened_by }));
}

/**
 * Stores moderation's dispute notice (build task 7) once it verifies against the chat's attested
 * moderator identity, for this chat's channel, and names the linked trade's current open dispute
 * exactly (its seq, opening time and opener; else 'not-disputed'). A repeat is 'ok'.
 */
export async function storeNotice(q: Queryable, chat: string, raw: unknown, now: Date): Promise<'ok' | 'bad' | 'unknown' | 'not-disputed'> {
  const a = await q.query<{ attestation: { participants?: { mod?: { signPublic: string; boxPublic: string } } }; trade_code: string | null }>(
    'select a.attestation, c.trade_code from chats c join chat_attestations a on a.chat = c.code where c.code = $1',
    [chat],
  );
  const row = a.rows[0];
  const mod = row?.attestation?.participants?.mod;
  if (row === undefined || mod === undefined) return 'unknown';
  let n: DisputeNotice;
  try {
    n = await verifyDisputeNotice(raw, { chat: await channelFor(chat, 'chat'), participants: { mod } });
  } catch (e) {
    if (e instanceof ProtocolError) return 'bad';
    throw e;
  }
  const d = row.trade_code === null ? null : await currentDispute(q, row.trade_code);
  if (d === null || d.seq !== n.disputeSeq || d.openedBy !== n.openedBy || d.openedAt.getTime() !== Date.parse(n.openedAt)) return 'not-disputed';
  await q.query('insert into chat_dispute_notices (chat, dispute_seq, notice, received_at) values ($1, $2, $3, $4) on conflict do nothing', [chat, n.disputeSeq, n, now]);
  return 'ok';
}

/** The grants of a chat as its traders see them: each signed grant and its acceptance, if any. */
export async function chatGrants(q: Queryable, chat: string): Promise<Array<{ grant: unknown; accepted: unknown | null }>> {
  const { rows } = await q.query<{ statement: unknown; accepted: unknown | null }>(
    `select statement, accepted from chat_members where chat = $1 and member_kind = 'mod' and removed_at is null order by id`,
    [chat],
  );
  return rows.map((r) => ({ grant: r.statement, accepted: r.accepted }));
}

/** For moderation: unaccepted grants with their chat's key record. */
export async function pendingGrants(q: Queryable, limit: number): Promise<Array<{ chat: string; grant: unknown; record: unknown }>> {
  const { rows } = await q.query<{ chat: string; statement: unknown; tkh: string; created_by_role: string; wrap_buyer: string; wrap_seller: string; sig: string }>(
    `select m.chat, m.statement, k.tkh, k.created_by_role, k.wrap_buyer, k.wrap_seller, k.sig
       from chat_members m join chat_keys k on k.chat = m.chat
      where m.member_kind = 'mod' and m.removed_at is null and m.accepted is null and m.refused_at is null
      order by m.id limit $1`,
    [limit],
  );
  const out = [];
  for (const r of rows) {
    out.push({
      chat: r.chat,
      grant: r.statement,
      record: { v: 1, chat: await channelFor(r.chat, 'chat'), tkh: r.tkh, by: r.created_by_role, wrapBuyer: r.wrap_buyer, wrapSeller: r.wrap_seller, sig: r.sig },
    });
  }
  return out;
}

/** Review F2: why moderation refused a grant (its log reasons). */
export const GRANT_REFUSALS = ['bad', 'wrong-key', 'unattested', 'other-key'] as const;

/**
 * Review F2: marks one grant refused, from moderation's signed report naming it exactly (chat, the
 * granting side and the grant's signature), only while it is neither accepted nor already refused;
 * a repeat for the same refused grant is 'ok', anything else 'unknown'.
 */
export async function refuseGrant(q: Queryable, chat: string, grantBy: unknown, grantSig: unknown, reason: unknown, now: Date): Promise<'ok' | 'bad' | 'unknown'> {
  if ((grantBy !== 'buyer' && grantBy !== 'seller') || typeof grantSig !== 'string' || !/^[0-9a-f]{128}$/.test(grantSig) || !(GRANT_REFUSALS as readonly unknown[]).includes(reason)) return 'bad';
  const { rowCount } = await q.query(
    `update chat_members set refused_at = $4, refused_reason = $5
      where chat = $1 and member_kind = 'mod' and removed_at is null and granted_by = $2 and sig = $3 and accepted is null and refused_at is null`,
    [chat, grantBy, grantSig, now, reason],
  );
  if (rowCount === 1) return 'ok';
  const same = await q.query("select 1 from chat_members where chat = $1 and member_kind = 'mod' and granted_by = $2 and sig = $3 and refused_at is not null", [chat, grantBy, grantSig]);
  return same.rows.length > 0 ? 'ok' : 'unknown';
}

/** Stores moderation's acceptance once it verifies against the attested moderator identity and names a stored grant. */
export async function acceptGrant(q: Queryable, chat: string, raw: unknown, now: Date): Promise<'ok' | 'bad' | 'unknown'> {
  const a = await q.query<{ attestation: { participants?: { mod?: { signPublic: string; boxPublic: string } } } }>('select attestation from chat_attestations where chat = $1', [chat]);
  const mod = a.rows[0]?.attestation?.participants?.mod;
  if (mod === undefined) return 'unknown';
  let acc: GrantAccepted;
  try {
    acc = await verifyGrantAccepted(raw, { chat: await channelFor(chat, 'chat'), participants: { mod } });
  } catch (e) {
    if (e instanceof ProtocolError) return 'bad';
    throw e;
  }
  const { rowCount } = await q.query(
    `update chat_members set accepted = $4, accepted_at = $5
      where chat = $1 and member_kind = 'mod' and removed_at is null and granted_by = $2 and sig = $3 and tkh = $6 and accepted is null`,
    [chat, acc.grantBy, acc.grantSig, acc, now, acc.tkh],
  );
  if (rowCount === 1) return 'ok';
  const same = await q.query('select 1 from chat_members where chat = $1 and member_kind = $2 and granted_by = $3 and sig = $4 and accepted is not null', [chat, 'mod', acc.grantBy, acc.grantSig]);
  return same.rows.length > 0 ? 'ok' : 'unknown';
}
