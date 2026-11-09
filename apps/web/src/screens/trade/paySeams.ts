/**
 * Seams for what Task 23's screens need from pieces that are not merged (or not built) yet, and
 * Task 23's typed wrappers over Task 22's trade API (api/trade.ts).
 *
 * - `postPayEvent`: Task 22's `postTradeEvent` (POST /v1/trades/:code/events, Task 6), narrowed to
 *   the events these screens post.
 * - `payMethodOf`: Task 22's `methodOf` plus the method's `fields` (Task 3's MethodProfile).
 * - `usePaymentDetails`: the seller's payment details for the method ("Email: <address>"), from
 *   the newest package the seller sent in the trade's encrypted chat (J-08, S-090; the source is
 *   chat/payDetailsFeed.ts, installed by App.tsx). No API ever carries them: they travel only as
 *   ciphertext inside the chat envelope, like any line.
 * - "Marked as paid" reads `escrow.paidRecorded` (Task 12's EscrowStatus, added for Task 23's
 *   review I3): no moderator ack of `trade.paid` exists anywhere yet (signals.ts GUESS).
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

// ---- The trade chat (Task 20) ----

/**
 * Task 40: the room may move the panel between a pane of its own and the Chat sheet when the phone
 * folds or unfolds, which remounts it; the panel keeps its draft in `useKeptText("chat:" + code)`
 * (src/ui/fold.ts) so typed text survives the move.
 */
export interface TradeChatProps {
  code: string;
  /** The counterparty's public display name. */
  name: string;
  /**
   * The trade's payment method (TradeView.methodId): the payee's side of the chat shows that
   * method's boxes (J-08, S-090). Absent, no boxes (a fixture, or a chat outside a trade).
   */
  methodId?: string | undefined;
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

/**
 * Whether the buyer has added a payment proof to this trade (T-079, build spec j31a section 4):
 * 'attached', 'none' (the proof slot can take one and there is none), or 'unavailable' (no proof
 * slot yet: Plan 5's proof pipeline installs the source). Only 'none' asks "Mark paid without proof?".
 */
export type ProofState = 'attached' | 'none' | 'unavailable';
let proofSource: ((code: string) => ProofState) | null = null;

/** Installs where the trade's proof state comes from (Plan 5's proof slot, or a test); null removes it. */
export function setProofSource(s: ((code: string) => ProofState) | null): void {
  proofSource = s;
}

export function proofStateOf(code: string): ProofState {
  return proofSource ? proofSource(code) : 'unavailable';
}
