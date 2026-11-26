# Visual system v2 rollout brief

The owner wants every screen of X2F to feel cohesive, BOLD and beautiful, something people want to use, while staying intuitive and explaining things when needed. You are bringing one group of boards up to **Visual system v2**.

## Read first
- `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/VISUAL-SYSTEM-v2.md`: the spec and the 13-step checklist. Follow it exactly.
- `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/CONVENTIONS.md`: the base rules.
- The exemplars in `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/`: BuyerPay.dc.html, Refunded.dc.html, Refunded-Wide.dc.html, plus ProofBlur.dc.html.
- Before/after shots in `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/v2-shots/`. View them with Read.

## Rules
- **Where to edit:** only YOUR group's files, in place, in `lead/project/`. Don't publish. Don't touch git.
- **What not to change:**
  - All copy and meaning: you may tighten wording only where v2 asks, and you must list every change.
  - All tweaks (names, options, defaults), states and interactions.
  - Every OPEN / Decided / design note and every "Draft copy" label.
  - The --team, --mod and --monero rules.
  - Designer notes go BELOW the app screen under "Design notes", as on SessionLength.dc.html and ProofBlur.dc.html, not inside the app UI.
- **Themes:** THEMES must include --mod and --team. Copy from BuyerPay.dc.html.
- **Signature 2-of-3 key mark:** only where v2 says (trade and trade-result heroes, active-trade list rows, the empty trades state).
- **One standout card:** each key screen gets exactly ONE hero (status chip + big number or headline + one-line meaning) where it fits. Not every screen needs a hero. Settings and lists use section headings, cards and list rows.
- **Check every board by looking at it:**
  - `node /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/tools/render-board.js <board.dc.html> <out.png> [night|day] [json]`
  - Shots go to `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/v2-shots/<Board>-<state>-<theme>.png`.
  - Look at night AND day for the default state and the most important other state. Iterate until each looks great and nothing overflows, clips or overlaps.
  - Set `$preview` (and any root height constant) to the measured height, with no empty band at the bottom.
- **Technical checks per file:** data-props JSON parses, tags balanced, the dc-script passes `node --check`, every hole is a plain dotted lookup, no hex outside THEMES.
- **Report:** per board, one line on what changed, any copy changes (old → new), and the PNG paths of the after shots. End with anything you think the owner should decide.
