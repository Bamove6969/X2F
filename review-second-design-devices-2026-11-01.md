# Review: origin/wip/second-design-devices @9f23e55 (C2-D1, approval screens + Devices)

Reviewer: review agent, 2026-11-01. Range `git diff e7dd94c..9f23e55` (main e7dd94c is contained).
Worktree: ~/x2f-worktrees/review-devices-design (detached, npm ci). Nothing committed or pushed.

## Verdict

**APPROVE WITH ONE CHANGE (I1), then land.** The auth flows keep the same protections. The one
real regression is on Devices, not in the login flow: "Log out all other devices" now skips team
members' sessions, but the companion "Log out all team members" button from the same owner
decision was not built. Owners lose the one-tap way to end every session they could end before.
M1 to M3 are small and can go in the same round or as follow-ups.

## Checks run (all under `flock ~/x2f-comms/check.lock`)

| Check | Result |
|---|---|
| `npm run typecheck` (all workspaces) | pass |
| `npx vitest run --project @x2f/web` | 81 files / 1121 tests pass |
| Playwright `security.spec.ts login.spec.ts team.spec.ts`, `--workers=1`, `X2F_CHROMIUM_PATH=/usr/bin/chromium` | 66 passed (1.3 min) |
| `npm run copy-lint` | clean |
| cantDoThat-lint ratchet | passes at the new cap. The branch adds exactly 5 `not-a-refusal` pragmas, so 50 is now full with no spare room. Each of the 5 is an explanation, not a rule, so the raise is justified. |

Logs: ~/x2f-worktrees/rvd-{typecheck,webunit,pw,copylint}.log

## Security check of the auth flows (what I checked)

- **Same API calls.** ApproveOnDevice still calls only `pollLoginApproval` (2 s) and `cancelLoginApproval`. The new back control in the waiting state calls the same `cancel()` as the Cancel button. LoginApprove still calls `decideApproval(id, {choice} | {choice, logOut} | {block:true})`, with the same request bodies (the unit test asserts the POST bodies). There is one new read-only call: `getDeviceSettings()`, which the approving device makes when the chooser opens (N1).
- **Number matching.** Unchanged. The choices become radios, and Yes stays disabled until a number is picked. A wrong number still blocks: the server decides, and the client still shows `wrong: true`.
- **Block.** Unchanged. It is reachable from both the ask step and the chooser, and the button is now `danger-outline`.
- **Device limit.** The API still returns 409 `too-many-devices` with a session list. The client now opens the chooser directly instead of showing CantDoThat first. This was intended and matches the board. The server-side check (approval.ts:572-589) is untouched, and so is the chosen-session check.
- **Weak sessions.** Still refused where they were. In the chooser, `weak-session` (approval.ts:568 / :587) goes through `loginCantDo` and then CantDoThat, as before. Devices' `end()` still goes through `weakSessionCantDo`.
- **24-hour hold.** Still goes through CantDoThat (`loginCantDo` HOLD branch, unchanged).
- **One device at a time.** The switch still calls `withConfirm({kind:'set-one-device'}, …, prove)`. `/settings/devices` mounts its own `useConfirm` (DevicesWithConfirm), and the e2e test asserts the confirm dialog and `{on:true, confirmToken}`. A held result still shows the held note.
- **M5 (no account info on the new device).** Confirmed. The new device shows only its own number, the countdown, the steps and the backup link. The only new sentence is in the blocked state: "This device can't log in until it's approved. Nobody else on your account is affected." It reveals nothing. The board's note about the room on the account's devices was deliberately left out. The `loggedOut` names on "You're in" were already there before this branch.
- **Owner-only.** `/settings/devices` is wrapped in `OwnerOnly`, the same as Security. Team members get the owner-only CantDoThat, and the API refuses with 403 regardless.

## Findings

### Important

