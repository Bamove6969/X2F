// TRIPWIRES for Task 37's web side (the trader-to-trader block). They read the local tree only:
// each fails when what it waits for lands, then build that part and delete the check.
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 37 web still waits for its design and the shared popup', () => {
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

  it("NEEDS_TASK_21_CANTDOTHAT: the block's refusals are inline until the shared CantDoThat popup is on the line", () => {
    // Plan 5 Task 21 (wip/lead-p5-task21) adds ui/CantDoThat.tsx. Then show BlockAction's and
    // Blocked's refusals ("That trader cannot be blocked.", the failed unblock) through it, with
    // its feedback link, and delete this check.
    expect(has('apps/web/src/ui/CantDoThat.tsx'), 'CantDoThat landed: use it for the block refusals').toBe(false);
  });

  it('NEEDS_TASK_20_BLOCK_UI: the trade chat has no block action yet (Task 20 ChatPanel not built)', () => {
    // When ChatPanel lands (installed into the trade room through Task 23's setTradeChat seam,
    // paySeams.ts, and used for offer chats from the quote's Chat button): put
    // <BlockAction displayName=… /> in the chat header area (the API refuses a blocked pair's
    // messages; apps/api/test/block-tripwires.test.ts).
    expect(has('apps/web/src/chat/ChatPanel.tsx'), 'ChatPanel landed: add the block action').toBe(false);
  });
});
