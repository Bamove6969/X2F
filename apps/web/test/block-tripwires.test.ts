// TRIPWIRES for Task 37's web side (the trader-to-trader block). They read the local tree only:
// each fails when what it waits for lands, then build that part and delete the check.
// (NEEDS_TASK_20_BLOCK_UI is retired 2026-10-30: ChatPanel shows BlockAction under its notice,
// test/chatPanel.test.tsx "ChatPanel: block (Task 37)".)
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('Task 37 web still waits for its design', () => {
  it('NEEDS_DESIGN_BLOCK: the Block board is not in the app canvas yet (brief item 14)', () => {
    // Claude Design's board is drafted on origin/wip/design-brief as docs/design-boards/Block.dc.html
    // and Block-Wide.dc.html (views: profile, chat, settings; the confirm sheet). The build follows
    // its copy and structure with kit parts only, no new CSS: settings/Blocked.tsx
    // (/settings/blocked, linked from Security), settings/BlockAction.tsx (on the quote). When the
    // board lands in design/x2f-app/ with a reference: build its styling (the Blocked chip, the
    // More menu on the profile and chat, the confirm as a Sheet), add expectParity to
    // e2e/block.spec.ts, have the owner sign off blockCopy.ts (COPY-UNSIGNED), link the Blocked list
    // from the Profile tab (Plan 5), and delete this check.
    const boards = readdirSync(`${ROOT}design/x2f-app`).filter((f) => /block/i.test(f));
    expect(boards, 'a block board landed: build to it').toEqual([]);
  });
});
