# X2F Visual system v2 (2 Nov 2026)

v2 is a **bolder layer on top of CONVENTIONS.md**. Every token and rule there still applies:
THEMES verbatim (+ `--mod`, + `--team` where members show), no hex outside THEMES, one orange
primary per screen, selection never orange (2px `--ink` border on `--surface-raised`), OPEN boxes,
"Draft copy" label, dates and durations in mono, 44px hit targets, real controls, stroke SVGs.

Exemplars to copy from (rendered shots in `design/v2-shots/after-*.png`):
- `lead/project/BuyerPay.dc.html`: phone trade screen (header, stepper, hero, amount, callout, row, footer, sheet)
- `lead/project/Refunded.dc.html` + `Refunded-Wide.dc.html`: result screen, phone and wide (hero result, timeline, tone per variant)

Check your board: `node design/tools/render-board.js <board> <out.png> [night|day] ['{"variant":"x","$state":{...},"$click":["text=..."]}']`

Colour tints use `color-mix(in srgb, var(--token) N%, transparent | var(--surface))`. Never hex, never rgba of a hex.

---

## 1. Signature: the 2-of-3 key mark

Three dots: two filled, one ring. X2F's escrow is 2-of-3 (you, the other trader, X2F), and any two
keys move the coins. The mark is X2F's one recognisable element. Use it for nothing else.

```html
<svg style="color: var(--caution);" width="62" height="14" viewBox="0 0 62 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"/><circle cx="31" cy="7" r="7" fill="currentColor"/><circle cx="55" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
```
- Sizes: **hero** 14px dots, 24px pitch (svg 62×14; this is the `space-6` dot pitch). **Small** 8px dots, 12px pitch (svg 32×8: circles r4 at 4/16, ring r3.25 sw1.5 at 28) in list rows.
- Colour = the screen's state tone: `--caution` while waiting, `--escrow` when secured/released/completed, `--danger` in a dispute, `--mod` after a moderator decision, `--ink-muted` for neutral endings (cancelled, refunded).
- **Where it appears (only here):**
  1. Top-right of every **hero status block** on trade and trade-result screens (BuyerPay, SellerConfirm, BuyerPaidWaiting, TradeFund, Released, Refunded, Dispute*, Fold-Trade, Fold-Cover).
  2. The leading **icon tile of an active-trade row** in lists (Main, MyOffers trades, Fold-Cover), small size.
  3. The **empty state for "no trades yet"** at hero size, `--ink-muted`.
- Never orange. Never animated. Never a button. Always `aria-hidden`: the chip next to it says the state in words.

## 2. Spacing and radius

- Spacing scale: **4 / 8 / 12 / 16 / 20 / 24 / 32**. Phone gutter 16. Gap between cards on a phone is 16; on wide it's 24. Gap inside a card is 16 (12 for tight lists). Card padding is 20 (hero on wide: 28).
- Radius: **16** for primary cards, the hero, upload rows and sheet tops. **12** for inner blocks, buttons, callouts, icon tiles and tooltips. **6** for inputs, small buttons and nav items. **Pill** for chips and the stepper bars.

## 3. Elevation

**No drop shadows anywhere.** Elevation comes from surface steps:
`--ground` (page) → `--surface` (cards, sheets) → `--surface-raised` (inner blocks, inputs, tooltips).
Overlays (tooltips and sheets) separate with a 1px `--line` border (tooltips) or a 1px `--surface-raised` top border (sheets), over `--scrim`.
The only `box-shadow` allowed is the nav-current inset line: `box-shadow: inset 2px 0 0 var(--ink)`.

## 4. Type additions

| Role | Spec | Where |
|---|---|---|
| Screen title (key screens) | Familjen 28/32 700, -0.01em | Under the header context line on trade, setup and result screens |
| Result headline | Familjen 32/36 700, -0.02em (phone); 40/44 on wide (counts as the one display) | Hero of a result screen |
| Sheet title | Familjen 24/30 700, -0.01em | Bottom sheets and dialogs |
| Section heading | 18/24 600 Atkinson, optional lead 13/18 or 14/20 `--ink-muted` below | Card headings |
| Hero number | Mono 40/44 500, -0.02em | The one big amount or timer per screen |
| Amount (secondary) | Mono 28/32 500 (wide 32/36) | Amounts inside the hero |
| Meta | 13/16 `--ink-muted` | Context line, row meta |

