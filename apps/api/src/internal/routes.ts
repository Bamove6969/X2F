import { createHash } from 'node:crypto';
import { MAX_NETWORK_FEE, normalizeTradeCode } from '@x2f/core';
import { RULING_REFUSALS } from '@x2f/staff';
import {
  attestationBytes,
  channelFor,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  isAttestedTerms,
  isRulingKind,
  afterRefundStatementBytes,
  isAfterRefundStatement,
  isRulingStatement,
  rulingStatementBytes,
  SETTLE_KINDS,
  settleKindFor,
  TradeRuleError,
  type Attestation,
  type AttestedTerms,
  type RulingKind,
  type SettleKind,
  type TradeEvent,
  type TradeState,
} from '@x2f/trade';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { canonicalJson } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { addOwnerAlert } from '../alerts.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { recordRulingExecution } from '../disputes/execution.js';
import { acceptGrant, noticeCandidates, pendingGrants, refuseGrant, storeNotice } from '../chat/grants.js';
import { loadDisputeRecord } from '../disputes/store.js';
import { applyEvent, loadTrade, type TradePublisher } from '../trades/store.js';
import { bookSettlementNetworkFee } from '../staff/revenue.js';

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
  pay_window_min: number;
  method_id: string;
  method_instructions: string;
  buyer_payout: string | null;
  seller_refund: string | null;
}

/**
 * The trade record's columns behind the attested terms (lead answer 4): the deal fixed at take
 * (the amount at take is the pre-growth amount if the trade grew), the time to pay fixed at take
 * (owner p9-6; the moderation shadow runs on it), the method chosen at take and its payment
 * instructions locked at take (J-16, migration 490; never changed after, by the deal trigger) and
 * both addresses.
 */
const TERMS_COLUMNS = `t.poster, coalesce(t.grown_from_atomic, t.amount_atomic)::text as take_amount, t.locked_currency,
                t.locked_cents_per_xmr::text as locked_cents_per_xmr, t.max_fiat_cents::text as max_fiat_cents,
                t.pay_window_min, t.method_id, t.method_instructions, t.buyer_payout, t.seller_refund`;

/** The terms the moderation service must sign for this trade, from the trade record. */
function termsOf(r: RegisteredRow): AttestedTerms {
  return {
    deal: {
      poster: r.poster,
      takeAmountAtomic: r.take_amount,
      currency: r.locked_currency,
      centsPerXmr: r.locked_cents_per_xmr,
      maxFiatCents: r.max_fiat_cents,
      // Task 34 review I1, restored for flex offers: the method and the SHA-256 of its locked
      // instructions, so a device can tell whether the text the (unsigned) TradeView shows is the
      // one locked at take. Only the hash leaves for moderation, never the text.
      methodId: r.method_id,
      instructionsSha256: createHash('sha256').update(r.method_instructions, 'utf8').digest('hex'),
    },
    payWindowMin: r.pay_window_min,
    buyerPayout: r.buyer_payout ?? '',
    sellerRefund: r.seller_refund ?? '',
  };
}

