import type { GateSource } from './registry.js';
import { syncRegistry } from './registry.js';
import type { GateStore } from './store.js';
import { authorizeRuling, type Authorization, type GateContext, type RulingInput } from './verify.js';

/**
 * The one way to ask the gate about a ruling (Plan 4 Task 13): sync the registry first, so a
 * switch-off or removal the API shows already counts, then check the ruling with its stored taps,
 * then save what the gate learnt (the nonces it bound, the ruling it saw), whatever the answer.
 *
 * NEEDS_TASK_14: the ruling executor (`gate/execute.ts`) calls this for each final ruling, with the
 * ruling from `pgGateSource.storedRulings` (round 1's once there is an appeal, Note 2026-10-30 M3),
 * the recorded terms from this process's own desk record (`recordedTerms`) and the balance from the
 * mod party, and settles `settle.payouts` once with `builder: 'mod', cosigner: settle.winner`.
 * Nothing here calls `settle`.
 */
export async function gateCheck(store: GateStore, source: GateSource, input: Omit<RulingInput, 'taps'>, ctx: GateContext): Promise<Authorization> {
  await syncRegistry(source, store.state, ctx);
  const taps = await source.rulingTaps(input.ruling.id);
  const result = await authorizeRuling(store.state, { ...input, taps }, ctx);
  await store.save();
  return result;
}

/** Syncs the registry every `intervalMs` (and saves the gate), until `stop`. A failed pass is logged and the next one runs. */
export function startGateSync(store: GateStore, source: GateSource, ctx: GateContext, intervalMs = 60_000): { stop(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();
  const pass = (): void => {
    if (stopped) return;
    running = syncRegistry(source, store.state, ctx)
      .then(() => store.save())
      .catch(() => ctx.log({ reason: 'gate-sync-failed' }))
      .finally(() => {
        if (!stopped) timer = setTimeout(pass, intervalMs);
      });
  };
  pass();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
