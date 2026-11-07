# X2F craft pass brief (7 Nov 2026)

The owner wants design's full detail, skill, artistic flavour and vision in every board, not only rule compliance. The Badges board set the bar. This brief turns that bar into checks that apply to every screen. v2 (`design-visual-system-v2.md`) still holds; this pass adds craft on top of it.

## The bar

A screen passes when someone who sees it for two seconds can say what's happening, who is involved, and what to do. It should also feel made for X2F: calm, exact, a little warm, and recognisably the same app on every screen.

## Signature moves (use wherever they fit)

1. **One focal moment.** Every key screen has a hero: tone wash, chip, key mark where it's a trade, then one big thing (a hero number or a result headline). Secondary screens get a compact header with one clear lead line. No screen opens on a flat stack of equal cards.
2. **People are drawn as people.** Wherever a trader, member or moderator appears (trade header, chat, lists, rulings), use the trader identity from Badges: initials avatar on surface-raised, an online dot (teal), a teal ring if Trusted, the name in 600, and a role tag (Vendor / Team member in team blue / Moderator in mod purple inside disputes). Never a bare name in body text where a person matters.
3. **Badges and seals.** Badges always use the seal and chip from the Badges board. Security facts (PGP verified, Security key) use the ink seal; never a plain text label.
4. **Numbers as typography.** Amounts, timers, counts and stats are set as type: hero number 40/44 mono, stat tiles (mono value over a muted label on surface-raised), digits mono and units body. Align figures in lists to the right edge so they line up.
5. **Icons carry meaning.** Every list row that means something has a 40 px icon tile (neutral or toned). Callouts have their 18 px icon. No icon is decoration; no meaningful row is iconless.
6. **Depth by steps.** ground → surface → surface-raised. Details sit in inner blocks (radius 12, inset 14 dividers). Never lines of loose text on the ground where a block would group them.
7. **Empty and quiet states are designed.** Use the cover vocabulary: the key mark, or 2–3 small blocks in the family tones with radius tokens, then the title and one sentence. Never just an icon and grey text.
8. **Rhythm.** 16 between cards on phone, 24 on wide; 20 inside cards; 12 inside lists; 8 between label and field. Headers with consistent back/close placement.
9. **Finish.** Chevrons on navigable rows, consistent 44 px hit areas, sentence-case labels except the uppercase label style, no orphaned single words in headlines (rewrap or tighten), no clipped text, no empty bands at the bottom, both themes checked.
10. **Copy stays.** The pass changes design, not wording. Wording changes only to fix a contradiction, and those are listed as COPY-UNSIGNED.

## Process per board

Render night and day (every variant that changes layout). Score the board against 1–9: what's missing and what looks plain. Fix it in the board, re-measure the heights, then render again and look. Record a one-line "what changed" per board.

## Cohesion rules for the craft pass (owner: cohesiveness is extremely important)

Several designers work in parallel, so every upgrade must come from one shared kit. Don't invent a new look on one board.

- **Person / trader identity:** the exact `avatar()` and `trader()` markup in `gen/badges.py`. Phone list size: a 40 px avatar; header and hero: 48 px. Online dot is teal; a ring only for Trusted. Team members use initials on `--team`; moderators use a `--mod` tile with the shield glyph, inside disputes only.
- **Badges:** `chip()` / `seal()` / `more()` from `gen/badges.py`, unchanged.
- **Stat tiles:** `stat()` from `gen/badges.py` (mono 16 value over a 12 muted label, surface-raised, radius 10), in a grid of 3.
- **Icon tile:** 40×40, radius 12, 20 px stroke-1.75 icon. Neutral is surface-raised + ink; toned is the tone at 14–16% + tone. Nothing else.
- **Inner block:** surface-raised, radius 12, rows min-height 48, padding 0 14, label 14/20 muted left, value mono 15/500 right, 1px surface dividers inset 14.
- **Hero:** v2 §6 exactly (gradient wash 14% to 140/160 px, 35% border, chip + key mark row).
- **Empty state:** v2 §16, plus at most three small blocks in family tones (radius tokens) above the title. Copy the first one made exactly; don't make a new one per board.
- **Headers:** v2 §5 key-screen or compact header, exactly as on BuyerPay / Refunded.
- **Pre-login screens:** the Login-Backup-Wide pattern (centred wordmark, single column).
- **Anything genuinely new** (a component no board had): name it in your report so it can be made the shared version, and reuse your first version on every board you touch.
