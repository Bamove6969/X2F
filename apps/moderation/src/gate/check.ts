import type { GateSource } from './registry.js';
import { syncRegistry } from './registry.js';
import type { GateStore } from './store.js';
import { authorizeRuling, type Authorization, type GateContext, type GateRuling, type RulingInput } from './verify.js';

/**
 * The one way to ask the gate about a ruling (Plan 4 Task 13): sync the registry first, so a
 * switch-off or removal the API shows already counts, then check the ruling with its stored taps,
 * then save what the gate learnt (the nonces it bound, the ruling it saw), whatever the answer.
 *
 * Plan 4 Task 14: the ruling executor (`src/execute.ts`, outside gate/) calls this each pass for a
 * disputed trade, with the ruling from `pgGateSource.storedRulings` (round 1's once there is an
 * appeal, Note 2026-10-30 M3), the recorded terms from this process's own records (`recordedTerms`)
 * and the balance from the mod party, and settles `settle.payouts` once, mod-built for the winner.
 * Nothing here calls `settle`.
 */
export function gateCheck(
  store: GateStore,
  source: GateSource,
  input: Omit<RulingInput, 'taps' | 'round1'> & { round1?: GateRuling },
  ctx: GateContext,
): Promise<Authorization> {
  // One critical section per gate (review M2): never alongside the periodic sync or another check.
  return store.exclusive(async () => {
    await syncRegistry(source, store.state, ctx);
    const taps = await source.rulingTaps(input.ruling.id);
    const { round1: r1, ...rest } = input;
    // Review p4t22 N1: round 1's own taps, for round 2 only and only while the gate has not seen round 1
    // (review F2: always for a `verifyOnly` check, which holds round 1 to its taps; see `authorizeRuling`).
    const round1 =
      input.ruling.round === 2 && r1 !== undefined && (input.verifyOnly === true || !Object.hasOwn(store.state.rulingsSeen, r1.id))
        ? { ruling: r1, taps: await source.rulingTaps(r1.id) }
        : undefined;
    const result = await authorizeRuling(store.state, { ...rest, taps, ...(round1 ? { round1 } : {}) }, ctx);
    await store.save();
    return result;
  });
}

/** Syncs the registry every `intervalMs` (and saves the gate), until `stop`. A failed pass is logged and the next one runs. */
export function startGateSync(store: GateStore, source: GateSource, ctx: GateContext, intervalMs = 60_000): { stop(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();
  const pass = (): void => {
    if (stopped) return;
    running = store
      .exclusive(async () => {
        await syncRegistry(source, store.state, ctx);
        await store.save();
      })
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
