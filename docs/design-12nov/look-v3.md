# X2F Look v3: small refinements (12 Nov 2026)

**Status: PROPOSED. Everything here waits for the owner's OK.** Nothing has been changed on the
canvas boards or in the app. New words are COPY-UNSIGNED.

Showcase (Today vs Refined, night and day, live motion):
`/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/look-v3/x2f-look-v3.html`

## 0. Scope and rules

- **This is not a redesign.** The owner liked the Exodus recording for its type, colour, light and
  smoothness. v3 borrows those qualities as small refinements that drop into today's system.
  Every screen keeps its layout, content order and flows. X2F stays more detailed than a wallet.
- **Not copied:** there is no violet, no emblem or hexagon coin shapes, and none of their icons.
  Tokens are rounded squares in X2F hues, built from tokens.
- **Kept:** orange (`--monero`) is still the one action colour (one primary per screen), and teal
  (`--escrow`) still means escrow and safe. Selection is still an ink border, never orange. The
  2-of-3 key mark keeps its placement rules. Mono is kept for codes, addresses and exact XMR.
  WCAG AA, 44px targets and reduced-motion fallbacks all stay.
- **v3 overrides two v2 rules** (design-visual-system-v2 §3 "No drop shadows" and Don't
  "no gradients outside the hero wash, or glow"), within the limits set in §3 below. Nothing else
  in v2 or the conventions changes.

### What the reference showed (from frames at 0–57 s)

- The ground is a cool blue-violet gradient (sampled about `#2d3549` at the top and `#1e1c32` at
  the bottom), lit from the top centre. It is never flat.
- Each row is its own tile: radius about 18, a gap of about 6 dp between tiles, and no dividers.
  Tiles are about 8% lighter than the ground, have a 1px lighter top edge, and a soft shadow.
- Icons are glossy tokens with a top-left light, a darker bottom edge and a coloured soft shadow.
- The hero is a big glossy emblem with a halo, over a two-tone title. Buttons are pills: a filled
  primary with a gradient and glow, and a glass secondary.
- The promo card bleeds a colour wash from its icon. The rewards card has an iridescent border.
- The dock is a floating blurred pill. It slides away while the list scrolls and comes back with a
  slight overshoot (frames at 11.0–12.6 s).
- Sheets have a grab handle, a radius of about 28 and a dark scrim over a dimmed page. Settings
  rows in the sheet are plain rows, not tiles. The help sheet is a centred two-line headline over
  three tiles, with a muted line of legal links at the foot.
- The type is a clean neo-grotesk: titles about 34pt bold with tight tracking, list names at 600,
  and muted secondary text.

## 1. Refinements, ordered by impact for effort

Ship them in this order. Each one stands on its own. Effort: XS is under an hour, S is half a day,
M is one to two days, all including the night and day check.

| # | Refinement | Impact | Effort | Ship wave |
|---|---|---|---|---|
| 1 | Lit gradient ground | High | XS | Wave 1 |
| 2 | Tile rows with gaps (lists) and grouped tiles (settings) | High | S | Wave 1 |
| 3 | Light shadowing: top highlight + 3 elevation levels | High | S | Wave 1 |
| 4 | Pill buttons, glowing primary, glass secondary | High | S | Wave 1 |
| 5 | Halo on the one hero block | Medium | XS | Wave 1 |
| 6 | Footer link line (Privacy Policy, Terms of Service, FAQ) | Medium | XS | Wave 1 |
| 7 | Trim wordiness behind an "i" button (two places) | Medium | S | Wave 1 |
| 8 | Inter on titles, names, buttons and big prices | High | M | Wave 2 |
| 9 | Glossy tokens for payment methods | High | M | Wave 2 |
| 10 | Glossy badges and avatars | Medium | S | Wave 2 (after 9) |
| 11 | Header fade on scroll | Medium | S | Wave 2 |
| 12 | Springy sheets | Medium | S | Wave 2 |
| 13 | Friendlier Help sheet | Medium | M | Wave 3 |
| 14 | Floating dock | Medium | M | Wave 3 |
| 15 | Search: instant suggestions + empty state (optional) | Medium | M | Optional |
| 16 | Dismissible tip card with a colour wash (optional) | Low | S | Optional |

Wave 1 is CSS only: tokens plus `base.css` and `ui.css`. Wave 2 adds a font file, an icon
component and two small scripts. Wave 3 adds new markup.

## 2. Tokens (PROPOSED additions)

