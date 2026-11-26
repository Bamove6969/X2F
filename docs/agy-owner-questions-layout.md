# Owner Questions — Job 2 (`wip/agy-layout`)

Questions recorded per the standing rule (`make NO product or judgment calls on your own; write the question in docs/agy-owner-questions.md`).

## 1. `/setup/wallet` — Wallet Connection System vs Suggested Wallets List (12 Nov #31 `9859d59b`, #32 `6f7af3e7`)
Answered by the owner 16 Nov #7; built in Job 27 (wip/agy-wallet-list).

## 2. `/setup/security-key` — Security Keys Illustration Style (13 Nov #34 `b851dfbf`)
- **Owner note:** *"Too much empty screen real estate maybe a picture of a big security key here or like 4 or 5 different ones side by side all by different companies as examples of what they can look like"*
- **Options:**
  1. **Keep the 4-key generic SVG outline row (`USB-A`, `USB-C`, `NFC card`, `Lightning`) with brand names in the caption (`SecurityKeyArt.tsx`):** Avoids vendor trademarks/logos while showing the four physical form factors side by side.
  2. **Commission detailed illustrated artwork of 4–5 hardware keys from design:** Replaces the `data-placeholder="design-to-draw"` SVG outlines with final illustration assets.
- **Status:** Existing 4-key SVG row (`SecurityKeyArt.tsx`) kept until design/owner signs off on final artwork (screen owned by claude2; agy is not changing it).

## 3. `/login` and `/session-length` Help Links — Pre-login Placeholders vs Signed-in Help (12 Nov #38 `aea147fe`, #42 `92778756`)
- **Owner notes:**
  - `#38` (`aea147fe`) on `/login`: *"Move everything down so the screen doesn't look so empty and so the logo fits at the top..."*
  - `#42` (`92778756`) on `/session-length`: *"maybe we can full some of the space with links to faq, getting started, support, settings etc..."*
- **Options:**
  1. **Keep the lead's 12 Nov call (front-door placeholders on both screens; current state):** Both screens use the front-door placeholder pages (`/help/faq`, `/help/getting-started`, `/help/support`, `/help/settings`) so nothing on either screen leads behind the door before full login is complete.
  2. **Signed-in links on `/session-length` to real in-app destinations:** Links to `/help#faq`, `/help#getting-started`, `/feedback`, and `/settings/security`. Note: team member sessions can also reach `/session-length`, but team members have no Security screen (`/settings/security` fails for them).
- **Status:** Option 1 kept as current state; Option 2 not built; waiting for the owner or the lead.

## 4. `/session-length` Font Sizing (12 Nov #43 `fb9462a7`)
#43: left to claude2's font sizing (wip/second-fonts), per the owner's 16 Nov order.
