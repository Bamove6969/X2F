// My trades (register D-005): GET /v1/trades, parsed strictly so a renamed or missing field fails
// loudly. The shape is apps/api/src/trades/list.ts `TradeListPage`:
//   GET /v1/trades?status=open|completed&cursor → { trades: TradeListItem[], next: string | null },
//   newest first; `next` is the cursor for the following page, null at the end. 403 `forbidden` for
//   a team member without the box for that part (open: See active trades; completed: See trade history).
import { normalizeTradeCode } from '@x2f/core';
import { api } from '../../api/client.js';
import { TRADE_STATES, type Party, type TradeState } from '../../api/trade.js';

export type TradeListStatus = 'open' | 'completed';

export interface TradeListItem {
  code: string;
  role: Party;
  state: TradeState;
  amountAtomic: bigint;
  fiatCents: bigint;
  currency: string;
  counterparty: { tradeTag: string };
  takenAt: string;
  closedAt: string | null;
  /**
   * Plan 3 Task 42: on the account owner's open rows only, the team member who last acted on the
   * trade and when (null: no member has); absent everywhere else.
   */
  lastActedBy?: { memberName: string; at: string } | null;
}

export interface TradeListPage {
  trades: TradeListItem[];
  next: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function shape(): Error {
  return new Error('unexpected trades list answer');
}

/** Review m2: a trade code in its own form only (what the room itself accepts), so a row's link stays a room link. */
function tradeCode(v: unknown): string {
  if (typeof v !== 'string' || normalizeTradeCode(v) !== v) throw shape();
  return v;
}

function str(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) throw shape();
  return v;
}

function big(v: unknown): bigint {
  if (typeof v !== 'string' || !/^\d{1,30}$/.test(v)) throw shape();
  return BigInt(v);
}

function iso(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) || !Number.isFinite(Date.parse(v))) throw shape();
  return v;
}

function lastActedBy(v: unknown): { memberName: string; at: string } | null {
  if (v === null) return null;
  if (!isRecord(v)) throw shape();
  return { memberName: str(v.memberName), at: iso(v.at) };
}

function item(raw: unknown): TradeListItem {
  if (!isRecord(raw) || !isRecord(raw.counterparty)) throw shape();
  if (raw.role !== 'buyer' && raw.role !== 'seller') throw shape();
  if (typeof raw.state !== 'string' || !(TRADE_STATES as readonly string[]).includes(raw.state)) throw shape();
  if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) throw shape();
  return {
    code: tradeCode(raw.code),
    role: raw.role,
    state: raw.state as TradeState,
    amountAtomic: big(raw.amountAtomic),
    fiatCents: big(raw.fiatCents),
    currency: raw.currency,
    counterparty: { tradeTag: str(raw.counterparty.tradeTag) },
    takenAt: iso(raw.takenAt),
    closedAt: raw.closedAt === null ? null : iso(raw.closedAt),
    ...(raw.lastActedBy !== undefined ? { lastActedBy: lastActedBy(raw.lastActedBy) } : {}),
  };
}

export function parseTradeList(raw: unknown): TradeListPage {
  if (!isRecord(raw) || !Array.isArray(raw.trades)) throw shape();
  if (raw.next !== null && typeof raw.next !== 'string') throw shape();
  return { trades: raw.trades.map(item), next: raw.next };
}

export async function fetchTradeList(status: TradeListStatus, cursor: string | null, signal?: AbortSignal): Promise<TradeListPage> {
  const q = new URLSearchParams({ status });
  if (cursor !== null) q.set('cursor', cursor);
  return parseTradeList(await api(`/v1/trades?${q}`, signal ? { signal } : {}));
}
