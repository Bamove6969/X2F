/**
 * Seams for what Task 23's screens need from pieces that are not merged (or not built) yet, and
 * Task 23's typed wrappers over Task 22's trade API (api/trade.ts).
 *
 * - `postPayEvent`: Task 22's `postTradeEvent` (POST /v1/trades/:code/events, Task 6), narrowed to
 *   the events these screens post.
 * - `payMethodOf`: Task 22's `methodOf` plus the method's `fields` (Task 3's MethodProfile).
 * - `usePaymentDetails`: the seller's own payment details for the method's fields ("Zelle to
 *   <id>"). No API carries them yet. GAP for the lead.
 * - `usePaidAck`: whether the moderation service acknowledged this device's `trade.paid`
 *   (`trade.ack { of: 'trade.paid' }`). Task 12's EscrowStatus does not expose acks yet, so
 *   "Marked as paid" waits for a source to be installed. GAP for Task 12.
 * - `TradeChat`: Task 20's `ChatPanel` for the trade (desktop aside, phone Chat sheet).
 */
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { methodOf, postTradeEvent } from '../../api/trade.js';
import type { TradeView } from './payTypes.js';

// ---- Trade events (Task 6) ----

/** The client events Task 23's screens post (a subset of @x2f/trade CLIENT_EVENTS). */
export type PayEvent =
  | { type: 'mark-paid'; fiatCents: bigint }
  | { type: 'buyer-cancel' }
  | { type: 'propose-cancel' }
  | { type: 'accept-cancel' }
  | { type: 'withdraw-cancel' };

/** Task 22's postTradeEvent, typed to Task 23's events; returns the new view, or throws ApiCallError 409 <code>. */
export function postPayEvent(code: string, e: PayEvent): Promise<TradeView> {
  return postTradeEvent(code, e);
}

// ---- The payment method ----

export interface FieldInfo {
  key: string;
  label: string;
}

export interface MethodInfo {
  name: string;
  whatItIs: string;
  /** "Gift cards & vouchers" methods (owner, 2026-10-21): the screen shows the one bold warning. */
  giftCard: boolean;
  fields: FieldInfo[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Task 22's `methodOf` (name, explainer, gift-card flag) plus the profile's fields, read defensively. */
export function payMethodOf(view: Pick<TradeView, 'methodId' | 'profile'>): MethodInfo {
  const p = isRecord(view.profile) ? view.profile : {};
  const fields = Array.isArray(p.fields)
    ? p.fields.flatMap((f): FieldInfo[] => (isRecord(f) && text(f.key) && text(f.label) ? [{ key: f.key as string, label: f.label as string }] : []))
    : [];
  return { ...methodOf(view), fields };
}

/** The exact gift-card warning (Plan 3 Revision 2026-10-21, owner). */
export const GIFT_CARD_WARNING =
  'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.';

// ---- The seller's payment details ----

/** One row of "Send this payment": the label ("Zelle to") and the seller's value. */
export interface PaymentDetail {
  label: string;
  value: string;
}

export type PaymentDetailsSource = (code: string, onDetails: (d: PaymentDetail[] | null) => void) => () => void;

let detailsSource: PaymentDetailsSource | null = null;

/** Installs where the seller's payment details come from (a fixture, or the real source once built); null removes it. */
export function setPaymentDetailsSource(s: PaymentDetailsSource | null): void {
  detailsSource = s;
}

/** The seller's details for this trade, or null while none are known. */
export function usePaymentDetails(code: string): PaymentDetail[] | null {
  const [d, setD] = useState<PaymentDetail[] | null>(null);
  useEffect(() => {
    setD(null);
    if (!detailsSource) return;
    return detailsSource(code, setD);
  }, [code]);
  return d;
}

// ---- The moderator's ack of trade.paid ----

export type PaidAckSource = (code: string, onAck: () => void) => () => void;

let ackSource: PaidAckSource | null = null;
const ackSubs = new Set<() => void>();

/** Installs the source of `trade.ack { of: 'trade.paid' }` (Task 12, or a test fake); null removes it. */
export function setPaidAckSource(s: PaidAckSource | null): void {
  ackSource = s;
  for (const cb of ackSubs) cb();
}

/** True once the moderation service acknowledged this trade's `trade.paid`. */
export function usePaidAck(code: string): boolean {
  const source = useSyncExternalStore(
    (notify) => {
      ackSubs.add(notify);
      return () => ackSubs.delete(notify);
    },
    () => ackSource,
  );
  const [acked, setAcked] = useState(false);
  useEffect(() => {
    setAcked(false);
    if (!source) return;
    return source(code, () => setAcked(true));
  }, [source, code]);
  return acked;
}

// ---- The trade chat (Task 20) ----

export interface TradeChatProps {
  code: string;
  /** The counterparty's public display name. */
  name: string;
}

let chat: ComponentType<TradeChatProps> | null = null;
const chatSubs = new Set<() => void>();

/** Installs Task 20's ChatPanel (or a fixture); null removes it. */
export function setTradeChat(c: ComponentType<TradeChatProps> | null): void {
  chat = c;
  for (const cb of chatSubs) cb();
}

export function useTradeChat(): ComponentType<TradeChatProps> | null {
  return useSyncExternalStore(
    (notify) => {
      chatSubs.add(notify);
      return () => chatSubs.delete(notify);
    },
    () => chat,
  );
}
