// TRIPWIRES for Task 24's seams (it was built before Tasks 12, 19 and 22 reached the main line).
// Each fails once the missing module is on the line: then do what its message says and delete it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);
const read = (p: string): string => readFileSync(ROOT + p, 'utf8');

describe('Task 24 seams still stand in for missing modules', () => {
  it('NEEDS_TASK_22: /trade/:code goes to InterimTradeRoute until TradeRoom exists', () => {
    // When TradeRoom.tsx lands (wip/lead-p3-task22): in SellerConfirm.tsx add at top level
    //   import { registerTradeScreen } from './TradeRoom.js';
    //   for (const s of RELEASE_SLOTS) registerTradeScreen(s);
    // put `import './SellerConfirm.js';` on screens.ts's Task 24 line, keep App.tsx's TradeRoom
    // route, delete release/InterimTradeRoute.tsx and its route, and replace this tripwire with a
    // test that TradeRoom picks ReleaseRoomScreen for each RELEASE_SLOTS entry.
    expect(has('apps/web/src/screens/trade/TradeRoom.tsx'), 'Task 22 TradeRoom landed: register RELEASE_SLOTS in it').toBe(false);
    expect(read('apps/web/src/App.tsx')).toContain('<InterimTradeRoute />');
  });

  it('NEEDS_TASK_22: publicName and methodInfo copy the rules of api/trade.ts', () => {
    // When apps/web/src/api/trade.ts lands: import publicName and methodOf from it in
    // release/view.ts (and type ReleaseTrade as Pick<TradeView, ...>) instead of the local copies.
    expect(has('apps/web/src/api/trade.ts'), 'Task 22 api/trade.ts landed: use its publicName, methodOf and TradeView').toBe(false);
  });

  it('NEEDS_TASK_12: useReleaseEscrow is a stand-in with no escrow runtime behind it', () => {
    // When useEscrow.ts lands: the room's escrow (Task 22 seams.ts useTradeEscrow) already passes it
    // to ReleaseRoomScreen; if InterimTradeRoute still exists, return `useEscrow(code)` from
    // useReleaseEscrow (release/seams.ts).
    expect(has('apps/web/src/escrow/useEscrow.ts'), 'Task 12 escrow runtime landed: use useEscrow(code).release()').toBe(false);
    expect(read('apps/web/src/screens/trade/release/seams.ts')).toContain('NO_ESCROW_RUNTIME');
  });

  it('NEEDS_TASK_19: the interim route polls the trade instead of the live events stream', () => {
    // When events.ts lands: TradeRoom follows `{ type: 'trade', code, state }` events; drop the polling.
    expect(has('apps/web/src/api/events.ts'), 'Task 19 live events landed: refresh the trade on its events').toBe(false);
  });

  it('NEEDS_TASK_3: SellerConfirm reads landsIn and checkPrompt from the TradeView profile', () => {
    // When the profiles land on the main line: check the profile's field names against
    // screens/trade/release/view.ts profileCopy and the e2e stubs in e2e/release.spec.ts.
    expect(has('apps/api/src/methods/profiles.ts'), 'Task 3 profiles landed: check profileCopy against MethodProfile').toBe(false);
  });
});
