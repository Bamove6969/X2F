import { createHash } from 'node:crypto';
import { normalizeTradeCode } from '@x2f/core';
import {
  attestationBytes,
  channelFor,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  isAttestedTerms,
  SETTLE_KINDS,
  settleKindFor,
  TradeRuleError,
  type Attestation,
  type AttestedTerms,
  type SettleKind,
  type TradeEvent,
  type TradeState,
} from '@x2f/trade';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { ApiError } from '../errors.js';
import { applyEvent, loadTrade, type TradePublisher } from '../trades/store.js';

/**
 * The API's private internal listener: a SEPARATE Fastify instance, bound to a private interface
 * only, serving only `/internal/v1/*`. The moderation service pulls work and posts reports here,
 * every request signed with the moderation key; this listener verifies them with
 * `MOD_SIGNING_PUBLIC` and holds NO other secret. It never reaches the escrow or moderation keys.
 */
export interface InternalOptions {
  db: pg.Pool;
  /** The moderation service's Ed25519 signing key (hex). The only secret-ish value here, and it is public. */
  modSigningPublic: string;
  /** Clock for the freshness check and work rotation; tests pass a fixed one. */
  now?: () => number;
  /** Most trades served per work pull. Default 100; tests lower it. */
  workLimit?: number;
  /** The server clock trade events are applied with (Task 9 reports). Default: `now` as a Date. */
  clock?: () => Date;
  /** Delivery of a trade event the watcher's report committed (main.ts passes Task 19's publisher). */
  publish?: TradePublisher;
}

/** How long a closed trade stays on the watch list: the watcher keeps a closed escrow 30 days (Task 9). */
export const WATCH_LIST_CLOSED_DAYS = 31;
const TX_HASH = /^[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9]\d{0,30})$/;
/** Exactly these keys, in any order. */
const keysAre = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
};

/** A signed request is refused when its `at` is further than this from the listener's clock. */
export const INTERNAL_MAX_AGE_MS = 60_000;
const MAX_REPLAY_ENTRIES = 10_000;
const HEX_KEY = /^[0-9a-f]{64}$/;
const WORK_LIMIT = 100;

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

class Refused extends Error {
  constructor(readonly status: number, readonly reason: string) {
    super(reason);
  }
}

interface RegisteredRow {
  code: string;
  buyer_sign: string;
  buyer_box: string;
  buyer_proof: string;
  seller_sign: string;
  seller_box: string;
  seller_proof: string;
  poster: 'buyer' | 'seller';
  take_amount: string;
  locked_currency: string;
  locked_cents_per_xmr: string;
  max_fiat_cents: string;
  buyer_payout: string | null;
  seller_refund: string | null;
}

/**
 * The trade record's columns behind the attested terms (lead answer 4): the deal fixed at take
 * (the amount at take is the pre-growth amount if the trade grew) and both addresses.
 */
const TERMS_COLUMNS = `t.poster, coalesce(t.grown_from_atomic, t.amount_atomic)::text as take_amount, t.locked_currency,
                t.locked_cents_per_xmr::text as locked_cents_per_xmr, t.max_fiat_cents::text as max_fiat_cents,
                t.buyer_payout, t.seller_refund`;

/** The terms the moderation service must sign for this trade, from the trade record. */
function termsOf(r: RegisteredRow): AttestedTerms {
  return {
    deal: {
      poster: r.poster,
      takeAmountAtomic: r.take_amount,
      currency: r.locked_currency,
      centsPerXmr: r.locked_cents_per_xmr,
      maxFiatCents: r.max_fiat_cents,
    },
    buyerPayout: r.buyer_payout ?? '',
    sellerRefund: r.seller_refund ?? '',
  };
}

function sameTerms(a: AttestedTerms, b: AttestedTerms): boolean {
  return (
    a.buyerPayout === b.buyerPayout && a.sellerRefund === b.sellerRefund &&
    a.deal.poster === b.deal.poster && a.deal.takeAmountAtomic === b.deal.takeAmountAtomic &&
    a.deal.currency === b.deal.currency && a.deal.centsPerXmr === b.deal.centsPerXmr && a.deal.maxFiatCents === b.deal.maxFiatCents
  );
}