**I1. "Log out all other devices" no longer ends team members' sessions, and nothing replaces it.**
- Where: apps/web/src/screens/settings/Devices.tsx:185 (`const others = mine.filter(...)`) and :262-270.
- Before: `others` was every non-current session, team members' included. "Log out all other devices" was how an owner who suspected a compromise cleared everything with one tap.
- Now: only the owner's own devices are covered. The board makes this change together with a separate **"Log out all team members"** button and an explaining line, citing the decision "Owner, 2 Nov: separate bulk logout for team members" (docs/design-boards/Devices.dc.html:100,112 and Devices-Wide.dc.html:111,123,425 on wip/design-brief). The branch takes the restriction but lists the button as "not built" (devicesCopy.ts header).
- Why it matters: this is a step back for incident response. Removing N team sessions now takes N separate confirms.
- The missing button needs no new API. It is `end(team.map(s => s.id), …)`, the same `endSession` loop that `end-others` used to run on these ids.
- Fix (either one):
  - (a) Add "Log out all team members" in the team card (askTeamAll → Sheet → `end(teamIds, 'All team members were logged out.')`), plus the board's line "'Log out all other devices' covers only your own devices. Use 'Log out all team members' for your team." Add a unit test and an e2e test.
  - (b) Keep `others = list.filter(s => !s.current)` until (a) is built.
- I recommend (a). It is about 20 lines and the copy is on the board.

### Medium

**M1. After the new device is let in, the back control goes back to the login chooser even though the device is now logged in.**
- Where: apps/web/src/screens/auth/ApproveOnDevice.tsx:92. `back` is `onRestart` for every stage except waiting, including `'in'`.
- On the `'in'` screen this calls `setWaiting(null); setMethod('choose')`. The person sees the login chooser while their session is already live. It is not a security hole, but it is confusing and can lead to a second login attempt and a second approval request.
- Fix: for `stage === 'in'`, use `onLoggedIn` for the back control (or hide it). Keep `onRestart` for blocked and expired.

**M2. A11y: stage changes on the new device are not announced, and focus can land on a different action.**
- Where: ApproveOnDevice.tsx, the waiting / in / blocked / expired renders. All of them use the same FlowScreen tree.
- React reuses the footer `<button>` across stages. A keyboard or screen-reader user focused on **Cancel** stays focused on the same DOM node when the approval lands, but the button is now **Continue** (or **Try again**). Nothing is announced: there is no live region and focus does not move.
- Countdown: it is fine that it is not live (no announcement every second). But the outcome itself also goes unannounced, and this branch removed the old `aria-live` from the number.
- Fix:
  - Give each stage's `<section>`/`<h2>` a `key` per stage, and focus the h2 (`tabIndex={-1}`) on stage change. LoginApprove already does this with Sheet's `focusKey`.
  - Or wrap the stage heading in a `role="status"` region.
  - Also add `key={stage}` on the footer buttons so a press on Cancel can't become Continue.

**M3. The two UI-kit branches collide.**
- This branch and origin/wip/lead-design-myoffers both add `apps/web/src/ui/Switch.tsx`, `Notice.tsx`, the `.x2f-switch*` rules in ui.css, and `apps/web/e2e/design-shots.spec.ts` (different blobs: 5d5aa9c here, 3adb67e there; wip/design-screens-2026-11-01 has a third). Whichever lands second will hit conflicts in every one of these files.
- The two `.x2f-switch` stylesheets also differ: the knob is drawn with flex here and absolutely positioned there, keyed on `data-on` here and `aria-checked` there. A careless merge would keep both and break the switch's look.
- Recommendation: see "Switch and Notice: which to keep" below. Land one branch, then rebase the other onto the unified parts.

### Nits

- **N1. New call: LoginApprove.tsx:67 `getDeviceSettings()`.** It only fills "You can be logged in on N devices at once." It runs on the logged-in approving device, fails soft to null, and leaks nothing. But it is a call the flow did not make before.
  - Option: have the 409 body carry `max`, or accept the call as is. I'm fine accepting it; I'm noting it because the brief said "exactly the same API calls".
- **N2. Dead path after dropping the popup.** `loginCantDo`'s `TOO_MANY_DEVICES_CODE && where === 'approve'` branch (refusals.ts:84) and `TOO_MANY_DEVICES_APPROVE` (cantDoCodes.ts:352) can no longer be reached from LoginApprove.
  - Delete them, or leave a comment. The `too-many-devices` CantDoCode is still valid for other callers, if there are any.
