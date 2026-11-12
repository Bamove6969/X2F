/**
 * C-021 (owner p11-33, 9 Nov 2026): "When a device becomes active again (website, Android web app
 * or app) it syncs first: every change is pushed before the user can act (a few seconds)."
 *
 * The sync-first gate. When this tab becomes active again (`watchResume`: back from the background
 * after RESUME_AFTER_HIDDEN_MS, back online (at most once per ONLINE_DEBOUNCE_MS), restored from the
 * back-forward cache, or a frozen page resumed), `syncNow` runs every registered sync at once: the
 * pulls of fresh state (the open trade room's trade, the dispute, the site's maintenance and
 * trading-paused state, the offers and their quote, My offers, Post offer's methods and prices)
 * and the flush of anything this device has queued (none on main yet: the chat sends go straight
 * out; the erased-chat markers of C-014 register here when they land). The phase is `syncing`
 * until they all succeed (`ready`). `SyncGate` holds the actions that change state while it is `syncing`; reading never
 * waits. A sync that fails, or is still running after SYNC_TIMEOUT_MS, ends `stale`: the actions
 * work again and the page says plainly that it may be out of date, with Try again (never stuck).
 * The server still judges every action against the current trade (a stale tap is refused there).
 *
 * The escrow worker is not gated here: it keeps its own loop (it re-reads the trade and its own
 * escrow before it signs anything; escrow/runtime.ts).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type SyncPhase = 'ready' | 'syncing' | 'stale';

/** "A few seconds" (owner): after this the gate lets go and says the page may be out of date. */
export const SYNC_TIMEOUT_MS = 8_000;
/** A tab switch shorter than this is not "becoming active again" (no Updating flash on every glance away). */
export const RESUME_AFTER_HIDDEN_MS = 5_000;
/**
 * Back online syncs at most once in this long, and never while a sync is already running: a flaky
 * connection that drops and comes back again and again must not hold the page again and again.
 */
export const ONLINE_DEBOUNCE_MS = 3_000;

/** COPY-UNSIGNED (C-021; no board draws the gate yet: design writes the final words). */
export const SYNC_COPY = {
  updating: 'Updating…',
  stale: "Couldn't update just now. What you see may be out of date.",
  retry: 'Try again',
} as const;

type Sync = () => unknown;
const syncs = new Set<Sync>();
const listeners = new Set<() => void>();
let phase: SyncPhase = 'ready';
let round = 0;

function setPhase(next: SyncPhase): void {
  if (phase === next) return;
  phase = next;
  for (const l of [...listeners]) l();
}

export function getSyncPhase(): SyncPhase {
  return phase;
}

export function subscribeSyncPhase(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Adds a sync run on every resume (a pull of fresh state, or a flush of a queue); returns its removal. A sync fails by rejecting or throwing. */
export function registerResumeSync(fn: Sync): () => void {
  const entry: Sync = () => fn();
  syncs.add(entry);
  return () => {
    syncs.delete(entry);
  };
}

/** Runs every registered sync now; `ready` once all succeed, `stale` on a failure or after `timeoutMs`. A later call supersedes this one. */
export async function syncNow(timeoutMs = SYNC_TIMEOUT_MS): Promise<SyncPhase> {
  const mine = ++round;
  setPhase('syncing');
  const all = Promise.allSettled(
    [...syncs].map((s) => {
      try {
        return Promise.resolve(s());
      } catch (e) {
        return Promise.reject(e);
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), timeoutMs);
  });
  const res = await Promise.race([all, timedOut]);
  clearTimeout(timer);
  if (mine === round) setPhase(res !== 'timeout' && res.every((r) => r.status === 'fulfilled') ? 'ready' : 'stale');
  return phase;
}

/** Listens for this tab becoming active again and runs `syncNow` each time; returns stop(). */
export function watchResume(o: { now?: () => number } = {}): () => void {
  const now = o.now ?? Date.now;
  let hiddenAt: number | null = document.visibilityState === 'hidden' ? now() : null;
  const go = () => void syncNow();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt ??= now();
      return;
    }
    const was = hiddenAt;
    hiddenAt = null;
    if (was !== null && now() - was >= RESUME_AFTER_HIDDEN_MS) go();
  };
  let onlineAt: number | null = null;
  const onOnline = () => {
    if (phase === 'syncing') return;
    const t = now();
    if (onlineAt !== null && t - onlineAt < ONLINE_DEBOUNCE_MS) return;
    onlineAt = t;
    go();
  };
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) go();
  };
  document.addEventListener('visibilitychange', onVisibility);
  // Page Lifecycle: a page the browser froze in the background, now running again.
  document.addEventListener('resume', go);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('resume', go);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', onPageShow);
  };
}

/** The current phase, for a component. */
export function useSyncPhase(): SyncPhase {
  return useSyncExternalStore(subscribeSyncPhase, getSyncPhase, getSyncPhase);
}

/** Registers `fn` as a resume sync while mounted (always the latest `fn`). */
export function useResumeSync(fn: Sync): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => registerResumeSync(() => ref.current()), []);
}

/** Tests: forgets every sync and goes back to ready. */
export function resetSyncFirst(): void {
  syncs.clear();
  round++;
  setPhase('ready');
}
