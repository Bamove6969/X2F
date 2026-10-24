/**
 * GUESSED interfaces of tasks not on the main line yet, kept in this one file so they are easy
 * to swap for the real modules. Each guess has a tripwire in test/adapters-tripwire.test.ts that
 * fails once the real module exists; then delete the guess here and import the real one.
 *
 * - Task 8 (`packages/trade/src/{attestation,checkWords}.ts`, `apps/api/src/trades/identity.ts`):
 *   Attestation, attestationBytes, verifyAttestation, AttestationError, escrowCheckWords,
 *   identityProofBytes and the identity/attestation routes, from the plan's Task 8 text.
 * - Task 6 (`apps/api/src/trades/view.ts`): the TradeView fields this runtime reads.
 */
import { ROLES, normalizeTradeCode, type Role } from '@x2f/core';
import { canonicalJson, type Participants } from '@x2f/protocol';
import { CHANNEL_KINDS, SETTLE_KINDS, channelFor, type ChannelKind, type SettleKind, type TradeState } from '@x2f/trade';
import sodium from 'libsodium-wrappers';

// ── Task 8: attestation ──────────────────────────────────────────────────────

/**
 * What the moderator attests about the deal (lead 2026-10-24, answer 4; Task 8 builds the
 * moderator side): the deal fixed at take and both sides' addresses. Bigints are decimal strings
 * (canonical JSON has no bigints). A trade attestation must carry it; a chat attestation does not.
 */
export interface AttestedTerms {
  deal: { poster: 'buyer' | 'seller'; takeAmountAtomic: string; currency: string; centsPerXmr: string; maxFiatCents: string };
  /** The buyer's payout address and the seller's refund address. */
  buyerPayout: string;
  sellerRefund: string;
}

export interface Attestation {
  v: 1;
  trade: string;
  channels: Partial<Record<ChannelKind, string>>;
  participants: Participants;
  issuedAt: string;
  terms: AttestedTerms;
}

/** `wrong-terms` is an addition: the attested deal or this device's own address is not what the user confirmed. */
export type AttestationErrorCode = 'bad-signature' | 'not-me' | 'wrong-trade' | 'wrong-channel' | 'wrong-terms';

export class AttestationError extends Error {
  constructor(readonly code: AttestationErrorCode) {
    super(code);
    this.name = 'AttestationError';
  }
}