The existing THEMES colours are unchanged. These are the additions, for `design/design-system/tokens.json`
(then `npm run tokens`). Names are shown without the `--x2f-` prefix.

### 2.1 Ground light

| Token | Night | Day |
|---|---|---|
| `bg-hi` | `#1a2332` | `#ffffff` |
| `bg-mid` | `#0f1319` | `#f3f5f8` |
| `bg-lo` | `#090b0f` | `#e8ecf1` |

```css
--x2f-app-bg:
  radial-gradient(130% 46% at 50% -4%, color-mix(in srgb, var(--x2f-escrow) 12%, var(--x2f-bg-hi)) 0%, transparent 72%),
  linear-gradient(180deg, var(--x2f-bg-hi) 0%, var(--x2f-bg-mid) 34%, var(--x2f-bg-lo) 100%);
```
- Use it on the app shell (`body` / `.x2f-flow`), with `background-attachment: fixed`, so tiles
  scroll over the light. `--x2f-ground` stays as the solid fallback and the colour for the theme meta tag.

### 2.2 Tile surface and edge light

| Token | Night | Day | Use |
|---|---|---|---|
| `tile` | `rgba(32,38,47,0.62)` | `rgba(255,255,255,0.86)` | Tiles, cards, grouped settings |
| `tile-solid` | `#1b2028` | `#ffffff` | Rings around online dots; no-blur fallback |
| `tile-press` | `rgba(44,51,62,0.80)` | `rgba(236,238,242,0.95)` | Pressed tile |
| `hl` | `rgba(255,255,255,0.075)` | `#ffffff` | The 1px lighter top edge on level 1 |
| `hl-strong` | `rgba(255,255,255,0.12)` | `#ffffff` | Top edge on levels 2 and 3 |
| `edge` | `rgba(255,255,255,0.05)` | `rgba(18,22,28,0.07)` | 1px hairline border on tiles |
| `glass` | `rgba(38,45,56,0.55)` | `rgba(255,255,255,0.66)` | Glass pills, round buttons, search |
| `glass-strong` | `rgba(30,36,45,0.78)` | `rgba(255,255,255,0.84)` | Dock |

- The inner highlight is always `inset 0 1px 0 var(--x2f-hl)`: a lighter top edge, not a border.
- Glass uses `backdrop-filter: blur(18px) saturate(150%)` (the dock uses 22px / 160%).
- Without `backdrop-filter`, fall back to `tile-solid` (`@supports not (backdrop-filter: blur(1px))`).

### 2.3 Elevation: three levels (shadow + highlight)

| Level | Used for | Night | Day |
|---|---|---|---|
| **e1** | Tiles, rows, chips, glass pills, inner stat blocks | `inset 0 1px 0 rgba(255,255,255,.075), 0 1px 2px rgba(0,0,0,.28), 0 6px 16px -8px rgba(0,0,0,.50)` | `inset 0 1px 0 #fff, 0 1px 2px rgba(18,28,45,.06), 0 6px 16px -8px rgba(18,28,45,.16)` |
| **e2** | The hero block, offer cards, the send/QR card, the primary card per screen | `inset 0 1px 0 rgba(255,255,255,.12), 0 2px 6px rgba(0,0,0,.26), 0 18px 36px -14px rgba(0,0,0,.66)` | `inset 0 1px 0 #fff, 0 2px 6px rgba(18,28,45,.06), 0 18px 36px -16px rgba(18,28,45,.24)` |
| **e3** | Sheets (casts upward) | `inset 0 1px 0 rgba(255,255,255,.12), 0 -1px 0 rgba(255,255,255,.04), 0 -18px 48px -10px rgba(0,0,0,.70)` | `inset 0 1px 0 #fff, 0 -1px 0 rgba(18,22,28,.05), 0 -16px 44px -12px rgba(18,28,45,.22)` |
| **e3-dock** | The floating dock | `inset 0 1px 0 rgba(255,255,255,.12), 0 10px 30px -6px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.30)` | `inset 0 1px 0 #fff, 0 10px 30px -8px rgba(18,28,45,.26), 0 2px 6px rgba(18,28,45,.08)` |

Rules:
- Every card and tile gets e1 at least. Do not stack levels, and do not nest an e2 inside an e2.
- Inner blocks inside a card (stats, detail rows) take only the highlight (`inset 0 1px 0 var(--x2f-hl)`)
  on `color-mix(in srgb, var(--x2f-surface-raised) 72%, transparent)`. They get no drop shadow.

