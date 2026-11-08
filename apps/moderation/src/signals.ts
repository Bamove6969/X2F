import type { Role } from '@x2f/core';
import type { Transport } from '@x2f/escrow';
import { open, ProtocolError, seal, type Envelope, type Identity, type Participants, type ReplayGuard } from '@x2f/protocol';
import { isSignalType, parseSignalDeal, signalAddressKey, signalPayloadOk, type AttestedTerms, type ConfirmedDeal, type SignalType } from '@x2f/trade';

/**
 * The moderator's side of a trade's signals channel (Plan 3 Task 10): `channelFor(code, 'signals')`,
 * Plan 1 envelopes, the channel's own ReplayGuard (persisted by the caller before anything is acted
 * on). The payload schema is `@x2f/trade`'s, shared with the trader apps (Task 12). The moderator
 * reads every signal and sends only `trade.ack { of }`, sealed to the signal's sender alone.
 */
export type ModSignal =
  | { type: 'trade.terms'; from: 'buyer' | 'seller'; address: string; deal: ConfirmedDeal }
  | { type: 'trade.paid'; from: 'buyer'; amountAtomic: bigint; fiatCents: bigint }
  | { type: 'trade.cancel'; from: 'buyer' }
  | { type: 'trade.extend'; from: 'seller' }
  | { type: 'trade.refund-request'; from: 'seller' };

export type SignalRead = { ok: true; signal: ModSignal } | { ok: false; reason: string };

/**
 * Opens one frame with the channel's guard (which commits only on full success, R14-R16) and reads
 * it against the shared schema. Never throws for a bad frame: the reason only.
 */
export async function readSignal(
  raw: unknown,
  o: { channel: string; me: Identity; participants: Participants; guard: ReplayGuard },
): Promise<SignalRead> {
  let opened;
  try {
    opened = await open(raw, { me: o.me, myRole: 'mod', participants: o.participants, trade: o.channel, guard: o.guard });
  } catch (e) {
    if (e instanceof ProtocolError) return { ok: false, reason: e.code };
    throw e;
  }
  const { type, from, payload } = opened;
  if (!isSignalType(type) || type === 'trade.ack' || !signalPayloadOk(type, from, payload)) return { ok: false, reason: 'malformed' };
  switch (type) {
    case 'trade.terms':
      return {
        ok: true,
        signal: { type, from: from as 'buyer' | 'seller', address: payload[signalAddressKey(from)] as string, deal: parseSignalDeal(payload.deal)! },
      };
    case 'trade.paid':
      return { ok: true, signal: { type, from: 'buyer', amountAtomic: payload.amountAtomic as bigint, fiatCents: payload.fiatCents as bigint } };
    case 'trade.cancel':
      return { ok: true, signal: { type, from: 'buyer' } };
    case 'trade.extend':
    case 'trade.refund-request':
      return { ok: true, signal: { type, from: 'seller' } };
  }
}

/** The signed terms equal what this service attested: the sender's own address and the whole deal. */
export function termsMatch(s: Extract<ModSignal, { type: 'trade.terms' }>, attested: AttestedTerms): boolean {
  const want = s.from === 'seller' ? attested.sellerRefund : attested.buyerPayout;
  const d = attested.deal;
  return (
    s.address === want &&
    s.deal.poster === d.poster &&
    s.deal.currency === d.currency &&
    s.deal.takeAmountAtomic.toString() === d.takeAmountAtomic &&
    s.deal.centsPerXmr.toString() === d.centsPerXmr &&
    s.deal.maxFiatCents.toString() === d.maxFiatCents
  );
}

/** `trade.ack { of }` from the moderator, sealed to the signal's sender only. */
export function sealAck(o: { channel: string; me: Identity; participants: Participants; seq: number; to: Role; of: SignalType }): Promise<Envelope> {
  return seal({ trade: o.channel, from: 'mod', seq: o.seq, type: 'trade.ack', payload: { of: o.of }, to: [o.to], me: o.me, participants: o.participants });
}

/** Reads frames until the transport ends or `stop()`; each is handed to `onFrame` in order. */
export function signalLoop(transport: Transport, onFrame: (raw: unknown) => Promise<void>, onError: () => void): { stop(): void; done: Promise<void> } {
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      let raw: unknown;
      try {
        raw = await transport.next();
      } catch {
        return; // the relay closed the channel for good, or stop()
      }
      if (stopped) return;
      await onFrame(raw).catch(onError);
    }
  })();
  return {
    stop() {
      stopped = true;
      transport.close();
    },
    done,
  };
}
