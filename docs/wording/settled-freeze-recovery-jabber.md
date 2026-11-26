# Settled wording: freeze, recovery, reputation, Jabber (lead's list of 12 Nov 2026)

Design, 12 Nov 2026. Design's answers count as signed. Every string below is new or changed: **COPY-UNSIGNED** (as far as the owner is concerned).
Line numbers are from `origin/main` 6ebed537 unless a branch is named.

## 1. Freeze refusal texts (open disputes never block trading; only a moderator's freeze does)

The code is still `trading-hold`. These strings now say "frozen". "Hold" is kept for the 24-hour account hold only.

| Where | Old | New |
|---|---|---|
| `apps/web/src/ui/cantDoCodes.ts:291` (take) | Your account is on a trading hold while a dispute is open, so it cannot start trades. | A moderator froze trading on your account, so you can't start or join trades for now. |
| `cantDoCodes.ts:348` (post) | Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved. | A moderator froze trading on your account, so you can't post offers for now. |
| `cantDoCodes.ts:409` (My offers, Turn on) | Your account has a trading hold while a dispute is open, so your offers stay off until it's resolved. | A moderator froze trading on your account, so your offers stay off until the freeze is lifted. |
| `cantDoCodes.ts:257` `CANT_DO_TITLE.myOffersHold` | You can't turn offers on during a trading hold | You can't turn offers on while your account is frozen |
| `cantDoCodes.ts:462` `MY_OFFERS_HOLD.title` | Your offers are paused during a trading hold | Your offers are paused while your account is frozen |
| `cantDoCodes.ts:463` `MY_OFFERS_HOLD.body` | Nobody can see or take them until the hold ends. Trades already started carry on. | Nobody can see or take them until a moderator lifts the freeze. Trades already started carry on. |
| `cantDoCodes.ts:464` `MY_OFFERS_HOLD.popup` | They stay paused until the hold ends. Trades already started carry on. | They stay paused until a moderator lifts the freeze. Trades already started carry on. |
| `cantDoCodes.ts:473` `MY_OFFERS_HIDDEN['trading-hold']` | On, hidden while your account has a trading hold | On, hidden while your account is frozen |
| `apps/web/src/screens/myoffers/model.ts:125` | Paused · trading hold | Paused · account frozen |
| `myoffers/model.ts:133` | Trading hold · all offers paused | Account frozen · all offers paused |

Engineering: the comment at `cantDoCodes.ts:467` ("a dispute's hold on the account") should say "a moderator's freeze".

## 2. "See why" link: yes

A refused take, post or Turn on with code `trading-hold` links to the frozen-account notice (`FROZEN_PATH`, `/account/frozen`).

- **Link text: `See what to do`.** It is better than "See why", because the notice is about getting trading back.
- Place it as a text link under the body in CantDoThat. OK stays the one button. `CantDoThat` (`apps/web/src/ui/CantDoThat.tsx`) has no link slot yet, so it needs a `link?: { text, to }` prop.
- Show it to the account owner only. `GET /v1/account/freeze` is owner-only, so a team member gets the same body without the link.

## 3. Freeze notice when the trade record is deleted

On `wip/lead-freeze`, `parseFreeze` skips a freeze whose `dispute` is null (`AccountFrozen.tsx:56`). Such a freeze should show this variant instead. It uses the same layout as the AccountFrozen board.

- Chip `Trading frozen`, page `Account frozen`, title `A moderator froze trading on your account`: all unchanged.
- **Lead:** `The trade it came from has been deleted, so there's no dispute to open. Ask support and a moderator will look at it.`
- **Facts:** `Frozen since` and `Ends · When a moderator lifts it` stay. The **Dispute row is removed**, because there is nothing to show in it.
- **What still works:** the chat line (`AccountFrozen.tsx:89`) becomes `You can open a support ticket. A senior moderator will check your account and can lift the freeze.` The other three lines are unchanged.
- **Paused until it's lifted:** unchanged.
- **Primary:** `Contact support` (goes to `/support`, the J-14 tickets on `wip/lead-j14`). The tertiary stays `Not now`.
- If an account has both kinds of freeze, show the normal variant (the one with a dispute).