### 2.4 Glow and halo

| Token | Night | Day | Where (only) |
|---|---|---|---|
| `glow-primary` | `0 12px 28px -10px color-mix(in srgb, var(--x2f-monero) 62%, transparent), 0 2px 6px -1px color-mix(in srgb, var(--x2f-monero) 35%, transparent)` | the same with 40% / 35% | The one orange primary button |
| `halo-a` | `16%` | `12%` | The hero block: `radial-gradient(90% 70% at 50% -10%, color-mix(TONE halo-a, transparent), transparent 70%)` over `tile`, plus `0 20px 50px -24px color-mix(TONE 40%, transparent)` |
| emblem halo | `radial-gradient(closest-side, color-mix(--x2f-escrow 34%, transparent), transparent)`, inset -34px | same | Help sheet emblem; intro logo stage |
| QR glow | `0 18px 40px -16px color-mix(--x2f-escrow 45%, rgba(0,0,0,.5)), 0 0 60px -10px color-mix(--x2f-escrow 22%, transparent)` | same | The escrow QR tile |
| active glow | `0 0 10px var(TONE)` | same | The current stepper track; the dock's current-tab bar (ink) |

- TONE is the hero's state tone (`--x2f-caution`, `--x2f-escrow`, `--x2f-danger`, `--x2f-moderator`, or `--x2f-escrow` for neutral heroes such as the market price).
- Glow is never used on chips, text, borders or on more than one element per screen, apart from the active-track and dock indicators.

### 2.5 Radii

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6 (unchanged) | Checkboxes (7), small tags |
| `radius-md` | 12 (unchanged) | Plain icon tiles, inner fields |
| `radius-inner` | **14** (new) | Inner stat blocks; token = 0.34 × size (40 → 14) |
| `radius-lg` | 16 (unchanged) | Inner detail blocks inside cards |
| `radius-tile` | **20** (new) | List tiles, settings groups, Help tiles |
| `radius-card` | **24** (new) | Hero, offer cards, the send/QR card |
| `radius-sheet` | **30** (new) | Sheet top corners |
| `radius-pill` | 999 (unchanged) | All buttons, chips, segmented control, search, dock |

### 2.6 Spacing

The scale is unchanged (4 / 8 / 12 / 16 / 20 / 24 / 32). New uses:
- The gap between list tiles is **8** (6 in the Help sheet and search suggestions). The gap between cards is 12–16.
- Tile padding is 12 by 14. The minimum row height is **68** for list tiles and 64 for rows in a settings group.
- The hero and card padding stays 20 (offer cards 16).
- The dock sits 14 above the safe area. Scroll areas under the dock get `padding-bottom: 120px`.

### 2.7 Token hues (glossy icons)

Payment-method categories. These are not status colours and never stand alone: the method name is always beside them.

| Token | Night | Day | Glyph colour (contrast) |
|---|---|---|---|
| `tok-bank` | `#4a7fe0` | `#3567c8` | white (3.9 night / 5.4 day) |
| `tok-app` (mobile app / wallet) | `#1f9673` | `#1b8566` | white (3.7 / 4.6) |
| `tok-cash` | `#d99a2b` | `#c98a1c` | `#1a0e05` (7.8 / 6.4) |
| `tok-card` | `#7d8799` | `#6b7484` | white (3.6 / 4.7) |
| `tok-gift` | `#c0569b` | `#a8407f` | white (4.2 / 5.7) |
| `tok-graphite` (neutral, avatars) | `#4a5361` | `#5a6372` | white (7.8 / 6.4) |

Badge tokens use the status tokens they already have: Trusted is `--x2f-escrow` (shield),
Fast is `--x2f-caution` (bolt), PGP verified is graphite (key), New is `--x2f-team` (spark), and
Vendor stays a plain tag. On the bright tones (escrow, caution, team) the night glyph is `#1a0e05`
and the day glyph is white.

### 2.8 Contrast checks (computed)

All of these pass AA:
- `ink-muted` on a night tile composited over the ground (`#1a1f27`): 6.6:1. `ink` on it: 14.6:1.
- Day `ink-muted` on a tile: 6.2:1.
- `on-monero` on the primary: 6.5:1, and 7.8:1 under the top sheen.
- `escrow` text on a night tile: 8.0:1. Day: 5.5:1.
- Legal links (`ink-muted` on the sheet): 6.9:1.
- Token glyphs (graphic objects): all at least 3.6:1.