function sameTerms(a: AttestedTerms, b: AttestedTerms): boolean {
  return (
    a.buyerPayout === b.buyerPayout && a.sellerRefund === b.sellerRefund && a.payWindowMin === b.payWindowMin &&
    a.deal.poster === b.deal.poster && a.deal.takeAmountAtomic === b.deal.takeAmountAtomic &&
    a.deal.currency === b.deal.currency && a.deal.centsPerXmr === b.deal.centsPerXmr && a.deal.maxFiatCents === b.deal.maxFiatCents &&
    a.deal.methodId === b.deal.methodId && a.deal.instructionsSha256 === b.deal.instructionsSha256
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
   * Task 9 I/O fallback) and `refund-unverified` (a seller's cancel refund the moderator will not
   * sign alone, Task 10), all applied as `escalate`, and `release-claimed` (the moderation
   * service received a trade party's sealed post-release info: the signing window no longer
   * reverts the settling trade, lead decision b 2026-10-29), each for an attested trade only. Applied through the
   * trade store as `system`. The state machine's refusal is 409 with its rule code, so a repeated
   * report is refused `wrong-state` and the watcher counts it as done.
   */
  /**
   * Security review 2026-11-12 I7: a ruling's payout seen after its case was closed (by a senior's
   * close). The coins moved but the trade stays disputed and the watcher backs off, so the owner is
   * alerted, once per trade (the case row locked, so two reports never alert twice).
   */
  const raiseClosedCase = async (x: { code: string; txHash: string }): Promise<void> => {
    const c = await o.db.connect();
    try {
      await c.query('begin');
      const { rows } = await c.query<{ seq: number }>(
        'select seq from disputes where code = $1 and seq = (select max(seq) from disputes where code = $1) for update',
        [x.code],
      );
      const seen = await c.query("select 1 from alerts where kind = 'ruling-payout-dispute-closed' and detail->>'trade' = $1 limit 1", [x.code]);
      if (rows[0] !== undefined && seen.rows.length === 0) {
        await addOwnerAlert(c, 'ruling-payout-dispute-closed', { trade: x.code, seq: rows[0].seq, txHash: x.txHash }, o.clock?.() ?? new Date(now()));
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  };

  const watcherReport = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    let event: TradeEvent | null = null;
    /** `settled`: the kind the watcher counted the sweep for (security review 7 Nov, finding 3), or a ruling's (R-M2). */
    let claimedKind: SettleKind | RulingKind | null = null;
    /** `settled`: the sweep's whole network fee, when the watcher knows it. */
    let networkFee: bigint | null = null;
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
        // `networkFeeAtomic` (optional, owner 16 Nov books): the sweep tx's whole network fee as the
        // moderator's wallet records it, a decimal string; X2F's share of it is booked with the 1%.
        if (!keysAre(body, ['kind', 'trade', 'txHash', 'settleKind']) && !keysAre(body, ['kind', 'trade', 'txHash', 'settleKind', 'networkFeeAtomic'])) break;
        if (typeof body.txHash !== 'string' || !TX_HASH.test(body.txHash)) break;
        if ('networkFeeAtomic' in body) {
          if (typeof body.networkFeeAtomic !== 'string' || !ATOMIC.test(body.networkFeeAtomic)) break;
          networkFee = BigInt(body.networkFeeAtomic);
          // Review M2: over the co-signer bound, so not what X2F's output paid; booked capped (staff/revenue.ts).
          if (networkFee > MAX_NETWORK_FEE) log({ reason: 'internal-settled-network-fee-over-cap' });
        }
        if (body.settleKind !== null && !SETTLE_KINDS.includes(body.settleKind as SettleKind) && !isRulingKind(body.settleKind)) break;
        claimedKind = body.settleKind as SettleKind | RulingKind | null;
        event = { type: 'settled', kind: 'release', txHash: body.txHash }; // kind set below from the trade
        break;
      case 'late-funds':
      case 'spend-unshown':
      // Task 10: a seller's cancel refund the moderator will not sign alone: its own records
      // (signals, shadow trade) disagree. The final-alert reports are gone (owner 8 Nov, p6-1).
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
    /** Review I7: a ruling payout's trade and tx, raised to the owner if its case turns out closed. */
    let closedCase: { code: string; txHash: string } | null = null;
    if (event.type === 'settled' && isRulingKind(claimedKind)) {
      // Plan 4 Task 14 (R-M2): the moderation process executed a round-1 escrow ruling and its watcher
      // saw the mod-built sweep. Never named by the trade alone: only a disputed trade whose published
      // round-1 escrow ruling pays exactly this way (checked again under the dispute's row lock).
      const t = await loadTrade(o.db, code);
      const closedAs = claimedKind === 'dispute-buyer' ? 'released' : 'refunded';
      // The same report again (the watcher retries until a pass is saved) changes nothing.
      if (t !== null && t.state === closedAs && t.txHash === body.txHash && t.settling === null) {
        log({ reason: 'internal-settled' });
        return reply.code(201).send({ ok: true });
      }
      if (t === null || t.state !== 'disputed') {
        if (t !== null && (t.state === 'released' || t.state === 'refunded')) throw new Refused(409, 'wrong-state');
        throw new Refused(409, 'settle-kind-unknown');
      }
      const kind = claimedKind;
      const txHash = body.txHash as string;
      const fee = networkFee;
      event = { type: 'settled', kind, txHash };
      within = async (c, _prev, next, at) => {
        const r = await recordRulingExecution(c, code, kind, txHash, at);
        if (r !== 'ok') throw new Refused(409, r);
        // C1 / NF-1 (lead 18 Nov): a buyer ruling's payout has X2F's fee output as a release's does
        // (payoutsFor), so its share of the network fee is booked with the 1% the store booked in this
        // same transaction, as on the release path. A seller ruling (full reversal) has no fee output.
        if (kind === 'dispute-buyer' && fee !== null && next.state === 'released') await bookSettlementNetworkFee(c, code, fee);
      };
      closedCase = { code, txHash };
    } else if (event.type === 'settled') {
      const t = await loadTrade(o.db, code);
      const kind = t ? settleKindFor(t) : null;
      if (kind === null || claimedKind === null) throw new Refused(409, 'settle-kind-unknown');
      if (kind !== claimedKind) throw new Refused(409, 'settle-kind-changed');
      event = { ...event, kind: claimedKind };
      const claimed = claimedKind;
      const fee = networkFee;
      within = async (c, prev, next, at) => {
        if (settleKindFor(prev) !== claimed) throw new Refused(409, 'settle-kind-changed');
        // Owner 16 Nov: X2F's fee output paid its share of the payout's network fee; the books
        // record it with the 1% the store booked in this same transaction (staff/revenue.ts).
        if (fee !== null && next.state === 'released') await bookSettlementNetworkFee(c, code, fee);
        // Review I1 (8 Nov): the seller's cancel refund landed on a trade disputed meanwhile (the
        // machine keeps it `disputed` and records the tx). The escrow is empty now, so a dispute
        // still `open` (no ruling proposed) becomes after-refund in this same transaction: its ruling
        // offers the after-refund outcomes (the seller sends the XMR, or no action), never an escrow
        // payout that can't run.
        // Re-verify 43fbbb2f, R-I1: a dispute past `open` already has an escrow ruling proposed or
        // published (a seller's device can hold the refund back until then). Flipping it would let
        // `resolveFinal` close a `release-to-buyer` case with nothing owed, so it is left as it is
        // (it waits for an execution that cannot come, and never closes) and raised for staff to
        // re-rule with `seller-sends-xmr`: logged on the case and the owner alerted.
        // R-M2 (Plan 4 Task 14): a ruling's own payout reports its own kind (`RulingKind`, the branch
        // above), never `auto-refund`; machine.ts `settled` refuses a ruling kind once txHash is set.
        if (prev.state === 'disputed' && next.state === 'disputed' && prev.txHash === null && next.txHash !== null) {
          const { rows } = await c.query<{ seq: number; status: string }>(
            `select seq, status from disputes
              where code = $1 and closed_at is null and seq = (select max(seq) from disputes where code = $1)
              for update`,
            [code],
          );
          const d = rows[0];
          if (d === undefined) return;
          if (d.status === 'open') {
            await c.query('update disputes set after_refund = true where code = $1 and seq = $2', [code, d.seq]);
          } else {
            await appendLog(c, { at, actor: { kind: 'system' }, tradeCode: code, action: 'dispute.refund-after-ruling', detail: { seq: d.seq, status: d.status } });
            await addOwnerAlert(c, 'dispute-refund-after-ruling', { trade: code, seq: d.seq }, at);
          }
        }
      };
    }
    try {
      await applyEvent({ db: o.db, clock: o.clock ?? (() => new Date(now())), ...(o.publish ? { publish: o.publish } : {}) }, code, event, 'system', within);
    } catch (e) {
      // Review I7: the payout's transaction rolled back; the owner is told once, in its own transaction.
      if (e instanceof Refused && e.reason === 'dispute-closed' && closedCase !== null) await raiseClosedCase(closedCase).catch(() => log({ reason: 'internal-dispute-closed-alert-failed' }));
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
  // `settleKind` (settleKindFor: the kind a `settled` report would be applied as; the watcher checks
  // a sweep it saw only through an import against it, review I1) and `paused` (maintenance: the
  // watcher's 6 h fallback does not run, review M3). Owner rule g62 (trade timers stop during maintenance):
  // an open trade also counts as paused as soon as `site_flags.maintenance_since` is set, before the
  // timer loop's next pass writes its `paused_at`, so the moderator decides nothing in that gap.
  // Also `chat` (chat shred review I1): the code of the chat linked to the trade, or null (none, or
  // purged); moderation records the link while the trade is live and holds a shred by it.
  app.get('/internal/v1/watch', guard('/internal/v1/watch', async (_req, reply) => {
    const { rows } = await o.db.query<{ code: string; chat: string | null; state: TradeState; settling: SettleKind | null; paused_at: Date | null; site_paused: boolean; held: boolean }>(
      `select t.code, c.code as chat, t.state, t.settling, t.paused_at,
              (t.closed_at is null and exists (select 1 from site_flags where maintenance_since is not null)) as site_paused,
              exists (select 1 from held_trades h where h.code = t.code and h.released_at is null) as held
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
        // Lead review 8 Nov C2 (owner G7): a trade a recovery-code hold holds is paused for the
        // moderator's timers too, until the hold ends or a moderator decides.
        paused: r.paused_at !== null || r.site_paused || r.held,
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
  // ── Dispute grants (design-chat-membership-keys section 3 T1, build task 6) ──────────────
  // The trader grants of a chat key to the moderator that moderation has not accepted yet, each
  // with its chat's key record (moderation checks the grant's wrap against the record's tkh).
  app.get('/internal/v1/chat-grants', guard('/internal/v1/chat-grants', async (_req, reply) => {
    return reply.send({ grants: await pendingGrants(o.db, o.workLimit ?? WORK_LIMIT) });
  }));

  // ── Dispute notices (design-chat-membership-keys section 3 T2, build task 7) ─────────────
  // Keyed chats of disputed trades with no accepted grant and no notice for the current dispute.
  app.get('/internal/v1/chat-notices', guard('/internal/v1/chat-notices', async (_req, reply) => {
    return reply.send({ candidates: await noticeCandidates(o.db, o.workLimit ?? WORK_LIMIT) });
  }));

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

  // ── Trade shred (Plan 7 Task 2, lead follow-up: the moderation-database purge) ──────────
  // The trades the whole-trade purge deleted whose moderation records (signed terms, keys, watch
  // state) the moderation service has not yet reported destroyed (761). Moderation checks its own
  // records first and destroys nothing on this list alone. Least recently served first, as the chat
  // shred list, so an order moderation holds does not keep the ones behind it waiting.
  app.get('/internal/v1/trade-shred', guard('/internal/v1/trade-shred', async (_req, reply) => {
    const { rows } = await o.db.query<{ trade: string; purged_at: Date }>(
      `with picked as (
         select trade, purged_at, served_at from trade_shred_orders
          order by served_at nulls first, purged_at, trade
          limit $1
       ), served as (
         update trade_shred_orders s set served_at = $2 from picked p where s.trade = p.trade
       )
       select trade, purged_at from picked order by served_at nulls first, purged_at, trade`,
      [o.workLimit ?? WORK_LIMIT, new Date(now())],
    );
    return reply.send({ orders: rows.map((r) => ({ trade: r.trade, purgedAt: r.purged_at.toISOString() })) });
  }));

  /**
   * `{ kind: 'chat-shredded', chat }`: the moderation service destroyed its copy of the chat's keys.
   * The order is removed; a repeat (or a chat with no order) is still 201, so the report is idempotent.
   */
  /**
   * Plan 4 Task 14: the moderation process's log checkpoint `{ id, hash }` (the head it recorded in
   * its own sealed gate store). Logged as `log.checkpoint` only when that row still has that hash
   * (else 409 `checkpoint-mismatch`, nothing written): the log then shows every checkpoint the
   * moderation process holds, and an API that rewrote the row cannot have it logged.
   */
  const logCheckpoint = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'id', 'hash']) || typeof body.id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(body.id) || typeof body.hash !== 'string' || !TX_HASH.test(body.hash)) {
      throw new Refused(400, 'bad-body');
    }
    const id = body.id;
    const hash = body.hash;
    const client = await o.db.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<{ hash: Buffer }>('select hash from activity_log where id = $1', [id]);
      if (rows[0] === undefined || rows[0].hash.toString('hex') !== hash) {
        await client.query('rollback');
        throw new Refused(409, 'checkpoint-mismatch');
      }
      await appendLog(client, { at: o.clock?.() ?? new Date(now()), actor: { kind: 'system' }, tradeCode: null, action: 'log.checkpoint', detail: { id, hash } });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    log({ reason: 'internal-log-checkpoint' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * RetoSwap/Haveno review 2026-11-12, finding 2 (lead call): `{ kind: 'ruling-statement', trade,
   * statement, sig }`, the moderation process's signed statement of the payout it worked out for a
   * round-1 escrow ruling its gate authorised. The traders' devices verify it themselves before they
   * co-sign (the API's word is never enough); the API keeps it for them only when it is signed by
   * MOD_SIGNING_PUBLIC (`bad-statement`), for this trade (`wrong-trade`), round 1 (or, review p4t22
   * m1, a decided round 2 whose round 1 never paid), a trade still
   * disputed (`wrong-state`) whose escrow address it names (`wrong-escrow`), and the trade's
   * published round-1 escrow ruling with that outcome (`stale-ruling`). The first statement stays:
   * the same one again is 201, any other (an altered payout) 409 `statement-conflict`.
   */
  const rulingStatement = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'trade', 'statement', 'sig'])) throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const s = body.statement;
    const sig = body.sig;
    if (!isRulingStatement(s) || typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) throw new Refused(400, 'bad-statement');
    let sigOk = false;
    try {
      sigOk = sodium.crypto_sign_verify_detached(sodium.from_hex(sig), rulingStatementBytes(s), modKey);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new Refused(400, 'bad-statement');
    if (normalizeTradeCode(s.trade) !== code) throw new Refused(400, 'wrong-trade');
    const t = await loadTrade(o.db, code);
    if (t === null) throw new Refused(404, 'not-found');
    if (t.state !== 'disputed') throw new Refused(409, 'wrong-state');
    if (t.escrowAddress === null || t.escrowAddress !== s.escrowAddress) throw new Refused(409, 'wrong-escrow');
    const rec = await loadDisputeRecord(o.db, code);
    const d = rec?.dispute ?? null;
    // Review p4t22 m1 (lead default, owner question OQ2): round 2's ruling pays once it is decided
    // and round 1's payout never ran (the moderation process pays only one of them per trade).
    const paid = d === null ? null : s.round === 1 ? (d.round === 1 ? d.ruling : d.round1) : d.round === 2 && d.status === 'final' ? d.ruling : null;
    if (d === null || paid === null || d.afterRefund || d.publishedAt === null || paid.id !== s.rulingId || paid.outcome !== s.outcome) {
      throw new Refused(409, 'stale-ruling');
    }
    await o.db.query('insert into ruling_statements (code, statement, sig, created_at) values ($1, $2, $3, now()) on conflict (code) do nothing', [code, s, sig]);
    const { rows } = await o.db.query<{ statement: unknown; sig: string }>('select statement, sig from ruling_statements where code = $1', [code]);
    const kept = rows[0];
    if (kept === undefined || kept.sig !== sig || canonicalJson(kept.statement) !== canonicalJson(s)) throw new Refused(409, 'statement-conflict');
    log({ reason: 'internal-ruling-statement' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * Review p4t22 M2: `{ kind: 'after-refund-statement', trade, statement, sig }`, the moderation
   * process's signed statement of an after-refund ruling its gate authorised (residual (a): any
   * after-refund outcome, so a decided round with nothing to send is signed too). The
   * seller's device verifies it itself before it shows the pay form (the API's word is never
   * enough); the API keeps it for the traders only when it is signed by MOD_SIGNING_PUBLIC
   * (`bad-statement`), for this trade (`wrong-trade`), and names the ruling in force of the trade's
   * current after-refund dispute (round 1's while an appeal is pending, else the decided round's),
   * with that round and outcome (`stale-ruling`). One per ruling: the same again is 201, any other
   * 409 `statement-conflict`.
   */
  const afterRefundStatement = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'trade', 'statement', 'sig'])) throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const s = body.statement;
    const sig = body.sig;
    if (!isAfterRefundStatement(s) || typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) throw new Refused(400, 'bad-statement');
    let sigOk = false;
    try {
      sigOk = sodium.crypto_sign_verify_detached(sodium.from_hex(sig), afterRefundStatementBytes(s), modKey);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new Refused(400, 'bad-statement');
    if (normalizeTradeCode(s.trade) !== code) throw new Refused(400, 'wrong-trade');
    const rec = await loadDisputeRecord(o.db, code);
    const d = rec?.dispute ?? null;
    if (d === null) throw new Refused(404, 'not-found');
    const decided = d.round === 2 && ['final', 'complying', 'closed'].includes(d.status);
    const inForce = d.round === 1 ? d.ruling : decided ? d.ruling : d.round1;
    const round = d.round === 1 || !decided ? 1 : 2;
    if (!d.afterRefund || d.publishedAt === null || inForce === null || inForce.id !== s.rulingId || inForce.outcome !== s.outcome || round !== s.round) {
      throw new Refused(409, 'stale-ruling');
    }
    await o.db.query(
      'insert into after_refund_statements (ruling_id, code, seq, round, statement, sig, created_at) values ($1, $2, $3, $4, $5, $6, now()) on conflict (ruling_id) do nothing',
      [s.rulingId, code, d.seq, s.round, s, sig],
    );
    const { rows } = await o.db.query<{ statement: unknown; sig: string }>('select statement, sig from after_refund_statements where ruling_id = $1', [s.rulingId]);
    const kept = rows[0];
    if (kept === undefined || kept.sig !== sig || canonicalJson(kept.statement) !== canonicalJson(s)) throw new Refused(409, 'statement-conflict');
    log({ reason: 'internal-after-refund-statement' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * Ruling-winner reasons (lead 22 Nov; review-lead-fix-ruling-pay, builder's question 1):
   * `{ kind: 'ruling-wait', trade, reason }`, why the moderation process's handed ruling payout waits
   * on its winner: `winner-committed` (the winner's party sent the moderator a built set for another
   * outcome), `winner-offline` (it has not taken part, as far as the moderator can tell), or null
   * (it did, now). Only for a disputed trade whose ruling statement is kept (`wrong-state`,
   * `no-statement`). Each change is logged as `ruling.payout-waiting` (system; `none` for null), the
   * same reason again is 201 and logs nothing, and the staff case view shows the latest. Nothing
   * about the payout changes.
   */
  const rulingWait = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'trade', 'reason'])) throw new Refused(400, 'bad-body');
    const reason = body.reason;
    if (reason !== null && reason !== 'winner-committed' && reason !== 'winner-offline') throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const t = await loadTrade(o.db, code);
    if (t === null) throw new Refused(404, 'not-found');
    if (t.state !== 'disputed') throw new Refused(409, 'wrong-state');
    const kept = await o.db.query('select 1 from ruling_statements where code = $1', [code]);
    if (kept.rows.length === 0) throw new Refused(409, 'no-statement');
    const next = reason ?? 'none';
    const client = await o.db.connect();
    try {
      await client.query('begin');
      // The trade's row lock: two reports never log the same change twice.
      await client.query('select 1 from trades where code = $1 for update', [code]);
      const last = await client.query<{ detail: string }>(
        "select detail from activity_log where trade_code = $1 and action = 'ruling.payout-waiting' order by id desc limit 1",
        [code],
      );
      const was = last.rows[0] === undefined ? 'none' : (JSON.parse(last.rows[0].detail) as { reason: string }).reason;
      if (was !== next) await appendLog(client, { at: o.clock?.() ?? new Date(now()), actor: { kind: 'system' }, tradeCode: code, action: 'ruling.payout-waiting', detail: { reason: next } });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    log({ reason: 'internal-ruling-wait' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * Review p4t22 M1 (d): `{ kind: 'ruling-refused', trade, rulingId, reason }`, the moderation
   * ruling gate refusing a ruling of the trade's current dispute (round 1's, or round 2's), with its
   * refusal code (`GATE_REFUSALS`, or residual (b)'s `no-terms`: `RULING_REFUSALS`), or null once it no longer refuses it. As `ruling-wait`: each
   * change is logged as `ruling.gate-refused` (system; `none` for null), the same report again is 201
   * and logs nothing, and the staff case view shows the latest. A ruling that is not the dispute's
   * is `stale-ruling`. Nothing about the ruling or the payout changes here; the rescue for
   * `needs-second` is the staff route's (rulings.ts, `…/second-approval`).
   */
  const rulingRefused = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'trade', 'rulingId', 'reason'])) throw new Refused(400, 'bad-body');
    const reason = body.reason;
    // Residual (b): `no-terms` too (`RULING_REFUSALS`), the moderation process with no recorded terms for the trade.
    if (reason !== null && !(typeof reason === 'string' && (RULING_REFUSALS as readonly string[]).includes(reason))) throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null || typeof body.rulingId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.rulingId)) throw new Refused(400, 'bad-body');
    const rulingId = body.rulingId;
    const next = reason ?? 'none';
    const client = await o.db.connect();
    try {
      await client.query('begin');
      // The trade's row lock: two reports never log the same change twice.
      const t = await client.query('select 1 from trades where code = $1 for update', [code]);
      if (t.rows.length === 0) throw new Refused(404, 'not-found');
      const d = (await loadDisputeRecord(client, code))?.dispute ?? null;
      if (d === null || (d.ruling?.id !== rulingId && d.round1?.id !== rulingId)) throw new Refused(409, 'stale-ruling');
      const last = await client.query<{ detail: string }>(
        "select detail from activity_log where trade_code = $1 and action = 'ruling.gate-refused' order by id desc limit 1",
        [code],
      );
      const was = last.rows[0] === undefined ? null : (JSON.parse(last.rows[0].detail) as { rulingId: string; reason: string });
      const same = was === null ? next === 'none' : was.rulingId === rulingId && was.reason === next;
      if (!same) await appendLog(client, { at: o.clock?.() ?? new Date(now()), actor: { kind: 'system' }, tradeCode: code, action: 'ruling.gate-refused', detail: { rulingId, reason: next } });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    log({ reason: 'internal-ruling-refused' });
    return reply.code(201).send({ ok: true });
  };

  /** Plan 4 Task 14: the moderation process's daily verification failed: `site_flags.log_alarm` (the first time stays). */
  const logAlarm = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind'])) throw new Refused(400, 'bad-body');
    await o.db.query('update site_flags set log_alarm = coalesce(log_alarm, $1)', [o.clock?.() ?? new Date(now())]);
    log({ reason: 'internal-log-alarm' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * `{ kind: 'chat-grant-accepted', chat, accepted }` (build task 6): moderation opened one grant's
   * wrap to the chat's key. Stored only when signed by the chat's attested moderator identity and
   * naming a stored grant (else 400 `bad-acceptance`, 404 `not-found`); a repeat is 201.
   */
  const chatGrantAccepted = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat', 'accepted'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const r = await acceptGrant(o.db, code, body.accepted, o.clock?.() ?? new Date(now()));
    if (r === 'bad') throw new Refused(400, 'bad-acceptance');
    if (r === 'unknown') throw new Refused(404, 'not-found');
    log({ reason: 'internal-chat-grant-accepted' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * `{ kind: 'chat-dispute-notice', chat, notice }` (build task 7): moderation's signed T2 notice.
   * Stored only when signed by the chat's attested moderator identity and naming the linked trade's
   * current open dispute exactly (else 400 `bad-notice`, 404 `not-found`, 409 `not-disputed`); a
   * repeat is 201.
   */
  const chatDisputeNotice = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat', 'notice'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const r = await storeNotice(o.db, code, body.notice, o.clock?.() ?? new Date(now()));
    if (r === 'bad') throw new Refused(400, 'bad-notice');
    if (r === 'unknown') throw new Refused(404, 'not-found');
    if (r === 'not-disputed') throw new Refused(409, 'not-disputed');
    log({ reason: 'internal-chat-dispute-notice' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * Review F2: `{ kind: 'chat-grant-refused', chat, grantBy, grantSig, reason }`: moderation refused
   * that one grant. Only that row is marked; the grant queue then skips it (else 400 `bad-body`, 404
   * `not-found`); a repeat is 201.
   */
  const chatGrantRefused = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat', 'grantBy', 'grantSig', 'reason'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    const r = await refuseGrant(o.db, code, body.grantBy, body.grantSig, body.reason, o.clock?.() ?? new Date(now()));
    if (r === 'bad') throw new Refused(400, 'bad-body');
    if (r === 'unknown') throw new Refused(404, 'not-found');
    log({ reason: 'internal-chat-grant-refused' });
    return reply.code(201).send({ ok: true });
  };

  const chatShredded = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    await o.db.query('delete from chat_shred_orders where chat = $1', [code]);
    log({ reason: 'internal-chat-shredded' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * `{ kind: 'trade-shredded', trade }` (761): the moderation service destroyed its records of a
   * purged trade. Only the order is removed (nothing else of a trade is left to remove); a repeat, or
   * a trade with no order, is still 201, so the report is idempotent.
   */
  const tradeShredded = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'trade'])) throw new Refused(400, 'bad-body');
    const code = typeof body.trade === 'string' ? normalizeTradeCode(body.trade) : null;
    if (code === null) throw new Refused(400, 'bad-body');
    await o.db.query('delete from trade_shred_orders where trade = $1', [code]);
    log({ reason: 'internal-trade-shredded' });
    return reply.code(201).send({ ok: true });
  };

  /**
   * `{ kind: 'chat-notice-stopped', chat, disputeSeq, status }` (re-review m5): the moderation
   * service stopped re-posting a dispute notice this API refused for good. One owner alert.
   */
  const chatNoticeStopped = async (body: Record<string, unknown>, reply: { code(n: number): { send(b: unknown): unknown } }): Promise<unknown> => {
    if (!keysAre(body, ['kind', 'chat', 'disputeSeq', 'status'])) throw new Refused(400, 'bad-body');
    const code = typeof body.chat === 'string' ? normalizeTradeCode(body.chat) : null;
    const seq = body.disputeSeq;
    const status = body.status;
    if (code === null || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499) {
      throw new Refused(400, 'bad-body');
    }
    await addOwnerAlert(o.db, 'chat-notice-refused', {
      chat: code, disputeSeq: seq, status,
      // COPY-UNSIGNED
      message: 'A disputed chat could not get its moderator notice: moderators may not be able to read it. Check the dispute.',
    }, o.clock?.() ?? new Date(now()));
    log({ reason: 'internal-chat-notice-stopped' });
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
    if (isPlainObject(body) && body.kind === 'trade-shredded') return tradeShredded(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-grant-accepted') return chatGrantAccepted(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-dispute-notice') return chatDisputeNotice(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-notice-stopped') return chatNoticeStopped(body, reply);
    if (isPlainObject(body) && body.kind === 'chat-grant-refused') return chatGrantRefused(body, reply);
    if (isPlainObject(body) && body.kind === 'log-checkpoint') return logCheckpoint(body, reply);
    if (isPlainObject(body) && body.kind === 'log-alarm') return logAlarm(body, reply);
    if (isPlainObject(body) && body.kind === 'ruling-statement') return rulingStatement(body, reply);
    if (isPlainObject(body) && body.kind === 'ruling-wait') return rulingWait(body, reply);
    if (isPlainObject(body) && body.kind === 'ruling-refused') return rulingRefused(body, reply);
    if (isPlainObject(body) && body.kind === 'after-refund-statement') return afterRefundStatement(body, reply);
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
