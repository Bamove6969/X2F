# iPhone Duo: audit and layout spec (12 Nov 2026)

Audited against `origin/main` at `8246e64b`. The screenshots come from the real app: a production build plus the fixtures build, driven by Playwright/Chromium at DPR 1. They are in `design-12nov/duo-shots/`, named `<width>x<height>-<screen>.png`. 390×844 is the phone reference. No app code was changed.

## 0. Device facts we design to

| State | CSS px (DPR 3) | Source |
|---|---|---|
| Folded, outer screen | **466×678** | Owner-confirmed: 5.4", 1398×2034, up to 120 Hz |
| Unfolded, inner, portrait | **626×890** | Owner-confirmed: 7.6", 1878×2670, ~430 ppi, ProMotion 120 Hz |
| Unfolded, inner, landscape | **890×626** | The same panel rotated |

- **Safari's own bars take some of that height.** On the outer screen Safari's tab bar sits at the bottom; on the inner screen it sits at the top (research note §0). Design for a usable height of about **600 px folded** and about **585 px in inner landscape**, not the full figures above.
- **Two older documents conflict with these sizes and are superseded:**
  - `design-research-foldables-2026-11-07.md` gives "Apple-published" sizes of 382 / 669 / 951 px.
  - G47 in `design-rulings-J34-2026-11-09.md` says "iPhone Duo is most likely the Surface Duo; Apple has no folding iPhone". That is wrong: the iPhone Duo is real and on sale.
  - The rules below give the same result at either set of sizes: 382 and 466 both get the phone layout, 626 and 669 both get one column, and 890 and 951 both get two panes.
- **Fold and hinge.** The inner screen is one continuous panel with a crease and **no gap** (research §1; only the Surface Duo has a real gap).
  - From the proportions, the crease runs down the middle of the 890 side. In landscape it is a vertical line at **x ≈ 445**. In portrait it is a horizontal line at **y ≈ 445**. Confirm this on a device.
  - Safari 27.1 keeps Viewport Segments and Device Posture behind a feature flag (research §3). **Today the app sees width only.** It must never depend on segments being reported.

## 1. How the app decides its layout today

- `apps/web/src/ui/fold.ts` writes `<html data-fold>` from media queries. Segments are checked first, then width:
  - `phone`: under 600 px;
  - `two` (two panes, split in the middle with a 16 px gutter): 600–999 px;
  - `wide`: 1000 px and up.
  - `cover` needs `device-posture: folded` and a screen under 600×480, so it never fires on the Duo.
- `App.tsx` uses the desktop shell with its left rail only when the layout is `wide`. Every other layout gets the phone shell with the bottom tab bar.
- `styles/fold.css` lays out the panes (`.x2f-panes`, `[data-pane=main|side]`).
  - The screens that have panes are the offers list with its quote (`OffersRoute`), My offers and the trade room (with chat).
  - Every other screen fills the full width, with no column limit.
- Other breakpoints: `trade.css` `max-width: 999px` (the room scrolls between its header and footer), `quote.css` `max-width: 1231px` (desktop only), `setup.css` 370/480 px. `.x2f-screen` (auth) is capped at 480 px.
- Safe area: `viewport-fit=cover` is set, but the CSS only uses `env(safe-area-inset-bottom)`, on the tab bar.

**What each Duo state gets today (measured in the browser):**

| State | `data-fold` | Shell | Result |
|---|---|---|---|
| 466×678 folded | `phone` | phone + tab bar | Good, except the trade room's "I've paid" sits below the fold (D2) |
| 626×890 portrait | `two` | phone + tab bar | **Broken.** The panes are 305 px wide, narrower than any phone, so offer cards overlap and get clipped (D1) |
| 890×626 landscape | `two` | phone + tab bar | Panes are fine at 437 px each. Single-column screens stretch to 858 px, and the main actions sit below a 626 px fold (D2, D3, D4) |

Folding and unfolding mid-trade (measured): going from 890×626 to 466×678 in the trade room switched `two` to `phone` with **no reload**. There was still one navigation entry, the same URL, and "I've paid" was still present. State is kept today.

## 2. The layout rule for each Duo state

The core change is **panes from 736 px, not 600 px**. 736 = two 360 px panes plus a 16 px gutter. No pane may ever be narrower than the narrowest phone we support.

