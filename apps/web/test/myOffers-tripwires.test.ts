// TRIPWIRES for My offers (Plan 3 Task 36), local tree only. Each fails once what it waits for is
// in this tree: then do what its message says and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

/**
 * Claude Design's board (2026-10-29) is in docs/design-boards/MyOffers.dc.html (the design record,
 * merged onto main from wip/design-brief on 26 Nov 2026 as an archive). Like the other design
 * tripwires, this waits for the board to be taken onto the line: the parity boards in design/x2f-app/.
 */
const BOARDS = ['design/x2f-app/MyOffers.dc.html'];

describe('My offers waits for its board', () => {
  it('NEEDS_DESIGN_MYOFFERS: the MyOffers board is not on the main line yet', () => {
    // Design review 1 Nov 2026 (shots 31-35) is in: the screen is built to the board's structure
    // from kit parts (ui/Switch, ui/Checkbox, ui/SelectAll, ui/SelectCard, ui/ActionBar,
    // ui/Notice, ui/EmptyState): real switches, 24 px tick boxes on one grid, the selection bar in
    // the footer above the tab bar, the hold in caution. Still waiting for the board on the line:
    // add expectParity for MyOffers and MyOffers-Wide to e2e/myOffers.spec.ts (pixel polish comes
    // with the v2 visual system); build the Wide board's table (On column, Price / Per trade /
    // Status columns, Post an offer in the header row, the selection bar above the table); the
    // per-offer Edit link once an edit screen exists (Task 35). Review M4's hidden-reason lines
    // ("On, hidden while trading is paused") are still not on the board: ask Claude Design.
    for (const b of BOARDS) expect(has(b), `The My offers board landed at ${b}: build MyOffers.tsx to it and add parity`).toBe(false);
  });
  // NEEDS_CANTDOTHAT_MYOFFERS retired 2026-10-29: Plan 5 Task 21 landed; trading-hold and
  // too-many-offers open CantDoThat (MyOffers.tsx, cantDoCodes.ts myOffersCantDoText).
});