## 4. `NEW_CODE_COPY.emergency` (`apps/web/src/screens/settings/holdCopy.ts:177`; `:193` on `wip/lead-recovery`)

What the code does (`wip/lead-recovery`, `apps/api/src/auth/password.ts` `setPasswordHandler`): a password change that includes a correct recovery code applies at once. It is never staged for the 24-hour wait, whatever kind of login the session has. The code is then spent and replaced, and other waiting password changes are dropped. The code does **not** skip the 24-hour account hold after a recovery-code login, and it does not skip the wait for any other change. A running account hold still refuses the change.

- Old: `A recovery code is only an emergency way back in. It doesn't change your username or password, and it doesn't skip the 24-hour wait on changes made with just a username and password.`
- **New:** `A recovery code is only an emergency way back in. Logging in with it starts a 24-hour hold on your account. Typed in with a new password, it sets the password at once, with no 24-hour wait. It never skips the wait on other changes.`

## 5. New recovery strings (`BURNED_CODE_COPY`, `holdCopy.ts:179-186` on `wip/lead-recovery`)

| Key | Builder's text | Settled |
|---|---|---|
| `passwordCodeLabel` (:184) | Recovery code (optional) | `Recovery code (optional)` (kept) |
| `passwordCodeHint` (:185) | Add your recovery code and the new password takes effect at once, with no 24-hour wait. The code is then used up. | `With your recovery code, the new password works at once, with no 24-hour wait. The code is then burned.` |
| `passwordCodeWrong` (:186) | That recovery code doesn't match. | `That recovery code doesn't match. Check it, or leave the box empty to wait 24 hours.` |
| `title` (:180) | Your recovery code is now burned | `Your recovery code is burned` |
| `body` (:181) | The recovery code you just used will never work again. Go to Security settings for a new recovery code. | `It won't work again. Go to Security settings and make a new recovery code now.` (owner S-111) |
| `link` | Go to Security | `Go to Security` (kept) |
| `done` | Done | `Done` (kept) |

Engineering flag: the server already makes a new code (`renewRecoveryCode`). That code is only revealed to a strong login, or to the recovery session once its 24 hours are over (`revealDue`). After a password change made with the code from a username-and-password session, the person can't see the new code yet. That is why the notice says "make a new" code, as the owner asked. Check that Security lets this session do that without a 24-hour wait. If it can't, the owner needs to rule on it.

## 6. Reputation

- **Reviews on hold during an appeal** (R-011; `held: true` from `GET /v1/trades/:code/review`, `wip/lead-reputation` `apps/api/src/reviews/routes.ts`). Shown in place of the other side's review: `Reviews on this trade are on hold during the appeal. If the trade stands, they come back. If it's reversed, they're removed.`
- **Fast badge meaning** (R-042). Today it is `Paid in under half the time allowed, 30+ times`, at `packages/reputation/src/badges.ts:75`, `apps/web/src/ui/Badges.tsx:32` and `apps/web/src/screens/browse/OfferCard.tsx:30` (all on `wip/lead-reputation`).
  - **Settled: `30+ payments sent in under half the time to pay`.** It now has the same shape as "200+ trades and 98%+ positive", it says payments (a buyer-side badge), and it uses the app's own phrase "time to pay".

## 7. J-20: Jabber messages to the lead when a member joins

At the join the lead's Jabber gets two messages. One is the generic `account-change` (the `team_members` row gets `joined_at`). The other is `team-member-first-login` (`wip/lead-j20`, `apps/api/src/jabber/sender.ts:23`). Review N3 asked design to decide whether to keep both.

**Decision: one message.** The join is the member's first login.

1. `account-change`: `An account change was made on your X2F account.` (signed, owner 7 Nov). This is **not sent for the join itself**. The trigger treats the join's own columns (`joined_at`, `member_account_id` being set) as covered by the team notice. Later member changes (role, band, hours, removal) still send it.
2. `team-member-first-login` (`sender.ts:23`). Old: `A team member logged in to your X2F account for the first time.` **New: `A new team member logged in to your X2F account.`** It names no member, method or device (p5-7).

