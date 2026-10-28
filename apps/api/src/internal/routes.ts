import { createHash } from 'node:crypto';
import { normalizeTradeCode } from '@x2f/core';
import {
  attestationBytes,
  channelFor,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  isAttestedTerms,
  type Attestation,
  type AttestedTerms,
} from '@x2f/trade';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';

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
}

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
    // Only a trade that is (or was) work: both identities registered and no attestation.
    const { rowCount } = await o.db.query(
      `insert into trade_refusals (code, reason, created_at)
       select t.code, $2, now()
         from trades t
         join trade_identities bi on bi.code = t.code and bi.role = 'buyer'
         join trade_identities si on si.code = t.code and si.role = 'seller'
         left join trade_attestations a on a.code = t.code
        where t.code = $1 and a.code is null
       on conflict (code) do nothing`,
      [code, reason],
    );
    if (rowCount === 0) {
      const again = await o.db.query('select 1 from trade_refusals where code = $1', [code]);
      if (again.rows.length === 0) throw new Refused(409, 'not-refusable');
    }
    log({ reason: 'internal-refused' });
    return reply.code(201).send({ ok: true });
  };

  // The trades that both traders have registered an identity for, with both addresses on record,
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
    log({ reason: 'internal-attested' });
    return reply.code(201).send({ ok: true });
  }));

  return app;
}
