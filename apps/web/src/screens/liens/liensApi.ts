/**
 * Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): `GET /v1/account/liens`, what this
 * account owes after a dispute and what it is owed, parsed strictly (a malformed reply is refused).
 */
import { api } from '../../api/client.js';

/**
 * Owner decision 26 Nov 2026 (docs/lien-recovery.md "Grace"): a lien the moderator gave 7 days to pay
 * the agreed way. `mode` `grace` while nothing is taken from trades; `collect` once the moderator
 * switched it to collecting. `method`: how the two traders agreed it is paid (the moderator's words);
 * `graceUntil`: the deadline; `lapsed`: it passed without the person owed confirming;
 * `paidOffPlatform`: the person owed confirmed they were paid.
 */
export interface LienGrace {
  mode: 'grace' | 'collect';
  method: string;
  graceUntil: string;
  lapsed: boolean;
  paidOffPlatform: boolean;
}

export interface OwedLien {
  grace?: LienGrace;
  /** Ended as settled off the platform (by staff, or the person owed); nothing is left. */
  paidOffPlatform?: true;
  id: string;
  status: 'active' | 'suspended';
  amountAtomic: bigint;
  recoveredAtomic: bigint;
  remainingAtomic: bigint;
  rateBps: number;
  fromCode: string;
}

/**
 * A lien owed to this account. Review M4 / provisional owner answer Q4: totals only (owed, received,
 * still to come), never the debtor's purchases. `fromCode`: the disputed trade, whose identity on
 * this device signs the recovery address (Q2); `recoveryAddressSet`: whether one is set.
 */
export interface OwedToMe {
  grace?: LienGrace;
  paidOffPlatform?: true;
  id: string;
  status: 'active' | 'suspended' | 'repaid';
  amountAtomic: bigint;
  recoveredAtomic: bigint;
  remainingAtomic: bigint;
  fromCode: string;
  recoveryAddressSet: boolean;
}

export interface MyLiens {
  owes: OwedLien[];
  owedTo: OwedToMe[];
}

export class LiensShapeError extends Error {}

const ATOMIC = /^(0|[1-9]\d{0,29})$/;
const rec = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new LiensShapeError('liens');
  return v as Record<string, unknown>;
};
const big = (o: Record<string, unknown>, k: string): bigint => {
  const v = o[k];
  if (typeof v !== 'string' || !ATOMIC.test(v)) throw new LiensShapeError(k);
  return BigInt(v);
};
const str = (o: Record<string, unknown>, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || v === '') throw new LiensShapeError(k);
  return v;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new LiensShapeError('list');
  return v;
};

/** The optional grace, strictly; absent on a lien never given it. `paidOffPlatform`: staff or the person owed ended it as settled off the platform. */
function graceOf(l: Record<string, unknown>): { grace?: LienGrace; paidOffPlatform?: true } {
  if (l.paidOffPlatform !== undefined && l.paidOffPlatform !== true) throw new LiensShapeError('paidOffPlatform');
  const paid = l.paidOffPlatform === true ? { paidOffPlatform: true as const } : {};
  if (l.grace === undefined) return paid;
  const g = rec(l.grace);
  if (g.mode !== 'grace' && g.mode !== 'collect') throw new LiensShapeError('grace');
  const method = str(g, 'method');
  const graceUntil = str(g, 'graceUntil');
  if (Number.isNaN(Date.parse(graceUntil)) || typeof g.lapsed !== 'boolean' || typeof g.paidOffPlatform !== 'boolean') throw new LiensShapeError('grace');
  return { ...paid, grace: { mode: g.mode, method, graceUntil, lapsed: g.lapsed, paidOffPlatform: g.paidOffPlatform } };
}

/** Rule 2 as the device can check it: recovered + remaining is what is owed, or nothing is left once paid off the platform. */
function figuresOk(a: { amountAtomic: bigint; recoveredAtomic: bigint; remainingAtomic: bigint }, g: { grace?: LienGrace; paidOffPlatform?: true }): boolean {
  if (g.grace?.paidOffPlatform === true || g.paidOffPlatform === true) return a.remainingAtomic === 0n && a.recoveredAtomic <= a.amountAtomic;
  return a.recoveredAtomic + a.remainingAtomic === a.amountAtomic;
}

export function parseLiens(raw: unknown): MyLiens {
  const o = rec(raw);
  const owes = list(o.owes).map((x): OwedLien => {
    const l = rec(x);
    const status = l.status;
    if (status !== 'active' && status !== 'suspended') throw new LiensShapeError('status');
    const rateBps = l.rateBps;
    if (typeof rateBps !== 'number' || !Number.isSafeInteger(rateBps) || rateBps < 1 || rateBps > 10_000) throw new LiensShapeError('rateBps');
    const amountAtomic = big(l, 'amountAtomic');
    const recoveredAtomic = big(l, 'recoveredAtomic');
    const remainingAtomic = big(l, 'remainingAtomic');
    const g = graceOf(l);
    if (!figuresOk({ amountAtomic, recoveredAtomic, remainingAtomic }, g)) throw new LiensShapeError('figures');
    return { id: str(l, 'id'), status, amountAtomic, recoveredAtomic, remainingAtomic, rateBps, fromCode: str(l, 'fromCode'), ...g };
  });
  const owedTo = list(o.owedTo).map((x): OwedToMe => {
    const l = rec(x);
    const status = l.status;
    if (status !== 'active' && status !== 'suspended' && status !== 'repaid') throw new LiensShapeError('status');
    const amountAtomic = big(l, 'amountAtomic');
    const recoveredAtomic = big(l, 'recoveredAtomic');
    const remainingAtomic = big(l, 'remainingAtomic');
    const g = graceOf(l);
    if (!figuresOk({ amountAtomic, recoveredAtomic, remainingAtomic }, g)) throw new LiensShapeError('figures');
    if (typeof l.recoveryAddressSet !== 'boolean') throw new LiensShapeError('recoveryAddressSet');
    return { id: str(l, 'id'), status, amountAtomic, recoveredAtomic, remainingAtomic, fromCode: str(l, 'fromCode'), recoveryAddressSet: l.recoveryAddressSet, ...g };
  });
  return { owes, owedTo };
}

export async function fetchLiens(signal?: AbortSignal): Promise<MyLiens> {
  return parseLiens(await api('/v1/account/liens', signal ? { signal } : {}));
}

/** Q2: `POST /v1/account/liens/:id/recovery-address` with the creditor device's signed statement. */
export async function setRecoveryAddress(lienId: string, signed: { statement: unknown; sig: string }): Promise<void> {
  await api(`/v1/account/liens/${encodeURIComponent(lienId)}/recovery-address`, { method: 'POST', body: signed });
}

/** Owner 26 Nov 2026 (grace): the person owed confirms "I've been paid" the agreed way. Ends the lien. */
export async function confirmPaid(lienId: string): Promise<void> {
  await api(`/v1/account/liens/${encodeURIComponent(lienId)}/paid`, { method: 'POST', body: {} });
}
