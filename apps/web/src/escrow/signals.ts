/**
 * The trade's signals channel (Task 10): small signed messages between buyer, seller and the
 * moderation service on `channelFor(code, 'signals')`, sealed to all three roles in one
 * envelope, with its own ReplayGuard and seq saved before anything is acted on or sent.
 *
 * - trade.terms (once at setup, resent until answered): the seller's `{ refundAddress, deal }`
 *   and the buyer's `{ payoutAddress, deal }`. The counterparty's first terms win; a different
 *   later copy is ignored. `deal` is a deviation from the plan (which signs the address only):
 *   both sides sign the trade's size and rate so a lying API cannot resize the payouts.
 * - trade.paid, trade.cancel (buyer); trade.extend, trade.refund-request (seller): `{}`.
 * - trade.ack (mod → sender): GUESS `{ of: '<type>' }`; an ack of trade.terms stops its resends.
 */
import type { Role } from '@x2f/core';
import type { Transport } from '@x2f/escrow';
import { ProtocolError, ReplayGuard, open, seal, type Identity, type Participants, type ReplayGuardJSON } from '@x2f/protocol';
import { ROLES } from '@x2f/core';
import type { Deal } from './policy.js';

export const SIGNAL_TYPES = ['trade.terms', 'trade.paid', 'trade.cancel', 'trade.extend', 'trade.refund-request', 'trade.ack'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
/** The signals a trader's app may send itself (terms and acks are sent by the runtime). */
export type UserSignal = 'trade.paid' | 'trade.cancel' | 'trade.extend' | 'trade.refund-request';

/** Who may send each signal. */
export const SIGNAL_SENDERS: Record<SignalType, readonly Role[]> = {
  'trade.terms': ['buyer', 'seller'],
  'trade.paid': ['buyer'],
  'trade.cancel': ['buyer'],
  'trade.extend': ['seller'],
  'trade.refund-request': ['seller'],
  'trade.ack': ['mod'],
};

export interface SignalsState {
  guard: ReplayGuardJSON;
  seq: number;
  theirAddress: string | null;
  theirDeal: Deal | null;
  termsAcked: boolean;
}

export interface SignalsArgs {
  /** The signals channel ID (the `trade` of every envelope). */
  channel: string;
  role: 'buyer' | 'seller';
  me: Identity;
  participants: Participants;
  transport: Transport;
  state: SignalsState;
  ownAddress: string;
  deal: Deal;
  /** Saves the state; resolves once it is stored. Called before acting on or sending anything. */
  save(s: SignalsState): Promise<void>;
  /** A valid signal from a peer (after it was saved). */
  onSignal?(type: SignalType, from: Role, payload: Record<string, unknown>): void;
  onIgnored?(reason: string): void;
  resendMs?: number;
}

export interface SignalsHandle {
  send(type: UserSignal): Promise<void>;
  stop(): void;
}

const MAX_ADDRESS = 256;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

function parseDeal(d: unknown): Deal | null {
  if (!isRecord(d) || !exactKeys(d, ['poster', 'takeAmountAtomic', 'currency', 'centsPerXmr', 'maxFiatCents'])) return null;
  if (d.poster !== 'buyer' && d.poster !== 'seller') return null;
  if (typeof d.currency !== 'string' || !/^[A-Z]{3}$/.test(d.currency)) return null;
  for (const k of ['takeAmountAtomic', 'centsPerXmr', 'maxFiatCents'] as const) if (typeof d[k] !== 'bigint' || (d[k] as bigint) <= 0n) return null;
  return d as unknown as Deal;
}

export function sameDeal(a: Deal, b: Deal): boolean {
  return a.poster === b.poster && a.takeAmountAtomic === b.takeAmountAtomic && a.currency === b.currency && a.centsPerXmr === b.centsPerXmr && a.maxFiatCents === b.maxFiatCents;
}

const addressKey = (role: Role): 'payoutAddress' | 'refundAddress' => (role === 'buyer' ? 'payoutAddress' : 'refundAddress');

/** Checks a payload's exact shape for its type and sender. */
function wellFormed(type: SignalType, from: Role, p: unknown): p is Record<string, unknown> {
  if (!isRecord(p) || !SIGNAL_SENDERS[type].includes(from)) return false;
  if (type === 'trade.terms') {
    const k = addressKey(from);
    const addr = p[k];
    return exactKeys(p, [k, 'deal']) && typeof addr === 'string' && addr.length > 0 && addr.length <= MAX_ADDRESS && parseDeal(p.deal) !== null;
  }
  if (type === 'trade.ack') return exactKeys(p, ['of']) && typeof p.of === 'string';
  return Object.keys(p).length === 0;
}

export function runSignals(a: SignalsArgs): SignalsHandle {
  const ignored = a.onIgnored ?? (() => {});
  const guard = ReplayGuard.from(a.state.guard);
  let state: SignalsState = { ...a.state };
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  const run = (fn: () => Promise<void>): Promise<void> => {
    const next = chain.then(async () => {
      if (!stopped) await fn();
    });
    chain = next.catch(() => undefined);
    return next;
  };
  const persist = async (): Promise<void> => {
    state = { ...state, guard: guard.toJSON() };
    await a.save(structuredClone(state));
  };

  const sendNow = async (type: SignalType, payload: Record<string, unknown>): Promise<void> => {
    state = { ...state, seq: state.seq + 1 };
    await persist(); // the seq is stored before the envelope leaves
    a.transport.send(await seal({ trade: a.channel, from: a.role, seq: state.seq, type, payload, to: ROLES, me: a.me, participants: a.participants }));
  };
  const sendTerms = (): Promise<void> => sendNow('trade.terms', { [addressKey(a.role)]: a.ownAddress, deal: a.deal });
  const termsDone = (): boolean => state.theirAddress !== null && state.termsAcked;

  const onFrame = async (raw: unknown): Promise<void> => {
    let opened;
    try {
      opened = await open(raw, { me: a.me, myRole: a.role, participants: a.participants, trade: a.channel, guard });
    } catch (e) {
      if (e instanceof ProtocolError) return ignored(e.code);
      throw e;
    }
    const type = opened.type as SignalType;
    const from = opened.from;
    if (!(SIGNAL_TYPES as readonly string[]).includes(type) || !wellFormed(type, from, opened.payload)) {
      await persist();
      return ignored('malformed');
    }
    const p = opened.payload;
    let answerTerms = false;
    if (type === 'trade.terms') {
      const addr = p[addressKey(from)] as string;
      const deal = parseDeal(p.deal)!;
      if (state.theirAddress === null) {
        state = { ...state, theirAddress: addr, theirDeal: deal };
        answerTerms = true; // the peer may have missed ours
      } else if (state.theirAddress !== addr || !state.theirDeal || !sameDeal(state.theirDeal, deal)) {
        ignored('terms-changed');
      }
    }
    if (type === 'trade.ack' && p.of === 'trade.terms') state = { ...state, termsAcked: true };
    await persist(); // saved before acting on it
    a.onSignal?.(type, from, p);
    if (answerTerms) await sendTerms();
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      let raw: unknown;
      try {
        raw = await a.transport.next();
      } catch {
        return;
      }
      await run(() => onFrame(raw)).catch(() => ignored('error'));
    }
  };

  const timer = setInterval(() => {
    if (!termsDone()) void run(sendTerms).catch(() => ignored('error'));
  }, a.resendMs ?? 5000);
  a.transport.onReconnect(() => {
    if (!termsDone()) void run(sendTerms).catch(() => ignored('error'));
  });
  void run(sendTerms).catch(() => ignored('error'));
  void loop();

  return {
    send(type) {
      if (!SIGNAL_SENDERS[type]?.includes(a.role) || type === ('trade.terms' as never) || type === ('trade.ack' as never)) {
        return Promise.reject(new TypeError(`signals: ${a.role} may not send ${String(type)}`));
      }
      return run(() => sendNow(type, {}));
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      a.transport.close();
    },
  };
}
