/**
 * Plan 3 Task 20: the encrypted chat's API. It stores ciphertext only and never decrypts.
 *
 * - `POST /v1/chats { offerId }` → 201 `{ chat, role }` (200 with the same chat when the caller
 *   already has an open one on the offer). The code comes from `newTradeCode`; the roles are fixed
 *   by the offer side (a 'sell' offer's poster is the seller, the taker the buyer).
 * - `POST /v1/trades/:code/chat` → `{ chat, role }`: the trade's chat for its buyer or seller. The
 *   chat a take linked, else the pair's open pre-trade chat on the offer (linked now: "a take
 *   reuses the chat"), else a new one linked to the trade. 404 for anyone else; 409
 *   `chat-unavailable` when the trade's offer is not in the offers table; 409 `trade-closed` when a
 *   new one would be made for a trade in a terminal state (released, refunded, cancelled, lapsed:
 *   lead call 20 Nov). A chat the trade already has keeps opening after it closes.
 * - `GET /v1/chats` → `{ chats: ChatSummary[] }`, the caller's chats, newest first.
 * - `GET /v1/chats/:chat` → `ChatView`.
 * - `POST /v1/chats/:chat/identity { signPublic, boxPublic, proof }` → 201: one per role, the role
 *   from the session, the proof over `chatIdentityProofBytes` (P3-I21).
 * - `GET /v1/chats/:chat/attestation` → 200 `{ attestation, sig }`, 202 pending, 409 refused.
 * - `POST /v1/chats/:chat/envelopes` (an `Envelope`, at most 16 KiB, 413 above) → 201 `{ id }`.
 *   `checkChatEnvelope(body, channelFor(chat, 'chat'), sessionRole)`; the stored `sender_role` is
 *   the session's role (Revision 2026-10-28). A seq not above that sender's last is 409 `stale-seq`.
 * - `POST /v1/chats/:chat/key` (the creator's signed key record, design build task 4) → 201; once the
 *   chat is attested, by either trader for their own role (`by`), verified against the registered
 *   chat identities (400 `bad-key-record`). First writer wins: a second record is 409 `key-exists`
 *   and the device then reads the stored one. `GET /v1/chats/:chat/key` → `{ record }`, or 404 `no-key`.
 *   Once a chat has a key record it takes only envelope v2 (`checkChatEnvelopeV2`); before, only v1.
 *   One exception (decision 16, lead call 18 Nov): the side an open dispute's moderator asked for an
 *   unblurred proof may post exactly ONE v1 envelope per request (the moderator-only
 *   `proof.unblurred`, which the shared chat key cannot carry). The API cannot see a v1 envelope's
 *   type or recipients (both are sealed), so it checks what it can: an open dispute of the chat's
 *   trade whose request names the sender's side, and no v1 envelope from that side since the request.
 *   The API cannot open any wrap: it stores and serves them.
 * - `POST /v1/chats/:chat/grant` (build task 6): the counterparty's fallback grant to the moderator
 *   (chat/grants.ts); the chat view lists every grant and its acceptance (`grants`).
 * - `GET /v1/chats/:chat/envelopes?after=<id>` → `{ envelopes: [{ id, senderRole, to, envelope, at }], more }`:
 *   the shared envelopes (`to` null) and the caller's own private lane (`to` = its role), never the
 *   other trader's lane.
 * - Private moderator lanes (private-mod-chat-2026-11-27): `GET /v1/chats/:chat/lane` → `{ record }`,
 *   the moderator-signed lane record for the caller's own role, or 404 `no-lane`. A keyed chat also
 *   takes envelope v3 (`checkChatEnvelopeV3`) with `from` = `to` = the caller's role: 400
 *   `wrong-lane` for another lane; 409 `no-lane` before the lane is filed, `lane-closed` when the
 *   trade's latest dispute is closed (or there is none), `lane-not-open` until the moderator has
 *   written in that lane (D2). Seq is per lane; the live event goes to the caller only, and a lane
 *   message leaves `last_message_at` alone (the other trader's list shows it; D1).
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
import { isPlainObject, ProtocolError, verifyChatKeyRecord } from '@x2f/protocol';
import { CHAT_BODY_MAX_BYTES, channelFor, chatIdentityProofValid, ChatEnvelopeError, checkChatEnvelope, checkChatEnvelopeV2, checkChatEnvelopeV3 } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recoveryHoldHidesSql } from '../auth/holdSql.js';
import { banHidesSql } from '../banState.js';
import { LIEN_BLOCKS_SQL } from '../disputes/lien.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { purgedTagSql } from './retention.js';
import { chatGrants, chatNotice, fallbackGrant } from './grants.js';
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
   * Design build task 6: the trader grants of the chat key to the moderator, each signed grant with
   * the moderator's signed acceptance (null until moderation opened it). Every device verifies both.
   */
  grants: Array<{ grant: unknown; accepted: unknown | null }>;
  /**
   * Design build task 7 (T2): the moderator's signed dispute notice for the trade's current open
   * dispute, or null. A device grants on it only when it verifies AND `disputeOpen` is true.
   */
  notice: unknown | null;
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
  and not ${LIEN_BLOCKS_SQL('o.account_id')}
  and not ${recoveryHoldHidesSql('o.account_id')}
  and not ${banHidesSql('o.account_id')}`;

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
        const { rows } = await client.query<{ offer_id: string; buyer_account_id: string; seller_account_id: string; open: boolean; terminal: boolean }>(
          `select offer_id, buyer_account_id, seller_account_id, closed_at is null as open,
                  state in ('released', 'refunded', 'cancelled', 'lapsed') as terminal
             from trades where code = $1 for update`,
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
        // Lead call (20 Nov, review 2 of wip/lead-fix-chat-attest): a trade in a terminal state gets no
        // NEW chat. One it already has (linked above, or the pair's pre-trade chat) keeps opening: its
        // history, a dispute or appeal on it, ruling compliance and the purge all use it.
        if (chat === null && t.terminal) throw new ApiError(409, 'trade-closed');
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
      grants: await chatGrants(deps.db, row.code),
      notice: await chatNotice(deps.db, row.code, row.trade_code),
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
    // Design build task 4: a chat with a key record takes only envelope v2 (one ciphertext under its
    // key, nothing a sender can leave out for the moderator, R16); one without takes only v1.
    const keyed = (await deps.db.query('select 1 from chat_keys where chat = $1', [row.code])).rows.length > 0;
    // Decision 16: in a keyed chat, a v1 body is only ever the answer to a moderator's request (checked under the lock below).
    const v1InKeyed = keyed && isPlainObject(req.body) && req.body.v === 1;
    // Private lanes: in a keyed chat a v3 body is a private reply to the moderator, in the caller's own lane.
    const lane = keyed && isPlainObject(req.body) && req.body.v === 3 ? role : null;
    let env;
    try {
      const channel = await channelFor(row.code, 'chat');
      env = lane !== null ? checkChatEnvelopeV3(req.body, channel, role) : keyed && !v1InKeyed ? checkChatEnvelopeV2(req.body, channel, role) : checkChatEnvelope(req.body, channel, role);
    } catch (e) {
      if (!(e instanceof ChatEnvelopeError)) throw e;
      if (e.code === 'too-large') throw new ApiError(413, 'bad-request');
      if (e.code === 'wrong-channel' || e.code === 'wrong-sender' || e.code === 'wrong-lane') throw new ApiError(400, e.code);
      throw new ApiError(400, 'bad-request');
    }
    // The budget is taken only for a well-formed envelope (round-2 review m5): a client bug's
    // malformed posts answer 400/413 and leave the sender's budget alone.
    req.server.budgets.chatPost.take(req.auth.accountId);
    const id = await locked(req, row.code, async (q) => {
      // Re-review 5 m1: the post's time is taken under the chat row's lock, so the stored times follow
      // the lock order (decision 16's "no v1 since the request" compares them with proof_requested_at).
      const now = deps.clock();
      if (v1InKeyed) {
        // Decision 16: an open dispute of this chat's trade whose moderator asked THIS side, with no
        // v1 envelope from it since the request; otherwise refused as any v1 in a keyed chat (400).
        // Under the chat row's lock, so two posts can never both answer one request; before the seq
        // check (re-review 5 m2), so the loser of two racing posts is this 400 whatever their seqs.
        const asked = row.trade_code === null ? [] : (await q.query(
          `select 1 from disputes d
            where d.code = $1 and d.status <> 'closed' and d.proof_request_side = $2
              and not exists (select 1 from chat_envelopes e where e.chat = $3 and e.sender_role = $2
                                 and e.envelope->>'v' = '1' and e.created_at >= d.proof_requested_at)
            limit 1`,
          [row.trade_code, role, row.code],
        )).rows;
        if (asked.length === 0) throw new ApiError(400, 'bad-request');
      }
      if (lane !== null) {
        // Private lanes, under the chat row's lock: the lane is filed, the trade's latest dispute is
        // not closed, and the moderator has written in this lane (D2).
        if ((await q.query('select 1 from chat_private_lanes where chat = $1 and to_role = $2', [row.code, lane])).rows.length === 0) throw new ApiError(409, 'no-lane');
        const latest = row.trade_code === null ? undefined : (await q.query<{ status: string }>(
          'select status from disputes where code = $1 order by seq desc limit 1',
          [row.trade_code],
        )).rows[0];
        if (latest === undefined || latest.status === 'closed') throw new ApiError(409, 'lane-closed');
        const opened = await q.query("select 1 from chat_envelopes where chat = $1 and sender_role = 'mod' and to_role = $2 limit 1", [row.code, lane]);
        if (opened.rows.length === 0) throw new ApiError(409, 'lane-not-open');
      }
      // The seq is per lane: the shared chat (to_role null) and each private lane count apart.
      const last = await q.query<{ seq: string | null }>(
        'select max(seq)::text as seq from chat_envelopes where chat = $1 and sender_role = $2 and to_role is not distinct from $3',
        [row.code, role, lane],
      );
      const top = last.rows[0]?.seq;
      if (top !== null && top !== undefined && BigInt(env.seq) <= BigInt(top)) throw new ApiError(409, 'stale-seq');
      const ins = await q.query<{ id: string }>(
        `insert into chat_envelopes (chat, sender_role, to_role, seq, envelope, created_at) values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
        [row.code, role, lane, env.seq, env, now],
      );
      if (lane === null) await q.query('update chats set last_message_at = $2 where code = $1', [row.code, now]);
      return ins.rows[0]!.id;
    });
    // Review trades-list I1: a trade's chat is that trade's part for members' streams; an offer chat has none.
    const part = row.trade_code === null ? {} : { closed: !(await tradeOpen(req.server.deps.db, row.trade_code)) };
    // A private reply's hint goes to its sender only (the moderator side reads on refresh; D1).
    const told = lane === null ? [row.buyer_account_id, row.seller_account_id] : [role === 'buyer' ? row.buyer_account_id : row.seller_account_id];
    for (const account of told) req.server.events.publish(account, { type: 'chat', chat: row.code }, part);
    return reply.code(201).send({ id });
  });

  app.post('/v1/chats/:chat/key', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const ready = await deps.db.query('select 1 from chat_attestations where chat = $1', [row.code]);
    if (ready.rows.length === 0) throw new ApiError(409, 'chat-not-ready');
    const ids = await deps.db.query<{ role: 'buyer' | 'seller'; sign_public: string; box_public: string }>(
      'select role, sign_public, box_public from chat_identities where chat = $1',
      [row.code],
    );
    const participants: Partial<Record<'buyer' | 'seller', { signPublic: string; boxPublic: string }>> = {};
    for (const r of ids.rows) participants[r.role] = { signPublic: r.sign_public, boxPublic: r.box_public };
    let rec;
    try {
      rec = await verifyChatKeyRecord(req.body, { chat: await channelFor(row.code, 'chat'), participants });
    } catch (e) {
      if (e instanceof ProtocolError) throw new ApiError(400, 'bad-key-record');
      throw e;
    }
    if (rec.by !== role) throw new ApiError(400, 'bad-key-record');
    // Review F5: under the chat row's lock, which the dispute route takes (for share) before it
    // decides whether a grant is required, so a record never lands between that check and its commit.
    const { rowCount } = await locked(req, row.code, (q) => q.query(
      `insert into chat_keys (chat, tkh, created_by_role, wrap_buyer, wrap_seller, sig, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (chat) do nothing`,
      [row.code, rec.tkh, rec.by, rec.wrapBuyer, rec.wrapSeller, rec.sig, deps.clock()],
    ));
    if (rowCount === 0) throw new ApiError(409, 'key-exists');
    // Review lead-trades-list-2 n1: the linked trade's part, as the chat line's publish says it.
    const part = row.trade_code === null ? {} : { closed: !(await tradeOpen(deps.db, row.trade_code)) };
    for (const account of [row.buyer_account_id, row.seller_account_id]) req.server.events.publish(account, { type: 'chat', chat: row.code }, part);
    return reply.code(201).send({ ok: true });
  });

  // Design build task 6: the counterparty's fallback grant (chat/grants.ts).
  app.post('/v1/chats/:chat/grant', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    await locked(req, row.code, (q) => fallbackGrant(q, row.code, row.trade_code, role, req.body, deps.clock()));
    return reply.code(201).send({ ok: true });
  });

  app.get('/v1/chats/:chat/key', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const { row } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const { rows } = await deps.db.query<{ tkh: string; created_by_role: string; wrap_buyer: string; wrap_seller: string; sig: string }>(
      'select tkh, created_by_role, wrap_buyer, wrap_seller, sig from chat_keys where chat = $1',
      [row.code],
    );
    const k = rows[0];
    if (!k) throw new ApiError(404, 'no-key');
    return { record: { v: 1, chat: await channelFor(row.code, 'chat'), tkh: k.tkh, by: k.created_by_role, wrapBuyer: k.wrap_buyer, wrapSeller: k.wrap_seller, sig: k.sig } };
  });

  // Private lanes: the caller's own lane record (only that trader's chat identity opens its wrap).
  app.get('/v1/chats/:chat/lane', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const { rows } = await deps.db.query<{ record: unknown }>('select record from chat_private_lanes where chat = $1 and to_role = $2', [row.code, role]);
    if (!rows[0]) throw new ApiError(404, 'no-lane');
    return { record: rows[0].record };
  });

  app.get('/v1/chats/:chat/envelopes', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const { row, role } = await roleInChat(deps.db, (req.params as { chat: string }).chat, req.auth.accountId);
    const raw = (req.query as Record<string, unknown> | null)?.after;
    if (raw !== undefined && (typeof raw !== 'string' || !AFTER.test(raw))) throw new ApiError(400, 'bad-request');
    const after = raw ?? '0';
    // The shared chat and the caller's own private lane only, never the other trader's (D1).
    const { rows } = await deps.db.query<{ id: string; sender_role: string; to_role: ChatRole | null; envelope: unknown; created_at: Date }>(
      `select id::text as id, sender_role, to_role, envelope, created_at from chat_envelopes
        where chat = $1 and chat_envelopes.id > $2 and (to_role is null or to_role = $4) order by chat_envelopes.id limit $3`,
      [row.code, after, ENVELOPE_PAGE + 1, role],
    );
    const page = rows.slice(0, ENVELOPE_PAGE);
    return {
      envelopes: page.map((r) => ({ id: r.id, senderRole: r.sender_role, to: r.to_role, envelope: r.envelope, at: r.created_at.toISOString() })),
      more: rows.length > ENVELOPE_PAGE,
    };
  });
}
