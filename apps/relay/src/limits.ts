/** Relay settings an operator may set; everything else is derived from the memory budget. */
export interface RelayOptions {
  maxEnvelopeBytes: number;
  memoryBudgetBytes: number;
  maxUnauthenticated: number;
  maxQueuedPerTrade: number;
  rateBurst: number;
  rateRefillPerSec: number;
  joinTimeoutMs: number;
}

export interface RelayLimits extends RelayOptions {
  maxPeerBufferedBytes: number;
  perTradeQueueBytes: number;
  totalQueueBytes: number;
  maxTrades: number;
  maxConnections: number;
}

export const DEFAULT_OPTIONS: RelayOptions = {
  maxEnvelopeBytes: 262_144,
  memoryBudgetBytes: 1024 ** 3,
  maxUnauthenticated: 64,
  maxQueuedPerTrade: 1000,
  rateBurst: 50,
  rateRefillPerSec: 20,
  joinTimeoutMs: 10_000,
};

const MAX_INT = 2 ** 31 - 1;
const PER_TRADE_QUEUE_BYTES = 1024 ** 2;
const PER_CONNECTION_OVERHEAD = 64 * 1024;

function positive(name: string, v: number, integer: boolean): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_INT || (integer && !Number.isInteger(v))) {
    throw new RangeError(`relay option ${name} must be a positive ${integer ? 'integer' : 'number'} up to ${MAX_INT}`);
  }
}

/**
 * Size every limit from one memory budget B (R21): peer buffer = 2 × max envelope; each
 * trade gets a 1 MiB queue share; queues total about B/4; a connection costs one envelope
 * plus 64 KiB. Trades fit in 70% of B after the queues and the unauthenticated reserve.
 */
export function deriveLimits(overrides: Partial<RelayOptions> = {}): RelayLimits {
  const o: RelayOptions = { ...DEFAULT_OPTIONS, ...overrides };
  for (const [k, v] of Object.entries(o) as [keyof RelayOptions, number][]) positive(k, v, k !== 'rateRefillPerSec');
  const maxPeerBufferedBytes = 2 * o.maxEnvelopeBytes;
  const perConnection = o.maxEnvelopeBytes + PER_CONNECTION_OVERHEAD;
  const totalQueueBytes = Math.floor(o.memoryBudgetBytes / 4);
  const unauthReserve = o.maxUnauthenticated * perConnection;
  const perTrade = 3 * maxPeerBufferedBytes + 3 * perConnection;
  const fit = Math.floor((Math.floor(0.7 * o.memoryBudgetBytes) - totalQueueBytes - unauthReserve) / perTrade);
  const maxTrades = Math.min(fit, Math.floor(totalQueueBytes / PER_TRADE_QUEUE_BYTES));
  if (maxTrades < 1) throw new RangeError('relay memory budget is too small for one trade');
  const maxConnections = 3 * maxTrades + o.maxUnauthenticated;
  if (maxConnections > MAX_INT) throw new RangeError('relay limits overflow');
  return { ...o, maxPeerBufferedBytes, perTradeQueueBytes: PER_TRADE_QUEUE_BYTES, totalQueueBytes, maxTrades, maxConnections };
}