| | Folded 466×678 | Inner portrait 626×890 | Inner landscape 890×626 |
|---|---|---|---|
| `data-fold` | `phone` | **`phone`** (today `two`) | `two` |
| Shell | phone | phone | phone (no rail: the rail stays at 1000 px and up) |
| Column | full width, 16 px gutters (content 434) | **one column, `max-width: 560px`, centred** (33 px gutters) | Pane screens: two panes, `437 / 16 / 437`; the gutter (437–453) sits on the crease at 445. Single-column screens: **`max-width: 600px`, centred** |
| Navigation | bottom tab bar, 60 px + `safe-area-inset-bottom` | bottom tab bar, full width, tabs centred in 560 | bottom tab bar, **56 px** (icon and label side by side), full width; on screens with a side pane, the bar sits under the main pane only (the existing rule) |
| Back | header back arrow (G47) | header back arrow | header back arrow, in the main pane's header |
| Type scale | 1.0 (16 px body, tokens as on the phone) | 1.0 | 1.0. Never scale type with the viewport (`vw`); respect the user's Safari text size |
| Primary action | pinned to the bottom of the viewport (D2) | pinned | pinned to the bottom of its own pane |
| Trade chat | Chat sheet (as on the phone) | Chat sheet | chat in the side pane (Fold-Trade) |

Change in `apps/web/src/ui/fold.ts`:

```ts
panes: '(min-width: 736px)',   // was 600px: two panes need 2 × 360 + 16
```

Update `e2e/phone.ts` FOLD_VIEWPORTS (the "two-pane edge" 600 becomes 736) and the `fold.ts` doc table to match. A 600–735 px screen then gets the phone layout with the 560 px column (rule below). This also fixes a 669 px inner screen and Android book folds around 690–700 px.

New CSS in `styles/fold.css`:

```css
/* One column on a wide phone-shell screen (626 portrait; any single-pane screen at 736–999). */
[data-shell='phone'] > [data-shell-body] > :not(.x2f-panes, main[data-screen='trade']),
[data-shell='phone'] > [data-shell-body] > .x2f-panes:not([data-side]) > [data-pane='main'] > * {
  width: 100%;
  max-width: 560px;
  margin-inline: auto;
  box-sizing: border-box;
}
:root[data-fold='two'] [data-shell='phone'] > [data-shell-body] > :not(.x2f-panes, main[data-screen='trade']) {
  max-width: 600px;
}
/* The trade room on one column, wider than a phone. */
@media (min-width: 600px) {
  :root[data-fold='phone'] main[data-screen='trade'] { max-width: 560px; margin-inline: auto; }
}
/* A pane is never narrower than a phone. */
:root[data-fold='two'] .x2f-panes > [data-pane] { min-width: 360px; }
/* The tab bar: its tabs stay grouped on a wide screen. */
@media (min-width: 600px) {
  .x2f-bottom-nav { padding-inline: max(0px, calc((100% - 560px) / 2)); }
}
/* Landscape on the inner screen: a slightly shorter bar, still above the 44 px target. */
@media (orientation: landscape) and (max-height: 700px) and (min-width: 736px) {
  :root { --x2f-tab-height: 56px; }
  .x2f-bottom-nav__tab { flex-direction: row; gap: 8px; }
}
```

## 3. Defects found

Severity: **P0** blocks a trade or looks broken; **P1** is clearly wrong; **P2** is polish.

### D1 (P0): inner portrait 626×890 splits into two 305 px panes
- **Shots:** `626x890-69-buyoffers.png`, `626x890-70-buyquote.png`, `626x890-68-selloffers.png`, `626x890-53-sell-offers-panes.png`, `626x890-31-myoffers-list.png`, `626x890-54-myoffers-panes.png`, `626x890-50-trade-room.png`.
- **What breaks:**
  - In the offer card, the name wraps ("satoshi_gho / st").
  - The XMR range runs into the "XMR" and "USD" units, which spill past the card's right edge (x ≈ 304 against a card edge at 288). "0.5% above market" prints on top of the range.
  - The sort chips wrap onto two lines.
  - My offers rows wrap every line, and the tab bar is squeezed into 305 px.
  - In the trade room, the title takes two lines and the trade code wraps.
  - The chat composer's placeholder is cut off ("Message satoshi_gł").
- **Fix:** the `panes` query goes to `(min-width: 736px)`, plus the one-column CSS in §2. At 626 px every screen is the phone layout in a 560 px column, the quote opens full screen (its URL already carries the offer id), and the trade chat is the Chat sheet. Add the `min-width: 360px` pane guard as a backstop.

### D2 (P0): "I've paid" is below the fold on the short Duo screens
- **Shots:** `466x678-50-trade-room.png` (no button visible), `890x626-50-trade-room.png`, and the full-page versions `*-50-trade-room-full.png`.
- **Measured:**
  - At 466×678 the button's top is at y = 695 in a 678 px viewport, and Safari's bottom bar takes about 60 px more.
  - At 890×626 it is at y = 715 in a 626 px viewport.
  - At 390×844 it only just fits.
