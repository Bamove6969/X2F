/**
 * A team member's actions in the account's trades (owner Jess, 26 Nov 2026): each a separate box
 * the lead grants, read from `GET /v1/team/me` (as MyAccess.tsx reads it):
 * - `trades-fund`: fund the escrow when the account sells (TradeFund, after a `fund-trade` confirm);
 * - `trades-release`: release the coins when the account sells (SellerConfirm's press and hold,
 *   after a `release-trade` confirm);
 * - `trades-upload-proof`: upload the payment proof when the account buys (BuyerPay's proof slot);
 * - `trades-mark-paid`: "I've paid" when the account buys (BuyerPay).
 * Each needs the account's escrow keys on the member's device too ("Hold trade keys",
 * `trades-escrow-keys`; memberKey.ts). A box missing: that action is not shown at all.
 *
 * The confirms take only the member's own passkey, security key or PGP key (ConfirmSheet offers no
 * authenticator code, and the API refuses any other method for these kinds).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { AuthApiError, withConfirm, type ConfirmAction } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';
import { postTradeEvent, type TradeView } from '../../api/trade.js';
import { authApi } from '../auth/authApi.js';
import { MEMBER_KEYS_BOX } from '../../escrow/memberKey.js';

export const MEMBER_ACT_BOXES = {
  fund: 'trades-fund',
  release: 'trades-release',
  uploadProof: 'trades-upload-proof',
  markPaid: 'trades-mark-paid',
} as const;

export interface MemberActs {
  fund: boolean;
  release: boolean;
  uploadProof: boolean;
  markPaid: boolean;
  /** "Hold trade keys": the account's escrow keys may be loaded on this device. */
  keys: boolean;
}

export const NO_ACTS: MemberActs = { fund: false, release: false, uploadProof: false, markPaid: false, keys: false };

/** The acts the boxes allow. Without "Hold trade keys" none: every one needs the escrow here. */
export function actsOf(boxes: readonly string[]): MemberActs {
  const keys = boxes.includes(MEMBER_KEYS_BOX);
  if (!keys) return NO_ACTS;
  return {
    fund: boxes.includes(MEMBER_ACT_BOXES.fund),
    release: boxes.includes(MEMBER_ACT_BOXES.release),
    uploadProof: boxes.includes(MEMBER_ACT_BOXES.uploadProof),
    markPaid: boxes.includes(MEMBER_ACT_BOXES.markPaid),
    keys,
  };
}

/** The boxes in a `GET /v1/team/me` answer (any group), read defensively; a box marked not ready is left out. */
export function boxesOf(raw: unknown): string[] {
  const groups = (raw as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const out: string[] = [];
  for (const g of groups) {
    const boxes = (g as { boxes?: unknown } | null)?.boxes;
    if (!Array.isArray(boxes)) continue;
    for (const b of boxes) {
      const r = b as { id?: unknown; ready?: unknown } | null;
      if (typeof r?.id === 'string' && r.ready !== false) out.push(r.id);
    }
  }
  return out;
}

/** The member's boxes: null while `GET /v1/team/me` loads; [] when it fails (no act is shown). */
export function useMemberBoxes(): string[] | null {
  const [boxes, setBoxes] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    authApi.myTeamAccess().then(
      (v) => live && setBoxes(boxesOf(v)),
      () => live && setBoxes([]),
    );
    return () => {
      live = false;
    };
  }, []);
  return boxes;
}

export type MemberStep = 'fund' | 'release' | 'pay';

/**
 * The step of this trade a member's boxes let them take on this device, or null (the member room's
 * plain view). The seller funds in setup, funding and securing (TradeFund's slot) and releases in
 * `paid` and a release's `settling` (SellerConfirm); the buyer pays in securing, secured and paid
 * (BuyerPay), with I've paid or the proof upload.
 */
export function memberStep(view: Pick<TradeView, 'role' | 'state' | 'settling'>, acts: MemberActs): MemberStep | null {
  if (!acts.keys) return null;
  if (view.role === 'seller') {
    if (acts.fund && (view.state === 'setup' || view.state === 'funding' || view.state === 'securing')) return 'fund';
    if (acts.release && (view.state === 'paid' || (view.state === 'settling' && view.settling === 'release'))) return 'release';
    return null;
  }
  if ((acts.markPaid || acts.uploadProof) && (view.state === 'securing' || view.state === 'secured' || view.state === 'paid')) return 'pay';
  return null;
}

// ── confirms ─────────────────────────────────────────────────────────────────

// TODO(API agent, agent/trades-release contract): '@x2f/accounts' ConfirmAction gains
// `{ kind: 'release-trade'; tradeCode }` and `{ kind: 'fund-trade'; tradeCode }` (the stored,
// normalized code); until both are in this tree, the cast below names them.
type TradeConfirmAction = { kind: 'release-trade'; tradeCode: string } | { kind: 'fund-trade'; tradeCode: string };
const asConfirm = (a: TradeConfirmAction): ConfirmAction => a as unknown as ConfirmAction;

export type Prove = (action: ConfirmAction) => Promise<string>;

/**
 * A trade event a member sends with a confirm token: `withConfirm` sends it once without one; on
 * the API's 403 `confirm-required` for this kind, `prove` (the member's own key) earns the token
 * and it goes again with it. The trade API answers with ApiCallError, so its `confirm-required` is
 * handed to withConfirm as the AuthApiError it reads.
 */
export async function confirmedEvent(code: string, kind: TradeConfirmAction['kind'], type: 'release-started' | 'fund-started', prove: Prove): Promise<TradeView> {
  const run = async (confirmToken?: string): Promise<TradeView> => {
    try {
      return await postTradeEvent(code, confirmToken === undefined ? { type } : { type, confirmToken });
    } catch (e) {
      if (e instanceof ApiCallError && e.code === 'confirm-required') throw new AuthApiError(e.status, 'confirm-required', e.extra);
      throw e;
    }
  };
  return withConfirm(asConfirm({ kind, tradeCode: code }), run, prove);
}

// ── the room's context ───────────────────────────────────────────────────────

export interface MemberRoomActs {
  acts: MemberActs;
  /** Opens the member's confirm sheet (useConfirm's prove). */
  prove: Prove;
  /** The API refused one of the member's steps with a team refusal code: the room shows CantDoThat. */
  refused(code: string): void;
}

/** Set by the member's trade room only; null on the account owner's device (every action shown). */
export const MemberActsContext = createContext<MemberRoomActs | null>(null);

export const useMemberActs = (): MemberRoomActs | null => useContext(MemberActsContext);
