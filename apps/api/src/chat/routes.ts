/**
 * Plan 3 Task 20: the encrypted chat's API. It stores ciphertext only and never decrypts.
 *
 * - `POST /v1/chats { offerId }` → 201 `{ chat, role }` (200 with the same chat when the caller
 *   already has an open one on the offer). The code comes from `newTradeCode`; the roles are fixed
 *   by the offer side (a 'sell' offer's poster is the seller, the taker the buyer).
 * - `POST /v1/trades/:code/chat` → `{ chat, role }`: the trade's chat for its buyer or seller. The
 *   chat a take linked, else the pair's open pre-trade chat on the offer (linked now: "a take
 *   reuses the chat"), else a new one linked to the trade. 404 for anyone else; 409
 *   `chat-unavailable` when the trade's offer is not in the offers table.
 * - `GET /v1/chats` → `{ chats: ChatSummary[] }`, the caller's chats, newest first.
 * - `GET /v1/chats/:chat` → `ChatView`.
 * - `POST /v1/chats/:chat/identity { signPublic, boxPublic, proof }` → 201: one per role, the role
 *   from the session, the proof over `chatIdentityProofBytes` (P3-I21).
 * - `GET /v1/chats/:chat/attestation` → 200 `{ attestation, sig }`, 202 pending, 409 refused.
 * - `POST /v1/chats/:chat/envelopes` (an `Envelope`, at most 16 KiB, 413 above) → 201 `{ id }`.
 *   `checkChatEnvelope(body, channelFor(chat, 'chat'), sessionRole)`; the stored `sender_role` is
 *   the session's role (Revision 2026-10-28). A seq not above that sender's last is 409 `stale-seq`.
 * - `GET /v1/chats/:chat/envelopes?after=<id>` → `{ envelopes: [{ id, senderRole, envelope, at }], more }`.
 *
 * Write budgets per account (review M7, limits.ts): a new pre-trade chat takes from
 * CHAT_OPEN_BUCKET (reopening one does not), a stored envelope from CHAT_POST_BUCKET; an empty
 * bucket is 429 `slow-down` with `retryAfterSeconds`, after the 404 and readiness checks.
 *
 * A stored envelope sends the live event `{ type: 'chat', chat }` to both traders' open streams
 * (Task 19's bus): a hint to re-read, carrying nothing but the chat code.
 *
 * Every chat route needs a trader session; a chat that does not exist or does not include the
 * caller is the same 404 `not-found`, except a chat purged under the caller: 410 `chat-purged`
 * (its member mark, kept CHAT_PURGED_MARK_DAYS), on which the device erases its copy (p11-10). Nothing here logs a chat code, a key or a ciphertext.
 *
 * Blocks (Task 37, traders/blocks.ts): while either trader has blocked the other, a chat between
 * them answers the same 404 on every route and leaves `GET /v1/chats`, and `POST /v1/chats`
 * answers 404 as for an unknown offer. The one exception is the chat of a trade still open
 * (`closed_at` null, as the nudge's `tradeSharedContext`): the trade must finish and a moderator
 * may need it, so it stays usable until the trade closes (lead decision 2026-10-29).
 */
import { newTradeCode, normalizeTradeCode } from '@x2f/core';
import { CHAT_BODY_MAX_BYTES, channelFor, chatIdentityProofValid, ChatEnvelopeError, checkChatEnvelope } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recoveryHoldHidesSql } from '../auth/holdSql.js';
import { ACTIVE_LIEN_SQL } from '../disputes/lien.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { purgedTagSql } from './retention.js';
import { MARKET_PRICED } from '../offers/routes.js';
import { assertNotBlocked, blockedEitherWaySql } from '../traders/blocks.js';
import { traderSummaries, type TraderSummary } from '../traders/summary.js';

const requireTrader = requireSession({ kinds: ['trader'] });

export type ChatRole = 'buyer' | 'seller';

