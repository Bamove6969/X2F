// TRIPWIRE for the rest of Task 9: its pure parts (src/modParty.ts, src/watch.ts, src/timerLoop.ts)
// are on the line and Task 8's moderation service (apps/moderation) has landed, but the service
// still defers the moderator party: `startModeration`'s default `runParty` only logs
// `party-deferred`. Once Task 9's I/O wiring lands in apps/moderation/src/main.ts (the real
// `runParty` built with `modPartyArgs`, the watcher and the timer loop) this fails: then delete it.
// Checks the local tree only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('../../../apps/moderation/src/main.ts', import.meta.url));

describe('Task 9 I/O is not wired into the moderation service yet', () => {
  it('NEEDS_TASK_9_IO: apps/moderation defers the moderator party and does not call modPartyArgs', () => {
    const src = readFileSync(MAIN, 'utf8');
    expect(src, 'Task 9 I/O landed: delete this tripwire').toMatch(/'party-deferred'/);
    expect(src, 'Task 9 I/O landed: delete this tripwire').not.toMatch(/\bmodPartyArgs\s*\(/);
  });
});
