# Build spec — j31b (9 Nov 2026, DRAW2)

All new copy is COPY-UNSIGNED. Colours are THEMES tokens only. "Mono" = Atkinson Hyperlegible Mono; body = Atkinson Hyperlegible Next.
Boards: `canvas/project/<Board>.dc.html`. Backups: `$S/bak-j31b/`.

---

## DisputeRoom (phone 390)

### D-069 cooperate line (moderator = joined)
- Where: the "Moderator joined" card (`section[aria-label="Moderator joined"]`), as a 2nd line under the existing read-access line ("She can read this whole chat… Moderators only ever contact you here.").
- Copy (exact): `She may ask either of you questions. Please answer them here: if someone doesn't help, the ruling can go against them.`
- Style: 14/20, `color: var(--ink)` (the line above stays `--ink-muted`), in the same 4 px-gap column. No icon, not danger colour. Same wording for buyer and seller.
- Reached from: any dispute once a moderator joins (moderator tweak = joined).
- Height: joined +84 px.

### p11-37 refund on its way (new tweak `escrow: locked | refunding`, default locked)
- State: the seller canceled; XMR is going back to the seller's wallet; shown until 10 of 10 confirmations, then the trade moves to its canceled/refunded end screen.
- In the amount row (both moderator states: the inner block when waiting, the plain row when joined):
  - `locked in escrow` (escrow colour, lock icon) is replaced by `refunding to the seller` (15/600, `var(--caution)`, return-arrow icon 16 px: paths `M9 14L4 9l5-5` + `M4 9h11a5 5 0 010 10h-3`).
  - Line under the amount (14/20, `--ink`): `satoshi_ghost canceled this trade. The XMR has started refunding to their wallet.`
  - Meter (6 px top margin): label row 13/16 `--ink-muted`: left `Network confirmations`, right `3 of 10` (the `3` mono 14/500 `--ink`, the `10` mono). Bar: 6 px tall, radius 999, track `color-mix(in srgb, var(--ink) 12%, transparent)`, fill `var(--caution)` at n/10 width (30% drawn). `role="group"`, `aria-label="Refund confirmations: 3 of 10"`.
- Seller's own view (not drawn; same slots): `You canceled this trade. Your XMR is on its way back to your wallet.` with the same meter.
- Data: confirmations n from the refund tx, target 10.
- Height: +83 px in every moderator state.

### Notes
- Two Decided asides added (D-069; p11-37). NOTES 531 → 817.
- Heights (app + notes): waiting 1606 → **1892** (default); joined 2092 → 2462; sent 2242 → 2612; waiting+refunding 1975; joined+refunding 2545; sent+refunding 2695. `$preview` 1892.

---

## TeamChat (phone 390) and TeamChat-Wide (1280) — p11-25

Label rule: the partner sees `<lead's Trade Tag> Assistant <n>`; n = order the lead added the member (Assistant 1, Assistant 2 …). The member's own name is never shown to the partner. Replaces both the "Team member" tag and "Team <display> member: <name>".

- Partner view (viewer = partner):
  - Team notice: `14:21 · satoshi_ghost Assistant 1 is replying.` (was "desk_ana from Team satoshi_ghost is replying.")
  - Each member message: people-icon avatar (32 px, `--team`), meta line `satoshi_ghost Assistant 1 · 14:21` (label 13/16 600 `--team`). No tag chip any more.
- Lead view (viewer = lead):
  - Team notice: `desk_ana replied for you.` + sub-line `mira.k sees “satoshi_ghost Assistant 1”, not desk_ana.`
  - Each member message (right side): `desk_ana` + tag chip `ASSISTANT 1` (existing team tag style: 20 px, 11/14 600 uppercase, `--team` on 14% `--team`, people icon) + time.
  - Wide only, "Team replies in this chat" card: chip next to desk_ana `Assistant 1` (was "Team member"); line `mira.k sees “satoshi_ghost Assistant 1” on each reply, never desk_ana’s name. Every reply is also in your audit log.`
- No notes section on these boards (none existed); the rule is in the code comment and here.
- Heights: TeamChat partner 928 → **860** (default), lead 902 (unchanged). TeamChat-Wide partner 1220 → **1132** (default), lead 1132 (unchanged). Labels are shorter, so the partner chat lost wrapping lines.

---

## ProofBlur (phone) and ProofBlur-Wide — P-011 proof disclaimer