export interface ChatView {
  chat: string;
  role: ChatRole;
  offerId: string;
  /** The other side, by display name only (never a login name, FU-A). */
  counterparty: TraderSummary | null;
  /** The trade a take linked to this chat, or null before a take. */
  tradeCode: string | null;
  /** A dispute is open on the linked trade: only then may the moderator post (spec 6.6). */
  disputeOpen: boolean;
  /**
   * When the linked trade's escrow was secured, or null (no trade, or not yet). Owner Q12 (J-08):
   * the seller's payment details reach the buyer only once the escrow is secured, so the trader
   * app shows a packaged-details message only from then on.
   */
  tradeSecuredAt: string | null;
  /** The moderation service's attestation is ready. */
  attested: boolean;
  /**
   * The signing key registered for the caller's own role, or null: a device that holds no chat
   * identity, or another key, knows the chat is open on another device (read-only).
   */
  mySignPublic: string | null;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface ChatSummary {
  chat: string;
  role: ChatRole;
  offerId: string;
  counterparty: string | null;
  lastMessageAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX_KEY = /^[0-9a-f]{64}$/;
const IDENTITY_KEYS = ['signPublic', 'boxPublic', 'proof'] as const;
const AFTER = /^(0|[1-9][0-9]{0,17})$/;
/** Envelopes per page. */
export const ENVELOPE_PAGE = 100;
/** Chats listed by GET /v1/chats. */
const CHAT_LIST_LIMIT = 200;

/**
 * An offer anyone may see (Task 4's LISTED): market-priced (an offer stored as fixed before the
 * owner's market-only rule is not found, offers/routes.ts MARKET_PRICED), live, and its poster
 * neither disabled nor on hold (a trading hold, an active lien or a recovery-code hold).
 */
const LISTED = `${MARKET_PRICED} and o.status = 'live' and a.kind = 'trader' and a.disabled_at is null
  and not exists (select 1 from trading_holds h where h.account_id = o.account_id and h.lifted_at is null)
  and not ${ACTIVE_LIEN_SQL('o.account_id')}
  and not ${recoveryHoldHidesSql('o.account_id')}`;

interface ChatRow {
  code: string;
  offer_id: string;
  buyer_account_id: string;
  seller_account_id: string;
  trade_code: string | null;
  created_at: Date;
  last_message_at: Date | null;
}

const notFound = (): ApiError => new ApiError(404, 'not-found');

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The chat and the caller's role in it, from the session alone. A malformed code, an unknown chat
 * and someone else's chat are the same 404.
 */
export async function roleInChat(db: Queryable, raw: string, accountId: string): Promise<{ row: ChatRow; role: ChatRole }> {
  const code = normalizeTradeCode(raw);
  if (code === null) throw notFound();
  const { rows } = await db.query<ChatRow>(
    'select code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at, last_message_at from chats where code = $1',
    [code],
  );
  const row = rows[0];
  if (!row) {
    // A chat purged under the caller (123's mark): 410, so the device erases its copy (p11-10).
    // Only a member's own session matches the tag; everyone else gets the same 404 as ever.
    if (UUID.test(accountId)) {
      const gone = await db.query(`select 1 from chat_purged_marks where tag = ${purgedTagSql('$1::text', '$2::uuid')}`, [code, accountId]);
      if (gone.rows.length > 0) throw new ApiError(410, 'chat-purged');
    }
    throw notFound();
  }
  const role: ChatRole | null = row.buyer_account_id === accountId ? 'buyer' : row.seller_account_id === accountId ? 'seller' : null;
  if (role === null) throw notFound();
  if (!(await tradeOpen(db, row.trade_code))) await assertNotBlocked(db, accountId, role === 'buyer' ? row.seller_account_id : row.buyer_account_id);
  return { row, role };
}

/** The linked trade has not closed: its chat stays usable under a block (Task 37). */
async function tradeOpen(db: Queryable, tradeCode: string | null): Promise<boolean> {
  if (tradeCode === null) return false;
  const { rows } = await db.query('select 1 from trades where code = $1 and closed_at is null', [tradeCode]);
  return rows.length > 0;
}

function identityBody(body: unknown): { signPublic: string; boxPublic: string; proof: string } {
  if (!isObject(body)) throw new ApiError(400, 'bad-request');
  const keys = Object.keys(body);
  if (keys.length !== IDENTITY_KEYS.length || !IDENTITY_KEYS.every((k) => keys.includes(k))) throw new ApiError(400, 'bad-request');
  const { signPublic, boxPublic, proof } = body;
  if (typeof signPublic !== 'string' || !HEX_KEY.test(signPublic)) throw new ApiError(400, 'bad-request');
  if (typeof boxPublic !== 'string' || !HEX_KEY.test(boxPublic)) throw new ApiError(400, 'bad-request');
  if (typeof proof !== 'string' || !/^[0-9a-f]{128}$/.test(proof)) throw new ApiError(400, 'bad-request');
  return { signPublic, boxPublic, proof };
}

/** Runs `fn` in a transaction with the chat row locked. */
async function locked<T>(req: FastifyRequest, chat: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await req.server.deps.db.connect();
  try {
    await client.query('begin');
    try {
      await client.query('select 1 from chats where code = $1 for update', [chat]);
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * Links an open pre-trade chat to the trade a take made from it ("a take reuses the chat"). Task 5's
 * take calls this in its own transaction; returns the chat code, or null when the pair had no chat.
 */
export async function linkChatToTrade(
  q: Queryable,
  t: { offerId: string; buyerAccountId: string; sellerAccountId: string; tradeCode: string },
): Promise<string | null> {
  const { rows } = await q.query<{ code: string }>(
    `update chats set trade_code = $4
      where offer_id = $1 and buyer_account_id = $2 and seller_account_id = $3 and trade_code is null
      returning code`,
    [t.offerId, t.buyerAccountId, t.sellerAccountId, t.tradeCode],
  );
  return rows[0]?.code ?? null;
}

/** Unique and foreign-key violations (Postgres SQLSTATE). */
const pgCode = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

export function chatRoutes(app: FastifyInstance): void {
  app.post('/v1/trades/:code/chat', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const code = normalizeTradeCode((req.params as { code: string }).code);
    if (code === null) throw notFound();
    const me = req.auth.accountId;
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      try {
        // The trade row is locked so two first opens (both sides at once) make one chat.
        const { rows } = await client.query<{ offer_id: string; buyer_account_id: string; seller_account_id: string; open: boolean }>(
          'select offer_id, buyer_account_id, seller_account_id, closed_at is null as open from trades where code = $1 for update',
          [code],
        );
        const t = rows[0];
        if (!t || (t.buyer_account_id !== me && t.seller_account_id !== me)) throw notFound();
        const role: ChatRole = t.buyer_account_id === me ? 'buyer' : 'seller';
        // A closed trade's chat is like any other under a block (Task 37).
        if (!t.open) await assertNotBlocked(client, me, role === 'buyer' ? t.seller_account_id : t.buyer_account_id);
        const linked = await client.query<{ code: string }>('select code from chats where trade_code = $1', [code]);
        let chat = linked.rows[0]?.code ?? null;
        chat ??= await linkChatToTrade(client, { offerId: t.offer_id, buyerAccountId: t.buyer_account_id, sellerAccountId: t.seller_account_id, tradeCode: code });
        if (chat === null) {
          chat = newTradeCode();
          try {
            await client.query(
              `insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)`,
              [chat, t.offer_id, t.buyer_account_id, t.seller_account_id, code, deps.clock()],
            );
          } catch (e) {
            // No offers row for the trade (only before Task 5's foreign key from trades to offers).
            if (pgCode(e) === '23503') throw new ApiError(409, 'chat-unavailable');
            throw e;
          }
        }
        await client.query('commit');
        return { chat, role };
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } finally {
      client.release();
    }
  });

  app.post('/v1/chats', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const body = req.body;
    if (!isObject(body) || Object.keys(body).length !== 1 || !('offerId' in body)) throw new ApiError(400, 'bad-request');
    const offerId = body.offerId;
    if (typeof offerId !== 'string' || !UUID.test(offerId)) throw notFound();
    const { rows } = await deps.db.query<{ account_id: string; side: 'sell' | 'buy' }>(
      `select o.account_id, o.side from offers o join accounts a on a.id = o.account_id where o.id = $1 and ${LISTED}`,
      [offerId],
    );
    const offer = rows[0];
    if (!offer) throw notFound();
    const me = req.auth.accountId;
    // Blocked either way: the same 404 as an unknown offer (Task 37), for a new chat or a reopened one.
    await assertNotBlocked(deps.db, me, offer.account_id);
    if (offer.account_id === me) throw new ApiError(409, 'own-offer');
    const role: ChatRole = offer.side === 'sell' ? 'buyer' : 'seller';
    const buyer = role === 'buyer' ? me : offer.account_id;
    const seller = role === 'seller' ? me : offer.account_id;
    const openChat = async (): Promise<string | null> => {
      const { rows: open } = await deps.db.query<{ code: string }>(
        'select code from chats where offer_id = $1 and buyer_account_id = $2 and seller_account_id = $3 and trade_code is null',
        [offerId, buyer, seller],
      );
      return open[0]?.code ?? null;
    };
    // Reopening the chat already open costs nothing; a new one takes from the caller's budget.
    const open = await openChat();
    if (open !== null) return reply.send({ chat: open, role });
    req.server.budgets.chatOpen.take(me);
    // One open chat per offer and pair (chats_open_pair): a racing second insert finds the first.
    const inserted = await deps.db.query<{ code: string }>(
      `insert into chats (code, offer_id, buyer_account_id, seller_account_id, created_at)
       values ($1, $2, $3, $4, $5)
       on conflict (offer_id, buyer_account_id, seller_account_id) where trade_code is null do nothing
       returning code`,
      [newTradeCode(), offerId, buyer, seller, deps.clock()],
    );
    if (inserted.rows[0]) return reply.code(201).send({ chat: inserted.rows[0].code, role });
    const existing = await openChat();
    if (existing === null) throw new ApiError(503, 'busy');
    return reply.send({ chat: existing, role });
  });

  app.get('/v1/chats', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const me = req.auth.accountId;
    const { rows } = await deps.db.query<ChatRow>(
      `select c.code, c.offer_id, c.buyer_account_id, c.seller_account_id, c.trade_code, c.created_at, c.last_message_at from chats c
        where (c.buyer_account_id = $1 or c.seller_account_id = $1)
          and (exists (select 1 from trades t where t.code = c.trade_code and t.closed_at is null)
               or not ${blockedEitherWaySql('c.buyer_account_id', 'c.seller_account_id')})
        order by coalesce(c.last_message_at, c.created_at) desc, c.code limit $2`,
      [me, CHAT_LIST_LIMIT],
    );
    const others = rows.map((r) => (r.buyer_account_id === me ? r.seller_account_id : r.buyer_account_id));
    const names = await traderSummaries(deps.db, others, deps.clock(), me);
    const chats: ChatSummary[] = rows.map((r, i) => ({
      chat: r.code,
      role: r.buyer_account_id === me ? 'buyer' : 'seller',
      offerId: r.offer_id,
      counterparty: names.get(others[i]!)?.displayName ?? null,
      lastMessageAt: r.last_message_at?.toISOString() ?? null,
    }));
    return { chats };
  });

  app.get('/v1/chats/:chat', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const other = role === 'buyer' ? row.seller_account_id : row.buyer_account_id;
    // Presence through the viewer-aware summary: hidden from a trader the other side blocked (review M5).
    const names = await traderSummaries(deps.db, [other], deps.clock(), req.auth.accountId);
    const facts = await deps.db.query<{ disputed: boolean; attested: boolean; mine: string | null; secured_at: Date | null }>(
      `select exists (select 1 from trades t where t.code = $2 and t.state = 'disputed') as disputed,
              exists (select 1 from chat_attestations a where a.chat = $1) as attested,
              (select sign_public from chat_identities i where i.chat = $1 and i.role = $3) as mine,
              (select t.secured_at from trades t where t.code = $2) as secured_at`,
      [row.code, row.trade_code, role],
    );
    const view: ChatView = {
      chat: row.code,
      role,
      offerId: row.offer_id,
      counterparty: names.get(other) ?? null,
      tradeCode: row.trade_code,
      disputeOpen: facts.rows[0]!.disputed,
      tradeSecuredAt: facts.rows[0]!.secured_at?.toISOString() ?? null,
      attested: facts.rows[0]!.attested,
      mySignPublic: facts.rows[0]!.mine,
      createdAt: row.created_at.toISOString(),
      lastMessageAt: row.last_message_at?.toISOString() ?? null,
    };
    return view;
  });

  app.post('/v1/chats/:chat/identity', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const keys = identityBody(req.body);
    if (!(await chatIdentityProofValid(row.code, role, keys))) throw new ApiError(400, 'bad-proof');
    await locked(req, row.code, async (q) => {
      const other = await q.query(
        'select 1 from chat_identities where chat = $1 and role <> $2 and (sign_public = $3 or box_public = $4)',
        [row.code, role, keys.signPublic, keys.boxPublic],
      );
      if (other.rows.length > 0) throw new ApiError(409, 'identity-conflict');
      const { rowCount } = await q.query(
        `insert into chat_identities (chat, role, sign_public, box_public, proof, created_at)
         values ($1, $2, $3, $4, $5, $6) on conflict (chat, role) do nothing`,
        [row.code, role, keys.signPublic, keys.boxPublic, keys.proof, deps.clock()],
      );
      if (rowCount === 0) throw new ApiError(409, 'identity-exists');
    });
    return reply.code(201).send({ ok: true, role });
  });

