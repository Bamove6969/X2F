# Owner Questions — Notes Finish (16 Nov 2026, Job 15 `wip/agy-notes-finish`)

Questions left from the 91 owner demo notes audit (`docs/owner-notes-status-2026-11-16.md`). One question lives in one place: where a question is already asked elsewhere, this file only points to it. agy lists options; it does not recommend.

---

## 1. 12 Nov Note #17 (`26d861d0`) — standing rule, no question
Standing rule, no question: notes are recommendations for the lead and design; reversals of recorded rulings are asked, not built (17:38 RULE).

## 2. 12 Nov Note #31 (`9859d59b`) — wallet connect
Answered by the owner 16 Nov #7 (`7fd0d91a`); built in Job 27 (wip/agy-wallet-list).

## 3. 12 Nov Note #32 (`6f7af3e7`) — suggested wallets list
Answered by the owner 16 Nov #7 (`7fd0d91a`); built in Job 27 (wip/agy-wallet-list).

## 4. 12 Nov Note #42 (`92778756`) — `/session-length` help-link targets
Asked in `docs/agy-owner-questions-layout.md` §3 (on `wip/agy-layout`). Current state: the lead's 12 Nov call (front-door placeholders on both screens).

## 5. 12 Nov Note #47 (`75bfbd3c`) — first screen and tour reversals
Asked in `docs/agy-owner-questions-landing.md` R1-R3 (on `wip/agy-landing`).

## 6. 13 Nov Note #21 (`0b68b013`) — capital "Terms"
Asked as Q11 in `review-third-demo-r3-and-terms-r3b-2026-11-16.md` (comms).

## 7. 13 Nov Notes #24 (`8a11bb3d`) and #29 (`99e62425`) — authenticator app without a password
Asked as Q1 in `review-third-signup-r3-2026-11-16.md` (comms). The owner ruled on 16 Nov (to-lead.log 2026-11-16 17:38:00: the authenticator app needs a password as well; the earlier notes are superseded); that is login security and is being built by Claude on `wip/second-signup-r3-fixes`, not by agy.

## 8. 13 Nov Note #34 (`b851dfbf`) — security key artwork (screen owned by claude2; agy is not changing it)
- **Screen:** `/setup/security-key`
- **Owner quote:** *"Too much empty screen real estate maybe a picture of a big security key here or like 4 or 5 different ones side by side all by different companies as examples of what they can look like"*
- **Now:** `apps/web/src/screens/setup/SecurityKeyArt.tsx` draws four generic key outlines (USB-A, USB-C, NFC card, Lightning), marked `data-placeholder="design-to-draw"`.
- **Options:**
  - **Option A:** keep generic connector outlines (no brand marks).
  - **Option B:** ask design for drawings of specific keys (for example YubiKey 5 NFC, Google Titan, Nitrokey 3, Feitian).
- **What each would change:** A needs no new assets. B needs design artwork.