Placement: the existing grey box above the "How your proof is protected" list (phone) / under the photo editor in the right column (wide). No new callout.
- Title: `Our privacy tool can miss things.` → `Before you send` (15/20 600).
- Line 1 (14/20 `--ink`): `Our privacy tool can miss things. Check names, account numbers and addresses.` (was "Check names, account numbers and addresses before sending.")
- Line 2, new (14/20 `--ink`, 4 px top margin): `Send only a real record of your payment. Moderators check proof closely and can ask you for a video of it.` (item 65: fake proof, including a copy of X2F's own pay screen; moderators ask for video)
- Button, new: text link `How proof is checked` (14/20 600 `--ink`, underlined, min-height 44 px hit area), goes to FAQ → the proofs entry.
- Shown on every review/drawing/removing/preview step (not on the sent screen).
- Decided aside added (P-011).
- Gift-card copy (T-058) on this board already matches (video row; "satoshi_ghost has 45 min to check it"; range cards need the video). No change.
- Heights: ProofBlur default 4735 → **5033** (app 1186 → 1280, notes 3549 → 3753; APP_H editor base 1036 → 1130). ProofBlur-Wide default 2505 → **2755** (H_EDIT), sent 2326 → 2478 (H_SENT). Wide: the left-column callouts (date 27, stale 39, amount 39) now fit inside the taller right column; only stacked callouts past 41 px add height (formula in the board).
- Pre-existing mismatches (also in backup, not mine): ProofBlur step=sent (declared 956 app vs 730 measured) and removeAuto=confirm-to-show+removing (+18 notes).

---

## GiftCardBrand (phone) — T-058 gift-card rules

- Replaces the caution sentence at the bottom of the list (above "Use this brand").
- Block: surface card (radius 16, padding 12 20), heading `GIFT CARD RULES` (13/16 600 uppercase `--ink-muted`), then 4 rows (15/22, 18 px `--ink-muted` icons, 10 px row padding, 1 px `--surface-raised` dividers):
  1. calendar icon — `Bought in the last 30 days` (30 mono)
  2. card icon — `Full value only. Range cards (e.g. Visa $200–$500) need a video.` (amount mono)
  3. timer icon — `The seller has 45 min to check the card.` (45 mono)
  4. list icon — `Brands on this list only, or Other.`
- Same 4 rows wherever gift-card rules are shown (offer ad, trade terms).
- Brand list unchanged: 30 researched + Home Hardware + Canadian Tire + Other (p5-6).
- Heights: amazon 3494 → **3801** (default), other 3616 → 3923, none 3520 → 3827.

---

## Main and BuyMain (phone) — O-021 + O-020 no-rate currency

Design call: TAG (not hide). A no-rate currency stays in the drop-down, greyed, with the `No rate right now` pill, can't be picked. Tapping it opens an explainer.
- New tweak option: `currencyMenu: closed | open | search | no-rate-tapped`.
- Explainer: a box inside the open currency panel, under the list (`role="alertdialog"`), surface-raised, 1 px `--line`, radius 12, padding 12 14 8:
  - Title (15/20 600, clock icon 18 px `--ink-muted`): `No rate for ARS right now`
  - Body (14/20 `--ink`): `We can’t get a market price for the Argentine peso at the moment, so it can’t be picked. It comes back on its own as soon as a price does.` (currency name from the list)
  - Button: `Got it` (44 px, outline, right-aligned) closes the box; the list stays open.
- While the box is open, the search hint line ("X2F has no market rate for … right now…") is hidden. Closing the panel also closes the box.
- The panel is absolute, so the screen height is unchanged; only the notes grew (Decided aside O-021/O-020).
- Heights: Main 6836 → **7004**; BuyMain 6732 → **6900** (all variants).

---

## MyOffers (phone), MyOffers-Wide, Fold-MyOffers — O-022 (and O-023)

The `rate: all | one-missing | none` tweak was already drawn; wording changed to the owner's words:
- Single-currency ad with no rate (rate=none): status chip `Not live · no rate` → `Can’t go live` (caution chip, signal-off icon, 28 px). Card stays dimmed to 70%, switch stays on (paused). Line under the chips unchanged: `We can’t get a rate for ARS, so this offer can’t go live. It goes live by itself when the rate is back.`
- Multi-currency ad (rate=one-missing): the no-rate currency chip now shows `Not available` visibly (12/16 600 `--caution`, after the struck code and signal-off icon; replaces the screen-reader-only "no rate right now"). Line under the chips unchanged: `No rate for ARS right now. Buyers can’t pick it until it’s back.`
- Fold-MyOffers: same two changes in the list and the detail pane.
- O-023: Decided aside on MyOffers and MyOffers-Wide: the screen stays `My offers` (matches the rail and every linking board).
- Heights: MyOffers default 2783 → **2969** (all/hold [2969, 3131], one-missing [3045, 3207], none [3049, 3211]; payTypes open +89). MyOffers-Wide default 1858 → **1974** (all [1974, 2120], one-missing/none [1998, 2144]; payTypes +71). Fold-MyOffers unchanged (1743 / 1785 / 1817).

---

## FlexOffer-Post (+Wide) — bands

Confirmed, no change: MAX_TIERS = 3, counter "of 3", full line `That's 3 bands, the most one currency can have.`, notes say Q23 3 bands / 5 payment types.