## 3. Type (PROPOSED default in Refined; "Today's fonts" stays one toggle away)

**Recommended font: Inter** (variable, `opsz` 14–32, `wght` 400–800, SIL OFL 1.1). Self-host it,
like the other faces. It is the closest open-licence match to the reference's clean neo-grotesk.
Its optical sizes tighten the display cuts at 28px and up. It has tabular figures, and its
disambiguation alternates (`cv05` l with tail, `cv08` I with serifs) keep I, l and 1 apart.

- Take the files from the upstream `rsms/inter` release (InterVariable.woff2 and InterVariable-Italic.woff2, v4.x).
  Do not use the Google or Fontsource builds: they strip `cv05` and `cv08` (checked 12 Nov; the showcase loads
  the Google copy, so there I and l look the same).
- Turn the alternates on wherever Inter is used: `font-feature-settings: 'cv05' 1, 'cv08' 1, 'tnum' 1` for numbers, without `tnum` for words.
- Option (a), keeping Familjen and Atkinson and only tuning them, is shown on the page. It is not recommended:
  Familjen's quirks and the wide mono prices read heavier than the reference.

### Which element uses which font

| Element | Font | Size / line / weight / tracking |
|---|---|---|
| Screen title (phone) | Inter | 28 / 34 / 700 / -0.022em |
| Result headline, sheet headline, hero name | Inter | 28–30 / 33–36 / 720 / -0.022em (wide: 40 / 44) |
| Sheet title | Inter | 24 / 30 / 700 / -0.018em |
| Section heading ("Active trades", card titles) | Inter | 18 / 24 / 650 / -0.008em |
| List-row primary text (methods, settings rows, Help tiles, "My trades") | Inter | 16 / 22 / 600 / -0.008em |
| **Usernames** (satoshi_ghost, mira.k) | Atkinson Hyperlegible Next 600 **until** Inter ships with `cv05`/`cv08` on, then Inter | 16 / 22 / 600 |
| Primary button | Inter | 17 / 22 / 650 / -0.008em |
| Secondary button, glass pills (Chat, Copy, Nudge, Site news) | Inter | 16 / 22 / 600 (pills 15 / 600, small 14 / 600) |
| Big prices and rates ($329.90, $330.00), timer digits, stat numbers | Inter, `tnum` | hero 44–46 / 48–50 / 650 / -0.02em; card price 30 / 36 / 650; inline 16–19 / 650 |
| Segmented control, dock labels | Inter / Atkinson | segmented 15 / 600 Inter; dock 11.5 / 14 / 600 Atkinson |
| Body, help paragraphs, callouts, row meta | Atkinson Hyperlegible Next | 16 / 24; card text 15 / 22; meta 13 / 18 |
| Caps labels (MARKET PRICE, TIME TO FUND) | Atkinson Hyperlegible Next | 13 / 16 / 600 / +0.04em uppercase |
| Addresses, trade codes, exact XMR (6 dp), dates, times, counts in meta, percent markups | Atkinson Hyperlegible Mono | unchanged (address 14.5 / 22 with 6px word spacing) |
| XMR unit label | Atkinson Next 600, `--x2f-monero-ink` | unchanged |

Rule of thumb: Inter is for what you scan (titles, names, prices, buttons). Atkinson is for what
you read. Mono is for what you copy or check digit by digit.

## 4. Components

### 4.1 Tile list (refinement 2)
- `.x2f-items` becomes `display:flex; flex-direction:column; gap:8px`. Each `.x2f-item` gets
  `background: tile; border: 1px solid edge; border-radius: 20px; box-shadow: e1; padding: 12px 14px; min-height: 68px`.
- Remove `.x2f-item + .x2f-item { border-top }` for tile lists.
- **Grouped variant** (`.x2f-panel` with settings rows): the group is one tile (radius 20, e1).
  Rows inside keep a hairline, `inset 0 1px 0 color-mix(in srgb, var(--x2f-line) 22%, transparent)`.
  This keeps Settings' layout and order.
- Press: `:active` → `transform: scale(.97); background: tile-press`; release with the press spring (§5).