- **Cause:** `BuyerPay` uses `.x2f-pay` (`min-height: 100dvh`). Its `.x2f-pay__footer` is pinned only in tabletop (`pay.css:34`).
- **Fix** (`screens/trade/pay.css`): replace the tabletop-only rule with one for every layout:
  ```css
  .x2f-pay__footer {
    position: sticky;
    bottom: 0;
    z-index: 1;
    padding-bottom: calc(var(--x2f-space-4) + env(safe-area-inset-bottom, 0px));
  }
  ```
  In panes, the footer sticks to the bottom of the main pane. Apply the same rule to the seller's confirm footer and any other room-state footer that holds the primary action.

### D3 (P1): single-column screens stretch to 858 px in inner landscape
- **Shots:** `890x626-67-buymain.png`, `890x626-66-main-sell.png`, `890x626-80-wallets.png` (an 858 px "Add a wallet" button, with the remove ✕ 700 px from the wallet name), `890x626-11-security-devices.png`, `890x626-12-security-hold-banner.png`.
- **Fix:** the 600 px centred column in §2. The wallets footer button follows the column, so give it `max-width: 600px; margin-inline: auto` inside `.x2f-wallets`.

### D4 (P1): the landing page is too tall for inner landscape, and its buttons are too wide on wide screens
- **Shots:** `890x626-00-landing.png` (the page is 706 px tall, the CTAs are 842 px wide), `626x890-00-landing.png` (578 px-wide buttons under a 300 px block of text), `466x678-00-landing.png` (fine, but the foot line is cut off at 678).
- **Fix** (`screens/auth/landing.css`):
  ```css
  .x2f-landing__ways { max-width: 440px; margin-inline: auto; }
  @media (max-height: 700px) {
    .x2f-landing__logo svg { height: 88px; width: auto; }   /* Logo is drawn at 120 */
    .x2f-landing__main { gap: 20px; padding-top: 16px; }
  }
  ```
  Then the logo, slogan, three promises and both buttons fit inside about 585 px. The same applies to `00-login`, where `.x2f-screen` is already capped at 480 px; only the height needs checking there.

### D5 (P1): the quote's "Trade" button is 1,800–2,000 px down the page
- **Shots:** `*-70-buyquote.png`, `*-71-sellquote.png`.
- **Measured:** "Trade" is at y = 1815 at 466×678 and 890×626, and at y = 2085 at 626×890. In panes it sits at the bottom of the side pane's own scroll, which is 1,915–2,185 px tall.
- **Fix:** pin the quote footer on short viewports and in the side pane:
  ```css
  @media (max-height: 700px) { [data-shell='phone'] .x2f-quote__footer { position: sticky; bottom: 0; z-index: 1; } }
  :root[data-fold='two'] [data-pane='side'] .x2f-quote__footer { position: sticky; bottom: 0; z-index: 1; }
  ```
  The footer already has a `--x2f-ground` background and a top rule, so it reads as a bar.

### D6 (P1): safe areas only cover the bottom
- `index.html` sets `viewport-fit=cover`, but no CSS reads `safe-area-inset-top`, `-left` or `-right`.
  - In inner landscape, the Duo's camera sits on a side edge. With `cover`, content at the 16 px gutter can run under it.
  - In a home-screen PWA (no Safari bars), the headers run under the status bar.
  - Note: the outer screen has a right-hand system strip that pages cannot draw under yet (research §0). Safari fills it with the page background, so `body` must keep an explicit `--x2f-ground` background (it does).
- **Fix** (`theme/base.css` or `ui/ui.css`):
  ```css
  [data-shell] {
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }
  [data-shell] > [data-shell-body] > :first-child header,
  .x2f-quote__header, .x2f-trade header, .x2f-browse__header {
    padding-top: max(var(--x2f-space-2), env(safe-area-inset-top, 0px));
  }
  .x2f-sheet { padding-bottom: calc(var(--x2f-space-4) + env(safe-area-inset-bottom, 0px)); }
  ```
  Sticky footers (D2, D5) add `env(safe-area-inset-bottom)` when no tab bar sits under them.

### D7 (P2): the browse screen sizes itself from `100vh` and a hard-coded 61 px
- `browse.css:9,13` uses `min-height: 100vh` and `calc(100vh - 61px)`.
  - On iOS, `100vh` is the large viewport, so the page is taller than the visible area while Safari's bar is showing.
  - The 61 px ignores the bottom safe area.
- **Fix:**
  ```css
  .x2f-browse { min-height: 100dvh; }
  [data-shell='phone'] .x2f-browse { min-height: calc(100dvh - var(--x2f-tab-bar-height)); }
  ```