const enc = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export function attestationBytes(a: Attestation): Uint8Array {
  return enc.encode(`x2f/attestation/v1\0${canonicalJson(a)}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function wellFormed(a: unknown): a is Attestation {
  if (!isRecord(a) || a.v !== 1 || typeof a.trade !== 'string' || typeof a.issuedAt !== 'string') return false;
  if (!isRecord(a.channels) || !Object.keys(a.channels).every((k) => (CHANNEL_KINDS as readonly string[]).includes(k) && typeof (a.channels as Record<string, unknown>)[k] === 'string')) return false;
  const p = a.participants;
  if (!isRecord(p) || Object.keys(p).length !== 3) return false;
  const signs = new Set<string>();
  for (const r of ROLES) {
    const k = p[r];
    if (!isRecord(k) || typeof k.signPublic !== 'string' || typeof k.boxPublic !== 'string' || !HEX64.test(k.signPublic) || !HEX64.test(k.boxPublic)) return false;
    signs.add(k.signPublic);
  }
  if (signs.size !== 3) return false;
  const t = a.terms;
  if (!isRecord(t) || !exactKeys(t, ['deal', 'buyerPayout', 'sellerRefund'])) return false;
  if (typeof t.buyerPayout !== 'string' || typeof t.sellerRefund !== 'string' || t.buyerPayout === '' || t.sellerRefund === '' || t.buyerPayout.length > 256 || t.sellerRefund.length > 256) return false;
  const d = t.deal;
  if (!isRecord(d) || !exactKeys(d, ['poster', 'takeAmountAtomic', 'currency', 'centsPerXmr', 'maxFiatCents'])) return false;
  return (d.poster === 'buyer' || d.poster === 'seller') && typeof d.currency === 'string' && [d.takeAmountAtomic, d.centsPerXmr, d.maxFiatCents].every((x) => typeof x === 'string' && DECIMAL.test(x));
}

const DECIMAL = /^[1-9]\d{0,30}$/;

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/** The attested deal equals this device's confirmed deal, field by field. */
export function attestedDealIs(t: AttestedTerms, d: { poster: string; takeAmountAtomic: bigint; currency: string; centsPerXmr: bigint; maxFiatCents: bigint }): boolean {
  return (
    t.deal.poster === d.poster &&
    t.deal.currency === d.currency &&
    t.deal.takeAmountAtomic === d.takeAmountAtomic.toString() &&
    t.deal.centsPerXmr === d.centsPerXmr.toString() &&
    t.deal.maxFiatCents === d.maxFiatCents.toString()
  );
}

/**
 * Throws unless `sig` is the moderation key's signature over the attestation, it is for
 * `code` with the escrow and signals channels derived from it, and this device's own keys sit
 * in its own slot. Async because channelFor is (Revision 2026-10-23); the plan's Task 8 text
 * has it sync.
 */
export async function verifyAttestation(
  a: unknown,
  sig: unknown,
  modSigningPublic: string,
  me: {
    role: 'buyer' | 'seller';
    signPublic: string;
    boxPublic?: string;
    /** What the user confirmed on this device; the attested terms must match it. */
    deal?: { poster: string; takeAmountAtomic: bigint; currency: string; centsPerXmr: bigint; maxFiatCents: bigint };
    ownAddress?: string;
  },
  code: string,
): Promise<void> {
  await sodium.ready;
  if (!wellFormed(a) || typeof sig !== 'string' || !HEX128.test(sig) || !HEX64.test(modSigningPublic)) throw new AttestationError('bad-signature');
  if (!sodium.crypto_sign_verify_detached(sodium.from_hex(sig), attestationBytes(a), sodium.from_hex(modSigningPublic))) {
    throw new AttestationError('bad-signature');
  }
  const normalized = normalizeTradeCode(code);
  if (normalized === null || a.trade !== normalized) throw new AttestationError('wrong-trade');
  for (const kind of ['escrow', 'signals'] as const) {
    if (a.channels[kind] !== (await channelFor(normalized, kind))) throw new AttestationError('wrong-channel');
  }
  const slot = a.participants[me.role];
  if (slot.signPublic !== me.signPublic || (me.boxPublic !== undefined && slot.boxPublic !== me.boxPublic)) throw new AttestationError('not-me');
  if (me.deal !== undefined && !attestedDealIs(a.terms, me.deal)) throw new AttestationError('wrong-terms');
  if (me.ownAddress !== undefined && (me.role === 'buyer' ? a.terms.buyerPayout : a.terms.sellerRefund) !== me.ownAddress) throw new AttestationError('wrong-terms');
}

/**
 * Four check words for the escrow, equal on every device with the same participants and
 * address. GUESS: the real Task 8 list is a bundled 2048-word list; until then four 4-hex
 * groups of SHA-256 over both, which already make the comparison work.
 */
export async function escrowCheckWords(participants: Participants, escrowAddress: string): Promise<[string, string, string, string]> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`x2f/check-words/v1\0${canonicalJson({ participants, escrowAddress })}`)));
  const hex = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
}

/** What the trade identity signs to prove it holds the key (Task 8 `proof`). */
export function identityProofBytes(code: string, role: Role, signPublic: string, boxPublic: string): Uint8Array {
  return enc.encode(`x2f/trade-identity/v1\0${code}\0${role}\0${signPublic}${boxPublic}`);
}

// ── Task 6: TradeView ────────────────────────────────────────────────────────

const STATES: readonly TradeState[] = ['setup', 'funding', 'securing', 'secured', 'paid', 'refund_requested', 'settling', 'released', 'refunded', 'lapsed', 'cancelled', 'disputed'];

/** The parts of `GET /v1/trades/:code` the escrow runtime reads (bigints arrive as decimal strings). */
export interface EscrowTradeView {
  role: 'buyer' | 'seller';
  state: TradeState;
  poster: 'seller' | 'buyer';
  amountAtomic: bigint;
  /**
   * GUESS: the viewer's own address for this trade, if the view carries it. Never used as the
   * source (the runtime takes the address the user confirmed on this device); a different one
   * here is a mismatch.
   */
  ownAddress: string | null;
  /** The locked rate and the offer maximum, fixed at take (OD-5, Revision 2026-10-20). */
  currency: string;
  centsPerXmr: bigint;
  maxFiatCents: bigint;
  settling: SettleKind | null;
  /** GUESS (Task 2's Trade field): who has a mutual-cancel proposal standing, if anyone. */
  cancelProposedBy: 'buyer' | 'seller' | null;
  paidAt: string | null;
}

const big = (v: unknown): bigint | null => (typeof v === 'string' && /^(?:0|[1-9]\d{0,30})$/.test(v) ? BigInt(v) : null);

/** Reads a TradeView, or null if it lacks what the runtime needs. */
export function parseTradeView(v: unknown): EscrowTradeView | null {
  if (!isRecord(v)) return null;
  const lockedRate = isRecord(v.lockedRate) ? v.lockedRate : null;
  const amountAtomic = big(v.amountAtomic);
  const centsPerXmr = big(lockedRate?.centsPerXmr);
  const maxFiatCents = big(v.maxFiatCents);
  if (v.role !== 'buyer' && v.role !== 'seller') return null;
  if (v.poster !== 'buyer' && v.poster !== 'seller') return null;
  if (typeof v.state !== 'string' || !STATES.includes(v.state as TradeState)) return null;
  if (amountAtomic === null || amountAtomic <= 0n || centsPerXmr === null || maxFiatCents === null) return null;
  if (typeof lockedRate?.currency !== 'string') return null;
  const settling = typeof v.settling === 'string' && (SETTLE_KINDS as readonly string[]).includes(v.settling) ? (v.settling as SettleKind) : null;
  return {
    role: v.role,
    state: v.state as TradeState,
    poster: v.poster,
    amountAtomic,
    ownAddress: typeof v.ownAddress === 'string' && v.ownAddress !== '' ? v.ownAddress : null,
    currency: lockedRate.currency,
    centsPerXmr,
    maxFiatCents,
    settling,
    cancelProposedBy: v.cancelProposedBy === 'buyer' || v.cancelProposedBy === 'seller' ? v.cancelProposedBy : null,
    paidAt: typeof v.paidAt === 'string' ? v.paidAt : null,
  };
}

// ── Tasks 6 and 8: the routes the runtime calls ─────────────────────────────

/**
 * The escrow runtime's API calls over a same-origin fetch (the worker's own; no redirects, the
 * page's api() handles Terms and wallet redirects). GUESS for the Task 8 routes' answers:
 * identity 200/201 (409 `identity-exists` counts as registered), attestation 200
 * `{ attestation, sig }` or 202 while it is not ready.
 */
export function httpEscrowApi(f: typeof fetch = (u, i) => fetch(u, i)) {
  const path = (code: string, rest = ''): string => `/v1/trades/${encodeURIComponent(code)}${rest}`;
  const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
    f(url, { ...init, credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  const fail = async (res: Response): Promise<never> => {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw Object.assign(new Error(`api ${res.status}`), { status: res.status, code: typeof body?.error === 'string' ? body.error : 'internal' });
  };
  return {
    async getTrade(code: string): Promise<unknown> {
      const res = await call(path(code));
      return res.ok ? res.json() : fail(res);
    },
    async registerIdentity(code: string, body: { signPublic: string; boxPublic: string; proof: string }): Promise<void> {
      const res = await call(path(code, '/identity'), { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) return;
      if (res.status === 409) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'identity-exists') return;
      }
      await fail(res);
    },
    async getAttestation(code: string): Promise<{ attestation: unknown; sig: unknown } | null> {
      const res = await call(path(code, '/attestation'));
      if (res.status === 202) return null;
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { attestation?: unknown; sig?: unknown } | null;
      return { attestation: b?.attestation, sig: b?.sig };
    },
  };
}