- **N3. ApproveOnDevice.tsx:174.** `aria-labelledby` on a plain `<span>` (generic role) is prohibited by ARIA and ignored by most screen readers. Reading order already gives "Your number, 47".
  - Drop the attribute, or make the card a `<dl>`/`role="group"` with the label.
- **N4. Devices.tsx:40.** `C.count` is defined but never used. The JSX builds the sentence with `<span className="x2f-num">` instead.
  - Remove it, or use it for an `aria-label`.
- **N5. Already there before this branch: "2 of 1 devices logged in".** With One device at a time on (`max = 1`) and a team member logged in (the member counts in `devicesInUse`), the count reads "2 of 1". The meter clamps to 1 pill.
  - Consider not showing the count when `oneDevice` is on, or counting only your own devices there.
- **N6. LoginApprove.tsx:127-133.** When this device logged itself out (one-device mode, or it chose itself), OK now calls `navigate('/login')`. That is good. But the local session state is not cleared before the navigate.
  - Check that Login doesn't bounce a "still logged in" client back. The e2e test covers only the case where this device stays in.
- **N7. The cantDoThat-lint cap is now exactly full (50/50).** The next screen that needs an explaining sentence will have to raise it again.
  - Fine as is. Just be aware that myoffers is at 45 on its own base, so the cap will need a rebase when both land.

## Switch and Notice: which to keep

**Switch**

| | this branch (devices) | lead-design-myoffers |
|---|---|---|
| Props | `on`, `onToggle`, `labelledBy` (required), `describedBy`, `disabled`, `part` | `checked` + any native `<button>` attribute (`aria-label` / `aria-labelledby` / `onClick` / `data-*` / `disabled`) |
| Accessible name | Required by the type | Not enforced (just a comment) |
| CSS hook | `data-on` | `[aria-checked]`: one source of truth |
| Tap box | min 52×44 | 60×44 |
| Focus ring | `.x2f-switch:focus-visible` | none |
| Disabled look | cursor only | `opacity: .5` |

**Keep the myoffers API shape** (`checked` + native button attributes, styled from `aria-checked`). It is the more idiomatic design, it can't drift from its ARIA state, and it passes `data-part` and handlers through without bespoke props. Add three things from this branch:
1. Require a name in the type: `({'aria-labelledby': string} | {'aria-label': string})`.
2. The `:focus-visible` ring.
3. The flex knob, so the knob position doesn't hard-code `left: 23px`.

Keep the myoffers 60×44 box and the disabled opacity. Devices then calls it like this: `<Switch checked={settings.oneDevice} onClick={…} aria-labelledby="devices-one-l" aria-describedby="devices-one-d" disabled={…} data-part="one-device-toggle" />`.

**Notice**

These are two different components that happen to share a name:
- This branch: a static caution box with an info icon and no live role by default (`part`, optional `role`). It is shown when the sheet opens ("at the limit", "one device").
- myoffers: an outcome line (`tone: plain|caution|danger`) that always sets `role="status"` or `role="alert"`. It is shown after an action.

Using the myoffers one for the approval notes would announce an alert as the sheet opens, which is wrong. Using this one for outcomes would lose the live role.

**Recommendation:** one `Notice` with `tone: 'plain' | 'caution' | 'danger'`, an optional `icon` (default: the info icon for caution), and an explicit `live?: 'status' | 'alert'` that defaults to **none**. Outcome callers in MyOffers pass `live`. Keep the class names `x2f-notice` with `data-tone`, and fold `.x2f-caution-note` and `.x2f-outcome` into it. If a quick merge is wanted instead, rename this branch's component to `CautionNote` and keep myoffers' `Notice` as is.

Land order: whichever lands first, the second rebases and moves its call sites to the unified parts.

## Questions for the lead / owner

1. **I1:** add "Log out all team members" now (my recommendation), or keep the old all-sessions behaviour until it is built? The board's comment dates the owner decision to "2 Nov", which is after today's date (1 Nov), so please confirm that the decision really happened.
2. **Copy:** every sentence here is marked COPY-UNSIGNED (the boards are Draft copy). Is it OK to land unsigned copy on login screens, or should it wait for the owner's sign-off?
3. Is the new `getDeviceSettings` call in the chooser (N1) acceptable, or should the 409 body carry `maxDevices`? The latter is an API change and needs a separate task.
