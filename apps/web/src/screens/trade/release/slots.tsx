import type { ReactNode } from 'react';
import { Released } from '../Released.js';
import { SellerConfirm } from '../SellerConfirm.js';
import { useReleaseEscrow } from './seams.js';
import type { MethodInfo, ReleaseTrade } from './view.js';

/**
 * Task 24's screens in the trade room (Task 22's TradeRoom routes role × state to a screen):
 *   - the seller in `paid`, and in `settling` for a release (its done look) → SellerConfirm;
 *   - either side in `released` → Released.
 * Everything else belongs to another task's screen (null).
 */
export type ReleaseScreen = 'seller-confirm' | 'released';

export function releaseScreenOf(t: Pick<ReleaseTrade, 'role' | 'state' | 'settling'>): ReleaseScreen | null {
  if (t.state === 'released') return 'released';
  if (t.role !== 'seller') return null;
  if (t.state === 'paid') return 'seller-confirm';
  if (t.state === 'settling' && t.settling === 'release') return 'seller-confirm';
  return null;
}

/**
 * The slot TradeRoom renders for a `releaseScreenOf` screen. It wires SellerConfirm to the escrow
 * (the Task 12 seam in seams.ts). `onTrade` hands the trade back after `release-started`;
 * `headerAction` is the header's Chat action.
 */
export function ReleaseSlot({
  trade,
  method,
  onTrade,
  headerAction,
}: {
  trade: ReleaseTrade;
  method: MethodInfo;
  onTrade: (next: ReleaseTrade) => void;
  headerAction?: ReactNode;
}) {
  const escrow = useReleaseEscrow(trade.code);
  const screen = releaseScreenOf(trade);
  if (screen === 'released') return <Released trade={trade} />;
  if (screen === 'seller-confirm') {
    return (
      <SellerConfirm
        trade={trade}
        method={method}
        escrow={escrow}
        onTrade={onTrade}
        {...(headerAction !== undefined ? { headerAction } : {})}
      />
    );
  }
  return null;
}
