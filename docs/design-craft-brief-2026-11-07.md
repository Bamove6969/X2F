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
- **Kit sources** (head designer's decision, 7 Nov): `gen/badges.py` plus `gen/badge_parts.py` (the 40 px list avatar with a 15 px initial, the compact list-card trader block, and the "+N" hover card). Chips and "+N" that open something are wrapped in a 44 px transparent button. Badge sheets use the sheet title 24/30.
- **Trader card** (shared, head designer 7 Nov): `trader()` inside a primary card (surface, radius 16, padding 20). Phone trade screens place it right after the hero; wide places it at the top of the right column. **Recipient row** (shared): the first row of `trader()` with an amount line under it (mono XMR plus muted fiat), between surface-raised rules, used in release and payment confirm sheets. Someone who missed a deadline or is away is drawn offline: no dot, "Last seen …".
- **Dispute kit** (shared, head designer 7 Nov; source `gen/craftkit.py`): the parties strip (inner block, 3 columns of avatar + name + role tag); the evidence thumbnail tile (72 px preview + title + meta, 2-column grid, mod-tinted for moderator-only files); the chat message (32 px avatar, name line, bubble); the decided-by row (mod tile, name in mod purple, "X2F Moderator" tag, mono date); the pending moderator tile (solid 1px line border, muted shield, "Not joined"). Avatar sizes: 48 in headers, 40 in lists, 32 in chat.
- **Onboarding kit** (shared, head designer 7 Nov; source `gen/craft-onb/kit.py`): the labelled setup stepper (5 steps, done in escrow teal, current in ink 600, upcoming raised). It now matches the trade stepper's language and replaces the bare ink bars, superseding the earlier setup-stepper rule. Login-method seals (ink family, 40 px; 22 px inside buttons): PGP key, security key, passkey, password, authenticator, recovery codes. Signed-in identity row (48 px avatar, name, Vendor tag, escrow check line).
- **Login-method seals: one set only** (head designer 7 Nov): the glyphs and families in `gen/craft-onb/kit.py`. **Strong-login seal trio:** passkey, security key and PGP seals at 28 px, gap 6, `aria-hidden`, always next to a sentence that names them. **Pre-login wordmark:** plain ink "X2F" (standard 3), centred, 24 px on phone and 32 px on wide. A logo mark is a separate brand proposal, not part of this pass.
- **Heights:** a board whose variants differ in height switches its root height per variant (the Compromised pattern), so no variant clips.
- **Account kit** (shared, head designer 7 Nov): the blocked marker (an 18 px `--danger` circle with a ban icon, a 2 px surface ring, bottom-right where the online dot goes); the offline avatar (no dot, plus "Last seen …"); the settings row value (right-aligned before the chevron, 15/20 500, digits mono); the change-card header (40 px tile or avatar plus a 16/22 600 title). On wide, cards in a column sit 24 px apart, always.
- **Results kit** (shared, head designer 7 Nov; source `craftgen/craftlib.py`): the rating chip (`chip()` with a caution star seal and mono digits), the star picker seal tiles, the designed result state `done_state()` (centred, 56 px toned tile, title, one line) for every thank-you, saved, skipped or done state, and the offline trader card. Digits in running text are mono.
- **Chat kit** (shared; source `craftfold/foldkit.py`): `chat_markup()` / `chat_js()` (32 px avatar, bold name with mono time, 12/12/12/4 bubble), the chat-header identity row with a badge chip on the right, and the encryption note with a lock icon.
- **One cast, one set of facts** (head designer 7 Nov): each example person has the same numbers on every board. satoshi_ghost (Vendor, Trusted + Fast, online): 1,284 trades · 99.4% positive · 275.4 XMR traded. mira.k (trader, PGP verified, no Trusted ring): 212 trades · 99% positive · 41.7 XMR traded. nightowl_44, kettle.moss and lowtide_rx keep one set each, chosen in the final review.
- **Team kit** (shared; source `gen/teamkit.py`): the Team member role tag (Vendor-tag geometry in `--team` at 14% with a people icon), the team avatar (`avatar()` in `--team` with initials in `--ground`), the two-person block (owner row over member row), and the Trader → Vendor step strip (BecomeVendor only). The owner is drawn with the standard avatar plus the Vendor tag. Team's "N of 19 allowed" is to become "of 31" to match the Q16 MemberPermissions model; that's the final review's job.
- **Home and builder kit** (shared; source `gen/craft-home/kit.py`): the builder step head (40 px tile, then "Step N of 4" uppercase over an 18/24 heading), the empty-state mark (56 px tile flanked by two small blocks in escrow and caution; **the one empty-state mark for every board**), and the wide "Steps" jump card. Active trade rows use the small key mark tile in the trade's state tone.