Related words:
- In-app alert (`Alerts.tsx` `KIND_WORDS['team-member-first-login']`): `A new team member logged in`.
- Jabber events page (`jabberCopy.ts:69-71`, `wip/lead-jabber-settings`): label `A new team member logs in`, note `Their first login, when they join your team.`, with the message shown under the row.

## 8. Jabber events page and loud alarm words (drawn, see boards)

`jabberCopy.ts` on `wip/lead-jabber-settings`:

| Key | Text |
|---|---|
| `eventsTitle` (:55) | `Jabber events` |
| `eventsLead` (:56) | `Pick which events send a secure Jabber message to <address>.` |
| `eventsRow` | `Events` |
| events card heading | `Which events send a message` |
| events card line | `Each message is one short sentence. It never names a person, an amount or a trade.` |
| `account-change` | `Account changes` · `A login method, wallet, hold or setting changes.` (team owner adds "team member") |
| `trade-attention` | `A trade needs you` · `A dispute opens on a trade where you're the one who pays.` |
| `team-member-first-login` | see §7; shown on team owners' accounts only |
| always-on chip | `Always on` |
| status | `2 of 2 events send a message. Changes save at once.` |
| `alwaysOnNote` (:76) | `Account changes are a security alert, so they're always on.` (team owner: `Account changes and new team members are security alerts, so they're always on.`) |
| not set up | `Set up Jabber first` · `No Jabber address yet` · `Add your Jabber address and check it with a test message. Then come back here to pick your events.` · `Events you can pick` · primary `Set up Jabber alerts` |
| footer | `Done` |

The message text is shown under each row.

`alarm.tsx:221-243` on `wip/lead-jabber-settings`:

| Key | Text |
|---|---|
| `title` | `Loud alarm` (section) |
| switch row | `Loud alarm for trade alerts` · `A loud sound on this device when a trade needs you. You pick what rings.` |
| `note` (:224) | `Rings while X2F is open on this phone. Your choices and your sound stay on this phone.` (computer: `Rings while X2F is open in this browser. Your choices and your sound stay on this computer.`) |
| `eventsTitle` | `Ring for` |
| `trade` | `Trade updates` · `A new trade, a payment marked as sent, a release.` |
| `cancel-confirm` | `A cancel that needs you` · `Your answer is needed to cancel a trade.` |
| `nudge` | `Nudges` · `The other trader nudges you.` (off by default) |
| `alert` | **not shown to traders.** That push goes only to the site owner, so the row exists only on the owner's own account: `Something needs your attention` |
| count | `Rings for 2 of 3` |
| other keys | Volume, test (`Play test sound` / `Playing at 80%`), sound choice: as on the existing board |

## Boards changed or added (`S/canvas/project/`; backups in `S/bak-w4/`)

| Board | Change | $preview height |
|---|---|---|
| `Alerts.dc.html` | Loud alarm card gains "Ring for" and the where-it-rings note. New alarm meta line. The Events row goes to JabberEvents and reads "2 of 2 on". HEIGHTS per device and Jabber state. | 1758 (was 1424) |
| `Alerts-Wide.dc.html` | Same changes | 1148 (was 832) |
| `JabberEvents.dc.html` (new) | Tweaks: account (trader or team owner), state (set up or not set up). HEIGHTS on-trader 1045, on-team-owner 1222, off 844; NOTES_H 1411 | 2456 |
| `JabberEvents-Wide.dc.html` (new) | Same tweaks. HEIGHTS 800, 886 (team owner); NOTES_H 791 | 1591 |
| `canvas.json` | Both new boards added at y 58635, x 9550 and 10020 (right of JabberSetup-Wide), placed after JabberSetup-Wide in `order`. Alerts h updated. | |

Checks: check-board prints OK for all four boards. MEASURE gives before.root == root for every tweak in night and day. relayout reports `overlaps []`. PNGs were rendered and looked at.

Not changed: JabberSetup's events step still shows the "Sample list" and its notes still mention "7 of 7 on". JabberEvents' notes say that step will reuse these rows once the owner signs the list (p11-32).
