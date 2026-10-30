/**
 * Task 24's trade-room slots (Task 22's slot interface, TradeRoom.tsx), registered at import
 * (screens.ts imports this file): seller × `paid` (SellerConfirm); any × `settling` guarded to a
 * release (the seller's SellerConfirm, the buyer's Released); any × `released` (Released). Kept
 * apart from SellerConfirm.tsx so that importing a screen never imports TradeRoom (no cycle
 * TradeRoom → screens → SellerConfirm → TradeRoom at module init), as Task 25's refundScreens.ts.
 */
import { RELEASE_SLOTS } from './release/slots.js';
import { registerTradeScreen } from './TradeRoom.js';

for (const s of RELEASE_SLOTS) registerTradeScreen(s);