  app.get('/v1/chats/:chat/attestation', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const { row } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const { rows } = await deps.db.query<{ attestation: unknown; sig: string }>('select attestation, sig from chat_attestations where chat = $1', [row.code]);
    if (rows[0]) return reply.send({ attestation: rows[0].attestation, sig: rows[0].sig });
    const refused = await deps.db.query('select 1 from chat_refusals where chat = $1', [row.code]);
    if (refused.rows.length > 0) throw new ApiError(409, 'attestation-refused');
    return reply.code(202).send({ status: 'pending' });
  });

  app.post('/v1/chats/:chat/envelopes', { preHandler: requireTrader, bodyLimit: CHAT_BODY_MAX_BYTES }, async (req, reply) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const ready = await deps.db.query('select 1 from chat_attestations where chat = $1', [row.code]);
    if (ready.rows.length === 0) throw new ApiError(409, 'chat-not-ready');
    let env;
    try {
      env = checkChatEnvelope(req.body, await channelFor(row.code, 'chat'), role);
    } catch (e) {
      if (!(e instanceof ChatEnvelopeError)) throw e;
      if (e.code === 'too-large') throw new ApiError(413, 'bad-request');
      if (e.code === 'wrong-channel' || e.code === 'wrong-sender') throw new ApiError(400, e.code);
      throw new ApiError(400, 'bad-request');
    }
    // The budget is taken only for a well-formed envelope (round-2 review m5): a client bug's
    // malformed posts answer 400/413 and leave the sender's budget alone.
    req.server.budgets.chatPost.take(req.auth.accountId);
    const now = deps.clock();
    const id = await locked(req, row.code, async (q) => {
      const last = await q.query<{ seq: string | null }>(
        'select max(seq)::text as seq from chat_envelopes where chat = $1 and sender_role = $2',
        [row.code, role],
      );
      const top = last.rows[0]?.seq;
      if (top !== null && top !== undefined && BigInt(env.seq) <= BigInt(top)) throw new ApiError(409, 'stale-seq');
      const ins = await q.query<{ id: string }>(
        `insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ($1, $2, $3, $4, $5) returning id::text as id`,
        [row.code, role, env.seq, env, now],
      );
      await q.query('update chats set last_message_at = $2 where code = $1', [row.code, now]);
      return ins.rows[0]!.id;
    });
    for (const account of [row.buyer_account_id, row.seller_account_id]) req.server.events.publish(account, { type: 'chat', chat: row.code });
    return reply.code(201).send({ id });
  });

  app.get('/v1/chats/:chat/envelopes', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const { row } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const raw = (req.query as Record<string, unknown> | null)?.after;
    if (raw !== undefined && (typeof raw !== 'string' || !AFTER.test(raw))) throw new ApiError(400, 'bad-request');
    const after = raw ?? '0';
    const { rows } = await deps.db.query<{ id: string; sender_role: string; envelope: unknown; created_at: Date }>(
      `select id::text as id, sender_role, envelope, created_at from chat_envelopes where chat = $1 and id > $2 order by id limit $3`,
      [row.code, after, ENVELOPE_PAGE + 1],
    );
    const page = rows.slice(0, ENVELOPE_PAGE);
    return {
      envelopes: page.map((r) => ({ id: r.id, senderRole: r.sender_role, envelope: r.envelope, at: r.created_at.toISOString() })),
      more: rows.length > ENVELOPE_PAGE,
    };
  });
}