### D8 (P2): the hold button's fill animates `right`, which is not smooth at 120 Hz
- `ui/ui.css:479` uses `transition: right var(--x2f-hold-ms) linear;`, so the browser recalculates layout on every frame of the press-and-hold confirm.
- **Fix:** keep the fill at full size and animate it with a transform:
  ```css
  .x2f-hold__fill { inset: 0; transform: scaleX(0); transform-origin: left center; }
  .x2f-hold[data-holding='true'] .x2f-hold__fill { transform: scaleX(1); transition: transform var(--x2f-hold-ms) linear; }
  ```
  Move the 2 px leading edge to a `::after` that follows the fill with `transform: translateX(...)`, or drop it.
- `ui.css:83` (buttons) and `ui.css:440` animate `background-color`, `border-color` and `color` over 150–160 ms. Under the 120 Hz rule below, swap each one for an `opacity` fade of a `::before` overlay, or remove the transition.

## 4. Folding or unfolding mid-trade

Today this works: the shell keeps one React tree, `useFoldLayout` re-renders without a reload, and the chat draft survives through `useKeptText` (see the measurement in §1). These rules must hold, and become test cases in `e2e/fold.spec.ts` at the Duo sizes:

1. **No reload and no new history entry.** The URL and `history.length` stay unchanged after a resize between 466×678, 626×890 and 890×626.
2. **State is kept:**
   - typed amounts, a picked wallet, the chat draft (`useKeptText`), ticked boxes, and an open sheet;
   - the main pane's scroll position (keep the element in view at the top);
   - the trade timer, which keeps counting from the server deadline, never from a local start.
3. **Panes collapse to a route.** When folding from 890 to 466, whatever was in the side pane becomes the full screen it would be on a phone.
   - The quote stays open, because its URL already carries the offer id.
   - The trade chat moves into the Chat sheet only if it was focused. Otherwise the room shows, with the Chat link.
   - Unfolding reverses this. From 626 portrait to 890 landscape, an open Chat sheet closes into the chat pane, and its draft goes with it.
4. **Back arrow (G47):** every unfolded and folded screen keeps its header back arrow. The iPhone has no system Back (research §2), so this is required. After a fold, Back goes to the same place it would have gone before the fold. A fold never adds a history step.
5. **A press-and-hold in progress is cancelled by a layout change**: it is treated as a `pointercancel`, and no release or "I've paid" is sent. The button returns to its idle caption. This prevents a fold half-way through a hold from confirming anything.
6. **Nothing animates the switch.** The layout snaps. Any transition used elsewhere is transform/opacity only (below).

## 5. Platform rules from the owner's specs

- **120 Hz ProMotion:** every animation and transition uses `transform` and `opacity` only. Never animate `width`, `height`, `top`, `left`, `right`, `margin`, colours or `box-shadow`. The current exceptions are D8. Keep `prefers-reduced-motion` (`theme/base.css:49`) as it is.
- **Always-On display:** nothing in the app relies on it. No "glanceable" state assumes the screen stays lit.
  - Timers are recomputed from deadlines when the page becomes visible again (`visibilitychange`). Do not trust `setInterval` ticks: they are throttled while the screen is dimmed.
  - No alert or confirmation is only drawn on screen; push and in-app notices carry it.
- **Fold and hinge:** one continuous panel with no gap, so no content needs to avoid a dead zone.
  - The landscape two-pane gutter (437–453 px) already sits on the crease at about 445 px.
  - When Safari turns on Viewport Segments, the existing `env(viewport-segment-*)` rules in `fold.css` take over with no change.
  - A half-folded portrait inner screen would report `vertical-viewport-segments: 2` and get `tabletop` at 626×890. The Fold-Tabletop board is drawn at 1000×840, so check that layout at 626 px before Safari ships the flag.
- **Never detect the model.** No user-agent checks; width, segments and posture only (G47).

## 6. Shots index (`design-12nov/duo-shots/`)

Each of these screens was taken at 390x844, 466x678, 626x890 and 890x626:

| Screen | File(s) |
|---|---|
| Landing | `00-landing` |
| Log in | `00-login` |
| Find a trade | `66-main-sell` (/sell), `67-buymain` (/buy) |
| Offers list | `68-selloffers`, `69-buyoffers` |
| Quote | `70-buyquote`, `71-sellquote` (full page) |
| Trade room | `50-trade-room` (viewport), `50-trade-room-full` |
| Wallets | `80-wallets` |
| Settings | `11-security-devices`, `12-security-hold-banner` |
| My offers | `31-myoffers-list` |

`53-sell-offers-panes` and `54-myoffers-panes` exist only at 626 and 890, the sizes where panes show today.

Not taken:
- The real chat sheet, the dispute room and PostOffer: their fixtures need build-time keys the scratch build did not have.
- The cover-posture and tabletop emulations: these are Android-only signals today.

How the shots were made: a scratch copy of `design-shots.spec.ts` with the viewport set by an environment variable, run against `vite preview` builds. The API's own `serveWeb` would not load under Node 22, while the repo pins Node 24.
