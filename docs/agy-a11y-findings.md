# Accessibility & Readability Audit Findings (Job 8)

Branch: `wip/agy-a11y`  
Author: AGY <agy@users.noreply.github.com>  
Date: November 2026  
Scope: Trader screens across phone (`360x800`) and wide desktop (`1280x800`).

---

## 1. Summary of Changes

This pass covers contrast, focus, labels and alt text only (owner order, to-agy.log 2026-11-16 22:44:41). It does not change font families, font sizes, font weights or button/tap-target sizing (those are claude2's and the owner's), nor any auth/escrow/money logic. A first version of this branch did resize tap targets and added three `aria-label`s; both were taken out after review (review-agy-a11y-2026-11-17.md B1, B2).

### Changes kept
1. **Focus visible**: `apps/web/src/screens/browse/browse.css` adds an explicit `.x2f-text-button:focus-visible` ring (`2px solid var(--x2f-ink); outline-offset: 2px; border-radius: var(--x2f-radius-sm)`).
2. **Badge hover card width**: `apps/web/src/ui/kit.css` `.x2f-badge-card` gets `max-width: calc(100vw - 32px)` so the 340 px card cannot be wider than a 360 px viewport minus the gutters.
3. **Retry button cursor**: `apps/web/src/ui/sync-gate.css` `.x2f-sync__retry` gets `cursor: pointer` (no size change).
4. **Contrast tests**: `apps/web/test/a11yPass.test.ts` checks the text tokens (ink, ink-muted, monero-ink, escrow, good, caution, danger) against ground, surface and surface-raised in both themes (>= 4.5:1) and the `line` token (>= 3:1), plus the two focus rings above.

---

## 2. Tap Targets Audit (audited, not changed)

Button and tap-target sizing is not part of Job 8 (owner order above). The targets measured under 44 px on a side are listed for claude2 and the owner in `docs/agy-owner-questions.md` §1. Nothing here was resized.

| Element | Location (base 94337781) | Measured | Status |
| :--- | :--- | :--- | :--- |
| `.x2f-text-button` | `browse.css:364` | ~32 px tall (`padding: 6px 0; margin: -6px 0`) | Under 44: question §1 |
| `.x2f-chip-button` | `browse.css:161` | 44 px tall, no minimum width | Width under 44 possible: question §1 |
| `.x2f-offer__nudge` | `browse.css:658` | 44 px tall, no minimum width | Width under 44 possible: question §1 |
| `.x2f-app-chip` | `Wallets.css:171` | 40 px tall | Under 44: question §1 |
| `.x2f-quote__switch`, `.x2f-quote__max` | `quote.css:130` | min 44 px tall, no minimum width | Width under 44 possible: question §1 |
| `.x2f-rail__home` | `ui.css:632` | min 44 px tall, no minimum width | Width under 44 possible: question §1 |
| `.x2f-sync__retry` | `sync-gate.css:29` | min 44 px tall, no minimum width | Width under 44 possible: question §1 |
| `.x2f-pay-timer__text` | `pay.css:182` | no minimum size | Question §1 |
| `a.x2f-list__row` (outside Jabber alerts) | `screens.css:266` | 44 px minimum only on the Jabber rows | Question §1 |
| `.x2f-btn` | `kit.css:20` | min 44 px tall | Pass |
| `.x2f-switch` | `ui.css:1003` | 52 x 44 px minimum | Pass |
| `.x2f-icon-button` | `ui.css:282` | 44 x 44 px | Pass |
| `.x2f-bottom-nav__tab` | `ui.css:547` | 60 px tall | Pass |

The existing e2e phone check (`apps/web/e2e/phone.ts`, `expectPhoneLayout`, MIN_TAP 32 px) already runs on the trader screens at 390x844 and 360x800.

---

## 3. Contrast AA Verification

All tokens were verified using standard WCAG 2.x relative luminance algorithms (`apps/web/test/contrast.ts`) across all backgrounds (`ground`, `surface`, `surface-raised`) in both **Night** and **Day** themes:

### Text Tokens (WCAG AA Requirement: >= 4.5:1)
- **Night Theme**:
  - `ink`: 16.69:1 on ground, 15.24:1 on surface, 13.43:1 on surface-raised
  - `ink-muted`: 7.50:1 on ground, 6.85:1 on surface, 6.04:1 on surface-raised
  - `monero-ink`: 6.44:1 on ground, 5.88:1 on surface, 5.18:1 on surface-raised
  - `escrow`: 9.11:1 on ground, 8.32:1 on surface, 7.33:1 on surface-raised
  - `good`: 10.85:1 on ground, 9.91:1 on surface, 8.73:1 on surface-raised
  - `caution`: 11.27:1 on ground, 10.29:1 on surface, 9.07:1 on surface-raised
  - `danger`: 6.95:1 on ground, 6.35:1 on surface, 5.60:1 on surface-raised