Mono is for digits only: amounts, IDs, times, dates, counts ("3 of 10"). Units and words stay in body text.

## 5. Screen header (phone)

```
[44 back]                         [Chat pill, optional]   ← 44px row, padding 8 16 0, row margin 0 -10px
Trade <mono>K7M2-…</mono> · Zelle · Example                 ← 13/16 muted, margin-top 8
Buying from satoshi_ghost                                    ← screen title 28/32 Familjen 700, margin-top 4
```
- Back/close: 44×44 `<a>`/`<button>` with `aria-label`, 24px icon, stroke 1.75, round caps.
- A secondary header action is a **pill**: height 44, padding 0 14, `--surface` bg, 15/600, 18px icon + word.
- No bottom border under the header (the cards give the structure).
- **Compact header** (result and secondary screens, where the hero has the big words): back 44 + two lines (15/20 600 title, 13/16 muted context). See Refunded.
- Wide: no header bar. Back 44 + the two-line context sits at the top of the content column, margin-left -12.

## 6. Hero status block

This is the top card on key moments: trade steps, results and holds. One per screen.
```
style: display:flex; flex-direction:column; gap:16px (result: 20); padding:20px (result: 24px 20px 20px; wide 28px);
       border-radius:16px;
       background: linear-gradient(180deg, color-mix(in srgb, TONE 14%, var(--surface)) 0%, var(--surface) 140px);
       border: 1px solid color-mix(in srgb, TONE 35%, transparent);
```
Content, in order:
1. A row with the status chip on the left and the key mark (TONE) on the right.
2. The meaning: a big number (hero number + unit), or a result headline + lead paragraph.
3. Supporting detail: a progress bar, a timer, or an inner `--surface-raised` amount block, radius 12.

Inner dividers are `1px color-mix(TONE 25%, transparent)`. TONE is one of the state tokens in §1.

## 7. Status chips

Height 28, padding 0 10, radius pill, gap 6, 16px icon, label 13/16 600 uppercase .04em.
`background: color-mix(in srgb, TONE 14%, transparent); color: TONE;`

| Chip | TONE | Text colour |
|---|---|---|
| escrow (secured, released, completed) | `--escrow` | `--escrow` |
| caution (securing, waiting, timer running) | `--caution` | `--caution` |
| danger (dispute, scam, blocked) | `--danger` | `--danger` |
| neutral (cancelled, refunded, off) | `--ink-muted` (16%) | `--ink` |
| team | `--team` | `--team` |
| mod | `--mod` (16%) | `--mod` |

Never an orange chip. Badges on profiles keep their outline style (CONVENTIONS) and are not status chips.

## 8. Cards

- **Primary card:** `--surface`, radius 16, padding 20, gap 16, no border.
- **Inner block** (detail rows, amount block): `--surface-raised`, radius 12. Rows are min-height 48, padding 0 14, label 14/20 muted on the left, value mono 15 500 on the right, divider `1px var(--surface)` inset 14.
- **Outline card** (optional action or "did you…?"): transparent, `1px solid var(--line)`, radius 16, padding 20.
- **Tinted card** (moderator, team): `color-mix(TONE 8–10%, var(--surface))` with a `color-mix(TONE 40–45%, transparent)` border. The team card keeps CONVENTIONS' 10% / 45%.

## 9. List row and icon tile

- **Row:** min-height 64, padding 12 16 (or 16 inside an upload or dashed box), gap 14, align center. Order: icon tile 40, then title (16/22 600) over meta (13/18 muted), then the trailing action (chevron 20, a 44 text button, or a toggle).
- **Icon tile:** 40×40, radius 12, 20px icon at stroke 1.75. Neutral: `--surface-raised` bg with `--ink` icon. Toned: `color-mix(TONE 14–16%, transparent)` bg with a TONE icon.
- **Upload row:** the row inside `1.5px dashed var(--line)`, radius 16.