### 4.2 Pill buttons (refinement 4)
- **Primary:** height 54 (phone footer 56), `radius-pill`, background
  `linear-gradient(180deg, rgba(255,255,255,.20) 0%, rgba(255,255,255,0) 52%), var(--x2f-monero)`, and
  `box-shadow: inset 0 1px 0 rgba(255,255,255,.38), inset 0 -1px 0 rgba(0,0,0,.12), glow-primary`.
  Press: `scale(.98)`. Hover: `filter: brightness(1.04)`. There is still only one per screen, and none on
  TradeFund (owner, 12 Nov: "Open in your wallet app" stays secondary).
- **Secondary (glass):** height 50, pill, `glass` background, `1px solid color-mix(line 55%, transparent)`, e1, ink text.
- **Glass pill** (Chat, Copy, Nudge, currency, Site news): height 44 (small 36), padding 0 16 (0 12), e1.
- **Round glass button** (back, close, dropdown): 44×44 circle, glass, e1.
- **Tertiary** and **danger** buttons keep their v2 specs. Danger confirm becomes a pill with no glow.
- Chips, the segmented control and search are pills. The selected state stays a 2px ink border on `surface-raised`.
- Toggles: on is an ink track with a ground knob, off is a 45% `line` track with an ink knob. The knob moves over 300 ms ease-out. Never orange.

### 4.3 Hero block (refinement 5)
- v2 §6 is unchanged in structure. It gets radius 24, the e2 shadow, the halo gradient (§2.4) and a border
  of `color-mix(TONE 30%, transparent)`.
- The key mark beads in the hero get a radial gloss and `0 0 10px -1px color-mix(TONE 60%, transparent)`.
  They still never move, and the small key mark in list rows stays flat.
- The timer ring gets `filter: drop-shadow(0 0 10px color-mix(TONE 45%, transparent))`.

### 4.4 Glossy token icons (refinements 9 and 10)
New component `<TokenIcon category|tone size glyph|monogram>`, built from tokens with no images:
```css
.x2f-token {
  --c: var(--x2f-tok-graphite); --sz: 40px;
  width: var(--sz); height: var(--sz); border-radius: calc(var(--sz) * .34);
  display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;
  color: var(--glyph); font: 750 calc(var(--sz) * .42)/1 Inter;
  background:
    radial-gradient(120% 90% at 28% 12%, color-mix(in srgb, var(--c), white 34%) 0%, transparent 58%),
    linear-gradient(160deg, color-mix(in srgb, var(--c), white 10%) 0%, var(--c) 45%, color-mix(in srgb, var(--c), black 28%) 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.42), inset 0 -2px 3px rgba(0,0,0,.20),
              0 6px 14px -6px color-mix(in srgb, var(--c) 80%, transparent), 0 1px 2px rgba(0,0,0,.22);
}
.x2f-token::before { /* sheen */ content:""; position:absolute; left:10%; right:10%; top:4%; height:42%;
  border-radius: 50% 50% 45% 45% / 70% 70% 30% 30%; background: linear-gradient(180deg, rgba(255,255,255,.32), transparent); }
```
- Sizes: 40 in list rows, 34 in search suggestions, 44 for avatars and Help tiles, 24 inside badges
  (round), 76 for the Help emblem, and 80 for the tip card (half-bleed).
- The contents are a 2px-stroke glyph of our own (bank, cash, ATM, card, gift, dots, shield, bolt,
  key, spark, book, staff, heart, lifebuoy) or a one-letter monogram for a named app method. **No brand logos.**
- Method → category mapping is a data field on the method list (`bank | app | cash | card | gift`).
  A generic bank method gets the bank glyph, a named app gets its monogram, and cash or ATM gets the cash or ATM glyph.
- Avatars become round graphite tokens with initials, with the online dot (12px `--x2f-escrow`, 2.5px `tile-solid` ring).
- Badges keep their words. Each becomes a 32px glass pill with a 24px round token in its tone (§2.7).
- Tokens are always `aria-hidden`: the name next to them says it.

### 4.5 Floating dock (refinement 14)
- `.x2f-bottom-nav` becomes `position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); width: min(350px, 100% - 32px); translate: -50% 0`.
  It is 66 tall with 5px padding and a 4-column grid with a 2px gap, radius pill, `glass-strong` with a 22px blur, and e3-dock.
- The same four tabs (Trade, Post offer, Wallets, Profile) keep 22px icons and 11.5px labels. Each tab is at least 56×56.
- Current tab: a `surface-raised` 85% pill behind it, ink 600 text, the highlight, and an 18×3 ink bar at the bottom with
  `0 0 10px 1px color-mix(ink 55%, transparent)`. This replaces the inset top line; it is still ink, never orange.
