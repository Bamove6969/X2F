# Review: `wip/lead-sync-first` 14a0a1a5 (C-021, sync first on resume)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-sync` at 14a0a1a5, base main 6ebed537.
The branch is a single commit, 14a0a1a5: 9 files, +731/-6. It adds `session/syncFirst.ts`, `ui/SyncGate.tsx` and `ui/sync-gate.css`; wires them into `App.tsx`, `api/site.ts`, `TradeRoom.tsx` and `DisputeScreen.tsx`; and adds two new test files, `test/syncFirst.test.tsx` and `e2e/syncFirst.spec.ts`.

## Verdict: PASS (3 Minor, none blocking)

Counts: 0 Major, 3 Minor (S1-S3), 4 Info (S4-S7). The gate can only *withhold* an action, never cause one, so the money path is not made less safe.

The tests ran once disk space came back. During the review the volume holding the repository and `/tmp` filled up (0 MB free). I removed my own throwaway worktree and touched nobody else's files. Space came back to about 5 GB, apparently freed by someone else, and I reran everything.

## The questions

**Can the gate drop or double-fire an action?** It cannot double-fire anything. While `syncing` it calls `preventDefault` and `stopPropagation` on `click`, `submit`, `pointerdown` and Space/Enter `keydown` aimed at a control, in the capture phase on `document`, which runs before React's root listeners. It queues nothing, so there is nothing to replay later.

It does drop: a tap made during a sync does nothing. The banner says "Updating…" (but see S2), and the person taps again once the sync is done, against fresh state.

The ends of a gesture (`pointerup`, `keyup`) are never held, so a press started before the gate came up finishes normally. For the hold button, that means a reset, not a release (next point).

**A release hold racing a resume.** When the gate comes up, it sends a synthetic `pointercancel` to every element with `[data-holding="true"]`. `HoldButton`'s `onPointerCancel={stop}` then clears the timer and disarms. I checked both modes:
- `completeOn: 'hold'` (the release): the timer is cleared before it can fire `finish()`.
- `completeOn: 'release'` (`TradeFund`'s wallet-link hold): `data-holding` stays `"true"` while armed, so the armed state is cancelled as well. A later `pointerup` or `keyup` then calls `release()`, which with `armedRef` false runs `stop()`, never `finish()`.
- While the gate is up, a new hold cannot start: `pointerdown` and Space/Enter `keydown` are held, and key repeats never call `start()`.

The phase change goes through `useSyncExternalStore`, which renders synchronously, and React 18 flushes that commit's passive effects synchronously. So no user event can land between "syncing" and the guard being installed. `useLayoutEffect` would make that explicit (S4).

**The money path.** The gate is advisory UX. The server still judges every action, and the escrow worker re-reads the trade and its escrow before signing anything. The worst case is a gate that fails open, which is today's behaviour. The gate has no path that completes a hold.

**A submit queued during a sync.** It is not queued, so it cannot be replayed. Pressing Enter in a text field passes the `keydown` (the target is not a control), and then the implicit submit event is held. Typing is never held, Space in the chat composer included. The CSS only changes the cursor.

**Can it get stuck?**
- A sync that never settles: the 8 s timeout (`SYNC_TIMEOUT_MS`) ends in `stale`, which never holds.
- Repeated visibility flips: each resume bumps `round`, and only the newest call sets the phase. A glance away shorter than 5 s (`RESUME_AFTER_HIDDEN_MS`) runs nothing.
- bfcache: `pageshow` with `persisted` set runs a sync; a `visibilitychange` may run a second one, which is harmless.
- The gate's listeners are removed on unmount. Moving to a route that is not gated, or maintenance replacing the app, both release the gate.

The only lingering effect is S3 (repeated `online` events).

**Keyboard and screen readers.** Keyboard use works and text fields are never held. The screen-reader gap is S2.

**Were tests weakened?** No. The diff touches no existing test file. The only test changes are the two new files.

## Findings

### S1 (Minor): on four of the six gated screens, the sync refreshes only the site status
`useResumeSync` is registered in only three places:
- `App.tsx`: `GET /v1/site`, the maintenance and trading-paused state;
- `TradeRoom.tsx`: the trade;
- `DisputeScreen.tsx`: the trade and the dispute.

Post offer, the offers lists, the quote and My offers register no pull of their own. On those screens, "Updating…" holds the controls only while the site status is re-read, then lets go with the offers, the quote price and my offers' state exactly as they were before the tab went to the background. The page looks fresh but is not, which is the opposite of what C-021 asks for ("every change is pushed before the user can act").

It is safe, because the take, post and status routes re-check everything on the server. But register a resume pull for:
- the offers list and quote (the offer and its price);
- My offers (the list);
- Post offer (methods, prices and the person's own offers, the same reads the screen makes on mount).

### S2 (Minor, accessibility): "Updating…" may not be announced, and held buttons give no sign
The `role="status"` element is mounted together with its text. Many screen readers announce only *changes* to a live region that was already on the page, so "Updating…" can go unread.

A screen-reader user who activates a button then gets no result and no explanation, because held controls are not marked disabled (`aria-disabled`) and the main area is not marked busy (`aria-busy`).

Fix:
- keep an empty live region mounted at all times and set its text when the phase changes;
- put `aria-busy="true"` on `main` (or `aria-disabled` on the held controls) while held.

The stale message uses `role="alert"`, which is announced when it is inserted, so that one is fine.

### S3 (Minor): repeated `online` events keep holding the page
`window` `online` runs `syncNow` every time with no debounce. On a flaky connection a person can be held for up to 8 s again and again. Suggest ignoring an `online` event within a few seconds of the last sync, or only syncing when an `offline` was actually seen first.

### S4 (Info): install the guard in `useLayoutEffect`
Today the guard runs synchronously only because React 18 flushes passive effects for SyncLane renders. `useLayoutEffect` would make "no event between syncing and the guard" a guarantee rather than an implementation detail.

### S5 (Info): `new PointerEvent` has no fallback
The constructor exists in every browser the app targets (iOS 13+). But if it throws, the effect throws before the guard listeners are added. A `typeof PointerEvent === 'function'` check with a plain `Event('pointercancel')` fallback costs nothing.

### S6 (Info): links are never held
`<a>` elements are not in `CONTROL`, so navigation works during a sync, as the module comment intends. The only link with a side effect on a gated screen is SellerConfirm's "Payment not received" / "Open dispute" (`onClick={retract}`). It clears this device's own "release asked" marker, a safety action, so letting it through is right.

### S7 (Info): screens that are not gated
`/wallets` (payout addresses), `/settings/*` (security, devices, team, Jabber) and `/profile` are not gated. Their writes are judged by the server and the hold-v3 gates, and C-021 is about acting on stale trade or offer state, so I would leave them. Listed so it is a choice, not an oversight.

## Tests run (serialised runner, `rv-sync` at 14a0a1a5, fresh `npm ci`; no dockerd needed, none restarted)
- web vitest, 8 files: 226/226 passed. The files: `syncFirst.test.tsx`, `tradeRoom.test.tsx`, `tradeRoom-tripwires.test.ts`, `tradeRoomEscrow.test.tsx`, `release.test.tsx`, `release-tripwires.test.ts`, `dispute.test.tsx`, `frontDoor.test.tsx`.
  - The log also prints 28 `connect ECONNREFUSED 127.0.0.1:3000` lines. Nothing failed, and none of these test files changed on the branch, so I read them as noise from existing tests. I did not check that against main.
- Playwright `e2e/syncFirst.spec.ts` with `--trace off --workers=1`: 3/3 passed.

Not run: the rest of the web suite and Playwright, and `npm run check`.