## 10. Buttons

| Kind | Spec |
|---|---|
| Primary (one per screen) | Phone: 56h, radius 12, `--monero` bg, `--on-monero` text, 18/600, full width, **pinned in the footer**. Wide: 48h, min-width 160, padding 0 24, 16/600. |
| Secondary | 48h, radius 12, `1px solid var(--line)`, transparent bg, `--ink`, 16/600. Full width in sheets and cards on phone, auto width on wide. |
| Tertiary | 44h, no bg, `--ink-muted`, 15/600, padding 0 8. |
| Danger tertiary | Same as tertiary in `--danger`, with an optional 16px chevron. |
| Danger confirm (destructive, in a sheet) | 56h, radius 12, `color-mix(--danger 14%, transparent)` bg, `1px solid var(--danger)`, `--danger` text, 18/600. Orange is not used for destructive actions. |
| Disabled | `--surface-raised` bg, `--ink-muted` text, `cursor: not-allowed`, `disabled` attribute. |

**Phone footer:** `padding: 16px 16px 8px; gap: 4px; border-top: 1px solid var(--surface-raised); background: var(--ground)`. Primary goes first. A tertiary pair goes under it in a space-between row (for example "Ask to cancel" and "Open dispute").

## 11. Form field

- Label 13/16 600 uppercase .04em `--ink-muted`, 8px above the field.
- Input: 48h (textarea min 96), radius 6, `--surface-raised` bg, `1px solid var(--line)`, padding 0 14, 16/24 `--ink`, placeholder `--ink-muted`.
- Focus: 2px `--ink` outline, 2px offset. Error: border `--danger`, plus a 13/18 `--danger` message with a 16px icon under the field. Helper text: 13/18 muted.
- A checkbox confirm row (sheets): `--surface-raised`, radius 12, padding 14, gets a 2px `--ink` border when ticked (selection is never orange). Accent `--ink`, 22px box.

## 12. Callouts (inline info / caution / danger / escrow)

```
display:flex; gap:10px; align-items:flex-start; padding:12px 14px; border-radius:12px;
background: color-mix(in srgb, TONE 10%, var(--surface));
border: 1px solid color-mix(in srgb, TONE 30%, transparent);
icon 18px TONE (info circle / triangle / octagon / shield), text 14/20 var(--ink)
```
For info callouts, TONE is `--ink-muted` and the background is `--surface-raised`. Put a title (15/20 600) above the text only when the callout has more than one sentence.

## 13. Trade stepper

Four steps across the top of every live-trade screen, under the screen title. `<ol aria-label="Trade progress">`, grid of 4 columns, gap 6, padding 0 16 16.
- Each step has a 4px pill track in `--surface-raised`, with a 12/16 label 6px below it.
- **Done steps:** full track in `--escrow`, label muted.
- **Current step:** track filled to the step's progress in its TONE, label `--ink` 600, `aria-current="step"`.
- **Upcoming steps:** empty track, label muted.
- Buyer labels: Escrow · You pay · Seller checks · Released. Seller labels: Escrow · Buyer pays · You check · Released. These labels are COPY-UNSIGNED.
- Segmented progress inside the hero (confirmations): N pills in a grid, gap 3, height 8. Done pills are TONE; the rest are `color-mix(TONE 18%, var(--surface-raised))`. Keep `role="progressbar"` with aria values.

## 14. Timer

- Digits in hero-number mono (40/44), unit in body 18/24 600 `--ink-muted`: `<mono>90</mono> min`, `<mono>1</mono> h <mono>52</mono> min`.
- Label above: 13/16 uppercase TONE. The meaning line below: 14/20 muted, with any digits in mono `--ink`.
- Ring: 64px, r 27, stroke 5. Track is TONE at 20% opacity. Progress arc is TONE with round caps. "Not started" is a dotted arc (`dasharray 2 6.48`) with a clock-hands glyph in the middle. The ring is `role="img"` with an aria-label that states the time in words.

## 15. Amounts