- A 130px fade under it (`transparent → bg-lo 92%`) keeps list text from colliding with the dock.
- Hide and show: §5. Keep `--x2f-tab-height` for the action-bar offset; screens with a footer action bar hide the dock, as today.

### 4.6 Sheets (refinements 12 and 13)
- `.x2f-sheet`: top corners 30, `box-shadow: e3`, no border-top, background
  `linear-gradient(180deg, color-mix(in srgb, var(--x2f-surface-raised) 92%, var(--x2f-bg-hi)) 0%, var(--x2f-surface) 220px)` at night,
  and `linear-gradient(180deg, var(--x2f-surface), var(--x2f-bg-mid))` by day.
- The grab handle (already in v2) is 40×5, pill, `color-mix(ink-muted 50%, transparent)`, with a 44px drag area.
- Backdrop: `var(--x2f-scrim)` with `backdrop-filter: blur(3px)`. This replaces the `ground` at 0.8 opacity.
- Close: a 44px round glass button at the top right.
- **Help sheet** (COPY-UNSIGNED): an escrow lifebuoy token at 76px with the emblem halo, then the headline "Answers fast," /
  "people who care" (Inter 28/33 720; the second line in `--x2f-escrow`). Under it, three tiles (44px tokens):
  - **Help articles** (team hue): "Short answers on trades, logins, wallets and privacy"
  - **Talk to X2F staff** (escrow): "A real person on the X2F team replies. Not a bot."
  - **Leave feedback** (caution): "Tell us what to fix or add"

  The sheet opens from Settings → About → "Help and FAQ" and from the intro's Support link. The footer link line sits under the tiles.

### 4.7 Footer link line (refinement 6)
`<nav aria-label="Legal">` with three links, "Privacy Policy | Terms of Service | FAQ" (COPY-UNSIGNED).
- Centred, 13/16, `ink-muted`; the hover state is ink and underlined.
- Each link is 44px tall with 0 10px padding.
- Separators are 1×12 bars of `color-mix(ink-muted 45%, transparent)`, `aria-hidden`.
- Placement: the Help sheet foot, the Settings foot (under Delete account), and the landing/intro foot. It wraps on narrow screens.

### 4.8 Header fade on scroll (refinement 11)
- The header row (`.x2f-trade-header`, `.x2f-flow__header`) becomes `position: sticky; top: 0`.
  After 6px of scroll it gets a glass background (`color-mix(bg-hi 70%, transparent)` + blur) and a 1px `edge` underline.
- The big screen title fades and lifts as you scroll; a compact title (Inter 16/650) fades into the bar.
  The values are in §5.
- The compact title is `aria-hidden`. The real `h1` stays in the document.

### 4.9 Trim wordiness (refinement 7, COPY-UNSIGNED)
Two places only. In each, the same words survive elsewhere:
- **Find a trade, market card:** "Offers set their price from this, plus or minus their margin." moves behind an "i" button
  (44px, `aria-label="How offers are priced"`) next to MARKET PRICE. The button opens a tooltip or small sheet with the same sentence.
- **TradeFund, hero:** "Once funded, neither of you can take the XMR alone. It's released when you both agree, or by a
  moderator if there's a dispute." moves behind an "i" (`aria-label="How escrow works"`). The "Escrow ready: 3 keys"
  card lower on the same screen still says it.
- **TradeFund, send card:** "Open Send in any Monero wallet and scan this code. It fills in the escrow address and the exact
  amount." becomes "Scan with any Monero wallet. It fills in the address and the exact amount."

### 4.10 Optional
- **Search (15):** suggestions under the pill field after one character. Up to 3 tile rows with a 34px token and the match
  underlined (bold, 2px underline, never a colour fill). When nothing matches, show an empty state with a graphite search
  token, `No "{query}" yet`, "Tell us and we'll look at adding it." and a glass "Suggest "{query}"" button that opens
  Leave feedback with the name filled in. COPY-UNSIGNED.
- **Tip card (16):** a tile with an 80px escrow token half-bleeding from the left edge, and a wash of
  `radial-gradient(120% 140% at 0% 50%, color-mix(escrow 34%, transparent), color-mix(escrow 10%, transparent) 42%, transparent 70%)`.
  It has one line of title and one of meta ("Your coins wait in escrow" / "Neither side can take them alone.") and a 44px × button.
  Once dismissed it stays dismissed for that account. COPY-UNSIGNED.

