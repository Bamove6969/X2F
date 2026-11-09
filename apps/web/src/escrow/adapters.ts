/**
 * The escrow runtime's reading of the API: the TradeView fields it reads (Task 6,
 * `apps/api/src/trades/view.ts`) and the trade, identity and attestation routes (Tasks 6 and 8).
 * The attestation, its terms check, the check words and the identity proof come from
 * `@x2f/trade` (Task 8).
 */
import { SETTLE_KINDS, type SettleKind, type TradeState } from '@x2f/trade';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// ── Task 6: TradeView ────────────────────────────────────────────────────────

const STATES: readonly TradeState[] = ['setup', 'funding', 'securing', 'secured', 'paid', 'settling', 'released', 'refunded', 'lapsed', 'cancelled', 'disputed'];

/**
 * The parts of `GET /v1/trades/:code` the escrow runtime reads (bigints arrive as decimal strings).
 * Checked against the real Task 6 TradeView. It carries no payout address on purpose: this device's
 * own address is verified through the attestation (`wrong-terms`) and in runtime.ts at the settle
 * points, never from the API view.
 */
export interface EscrowTradeView {
  role: 'buyer' | 'seller';
  state: TradeState;
  poster: 'seller' | 'buyer';
  amountAtomic: bigint;
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
 * page's api() handles Terms and wallet redirects). The Task 8 routes' answers: identity 201
 * (409 `identity-exists` counts as registered; 409 `identity-conflict`, the other slot holds this
 * key, is thrown with that code and is final), attestation 200 `{ attestation, sig }`, 202 while it
 * is not ready, or 409 `attestation-refused` or `trade-closed` (thrown, final).
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
