# X2F brief 2026-10-29 — board conventions (binding for every new board)

Canvas: X2F App (https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH). Design system: X2F
(tokens in /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/artifact-files/ad82f073-8cd3-4403-807b-a395a18b01a6/project/ds/x2f/tokens.json).
Existing boards to match (read 2–3 before writing): same folder, project/*.dc.html
(e.g. PostOffer, SellOffers, BuyerPay, SellerConfirm, SetupBackup, Profile, StaffSettings for desktop).

## Files
- Each brief item = TWO files: `<Name>.dc.html` (phone, root fixed 390px wide, height = content,
  min 844) and `<Name>-Wide.dc.html` (desktop, root fixed 1280px wide, height = content, min 800).
- Names from the brief, CamelCase with dashes (e.g. FlexOffer-Post, FlexOffer-Quote, MyOffers,
  CantDoThat, Feedback, Warn-IvePaid, Warn-Release, Refunded, Appeal-Notice, Lien-Notice, Ban-Notice,
  Maintenance, News, Block, Reviews, Alerts, DeleteAccount, Support, SelfDestruct).
- Write files only into your own folder given in your task; the lead publishes them.
- Exact skeleton: copy from the exemplar `CantDoThat.dc.html` / `CantDoThat-Wide.dc.html` in
  /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/.
  Keep the `<script src="./support.js"></script>` head line exactly; quote every attribute; close every tag.

## Night + light
- One `theme` tweak per board: data-props `{"theme":{"editor":"enum","options":["night","day"],"default":"night"},"$preview":{...}}`.
- renderVals returns `rootStyle` = the fixed size/layout styles + CSS custom properties for the chosen
  theme (copy the THEMES object from the exemplar verbatim). Every colour inside the board uses
  `var(--ground)`, `var(--surface)`, `var(--surface-raised)`, `var(--line)`, `var(--ink)`,
  `var(--ink-muted)`, `var(--monero)`, `var(--monero-ink)`, `var(--on-monero)`, `var(--escrow)`,
  `var(--caution)`, `var(--danger)`, plus `var(--scrim)` for modal backdrops. No raw hex in markup.
- Orange (monero) FILL = the one primary action per screen only. No orange chips/badges.

## Type and spacing (from the system)
- Fonts link (helmet): Familjen Grotesk 600;700, Atkinson Hyperlegible Next 400;600, Atkinson Hyperlegible Mono 400;500.
- display 40/44 700 (max one), title 24/30 600, heading 18/24 600, body 16/24, label 13/16 600 uppercase .04em,
  amount mono 28/32 500, address mono 14/20. Phone gutter 16px; section gap 24px; radius 6/12/pill.
- Hit targets ≥ 44px. Real <button>, <a href>, <input>+<label>. Icon-only buttons get aria-label.
  Inline stroke SVG icons only, aria-hidden. No emoji. No fake status bar/keyboard.
- Phone layout follows existing boards: header row with back/close (44px) + title; main scrolls;
  footer with the primary action. Wide layout: left nav rail like Desktop.dc.html / ModQueue boards,
  content max-width ~720px for forms, dialogs centered over a dimmed app.

## Copy
- Plain, short sentences, no jargon. Owner's quoted words (in the brief) are kept verbatim unless they
  break these rules; if you change any, list the change and why in your report.
- No email anywhere. Amounts: XMR with 6 decimals and fiat beside it. Example names: use the ones on
  existing boards (mira.k, nightowl_44, satoshi_ghost); placeholders like <exact date> shown as a real
  example date in mono (e.g. 31 Oct 2026, 14:05 UTC).
- Variants the brief asks for (e.g. 1–5 vs 1–10 stars, greyed vs hidden, News with/without the
  checkbox): build them as a `variant` enum tweak on the same board, not extra boards.

## Interactivity
- Use state for real interactions (toggles, tiers +, checkboxes, dropdowns, popups open/close).
  Keep logic small; all UI is markup (sc-if / sc-for), never script-built.

## Report back
- List each file written, any copy changed (old → new, why), and open questions for the owner.

## Additions (2 Nov 2026)
- **`--mod` token** (moderator purple), in every THEMES object:
  - night: `#b69cff`
  - day: `#6741d9` (6.3:1 on white)
- **Selection is never orange:**
  - Selected chips, tabs, tiles, radio cards and number tiles: a 2px `var(--ink)` border on `var(--surface-raised)`.
  - Checkboxes and radios: accent `var(--ink)`.
  - Current nav item: ink text on `--surface-raised`, with a 2px ink inset line.
- **Open owner decisions:** show an "OPEN · owner to choose" box next to the element instead of picking a default.
  - Box: 1px dashed `var(--caution)` border, 6px radius, 13px text.
  - Label: 12px mono, uppercase, `var(--caution)`.
  - Content: the question in bold, then the options as a list.
  - If the choice changes what the screen shows, add an enum tweak so each option can be previewed, and add "(not decided)" to the label.
- **Draft copy:** boards whose words aren't signed off show "Draft copy" top-right, 12px mono, `var(--ink-muted)`. List the sentences as COPY-UNSIGNED in reports.
- **Dates:** "6 Nov 2026, 15:00 UTC", in mono.
- **Durations:** digits in mono, units in body text ("1 h 58 min"). No spaces between the digits, and always a space before a unit ("in 2 h", never "in2 h").
- **Superseded boards:** keep them for reference, with a dashed `var(--line)` banner at the top saying what replaced them and when.
- **Foldables:** see Fold-Notes.dc.html.
  - Unfolded screens are two panes of 412 + 16 + 412, with the gutter centred on the hinge.
  - Nothing crosses the hinge, and dialogs stay inside one pane.