- XMR: always 6 decimals. Digits in mono, unit "XMR" in body 600 `--monero-ink` (tokens.json: monero-ink is for the XMR unit label). Fiat sits beside it in mono 16 `--ink-muted`, and wraps below if it doesn't fit.
- A fiat-first amount (what to send): `$412.50` in hero mono 40/44, unit "USD" in body 16/600 muted.
- In running text, the amount digits are mono and the unit stays in body text.

## 16. Empty state

Centered column, padding 48 24, gap 12. Use the key mark at hero size (`--ink-muted`) for trade empties, or a 56px icon tile (radius 16) for anything else. Title Familjen 24/30 700. Then one 16/24 muted sentence, then one secondary button (or the primary, if it's the screen's only action).

## 17. Timeline ("What happened")

`<ol>` rows, gap 12. Left is a 12px column: a 12px dot (2px `--line` ring, or a filled TONE dot for the final event) above a 2px `--surface-raised` connector (margin 4 0, flex-grow). Right is the event text (15/20, 600 on the last event) with the time in mono 14 muted, space-between, padding-bottom 16 (20 on wide). The card head carries the date in mono 13 muted.

## 18. Wide layout

- Nav rail 240: wordmark Familjen 24/30 700, items 44h with a 20px icon and gap 12. The current item is `--surface-raised` bg + `inset 2px 0 0 var(--ink)` + ink 600 text.
- Content padding 32 48 48. Key and result screens use a **2-column grid of 560 + 360, gap 24**: hero, actions and decision cards on the left; the timeline or summary on the right. Forms stay in a single 720 column.
- Actions sit inline under the left column: primary 48 + tertiary.

## 19. Motion

Colour, background and border transitions run 150ms ease-out. Sheets and tooltips enter over 200ms (translate 8px plus opacity). Nothing loops, and the key mark never moves. Always include:
```css
button,a,label{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}
@media (prefers-reduced-motion: reduce){*{transition:none !important;animation:none !important}}
```

## Do

- Do give each key screen one big thing: a hero number or a result headline. Everything else should step down.
- Do express a state three ways: chip word, tone wash and key mark colour.
- Do group details in `--surface-raised` inner blocks rather than loose lines of text.
- Do put warnings in a callout with an icon, not in a muted paragraph.
- Do keep copy, tweaks, states, OPEN boxes and tooltips exactly as they were when you restyle a board.

## Don't

- Don't add drop shadows, gradients outside the hero wash, or glow.
- Don't use orange for anything except the one primary fill, links, and the XMR unit label.
- Don't put two hero numbers on one screen, or a display headline and a screen title together.
- Don't use the key mark as decoration, or in brand orange.
- Don't let a tint stand in for words: every tone still sits next to a word.
- Don't set mono on words, or body text on digits that matter.

## Checklist: bringing a board to v2

1. Copy the transition/reduced-motion CSS into `<helmet>`. Make sure THEMES has `--mod` (and `--team` if members show).
2. Header: use the key-screen pattern (§5) or the compact pattern. Remove the header bottom border.
3. Pick the screen's state TONE. Build the hero block (§6): chip (§7) + key mark (§1, trade screens only) + one hero number or headline.
4. Live trade screen? Add the stepper (§13).
5. Cards: radius 16, padding 20, no borders on primary cards. Detail rows go into an inner block (§8).
6. Lists: rows with 40 icon tiles, 64 min height (§9).
7. Warnings become callouts (§12). Amounts follow §15. Timers follow §14. Dates and times are mono.
8. Buttons follow §10. Phone footer: pinned, 16/16/8 padding, border-top, ground bg.
9. Wide: nav-current inset line, and the 560+360 grid for key or result screens (§18).
10. Grow the root height to fit the content (minimum 844 phone, 800 wide), and update `$preview` to match.
11. Render night and day with `tools/render-board.js` (and each variant and sheet) and look at them.
12. Checks: data-props JSON parses, tags balanced, dc-script passes `node --check`, holes are plain dotted lookups, no hex outside THEMES, no HTML comments inside `<x-dc>`.
13. List any new words (for example stepper labels) as COPY-UNSIGNED in your report.