## 5. Motion

Springs are sampled into a CSS `linear()` easing with the intro's `spring(zeta, omega, seconds)` helper
(x2f-intro-prototype.html). Keep one helper module.

| Motion | Spec |
|---|---|
| Sheet in | `translateY(105%) → 0`, spring(0.78, 15, 0.56): about 560 ms with about 2% overshoot. The scrim fades in over 240 ms ease-out. Focus moves to the sheet after the first frame. |
| Sheet out | `0 → translateY(105%)`, 240 ms `cubic-bezier(0.4, 0, 1, 1)`, no spring. Swiping down on the handle more than 30% of the height (or faster than 0.5 px/ms) dismisses. |
| Tile press | Down: `scale(.97)` + `tile-press` over 140 ms `cubic-bezier(0.22, 1, 0.36, 1)`. Up: spring(0.5, 20, 0.5) back to 1. |
| Primary press | `scale(.98)` over 140 ms, with the same release spring. |
| Header fade | Tied to `scrollTop`, with no timers. The big title's opacity is `1 - k`, where `k = clamp(y / 64)`, plus `translateY(-8k px) scale(1 - .04k)`. The compact title's opacity is `clamp((y - 40) / 36)`, from `translateY(6px)`. The bar turns to glass at y > 6. |
| Dock | Hides when scrolling down by more than 4px after y > 80: `translateY(110px)` over 260 ms `cubic-bezier(0.4, 0, 1, 1)`. It comes back when scrolling up by more than 4px or at y < 40, with spring(0.68, 16, 0.5) over 520 ms. It stays shown while a sheet is open or the keyboard is up. |
| Toggle | The knob moves 20px over 300 ms `cubic-bezier(0.22, 1, 0.36, 1)`. |
| Colour states | Background, border and colour transitions run 150 ms ease-out (v2, unchanged). |
| Tip dismiss | Opacity 0 and `scale(.96)` over 220 ms ease-in; the list closes up over 280 ms. |
| Intro | Unchanged: letters with spring(0.62, 13.5, 0.6), 200 ms apart, the dot with spring(0.48, 15, 0.7), and the ring burst. |

**Reduced motion** (`prefers-reduced-motion: reduce`, plus the in-app setting):
- Nothing moves. Sheets, the dock and the titles crossfade in 150 ms.
- Presses change colour only, with no scale.
- The header swaps its titles at y = 40 with no lift.
- The intro shows the full logo with a 600 ms fade and no loop.
- Spring easings are never used in this mode.

## 6. Migration plan (app CSS)

Files: `design/design-system/tokens.json` → `tools/tokens-to-css.ts` → `apps/web/src/theme/tokens.css`,
plus `theme/base.css`, `theme/fonts.css` and `ui/ui.css` (1,749 lines; today only 7 `box-shadow`s).

**Step 0. Tokens** (all waves need this)
1. Add to `tokens.json`:
   - colour tokens `bg-hi`, `bg-mid`, `bg-lo`, `tile`, `tile-solid`, `tile-press`, `hl`, `hl-strong`, `edge`, `glass`,
     `glass-strong`, `tok-bank`, `tok-app`, `tok-cash`, `tok-card`, `tok-gift` and `tok-graphite`, each with night and day;
   - a new `elevation` group: `e1`, `e2`, `e3`, `e3-dock`, `glow-primary`, `halo-a`, each with night and day;
   - radius tokens `radius-inner` 14, `radius-tile` 20, `radius-card` 24 and `radius-sheet` 30.
2. Extend `tokens-to-css.ts`:
   - accept `rgba()` colour values and a `shadow` value shape;
   - emit `--x2f-app-bg`;
   - extend `test/tokens.test.ts` to cover the new groups.