interface RawBody {
  rawBodyText?: string;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

export async function buildInternalListener(o: InternalOptions, log: (e: { reason: string }) => void = () => {}): Promise<FastifyInstance> {
  await sodium.ready;
  if (typeof o.modSigningPublic !== 'string' || !HEX_KEY.test(o.modSigningPublic)) {
    throw new TypeError('internal listener: bad moderation signing key');
  }
  const modKey = sodium.from_hex(o.modSigningPublic);
  const now = o.now ?? Date.now;
  /** Signed messages seen within the freshness window, so none can be replayed. */
  const seen = new Map<string, number>();

  /** Verify the moderation signature over method + path + freshness + body hash. 401 on any fault. */
  const verify = (req: FastifyRequest, path: string): void => {
    const at = Number(req.headers[INTERNAL_AT_HEADER]);
    const sigRaw = req.headers[INTERNAL_SIG_HEADER];
    if (!Number.isSafeInteger(at) || typeof sigRaw !== 'string') throw new Refused(401, 'unsigned');
    const bodyHash = sha256Hex((req as FastifyRequest & RawBody).rawBodyText ?? '');
    const msg = internalSignedBytes({ method: req.method, path, at, bodyHash });
    let sig: Uint8Array;
    try {
      sig = sodium.from_base64(sigRaw, sodium.base64_variants.ORIGINAL);
    } catch {
      throw new Refused(401, 'bad-signature');
    }
    if (sig.length !== sodium.crypto_sign_BYTES || !sodium.crypto_sign_verify_detached(sig, msg, modKey)) {
      throw new Refused(401, 'bad-signature');
    }
    const t = now();
    if (Math.abs(t - at) > INTERNAL_MAX_AGE_MS) throw new Refused(401, 'stale');
    for (const [k, until] of seen) if (until < t) seen.delete(k);
    const id = sodium.to_hex(sodium.crypto_generichash(32, sig, null));
    if (seen.has(id)) throw new Refused(401, 'replay');
    if (seen.size >= MAX_REPLAY_ENTRIES) throw new Refused(503, 'busy');
    seen.set(id, t + 2 * INTERNAL_MAX_AGE_MS);
  };

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & RawBody).rawBodyText = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, { __invalid: true });
    }
  });
  app.setErrorHandler((_e, _req, reply) => reply.code(400).send({ error: 'bad-body' }));
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not-found' }));

  const guard = (path: string, handler: (req: FastifyRequest, reply: { code(n: number): { send(b: unknown): unknown }; send(b: unknown): unknown }) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: { code(n: number): { send(b: unknown): unknown }; send(b: unknown): unknown }) => {
      try {
        verify(req, path);
        return await handler(req, reply);
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        log({ reason: `internal-${e.reason}` });
        return reply.code(e.status).send({ error: e.reason });
      }
    };

  /** Record a terminal refusal (see POST /internal/v1/reports). */
  const refuse = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    const keys = Object.keys(body);
    if (keys.length !== 3 || !['kind', 'trade', 'reason'].every((k) => keys.includes(k))) throw new Refused(400, 'bad-body');
    const reason = body.reason;
    if (reason !== 'bad-proof' && reason !== 'bad-work') throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    // Only a trade that is (or was) work: open and in setup, both identities registered and no attestation.
    const { rowCount } = await o.db.query(
      `insert into trade_refusals (code, reason, created_at)
       select t.code, $2, now()
         from trades t
         join trade_identities bi on bi.code = t.code and bi.role = 'buyer'
         join trade_identities si on si.code = t.code and si.role = 'seller'
         left join trade_attestations a on a.code = t.code
        where t.code = $1 and a.code is null and t.state = 'setup' and t.closed_at is null
       on conflict (code) do nothing`,
      [code, reason],
    );
    if (rowCount === 0) {
      const again = await o.db.query('select 1 from trade_refusals where code = $1', [code]);
      if (again.rows.length === 0) throw new Refused(409, 'not-refusable');
    }
    await o.db.query('delete from trade_work_served where code = $1', [code]);
    log({ reason: 'internal-refused' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * A chain-watcher report (Task 9): `setup-done { escrowAddress }`, `chain { receivedAtomic,
   * unlockedAtomic, confirmations }` (bigints as decimal strings), `settled { txHash }` (the kind
   * from `settleKindFor`; 409 `settle-kind-unknown` when the trade alone does not name it) and
   * `late-funds` and `spend-unshown` (a trade settling 6 h with no sweep shown to the moderator,
   * Task 9 I/O fallback), `alert-unseen`, `alert-late` and `refund-unverified` (a requested refund the moderator
   * will not sign alone, Task 10), all applied as `escalate`, and `release-claimed` (the moderation
   * service received a trade party's sealed post-release info: the signing window no longer
   * reverts the settling trade, lead decision b 2026-10-29), each for an attested trade only. Applied through the
   * trade store as `system`. The state machine's refusal is 409 with its rule code, so a repeated
   * report is refused `wrong-state` and the watcher counts it as done.
   */
  const watcherReport = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    let event: TradeEvent | null = null;
    /** `settled`: the kind the watcher counted the sweep for (security review 7 Nov, finding 3). */
    let claimedKind: SettleKind | null = null;
    switch (body.kind) {
      case 'setup-done':
        if (!keysAre(body, ['kind', 'trade', 'escrowAddress']) || typeof body.escrowAddress !== 'string' || !/^[0-9A-Za-z]{1,128}$/.test(body.escrowAddress)) break;
        event = { type: 'setup-done', escrowAddress: body.escrowAddress };
        break;
      case 'chain': {
        const { receivedAtomic: r, unlockedAtomic: u, confirmations: c } = body;
        if (!keysAre(body, ['kind', 'trade', 'receivedAtomic', 'unlockedAtomic', 'confirmations'])) break;
        if (typeof r !== 'string' || typeof u !== 'string' || !ATOMIC.test(r) || !ATOMIC.test(u)) break;
        if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0 || BigInt(u) > BigInt(r)) break;
        event = { type: 'chain', receivedAtomic: BigInt(r), unlockedAtomic: BigInt(u), confirmations: c };
        break;
      }
      case 'settled':
        if (!keysAre(body, ['kind', 'trade', 'txHash', 'settleKind']) || typeof body.txHash !== 'string' || !TX_HASH.test(body.txHash)) break;
        if (body.settleKind !== null && !SETTLE_KINDS.includes(body.settleKind as SettleKind)) break;
        claimedKind = body.settleKind as SettleKind | null;
        event = { type: 'settled', kind: 'release', txHash: body.txHash }; // kind set below from the trade
        break;
      case 'late-funds':
      case 'spend-unshown':
      // Task 10: a requested refund the moderator will not sign alone: no seen-receipt for the
      // buyer's final alert 15 min after it, or its own records (signals, shadow trade) disagree.
      // `alert-late`: the receipt came more than 2 min after the alert (lead decision I2 (b)).
      case 'alert-unseen':
      case 'alert-late':
      case 'refund-unverified':
        if (!keysAre(body, ['kind', 'trade'])) break;
        event = { type: 'escalate' };
        break;
      case 'release-claimed':
        if (!keysAre(body, ['kind', 'trade'])) break;
        event = { type: 'release-claimed' };
        break;
    }
    if (event === null) throw new Refused(400, 'bad-body');
    const attested = await o.db.query('select 1 from trade_attestations where code = $1', [code]);
    if (attested.rows.length === 0) {
      const known = await o.db.query('select 1 from trades where code = $1', [code]);
      throw known.rows.length === 0 ? new Refused(404, 'not-found') : new Refused(409, 'not-attested');
    }
    // Finding 3: `settled` applies only with the kind the watcher counted the sweep for, and only
    // while the trade still names that kind, checked again under the trade's row lock (`within`):
    // a signing window that reverted and a new settlement started in between is refused, never
    // recorded as the other kind.
    let within: Parameters<typeof applyEvent>[4];
    if (event.type === 'settled') {
      const t = await loadTrade(o.db, code);
      const kind = t ? settleKindFor(t) : null;
      if (kind === null || claimedKind === null) throw new Refused(409, 'settle-kind-unknown');
      if (kind !== claimedKind) throw new Refused(409, 'settle-kind-changed');
      event = { ...event, kind: claimedKind };
      const claimed = claimedKind;
      within = async (_c, prev) => {
        if (settleKindFor(prev) !== claimed) throw new Refused(409, 'settle-kind-changed');
      };
    }
    try {
      await applyEvent({ db: o.db, clock: o.clock ?? (() => new Date(now())), ...(o.publish ? { publish: o.publish } : {}) }, code, event, 'system', within);
    } catch (e) {
      if (e instanceof TradeRuleError) throw new Refused(409, e.code);
      if (e instanceof ApiError && e.status === 404) throw new Refused(404, 'not-found');
      if (e instanceof RangeError) throw new Refused(400, 'bad-body');
      throw e;
    }
    log({ reason: `internal-${body.kind as string}` });
    return reply.code(201).send({ ok: true });
  };

  // Every attested trade that is open, or closed within WATCH_LIST_CLOSED_DAYS, with its state:
  // the moderation watcher's view of the API trade (Task 9). No addresses or terms. Also
  // Task 10: `finalAlertSeenAt` (`final_alert_seen_at` only while `final_alert_delivered` is true, else null).
  // Also
  // `settleKind` (settleKindFor: the kind a `settled` report would be applied as; the watcher checks
  // a sweep it saw only through an import against it, review I1) and `paused` (maintenance: the
  // watcher's 6 h fallback does not run, review M3). Also `finalAlertAt` (Task 10 review I1): the
  // API's own, shifted by every maintenance pause it applied; the moderator's auto-refund waits
  // for the later of it and its shadow's. Owner rule g62 (trade timers stop during maintenance):
  // an open trade also counts as paused as soon as `site_flags.maintenance_since` is set, before the
  // timer loop's next pass writes its `paused_at`, so the moderator decides nothing in that gap.
  // Also `chat` (chat shred review I1): the code of the chat linked to the trade, or null (none, or
  // purged); moderation records the link while the trade is live and holds a shred by it.
  app.get('/internal/v1/watch', guard('/internal/v1/watch', async (_req, reply) => {
    const { rows } = await o.db.query<{ code: string; chat: string | null; state: TradeState; settling: SettleKind | null; paused_at: Date | null; final_alert_at: Date | null; seen: Date | null; site_paused: boolean }>(
      `select t.code, c.code as chat, t.state, t.settling, t.paused_at, t.final_alert_at,
              case when t.final_alert_delivered is true then t.final_alert_seen_at end as seen,
              (t.closed_at is null and exists (select 1 from site_flags where maintenance_since is not null)) as site_paused
         from trades t
         join trade_attestations a on a.code = t.code
         left join chats c on c.trade_code = t.code
        where t.closed_at is null or t.closed_at > $1
        order by t.taken_at, t.code`,
      [new Date(now() - WATCH_LIST_CLOSED_DAYS * 86_400_000)],
    );
    return reply.send({
      trades: rows.map((r) => ({
        trade: r.code,
        chat: r.chat,
        state: r.state,
        settleKind: settleKindFor({ state: r.state, settling: r.settling }),
        paused: r.paused_at !== null || r.site_paused,
        finalAlertSeenAt: r.seen ? r.seen.toISOString() : null,
        finalAlertAt: r.final_alert_at ? r.final_alert_at.toISOString() : null,
      })),
    });
  }));

  // The open trades in setup that both traders have registered an identity for, with both addresses on record,
  // no attestation yet and not refused by the moderation service (a refused trade is done for good
  // and never served again). Each item carries the trade record's terms for the attestation.
  // Never-served trades come first, then the least recently served, so one trade that keeps failing
  // moves to the back of the line instead of holding the window shut.
  app.get('/internal/v1/work', guard('/internal/v1/work', async (_req, reply) => {
    const { rows } = await o.db.query<RegisteredRow>(
      `with picked as (
         select t.code,
                bi.sign_public as buyer_sign, bi.box_public as buyer_box, bi.proof as buyer_proof,
                si.sign_public as seller_sign, si.box_public as seller_box, si.proof as seller_proof,
                ${TERMS_COLUMNS}
           from trades t
           join trade_identities bi on bi.code = t.code and bi.role = 'buyer'
           join trade_identities si on si.code = t.code and si.role = 'seller'
           left join trade_attestations a on a.code = t.code
           left join trade_refusals r on r.code = t.code
           left join trade_work_served w on w.code = t.code
          where a.code is null and r.code is null
            and t.state = 'setup' and t.closed_at is null
            and t.buyer_payout is not null and t.seller_refund is not null
          order by w.served_at nulls first, t.taken_at, t.code
          limit $1
       ), served as (
         insert into trade_work_served (code, served_at)
         select code, $2 from picked
         on conflict (code) do update set served_at = excluded.served_at
       )
       select * from picked`,
      [o.workLimit ?? WORK_LIMIT, new Date(now())],
    );
    const work = rows.map((r) => ({
      trade: r.code,
      participants: {
        buyer: { signPublic: r.buyer_sign, boxPublic: r.buyer_box, proof: r.buyer_proof },
        seller: { signPublic: r.seller_sign, boxPublic: r.seller_box, proof: r.seller_proof },
      },
      terms: termsOf(r),
    }));
    return reply.send({ work });
  }));

  // ── Task 20: chats ─────────────────────────────────────────────────────────
  // The chats both traders have registered a chat identity for, with no attestation yet and not
  // refused, least recently served first (as the trade work list).
  app.get('/internal/v1/chat-work', guard('/internal/v1/chat-work', async (_req, reply) => {
    const { rows } = await o.db.query<{ chat: string; buyer_sign: string; buyer_box: string; buyer_proof: string; seller_sign: string; seller_box: string; seller_proof: string }>(
      `with picked as (
         select c.code as chat,
                bi.sign_public as buyer_sign, bi.box_public as buyer_box, bi.proof as buyer_proof,
                si.sign_public as seller_sign, si.box_public as seller_box, si.proof as seller_proof
           from chats c
           join chat_identities bi on bi.chat = c.code and bi.role = 'buyer'
           join chat_identities si on si.chat = c.code and si.role = 'seller'
           left join chat_attestations a on a.chat = c.code
           left join chat_refusals r on r.chat = c.code
           left join chat_work_served w on w.chat = c.code
          where a.chat is null and r.chat is null
          order by w.served_at nulls first, c.created_at, c.code
          limit $1
       ), served as (
         insert into chat_work_served (chat, served_at)
         select chat, $2 from picked
         on conflict (chat) do update set served_at = excluded.served_at
       )
       select * from picked`,
      [o.workLimit ?? WORK_LIMIT, new Date(now())],
    );
    const work = rows.map((r) => ({
      chat: r.chat,
      participants: {
        buyer: { signPublic: r.buyer_sign, boxPublic: r.buyer_box, proof: r.buyer_proof },
        seller: { signPublic: r.seller_sign, boxPublic: r.seller_box, proof: r.seller_proof },
      },
    }));
    return reply.send({ work });
  }));

  // ── Chat shred (design-chat-membership-keys 5, task 1) ─────────────────────
  // The chats purgeChats deleted whose keys the moderation service has not yet reported destroyed,
  // with the linked trade's code (null before a take). Moderation checks its own view of that trade
  // before it shreds; this list is only the trigger. Never-served orders first, then the least
  // recently served (review M4): orders moderation holds move to the back instead of keeping the
  // ones behind them waiting.
  app.get('/internal/v1/chat-shred', guard('/internal/v1/chat-shred', async (_req, reply) => {
    const { rows } = await o.db.query<{ chat: string; trade_code: string | null; purged_at: Date }>(
      `with picked as (
         select chat, trade_code, purged_at, served_at from chat_shred_orders
          order by served_at nulls first, purged_at, chat
          limit $1
       ), served as (
         update chat_shred_orders s set served_at = $2 from picked p where s.chat = p.chat
       )
       select chat, trade_code, purged_at from picked order by served_at nulls first, purged_at, chat`,
      [o.workLimit ?? WORK_LIMIT, new Date(now())],
    );
    return reply.send({ orders: rows.map((r) => ({ chat: r.chat, trade: r.trade_code, purgedAt: r.purged_at.toISOString() })) });
  }));

  /**
   * `{ kind: 'chat-shredded', chat }`: the moderation service destroyed its copy of the chat's keys.
   * The order is removed; a repeat (or a chat with no order) is still 201, so the report is idempotent.
   */
  const chatShredded = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    await o.db.query('delete from chat_shred_orders where chat = $1', [code]);
    log({ reason: 'internal-chat-shredded' });
    return reply.code(201).send({ ok: true });
  };

  /** `{ kind: 'chat-refused', chat, reason }`: the moderation service will never attest this chat. */
  const refuseChat = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    const keys = Object.keys(body);
    if (keys.length !== 3 || !['kind', 'chat', 'reason'].every((k) => keys.includes(k))) throw new Refused(400, 'bad-body');
    if (body.reason !== 'bad-proof' && body.reason !== 'bad-work') throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const { rowCount } = await o.db.query(
      `insert into chat_refusals (chat, reason, created_at)
       select c.code, $2, now() from chats c
         join chat_identities bi on bi.chat = c.code and bi.role = 'buyer'
         join chat_identities si on si.chat = c.code and si.role = 'seller'
         left join chat_attestations a on a.chat = c.code
        where c.code = $1 and a.chat is null
       on conflict (chat) do nothing`,
      [code, body.reason],
    );
    if (rowCount === 0) {
      const again = await o.db.query('select 1 from chat_refusals where chat = $1', [code]);
      if (again.rows.length === 0) throw new Refused(409, 'not-refusable');
    }
    log({ reason: 'internal-chat-refused' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * `{ kind: 'chat-attestation', attestation, sig }`: stored only if signed by MOD_SIGNING_PUBLIC,
   * for a known chat, with exactly the two registered trader keys, channels exactly
   * `{ chat: channelFor(chat, 'chat') }`, and no terms (a chat attests no deal).
   */
  const attestChat = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    const keys = Object.keys(body);
    if (keys.length !== 3 || !['kind', 'attestation', 'sig'].every((k) => keys.includes(k))) throw new Refused(400, 'bad-body');
    const attestation = body.attestation;
    const sig = body.sig;
    if (!isPlainObject(attestation) || typeof sig !== 'string') throw new Refused(400, 'bad-body');
    let sigOk = false;
    try {
      const sigBytes = sodium.from_hex(sig);
      sigOk = sigBytes.length === sodium.crypto_sign_BYTES && sodium.crypto_sign_verify_detached(sigBytes, attestationBytes(attestation as unknown as Attestation), modKey);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new Refused(400, 'bad-attestation');
    const a = attestation as unknown as Attestation;
    if ('terms' in attestation) throw new Refused(400, 'bad-attestation');
    const code = typeof a.trade === 'string' ? normalizeTradeCode(a.trade) : null;
    if (code === null) throw new Refused(400, 'bad-attestation');
    const ch = a.channels;
    if (!isPlainObject(ch) || Object.keys(ch).length !== 1 || ch.chat !== (await channelFor(code, 'chat'))) throw new Refused(400, 'bad-channel');
    const { rows } = await o.db.query<{ buyer_sign: string; buyer_box: string; seller_sign: string; seller_box: string }>(
      `select bi.sign_public as buyer_sign, bi.box_public as buyer_box, si.sign_public as seller_sign, si.box_public as seller_box
         from chats c
         join chat_identities bi on bi.chat = c.code and bi.role = 'buyer'
         join chat_identities si on si.chat = c.code and si.role = 'seller'
        where c.code = $1`,
      [code],
    );
    const reg = rows[0];
    if (!reg) throw new Refused(409, 'not-ready');
    const p = a.participants;
    if (
      !isPlainObject(p) ||
      p.buyer?.signPublic !== reg.buyer_sign || p.buyer?.boxPublic !== reg.buyer_box ||
      p.seller?.signPublic !== reg.seller_sign || p.seller?.boxPublic !== reg.seller_box
    ) {
      throw new Refused(409, 'participant-mismatch');
    }
    const refused = await o.db.query('select 1 from chat_refusals where chat = $1', [code]);
    if (refused.rows.length > 0) throw new Refused(409, 'refused');
    await o.db.query(
      'insert into chat_attestations (chat, attestation, sig, created_at) values ($1, $2, $3, now()) on conflict (chat) do nothing',
      [code, attestation, sig],
    );
    log({ reason: 'internal-chat-attested' });
    return reply.code(201).send({ ok: true });
  };

  // An attestation the moderation service signed. Stored only if it is signed by MOD_SIGNING_PUBLIC,
  // names a known trade, and lists exactly the buyer and seller keys the two traders registered
  // (so even a buggy moderation cannot bind a key the real trader never registered), with channels
  // that equal channelFor(trade, kind), and terms equal to the trade record's (409 terms-mismatch).
  //
  // Or the moderation service's terminal refusal of a trade: exactly `{ kind: 'refused', trade,
  // reason }`, authenticated like every internal request by the moderation request signature over
  // the body. It is recorded once, for a trade that was work (both identities registered, no
  // attestation), and that trade is never served as work again.
  app.post('/internal/v1/reports', guard('/internal/v1/reports', async (req, reply) => {
    const body = req.body;
    if (isPlainObject(body) && body.kind === 'refused') return refuse(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-refused') return refuseChat(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-attestation') return attestChat(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-shredded') return chatShredded(body, reply);
    if (isPlainObject(body) && typeof body.kind === 'string' && body.kind !== 'attestation') return watcherReport(body, reply);
    if (!isPlainObject(body) || body.kind !== 'attestation') throw new Refused(400, 'bad-body');
    const attestation = body.attestation;
    const sig = body.sig;
    if (!isPlainObject(attestation) || typeof sig !== 'string') throw new Refused(400, 'bad-body');

    let sigOk = false;
    try {
      const sigBytes = sodium.from_hex(sig);
      sigOk =
        sigBytes.length === sodium.crypto_sign_BYTES &&
        sodium.crypto_sign_verify_detached(sigBytes, attestationBytes(attestation as unknown as Attestation), modKey);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new Refused(400, 'bad-attestation');

    const a = attestation as unknown as Attestation;
    const code = typeof a.trade === 'string' ? normalizeTradeCode(a.trade) : null;
    if (code === null) throw new Refused(400, 'bad-attestation');
    if (!isAttestedTerms(a.terms)) throw new Refused(400, 'bad-attestation');
    const { rows } = await o.db.query<RegisteredRow>(
      `select t.code,
              bi.sign_public as buyer_sign, bi.box_public as buyer_box, bi.proof as buyer_proof,
              si.sign_public as seller_sign, si.box_public as seller_box, si.proof as seller_proof,
              ${TERMS_COLUMNS}
         from trades t
         join trade_identities bi on bi.code = t.code and bi.role = 'buyer'
         join trade_identities si on si.code = t.code and si.role = 'seller'
        where t.code = $1`,
      [code],
    );
    const reg = rows[0];
    if (!reg) throw new Refused(409, 'not-ready');
    const p = a.participants;
    if (
      typeof p !== 'object' || p === null ||
      p.buyer?.signPublic !== reg.buyer_sign || p.buyer?.boxPublic !== reg.buyer_box ||
      p.seller?.signPublic !== reg.seller_sign || p.seller?.boxPublic !== reg.seller_box
    ) {
      throw new Refused(409, 'participant-mismatch');
    }
    if (a.channels?.escrow !== (await channelFor(code, 'escrow')) || a.channels?.signals !== (await channelFor(code, 'signals'))) {
      throw new Refused(400, 'bad-channel');
    }
    if (reg.buyer_payout === null || reg.seller_refund === null || !sameTerms(a.terms, termsOf(reg))) throw new Refused(409, 'terms-mismatch');

    const refused = await o.db.query('select 1 from trade_refusals where code = $1', [code]);
    if (refused.rows.length > 0) throw new Refused(409, 'refused');

    await o.db.query(
      `insert into trade_attestations (code, attestation, sig, created_at)
       values ($1, $2, $3, now()) on conflict (code) do nothing`,
      [code, attestation, sig],
    );
    await o.db.query('delete from trade_work_served where code = $1', [code]);
    log({ reason: 'internal-attested' });
    return reply.code(201).send({ ok: true });
  }));

  return app;
}
