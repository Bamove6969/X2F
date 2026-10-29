// TRIPWIRES for My offers (Plan 3 Task 36), local tree only. Each fails once what it waits for is
// in this tree: then do what its message says and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('My offers waits for its board and the shared popup', () => {
  it('NEEDS_DESIGN_MYOFFERS: no Claude Design board for My offers yet (design brief item 3)', () => {
    // Built from the existing kit only (Button, screens.css's x2f-screen, x2f-list, x2f-row,
    // x2f-note, x2f-error, x2f-link) with no CSS of its own, kit Buttons for the on/off
    // (role="switch") and the Select toggles (aria-pressed), no parity entry, and a "My offers" link (kit quiet-button classes) at the end of PostOffer. When the board
    // lands: match apps/web/src/screens/MyOffers.tsx to it, place the entry point (PostOffer, the
    // Profile tab) as the board says, add expectParity to e2e/myOffers.spec.ts, and delete this.
    expect(has('design/x2f-app/MyOffers.dc.html'), 'The My offers board landed: build MyOffers.tsx to it and add parity').toBe(false);
  });

  it('NEEDS_CANTDOTHAT_MYOFFERS: refusals are inline text until the shared CantDoThat popup is on the line', () => {
    // When Plan 5 Task 21 lands: show the account-wide refusals (trading-hold, trading-paused,
    // too-many-offers) through CantDoThat with its feedback link, keep the per-row line naming
    // which offer stayed off, and check Task 21's cap code ('offer-cap') against the API's
    // 'too-many-offers'.
    expect(has('apps/web/src/ui/CantDoThat.tsx'), 'CantDoThat landed: move My offers refusals into it (myoffers/model.ts refusalLine)').toBe(false);
  });
});
