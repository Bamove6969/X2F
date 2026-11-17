import { normalizeTradeCode } from '@x2f/core';
import type { Participants } from '@x2f/protocol';
import { lienCreditorsOf, type LienSide } from '@x2f/staff';
import {
  LIEN_DEFAULT_RATE_BPS,
  LIEN_RECOVERY_MAX_BPS,
  LIEN_RECOVERY_MIN_ATOMIC,
  buyerProceeds,
  escrowPlan,
  expectedRecovery,
  lienRecoveryCap,
  recoveryAddressValid,
  signLienStatement,
  type AttestedTerms,
  type LienStatement,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type pg from 'pg';
import { gateCheck, noteCounter, recordedTerms, syncRegistry, verifyTap, type GateContext, type GateSource, type GateState, type GateStore, type RecordedTerms, type StoredTap } from './gate/index.js';
import type { RulingSource } from './execute.js';
import { fromJson } from './shadow.js';

/**
 * Lien recovery, review B1 (security, 2026-11-16; docs/lien-recovery.md), with the provisional owner
 * answers of 17 Nov 2026. Under the threat model of the reviews (the API and its database
 * compromised; gate.bin, the MOD_* secrets and honest staff keys not), this service signs a
 * `lienRecovery` only when its own records back it, and then only the exact figure:
 *
 * 1. the work item names the recovery's source and lien (`lienSource`: the disputed trade, the
 *    creditor's side in it, the lien, its parties, this trade's buyer and the rate), and that trade
 *    is one this service attested (`signed_terms`);
 * 2. the rulings of that trade's dispute, as this service's gate verifies them (staff key taps
 *    rooted in the owner's pinned keys, never the API's rows), make that side a lien's creditor
 *    (`lienCreditorsOf`);
 * 3. Q2: the recovery pays the address the CREDITOR's own device signed for it (@x2f/trade
 *    RecoveryAddressStatement), checked against that side's trade identity in the source trade as
 *    this service attested it; never one of this trade's own addresses or the fee wallet (B2);
 * 4. the lien's debtor is this trade's buyer, and the lien's source, side, parties and amount are
 *    the ones this service pinned the first time it saw the lien (`mod_liens`);
 * 5. Q1: the rate is the one this service last applied to the lien (the 50% default until then),
 *    or a rate up to 90% that a senior moderator's (or the owner's) `lien-rate` key tap approved for
 *    this lien, verified by its gate (`LienRates`), that it has not applied before. A tap it has
 *    applied is spent for the lien: an API cannot replay an old approval, nor go back to the default
 *    once another rate was applied, without a new tap (the replaced rate stays good for
 *    LIEN_RATE_GRACE_HOURS, for trades the buyer accepted before the change);
 * 6. the amount is exactly @x2f/trade `expectedRecovery` of the buyer's proceeds at that rate, on
 *    what is left of the lien (its amount less every recovery this service signed for it and has not
 *    seen end without paying), never past the source trade's XMR in total (`mod_lien_recoveries`,
 *    rule 2), under the same advisory lock;
 * 7. it then signs a LienStatement for the lien (kept in `mod_liens`, posted to the API).
 *
 * What a compromised API can still do (docs/lien-recovery.md): name a real lien against a buyer
 * who is not its debtor (account ids are its word; this service pins them on first sight). The
 * money then still goes only to the real creditor's own signed address, within the lien's total,
 * at the verified rate, and the buyer's device refuses any figure the buyer did not accept on the
 * quote before the take.
 *
 * Re-review N1: all of this runs only while this service's own switch is on (`MOD_LIEN_RECOVERY=on`,
 * off by default); while it is off every recovery is refused (`off`) and no lien statement is signed.
 *
 * A refusal is never final (the traders did nothing wrong): the work is logged
 * (`lien-refused-<reason>`) and skipped, like malformed terms.
 */
export type LienRefusal =
  | 'off'
  | 'no-source'
  | 'bad-source'
  | 'no-authority'
  | 'source-unknown'
  | 'wrong-address'
  | 'not-creditor'
  | 'not-debtor'
  | 'lien-changed'
  | 'rate-unverified'
  | 'over-rate'
  | 'over-owed'
  | 'not-expected';

export class LienRefused extends Error {
  constructor(readonly reason: LienRefusal) {
    super(`lien-refused-${reason}`);
    this.name = 'LienRefused';
  }
}

/** The work item's claim of where its recovery comes from (apps/api internal/routes.ts); every field is the API's word. */
export interface LienSource {
  fromCode: string;
  creditor: LienSide;
  lienId: string;
  debtorAccount: string;
  creditorAccount: string;
  /** This trade's buyer account. */
  buyerAccount: string;
  rateBps: number;
  /** Q2: the creditor device's signed statement of the address (RecoveryAddressStatement) and its signature. */
  address: { statement: unknown; sig: unknown };
}

/**
 * Q1: the rates a senior moderator's (or the owner's) `lien-rate` key taps approved for `lienId`,
 * each verified by the gate, with the tap's nonce (which the gate binds to that lien and rate).
 */
export interface LienRates {
  approvals(lienId: string): Promise<ReadonlyArray<{ rateBps: number; nonce: string }>>;
}

/** The creditor sides of a trade's dispute rulings, each verified by the gate; null when none verifies (or there is no gate). */
export interface LienRulings {
  creditors(code: string, recorded: RecordedTerms): Promise<readonly LienSide[] | null>;
}

/** A recovery this service may sign, to be recorded with the attestation (`recordLienRecovery`). */
export interface CheckedRecovery {
  source: string;
  creditor: LienSide;
  amountAtomic: bigint;
  /** The source trade's XMR, as the gate verified the rulings against it: the lien's most. */
  owedAtomic: bigint;
  /** The buyer's proceeds on this trade, for the exact figure (`expectedRecovery`). */
  proceedsAtomic: bigint;
  lienId: string;
  debtor: string;
  creditorAccount: string;
  rateBps: number;
  /** The nonces of the verified rate taps this recovery spends (applied: never again a reason for a rate change). */
  rateTaps: string[];
}

export interface LienCheckDeps {
  /** Re-review N1: this service's own switch (`MOD_LIEN_RECOVERY=on`). False: every recovery is refused (`off`). */
  enabled: boolean;
  db: Pick<pg.Pool, 'query'>;
  feeWallet: string;
  rulings: LienRulings | null;
  /** Absent or null: only the default rate is ever signed. */
  rates?: LienRates | null;
}

/** The source trade's terms as this service signed and posted them, and its recorded terms (its own shadow trade when it has one). */
async function sourceFacts(db: Pick<pg.Pool, 'query'>, code: string, feeWallet: string): Promise<{ terms: AttestedTerms; recorded: RecordedTerms; participants: Participants } | null> {
  const { rows } = await db.query<{ attestation: { terms?: AttestedTerms; participants?: Participants } }>('select attestation from signed_terms where trade = $1 and posted_at is not null', [code]);
  const terms = rows[0]?.attestation.terms;
  const participants = rows[0]?.attestation.participants;
  if (terms === undefined || participants === undefined) return null;
  // The trade as this service's own desk saw it (it may have grown since take), else the attested deal.
  const desk = await db.query<{ record: unknown }>('select record from mod_trade_desk where trade = $1', [code]);
  type Shadow = { amountAtomic?: unknown; feeAtomic?: unknown; sellerFundsAtomic?: unknown; poster?: unknown };
  const shadowOf = (record: unknown): Shadow | null => {
    try {
      return (fromJson(record) as { shadow?: Shadow | null }).shadow ?? null;
    } catch {
      return null;
    }
  };
  const shadow = desk.rows[0] === undefined ? null : shadowOf(desk.rows[0].record);
  let trade: { amountAtomic: bigint; feeAtomic: bigint; sellerFundsAtomic: bigint; poster: 'buyer' | 'seller' };
  if (
    shadow !== null && typeof shadow.amountAtomic === 'bigint' && typeof shadow.feeAtomic === 'bigint' && typeof shadow.sellerFundsAtomic === 'bigint' &&
    (shadow.poster === 'buyer' || shadow.poster === 'seller')
  ) {
    trade = { amountAtomic: shadow.amountAtomic, feeAtomic: shadow.feeAtomic, sellerFundsAtomic: shadow.sellerFundsAtomic, poster: shadow.poster };
  } else {
    const take = BigInt(terms.deal.takeAmountAtomic);
    const plan = escrowPlan({ amountAtomic: take, poster: terms.deal.poster });
    trade = { amountAtomic: take, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: terms.deal.poster };
  }
  try {
    return { terms, recorded: recordedTerms({ terms, trade, feeWallet }), participants };
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCE_KEYS = ['address', 'buyerAccount', 'creditor', 'creditorAccount', 'debtorAccount', 'fromCode', 'lienId', 'rateBps'].join(',');

/**
 * Checks the work item's recovery (rules 1 to 5 above) against this service's own records. Null
 * when the terms carry none (and the item names no source); throws LienRefused otherwise. The exact
 * figure (rule 6) is checked by `recordLienRecovery`, under the lien's lock.
 */
export async function checkLienRecovery(w: { trade: string; terms: AttestedTerms; lienSource?: unknown }, d: LienCheckDeps): Promise<CheckedRecovery | null> {
  const rec = w.terms.lienRecovery;
  const src = w.lienSource;
  if (rec === undefined) {
    if (src !== undefined) throw new LienRefused('bad-source');
    return null;
  }
  // Re-review N1: nothing outside the API switched recovery on, so nothing carrying one is signed.
  if (!d.enabled) throw new LienRefused('off');
  if (src === undefined || src === null) throw new LienRefused('no-source');
  if (typeof src !== 'object' || Array.isArray(src)) throw new LienRefused('bad-source');
  const s = src as Record<string, unknown>;
  const fromCode = typeof s.fromCode === 'string' ? normalizeTradeCode(s.fromCode) : null;
  const creditor = s.creditor;
  const ids = [s.lienId, s.debtorAccount, s.creditorAccount, s.buyerAccount];
  if (
    Object.keys(s).sort().join(',') !== SOURCE_KEYS || fromCode === null || (creditor !== 'buyer' && creditor !== 'seller') ||
    !ids.every((x) => typeof x === 'string' && UUID.test(x)) || s.debtorAccount === s.creditorAccount ||
    typeof s.address !== 'object' || s.address === null || Array.isArray(s.address)
  ) {
    throw new LienRefused('bad-source');
  }
  if (fromCode === normalizeTradeCode(w.trade)) throw new LienRefused('bad-source');
  const lienId = s.lienId as string;
  const debtor = s.debtorAccount as string;
  const creditorAccount = s.creditorAccount as string;
  // Rule 4: the lien's debtor is this trade's buyer.
  if (debtor !== s.buyerAccount) throw new LienRefused('not-debtor');
  // Rule 5 (Q1): a rate outside 1..90% is never signed.
  const rateBps = s.rateBps;
  if (typeof rateBps !== 'number' || !Number.isSafeInteger(rateBps) || rateBps < 1 || rateBps > LIEN_RECOVERY_MAX_BPS) throw new LienRefused('over-rate');
  const amount = BigInt(rec.amountAtomic);
  const proceeds = buyerProceeds(w.terms.deal);
  // The shared limits every co-signer applies (B1, B3, Q1, Q5); the exact figure comes later.
  if (amount < LIEN_RECOVERY_MIN_ATOMIC || amount > lienRecoveryCap(proceeds)) throw new LienRefused('over-rate');
  if (d.rulings === null) throw new LienRefused('no-authority');
  const facts = await sourceFacts(d.db, fromCode, d.feeWallet);
  if (facts === null) throw new LienRefused('source-unknown');
  // Rule 3 (Q2, B2): the creditor's own signed address, checked against its identity in the source
  // trade as this service attested it; never one of this trade's addresses or the fee wallet.
  const a = s.address as Record<string, unknown>;
  const st = a.statement;
  const signer = facts.participants[creditor].signPublic;
  await sodium.ready;
  if (
    !recoveryAddressValid(st, a.sig, signer) || st.fromCode !== fromCode || st.creditorSide !== creditor || st.address !== rec.address ||
    rec.address === w.terms.buyerPayout || rec.address === w.terms.sellerRefund || rec.address === d.feeWallet
  ) {
    throw new LienRefused('wrong-address');
  }
  // Rule 4: the parties, source and amount this service pinned for the lien the first time.
  const pinned = (
    await d.db.query<{ source_code: string; creditor_side: string; debtor: string; creditor: string; amount_atomic: string; rate_bps: number }>(
      'select source_code, creditor_side, debtor, creditor, amount_atomic::text, rate_bps from mod_liens where lien_id = $1',
      [lienId],
    )
  ).rows[0];
  if (
    pinned !== undefined &&
    (pinned.source_code !== fromCode || pinned.creditor_side !== creditor || pinned.debtor !== debtor || pinned.creditor !== creditorAccount ||
      pinned.amount_atomic !== facts.recorded.amountAtomic.toString())
  ) {
    throw new LienRefused('lien-changed');
  }
  const sides = await d.rulings.creditors(fromCode, facts.recorded);
  if (sides === null) throw new LienRefused('no-authority');
  if (!sides.includes(creditor)) throw new LienRefused('not-creditor');
  // Rule 5 (Q1): the rate this service last applied (the default until then), or a change a
  // senior's key tap approved that it has not applied yet (verified by its gate). Applying one spends
  // every new tap for the lien, so none is ever a reason for a change again.
  const rateTaps = await newRateTaps(d, lienId);
  const current = pinned?.rate_bps ?? LIEN_DEFAULT_RATE_BPS;
  let spends: string[] = [];
  if (rateBps !== current) {
    if (rateTaps.some((t) => t.rateBps === rateBps)) spends = rateTaps.map((t) => t.nonce);
    else if (!(await justReplaced(d, lienId, rateBps))) throw new LienRefused('rate-unverified');
  }
  return {
    source: fromCode, creditor, amountAtomic: amount, owedAtomic: facts.recorded.amountAtomic, proceedsAtomic: proceeds,
    lienId, debtor, creditorAccount, rateBps, rateTaps: spends,
  };
}

/**
 * How long a rate this service replaced stays good for trades reserved before the change
 * (`LIEN_RATE_GRACE_HOURS`): a buyer who accepted a figure on the quote at the old rate, and whose
 * trade is attested after another trade applied the new one, still gets the figure it accepted.
 */
export const LIEN_RATE_GRACE_HOURS = 24;

/** Whether `rateBps` is the rate the lien's last applied change replaced, less than LIEN_RATE_GRACE_HOURS ago (this service's clock). */
async function justReplaced(d: LienCheckDeps, lienId: string, rateBps: number): Promise<boolean> {
  const { rows } = await d.db.query<{ from_rate_bps: number; recent: boolean }>(
    `select from_rate_bps, applied_at > now() - make_interval(hours => $2) as recent from mod_lien_rate_taps
      where lien_id = $1 order by applied_at desc, nonce limit 1`,
    [lienId, LIEN_RATE_GRACE_HOURS],
  );
  return rows[0] !== undefined && rows[0].recent && rows[0].from_rate_bps === rateBps;
}

/** The gate-verified rate taps for `lienId` this service has not applied yet (`mod_lien_rate_taps`). */
async function newRateTaps(d: LienCheckDeps, lienId: string): Promise<Array<{ rateBps: number; nonce: string }>> {
  if (d.rates == null) return [];
  const all = await d.rates.approvals(lienId);
  if (all.length === 0) return [];
  const { rows } = await d.db.query<{ nonce: string }>('select nonce from mod_lien_rate_taps where lien_id = $1', [lienId]);
  const spent = new Set(rows.map((r) => r.nonce));
  return all.filter((t) => !spent.has(t.nonce) && Number.isSafeInteger(t.rateBps) && t.rateBps >= 1 && t.rateBps <= LIEN_RECOVERY_MAX_BPS).map((t) => ({ ...t }));
}

/**
 * Rules 6 and 7, inside the transaction that stores the attestation, serialised per source
 * (advisory lock): the amount is exactly `expectedRecovery` on what is left of the lien after every
 * recovery signed for it and not freed, and with every recovery signed for the same source it stays
 * within the source's XMR; then the lien is pinned (first sight) and its LienStatement signed and
 * kept (`mod_liens`) when new or its rate changed. Throws LienRefused, and the caller rolls back.
 * Returns the statement to post to the API, or null when it was already kept.
 */
export async function recordLienRecovery(
  c: pg.PoolClient,
  trade: string,
  r: CheckedRecovery,
  sign: { signingSecret: Uint8Array; now: Date },
): Promise<{ statement: LienStatement; sig: string } | null> {
  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`x2f-lien:${r.source}:${r.creditor}`]);
  const sum = async (where: string, args: unknown[]): Promise<bigint> =>
    BigInt((await c.query<{ s: string }>(`select coalesce(sum(amount_atomic), 0)::text as s from mod_lien_recoveries where ${where} and freed_at is null and trade <> $1`, [trade, ...args])).rows[0]!.s);
  const forSource = await sum('source_code = $2 and creditor = $3', [r.source, r.creditor]);
  if (forSource + r.amountAtomic > r.owedAtomic) throw new LienRefused('over-owed');
  const forLien = await sum('lien_id = $2', [r.lienId]);
  const left = r.owedAtomic > forLien ? r.owedAtomic - forLien : 0n;
  if (expectedRecovery({ proceedsAtomic: r.proceedsAtomic, rateBps: r.rateBps, leftAtomic: left }) !== r.amountAtomic) throw new LienRefused('not-expected');
  const kept = (await c.query<{ rate_bps: number }>('select rate_bps from mod_liens where lien_id = $1 for update', [r.lienId])).rows[0];
  let out: { statement: LienStatement; sig: string } | null = null;
  // First sight, or a rate change this recovery applies (it spends taps); a recovery at the rate just
  // replaced (the grace period) changes nothing kept.
  if (kept === undefined || (r.rateTaps.length > 0 && kept.rate_bps !== r.rateBps)) {
    const statement: LienStatement = {
      v: 1, lienId: r.lienId, fromCode: r.source, creditorSide: r.creditor, debtor: r.debtor, creditor: r.creditorAccount,
      amountAtomic: r.owedAtomic.toString(), rateBps: r.rateBps, issuedAt: sign.now.toISOString(),
    };
    const sig = await signLienStatement(statement, sign.signingSecret);
    await c.query(
      `insert into mod_liens (lien_id, source_code, creditor_side, debtor, creditor, amount_atomic, rate_bps, statement, sig, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (lien_id) do update set rate_bps = excluded.rate_bps, statement = excluded.statement, sig = excluded.sig, posted_at = null, updated_at = excluded.updated_at`,
      [r.lienId, r.source, r.creditor, r.debtor, r.creditorAccount, r.owedAtomic.toString(), r.rateBps, statement, sig, sign.now],
    );
    out = { statement, sig };
  }
  await c.query(
    'insert into mod_lien_recoveries (trade, lien_id, source_code, creditor, amount_atomic) values ($1, $2, $3, $4, $5) on conflict (trade) do nothing',
    [trade, r.lienId, r.source, r.creditor, r.amountAtomic.toString()],
  );
  // Q1: the rate taps this change applied are spent for the lien (an old approval is never replayed).
  const from = kept?.rate_bps ?? LIEN_DEFAULT_RATE_BPS;
  for (const nonce of r.rateTaps) {
    await c.query(
      'insert into mod_lien_rate_taps (nonce, lien_id, rate_bps, from_rate_bps, trade) values ($1, $2, $3, $4, $5) on conflict (nonce) do nothing',
      [nonce, r.lienId, r.rateBps, from, trade],
    );
  }
  return out;
}

/** Lien statements this service signed and the API has not taken yet (posted by `postLienStatements`). */
export async function unpostedLienStatements(db: Pick<pg.Pool, 'query'>): Promise<Array<{ lienId: string; statement: LienStatement; sig: string }>> {
  const { rows } = await db.query<{ lien_id: string; statement: LienStatement; sig: string }>('select lien_id, statement, sig from mod_liens where posted_at is null order by updated_at');
  return rows.map((r) => ({ lienId: r.lien_id, statement: r.statement, sig: r.sig }));
}

export async function markLienStatementPosted(db: Pick<pg.Pool, 'query'>, lienId: string, sig: string): Promise<void> {
  await db.query('update mod_liens set posted_at = now() where lien_id = $1 and sig = $2', [lienId, sig]);
}

/**
 * Q1 (provisional, 17 Nov 2026): the gate-backed LienRates. A rate is approved for a lien by each
 * used `lien-rate` tap that names that lien and a rate of at most LIEN_RECOVERY_MAX_BPS, by a
 * senior moderator or the owner, verifies against the gate's registry (the key the gate trusts for
 * that person, the WebAuthn assertion over the tap's challenge on the staff origin), and whose nonce
 * was never used for anything else (it is bound here to this lien and rate). The registry is synced
 * first, so a switch-off already counts.
 */
export function lienRateVerifier(o: { store: GateStore; source: GateSource; ctx: GateContext }): LienRates {
  return {
    approvals: (lienId) =>
      o.store.exclusive(async () => {
        await syncRegistry(o.source, o.store.state, o.ctx);
        const ok = await lienRateTaps(o.store.state, await o.source.usedTaps(['lien-rate']), lienId, o.ctx);
        await o.store.save();
        return ok;
      }),
  };
}

/** The pure part of `lienRateVerifier`, on gate state `g` and the API's stored `lien-rate` taps: every verified approval for `lienId`. Binds each nonce it relied on. */
export async function lienRateTaps(g: GateState, taps: readonly StoredTap[], lienId: string, ctx: GateContext): Promise<Array<{ rateBps: number; nonce: string }>> {
  if (g.ownerAccountId === null || g.stopped) return [];
  const out: Array<{ rateBps: number; nonce: string }> = [];
  for (const tap of taps) {
    const c = await verifyTap(g, tap, ctx);
    if (!c.ok || c.intent.kind !== 'lien-rate' || c.intent.lienId !== lienId) continue;
    const rateBps = c.intent.rateBps;
    if (!Number.isSafeInteger(rateBps) || rateBps < 1 || rateBps > LIEN_RECOVERY_MAX_BPS) continue;
    if (c.role !== 'senior' && c.role !== 'owner') {
      ctx.log({ reason: 'gate.refused.lien-rate-role' });
      continue;
    }
    const use = `lien-rate:${lienId}:${rateBps}`;
    const bound = Object.hasOwn(g.usedNonces, tap.nonceHex) ? g.usedNonces[tap.nonceHex] : undefined;
    if (bound !== undefined && bound !== use) {
      ctx.log({ reason: 'gate.refused.nonce-reused' });
      continue;
    }
    g.usedNonces[tap.nonceHex] = use;
    noteCounter(g, c.accountId, c.credentialId, c.counter);
    out.push({ rateBps, nonce: tap.nonceHex });
  }
  return out;
}

/** Whether a verified tap approves exactly `want.rateBps` for `want.lienId` (`lienRateTaps`). */
export async function lienRateApproved(g: GateState, taps: readonly StoredTap[], want: { lienId: string; rateBps: number }, ctx: GateContext): Promise<boolean> {
  if (!Number.isSafeInteger(want.rateBps) || want.rateBps < 1 || want.rateBps > LIEN_RECOVERY_MAX_BPS) return false;
  return (await lienRateTaps(g, taps, want.lienId, ctx)).some((t) => t.rateBps === want.rateBps);
}

/**
 * Review M2: the watcher counted a sweep for `trade` that pays its signed recovery (a release, or a
 * ruling for the buyer, after late coins on a trade it had seen refunded): the recovery counts
 * against its lien again, so this service never signs past what is owed.
 */
export async function unfreeLienRecoveries(db: Pick<pg.Pool, 'query'>, trade: string): Promise<void> {
  await db.query('update mod_lien_recoveries set freed_at = null where trade = $1 and freed_at is not null', [trade]);
}

/** The watcher saw `trade` end without paying its recovery: it no longer counts against its lien. */
export async function freeLienRecoveries(db: Pick<pg.Pool, 'query'>, trade: string): Promise<void> {
  await db.query('update mod_lien_recoveries set freed_at = now() where trade = $1 and freed_at is null', [trade]);
}

/**
 * The gate-backed LienRulings: the source trade's round-1 ruling (and its appeal's, if published)
 * as the API stores them, each checked by the gate with its stored taps (`gateCheck` with
 * `verifyOnly`: nothing is settled or co-signed), then `lienCreditorsOf`. Any ruling that does not
 * verify: null.
 */
export function lienRulingVerifier(o: { store: GateStore; source: Pick<RulingSource, 'storedRulings' | 'rulingTaps' | 'ownerKeys' | 'usedTaps' | 'credential' | 'invite' | 'staff'>; ctx: GateContext }): LienRulings {
  return {
    async creditors(code, recorded) {
      const stored = await o.source.storedRulings(code);
      const r1 = stored.current?.round === 1 ? stored.current : stored.round1;
      if (r1 === null) return null;
      const a1 = await gateCheck(o.store, o.source, { ruling: r1, recorded, balanceAtomic: 0n, verifyOnly: true }, o.ctx);
      if (!a1.ok) return null;
      let r2 = null;
      if (stored.current !== null && stored.current.round === 2) {
        const a2 = await gateCheck(o.store, o.source, { ruling: stored.current, recorded, balanceAtomic: 0n, involved: stored.involved, verifyOnly: true }, o.ctx);
        if (!a2.ok) return null;
        r2 = stored.current.outcome;
      }
      return lienCreditorsOf(r1.outcome, r2);
    },
  };
}