- **Day Theme**:
  - `ink`: 16.78:1 on ground, 18.15:1 on surface, 15.62:1 on surface-raised
  - `ink-muted`: 5.88:1 on ground, 6.36:1 on surface, 5.47:1 on surface-raised
  - `monero-ink`: 5.05:1 on ground, 5.46:1 on surface, 4.70:1 on surface-raised
  - `escrow`: 6.11:1 on ground, 6.60:1 on surface, 5.69:1 on surface-raised
  - `good`: 6.59:1 on ground, 7.13:1 on surface, 6.14:1 on surface-raised
  - `caution`: 6.07:1 on ground, 6.56:1 on surface, 5.65:1 on surface-raised
  - `danger`: 6.19:1 on ground, 6.69:1 on surface, 5.76:1 on surface-raised

All text tokens exceed the 4.5:1 threshold across all grounds.

### Non-Text UI Component Contrast (WCAG 2.1 1.4.11 Requirement: >= 3:1)
- `line` token (dividers, borders, control boundaries):
  - Night: 4.06:1 on ground, 3.70:1 on surface, 3.26:1 on surface-raised
  - Day: 3.50:1 on ground, 3.78:1 on surface, 3.25:1 on surface-raised

All UI borders exceed 3.0:1 in both themes.

---

## 4. Viewport & Horizontal Overflow Checks

What was checked, and how:
- **360x800 and 390x844 (phone)**: the e2e helper `expectPhoneLayout` (`apps/web/e2e/phone.ts`) fails a spec when the page scrolls sideways or a visible element sticks out past the viewport. The browse-buy, browse-sell and quote specs run it at both sizes; they passed on this branch (counts in §7).
- **Badge hover card**: `.x2f-badge-card` is only rendered by the kit component `BadgeChips` (`apps/web/src/ui/Badges.tsx`, used by `TraderCard` / `CompactTrader` in `ui/Identity.tsx`). No trader screen renders those components today, so no Playwright check can open the card on a real screen; it is covered by `apps/web/test/kit-identity.test.tsx`. The new `max-width` caps its width, but `left: -24px` (kit.css:540) can still put it past the left edge when its anchor sits at the 16 px gutter. Check this when a screen starts using the card.
- **1280x800 (desktop)**: a CSS read-through only (not measured): rail 240 px + content max 944 px + 96 px padding = 1280 px.

---

## 5. Form Input Labelling (audited, already labelled, no change)

Every `<input>`, `<textarea>`, `<select>` and `<Checkbox>` on the trader screens read below already has a label; nothing was changed:
- **`OfferList.tsx`**: the with-markup checkbox has a visible `<label htmlFor={markupId}>` and `aria-describedby`.
- **`MethodList.tsx`**: the search input has a visually hidden `<label htmlFor="browse-search">` ("Search payment methods").
- **`Quote.tsx`**: the amount input has a visible `<label htmlFor="quote-amount">` and `aria-describedby="quote-amount-help"`.
- **`CheckRow.tsx`**, **`SelectAll.tsx`**: `id` + `aria-labelledby` (and `aria-describedby`).
- **`Wallets.tsx`**, **`SuggestMethodSheet.tsx`**, **`PaidConfirmSheet.tsx`**, **`ReleaseWarning.tsx`**: `<label htmlFor>` with visible text.

This was a source read of the files above, not an automated scan of every screen.

---

## 6. Focus Visible & Images / Icons

- **Focus Visible**:
  - `apps/web/src/theme/base.css` enforces `outline: 2px solid var(--x2f-ink); outline-offset: 2px;` across `button:focus-visible`, `a:focus-visible`, `input:focus-visible`, `select:focus-visible`, `textarea:focus-visible`, and `[tabindex]:focus-visible`.
  - Added explicit focus ring to `.x2f-text-button:focus-visible`.
- **Images & Icons**:
  - `ProofThumb.tsx`: only `<img>` tag in the app, explicitly passes `alt={alt}`.
  - `Icon` and `KitGlyph` components: every SVG automatically applies `aria-hidden="true"` and `focusable="false"`.
  - Informative SVGs (`Logo`, `Qr`, `FundFallback`, `TimerCard`): carry `role="img"` and descriptive `aria-label`s.

---

## 7. Verification & Checks Run

See the READY line in to-lead.log for the counts of the latest run (full `npm run check`, plus the browse-buy, browse-sell and quote Playwright specs).
