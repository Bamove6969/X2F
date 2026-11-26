# J-34 look and feel: head designer rulings (9 Nov 2026) — READY, build-ready

The owner delegated these calls to design by name (G42–G47). They are final unless he overrides them.

## G-003 (G42) Active Buy/Sell tab: YES, 2 px ink border
- Segmented control: track `var(--surface)`, radius 999, height 40.
- Active segment: `background: var(--ground)`, `border: 2px solid var(--ink)`, text `var(--ink)` 15/20 600.
- Inactive segment: no border, text `var(--ink-muted)` 15/20 400.
- As drawn on Main/BuyMain. No colour fill on the active segment: the border alone carries the state, which meets the owner's "obvious selected state" rule.

## G-004 (G43) Disabled button and sheet title: KEEP everywhere
- **Disabled primary button:**
  - `background: var(--surface-raised)`, `color: var(--ink-muted)`, no border, `cursor: not-allowed`, same height as the enabled button (56 phone footer, 48 inline).
  - Never use opacity.
  - Always pair it with a one-line reason under it, 13/18 `--ink-muted` (e.g. "Opens once the escrow is secured.").
- **Sheet title:** Familjen Grotesk 24/30 700, letter-spacing −0.01em, `text-wrap: balance`, with a 36×4 grab handle (`var(--line)`, radius 999) above it.

## G-005 (G44) Unbuilt offer-screen items: BUILD ALL, as on the boards
Order on Main/BuyMain, top to bottom:
1. Header with the Site news link (bell + "Site news", 15/20).
2. Buy/Sell tabs.
3. Market price card (label 13/16 caps `--ink-muted`; price in mono 24; the currency drop-down on the right).
4. Search.
5. Sort chips.
6. Section heading with its count. The count is right-aligned, mono 13, `--ink-muted`.
7. Method rows. Each row has a 40×40 icon tile, radius 12, `var(--surface-raised)`.

- Empty-search heading: "No payment methods match "{query}"" + "Try another word, or post an offer for it."
- **The Deposit row is dropped:** there are no buyer deposits (T-021).

## G-006 (G45) Blue information note + rounder icon buttons: YES
- **Information note:**
  - `background: color-mix(in srgb, var(--escrow) 10%, var(--surface))`, `border: 1px solid color-mix(in srgb, var(--escrow) 30%, transparent)`, radius 12, padding 12×14.
  - 18 px info icon in `--escrow`; text 14/20 `--ink`.
  - Use it for neutral facts only.
  - Caution (`--caution`) is for "check this". Danger is for "stop".
- **Icon buttons:** 44×44 (48×48 next to a 48 field), radius 12, `border: 1px solid var(--line)`, glyph 20–24 at stroke 1.75.

## G-007 (G46) Devices: the five wordings (drawn on Devices / Devices-Wide)
1. No team members: "No team members yet" / "Add up to 3 people to help with your trades. You choose what each one can do." / button "Add a team member".
2. "They stay logged in until their session ends or you switch them off."
3. Over the device limit: "2 logged in · your limit is 1" / "Log one out to keep going."
4. "Back to log in" (unchanged).
5. "You stay logged in for {hours} h. Then we ask you to confirm it's you."

No owner input is needed.

## G-008 (G47) Folding phones: research and ruling
**Devices in scope (late 2026), all on Android:**
- Google Pixel Fold / Pixel 9–10 Pro Fold;
- Samsung Galaxy Z Fold and Z Flip lines;
- OnePlus Open, Honor Magic V, Vivo X Fold, Oppo Find N;
- Microsoft Surface Duo (dual screen, discontinued, still in use).

The owner's "iPhone Duo" is most likely the Surface Duo. Apple has no folding iPhone on our list; if one ships, the same posture rules cover it.

**Back:** every Android foldable gives a system Back, either as a gesture (swipe from the edge, as on the owner's Pixel Fold) or as the 3-button bar, which Samsung offers. Not every user uses gestures, so **we keep the in-app back arrow on every unfolded screen**, in the same header pattern as the phone boards. This answers G47/L27: the fold boards get a Back arrow.

**Detect the posture, not the model.** The web app can't reliably read a device model, and model lists go stale. Use:
- CSS viewport-segment media queries (`horizontal-viewport-segments: 2` for side-by-side, `vertical-viewport-segments: 2` for tabletop) and the `env(viewport-segment-*)` variables;
- the Device Posture API where available (`navigator.devicePosture.type`: `continuous` / `folded`);
- width as the fallback.

**One design per posture, already on the canvas:**

| Posture | Board | Size |
|---|---|---|
| Cover screen (folded) | Fold-Cover | 360×392 |
| Unfolded, inner screen | Fold-Offers, Fold-Trade, Fold-MyOffers, Fold-Notes | 840×1000 |
| Half-folded, tabletop | Fold-Tabletop | 1000×840 (top half content, bottom half controls) |
| Two segments (Surface Duo, and Samsung in split view) | Fold-TriFold pattern | list on one segment, detail on the other, never across the hinge |

- Flip phones (Z Flip) use the normal phone boards on the main screen. The cover screen shows only Fold-Cover-style trade status.
- **Follow-up (design):** add the Back arrow to the Fold-* unfolded boards. G48 ("Pay now" label on the fold screen) waits until the fold boards are final, as the owner said.
