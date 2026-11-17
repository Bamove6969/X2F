/**
 * Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): `GET /v1/account/liens`, what this
 * account owes after a dispute and what it is owed, parsed strictly (a malformed reply is refused).
 */
import { api } from '../../api/client.js';

export interface OwedLien {
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
    // Rule 2 as the device can check it: recovered + remaining is exactly what is owed.
    if (recoveredAtomic + remainingAtomic !== amountAtomic) throw new LiensShapeError('figures');
    return { id: str(l, 'id'), status, amountAtomic, recoveredAtomic, remainingAtomic, rateBps, fromCode: str(l, 'fromCode') };
  });
  const owedTo = list(o.owedTo).map((x): OwedToMe => {
    const l = rec(x);
    const status = l.status;
    if (status !== 'active' && status !== 'suspended' && status !== 'repaid') throw new LiensShapeError('status');
    const amountAtomic = big(l, 'amountAtomic');
    const recoveredAtomic = big(l, 'recoveredAtomic');
    const remainingAtomic = big(l, 'remainingAtomic');
    if (recoveredAtomic + remainingAtomic !== amountAtomic) throw new LiensShapeError('figures');
    if (typeof l.recoveryAddressSet !== 'boolean') throw new LiensShapeError('recoveryAddressSet');
    return { id: str(l, 'id'), status, amountAtomic, recoveredAtomic, remainingAtomic, fromCode: str(l, 'fromCode'), recoveryAddressSet: l.recoveryAddressSet };
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
