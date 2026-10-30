// TRIPWIRE (Tasks 38-39 review M2): the owner's 48-hour auto-close of an unconfirmed buyer cancel is
// a machine `tick` (packages/trade machine.ts, SELLER_CONFIRM_CANCEL_TIMEOUT_H), decided by
// `timerEvents` (timerLoop.ts). No API loop runs `timerEvents` yet (Task 9's `startTimers`), so the
// auto-close does not fire on its own today. When that loop lands, it must read the trades
// `awaitingCancelConfirm` selects (closed, but still timed and paused by maintenance) as well as
// the open ones; then add an API test that the 48 h close fires, and delete this check.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('Task 39 waits for the API timer loop', () => {
  it('NEEDS_TASK_9_TIMER_LOOP: the 48 h auto-close of an unconfirmed buyer cancel needs startTimers', () => {
    const files = readdirSync(SRC, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts'));
    const uses = files.filter((e) => /\btimerEvents\s*\(/.test(readFileSync(join(e.parentPath, e.name), 'utf8')));
    expect(uses.map((e) => e.name), 'the API timer loop landed: make it read awaitingCancelConfirm trades too, then delete this').toEqual([]);
  });
});
