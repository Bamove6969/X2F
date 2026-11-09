/**
 * The trade's signals channel (Task 10): small signed messages between buyer, seller and the
 * moderation service on `channelFor(code, 'signals')`, sealed to all three roles in one
 * envelope, with its own ReplayGuard and seq saved before anything is acted on or sent.
 *
 * - trade.terms (once at setup, resent until answered): the seller's `{ refundAddress, deal }`
 *   and the buyer's `{ payoutAddress, deal }`. Only terms whose address and deal are the ones the
 *   moderator attested are adopted; any other copy is ignored (never adopted, never fatal: one
 *   wrong message from a peer must not stop this device's key share for good). `deal` is a
 *   deviation from the plan (which signs the address only): both sides sign the trade's size and
 *   rate so a lying API cannot resize the payouts.
 * - trade.paid (buyer): `{ amountAtomic, fiatCents }`, the trade amount the buyer's device fixed
 *   and the fiat total the buyer confirmed (bigints, signed with the envelope). A deviation from
 *   the plan's `{}` (security fix 2026-10-24): the seller fixes the amount from this signed value,
 *   never from the API. Task 10 must accept it.
 * - trade.cancel (buyer); trade.extend, trade.refund-request (seller): `{}`.
 * - trade.ack (mod → the sender only): `{ of: '<type>' }`; an ack of trade.terms stops its resends.
 *
 * The payload schema is `@x2f/trade`'s (signals.ts), the one the moderation service reads too
 * (Task 10, which replaced this module's earlier guesses).
 */
import type { Role } from '@x2f/core';
import type { Transport } from '@x2f/escrow';
import { ProtocolError, ReplayGuard, open, seal, type Identity, type Participants, type ReplayGuardJSON } from '@x2f/protocol';
import { ROLES } from '@x2f/core';
import { SIGNAL_SENDERS, SIGNAL_TYPES, parseSignalDeal, signalAddressKey, signalPayloadOk, type SignalType } from '@x2f/trade';
import type { Deal } from './policy.js';

export { SIGNAL_SENDERS, SIGNAL_TYPES, type SignalType };
/** The signals a trader's app may send itself (terms and acks are sent by the runtime). */
export type UserSignal = 'trade.paid' | 'trade.cancel' | 'trade.extend' | 'trade.refund-request';

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
  /** This device's deal, as the moderator attested it (verified before the signals run). */
  deal: Deal;
  /** The counterparty's address as the moderator attested it; terms with another one are ignored. */
  attestedTheirAddress: string;
  /** Saves the state; resolves once it is stored. Called before acting on or sending anything. */
  save(s: SignalsState): Promise<void>;
  /**
   * A valid signal from a peer, BEFORE its state is saved: fold it into the caller's own record
   * here (synchronously), so the replay guard and what the signal changed land in one save and a
   * reload can never have one without the other.
   */
  absorb?(type: SignalType, from: Role, payload: Record<string, unknown>): void;
  /** A valid signal from a peer (after it was saved). */
  onSignal?(type: SignalType, from: Role, payload: Record<string, unknown>): void;
  onIgnored?(reason: string): void;
  resendMs?: number;
}

/** The trade.paid payload: the amount the buyer's device fixed and the fiat total the buyer confirmed. */
export interface PaidPayload {
  amountAtomic: bigint;
  fiatCents: bigint;
}

export interface SignalsHandle {
  /** `trade.paid` needs its PaidPayload; every other user signal carries `{}`. */
  send(type: UserSignal, payload?: PaidPayload): Promise<void>;
  stop(): void;
}

export function sameDeal(a: Deal, b: Deal): boolean {
  return a.poster === b.poster && a.takeAmountAtomic === b.takeAmountAtomic && a.currency === b.currency && a.centsPerXmr === b.centsPerXmr && a.maxFiatCents === b.maxFiatCents;
}

const addressKey = signalAddressKey;
const parseDeal = (d: unknown): Deal | null => parseSignalDeal(d);
const wellFormed = signalPayloadOk;

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
      if (addr !== a.attestedTheirAddress || !sameDeal(deal, a.deal)) {
        await persist(); // the replay guard has seen it
        return ignored('terms-mismatch');
      }
      if (state.theirAddress === null) {
        state = { ...state, theirAddress: addr, theirDeal: deal };
        answerTerms = true; // the peer may have missed ours
      }
    }
    if (type === 'trade.ack' && p.of === 'trade.terms') state = { ...state, termsAcked: true };
    a.absorb?.(type, from, p);
    await persist(); // saved (with what absorb folded in) before acting on it
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
    send(type, payload) {
      if (!SIGNAL_SENDERS[type]?.includes(a.role) || type === ('trade.terms' as never) || type === ('trade.ack' as never)) {
        return Promise.reject(new TypeError(`signals: ${a.role} may not send ${String(type)}`));
      }
      const body: Record<string, unknown> = type === 'trade.paid' && payload ? { amountAtomic: payload.amountAtomic, fiatCents: payload.fiatCents } : {};
      if (!wellFormed(type, a.role, body)) return Promise.reject(new TypeError(`signals: bad ${type} payload`));
      return run(() => sendNow(type, body));
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      a.transport.close();
    },
  };
}