**Wave 1** (CSS only, one PR, about 1.5 days with checks)
1. `base.css`: `body { background: var(--x2f-app-bg) fixed, var(--x2f-ground); }`.
2. `ui.css`:
   - `.x2f-panel`, `.x2f-number-card`, `.x2f-select-card`, `.x2f-info-block`: `background: var(--x2f-tile)`, a 1px `edge` border, `box-shadow: var(--x2f-e1)`, radius 20 (24 + e2 for the screen's hero or card).
   - `.x2f-items`: flex column with an 8px gap; `.x2f-item` becomes a tile (§4.1); drop the `+` border rule except inside the grouped variant (`.x2f-panel .x2f-item`).
   - `.x2f-button*`: `border-radius: var(--x2f-radius-pill)`; primary gets the sheen and `glow-primary`; secondary becomes glass.
   - `.x2f-chip`, `.x2f-icon-button`, the search input and the segmented control: pill and glass.
   - `.x2f-switch`: ink track (§4.2).
   - Hero block: add the halo and e2 (§4.3).
   - `.x2f-hold` already has a glow. Align it to `glow-primary` so it is not brighter than the primary.
3. Add a `<LegalLinks>` component (§4.7) to Settings, the Help sheet and the landing.
4. Copy trims (§4.9) with an `InfoButton` that reuses the existing tooltip and sheet.
5. Check:
   - render the boards and real screens in night and day, at 360 and 412 wide;
   - axe contrast pass;
   - 44px target audit;
   - `@supports not (backdrop-filter)` fallback in Firefox ESR;
   - low-end Android scroll: if blur costs frames, keep blur only on the dock and sheets and make tiles opaque `tile-solid`.

**Wave 2** (about 3 days)
1. Fonts: add InterVariable.woff2 from rsms/inter to `apps/web/public/fonts/` (OFL; add the licence file) and an `@font-face`
   in `fonts.css` with `font-display: swap`.
   - Add `--x2f-font-ui: "Inter", "Atkinson Hyperlegible Next", system-ui, sans-serif`.
   - Repoint `screen-title`, `sheet-title`, `display` and `heading` to `font-ui` with the new tracking (§3).
   - Add `--x2f-price-family: var(--x2f-font-ui)` for big prices and keep `amount-family` mono for exact XMR.
   - Add `.x2f-item__name`, `.x2f-method-name` and the button rules to `font-ui`.
   - Usernames stay on `font-sans` until a test confirms `cv05` and `cv08` render.
   - Preload one file (about 330 KB, or subset Latin to about 110 KB).
2. `TokenIcon` component (§4.4).
   - Add a `category` field to the payment-method list data. A missing category falls back to graphite with the bank or dots glyph.
   - Replace `.x2f-icon-tile` in method rows, avatars and badges.
3. Sticky header and fade (§4.8): a small `useScrollFade(ref)` hook writing two CSS variables (`--k-big`, `--k-mini`) on rAF.
4. Sheet motion (§4.6, §5): add the `spring()` helper, use the Web Animations API on `.x2f-sheet` open and close, add drag-to-dismiss on the handle,
   and swap the backdrop to scrim plus blur.

**Wave 3** (about 3 days)
1. The Help sheet (§4.6) replaces the Help and FAQ entry. Support still lists tickets. The "Talk to X2F staff" route opens a staff chat (not a bot).
2. The floating dock (§4.5):
   - `.x2f-bottom-nav` becomes the floating pill.
   - Screens lose the 60px bar reservation and gain `padding-bottom: 120px`.
   - Add the `useDockAutoHide` hook.
   - Hide the dock when an `.x2f-action-bar` is present.
3. Optional: search suggestions and the tip card (§4.10).

**Boards:** once approved, add v3 THEMES additions to every board's THEMES object (the canvas rule "no hex outside THEMES"
still holds), and update design-visual-system-v2.md §3 and Don'ts with a pointer to this file.

**Note for the lead:** the app's `--x2f-monero` is `#ff7a1a` (night) and `#f26822` (day), but the boards use `#ff6600`.
v3 does not change either. The showcase uses the board values.

## 7. Open questions for the owner

1. Do you OK the v3 overrides of "no shadows / no glow" (limited as in §2.3–2.4)?
2. Do you OK Inter as the default in the places listed in §3? Usernames stay on Atkinson until the disambiguation test passes.
3. Floating dock (Wave 3): yes, or keep the pinned tab bar with only the new light and blur?
4. Optional items 15 (search suggestions) and 16 (tip card): in or out?
5. Copy (COPY-UNSIGNED):
   - "Answers fast, people who care"
   - "Help articles" / "Short answers on trades, logins, wallets and privacy"
   - "Talk to X2F staff" / "A real person on the X2F team replies. Not a bot."
   - "Leave feedback" / "Tell us what to fix or add"
   - "Privacy Policy | Terms of Service | FAQ"
   - "Scan with any Monero wallet. It fills in the address and the exact amount."
   - `No "{query}" yet` / "Tell us and we'll look at adding it." / `Suggest "{query}"`
   - "Your coins wait in escrow" / "Neither side can take them alone."
