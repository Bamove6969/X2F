// TRIPWIRES for My offers (Plan 3 Task 36), local tree only. Each fails once what it waits for is
// in this tree: then do what its message says and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

/**
 * Claude Design's board (2026-10-29) is on origin/wip/design-brief at this path, not merged yet;
 * the parity boards live in design/x2f-app/ once a board is taken onto the line.
 */
const BOARDS = ['docs/design-boards/MyOffers.dc.html', 'design/x2f-app/MyOffers.dc.html'];

describe('My offers waits for its board and the shared popup', () => {
  it('NEEDS_DESIGN_MYOFFERS: the MyOffers board is not on the main line yet', () => {
    // The screen follows the board's behaviour (a tick box per offer, Select all only ticks, the
    // Selected offers bar with Clear / Turn on / Turn off, a switch per offer, its words) but is built
    // from the existing kit only: no CSS of its own, kit Buttons for the tick boxes (role="checkbox")
    // and the switch (role="switch"), no Edit link (no edit screen until Task 35), no parity entry.
    // When the board lands: match apps/web/src/screens/MyOffers.tsx to it (the switch track, the
    // dashed card of an Off offer, the 22 px tick box in its 44 px tile), add expectParity for
    // MyOffers and MyOffers-Wide to e2e/myOffers.spec.ts, and delete this. Review M4's hidden-reason
    // line ("On, hidden while trading is paused") is not on the board: ask Claude Design.
    for (const b of BOARDS) expect(has(b), `The My offers board landed at ${b}: build MyOffers.tsx to it and add parity`).toBe(false);
  });

  it('NEEDS_CANTDOTHAT_MYOFFERS: refusals are inline text until the shared CantDoThat popup is on the line', () => {
    // When Plan 5 Task 21 lands: show the account-wide refusals (trading-hold, trading-paused,
    // too-many-offers) through CantDoThat with its feedback link, keep the per-row line naming
    // which offer stayed off, and check Task 21's cap code ('offer-cap') against the API's
    // 'too-many-offers'.
    expect(has('apps/web/src/ui/CantDoThat.tsx'), 'CantDoThat landed: move My offers refusals into it (myoffers/model.ts refusalLine)').toBe(false);
  });
});
