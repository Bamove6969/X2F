# Owner Questions & Product Decisions — Notes Finish (16 Nov 2026, Job 15 `wip/agy-notes-finish`)

This document records all product questions, design tradeoffs, and ambiguities arising from the 91 owner demo notes audit (`docs/owner-notes-status-2026-11-16.md`), per the standing directive:
> *"make NO product or judgment calls on your own; write the question in `docs/agy-owner-questions-notes-finish.md` (one question per note, options, what each would change)."*

---

## 1. 12 Nov Note #17 (`26d861d0`) — Standing Process Directive on Recommendations vs Rulings
- **Screen:** `/setup`, `setup-terms`, `#terms-sign-help`
- **Owner quote:** *"All comments I leave are recommendations to be discussed amongst lead and designer and if needed to come to me with questions"*
- **Context:** Recorded in `origin/comms:terms-draft-2026-11-12.md:14-17`. The owner established that feedback left in demo notes reflects recommendations to be reviewed by lead and designer rather than immediate unilateral mandates.
- **Question for Owner:** Confirm whether any demo note recommendations that reverse prior recorded design/lead specifications (such as the diagonal "Welcome to" lead-in or "Next screen" in story-flow tours) require explicit owner approval before merging into the main demo branch.
- **Options:**
  - **Option A (Strict Approval):** Any recommendation that reverses an existing recorded lead/design ruling must be raised as an owner decision in `to-lead.log` before code is merged into `wip/third-demo-r3`.
  - **Option B (Implement Recommendation First):** Implement the owner's demo note verbatim immediately and document the reversal in the branch questions file for post-implementation review.
- **What each would change:** Option A prevents churn and keeps the demo branch stable while awaiting decisions; Option B prioritizes rapid demo visual fidelity to the owner's latest notes.

---

## 2. 12 Nov Note #31 (`9859d59b`) — Wallet Connect Protocols (MetaMask / Edge Equivalent for Monero)
- **Screen:** `/setup/wallet`, `setup-wallet`, `div.x2f-start__chips`
- **Owner quote:** *"What are the methods of connecting wallets like edge has and meta mask and some of the others use. Can we not use that technology too?"*
- **Context:** Job 4 (`origin/wip/agy-wallet-research:docs/research-monero-wallet-connect-agy-2026-11-16.md`) audited Monero cryptography and confirmed why standard Web3 transports (injected `window.ethereum`, WalletConnect v2 relay) do not exist for Monero: Monero stealth addresses require private view key scanning across the entire blockchain to detect UTXOs, and no browser extension injects a provider. Edge's proprietary `reqaddr:` returns only primary addresses (never subaddresses) and lacks encryption.
- **Question for Owner:** Since Monero has no equivalent to MetaMask's browser-injected connect or WalletConnect RPC relay, which address-import mechanism should X2F adopt for launch?
- **Options:**
  - **Option A (Manual Copy-Paste + QR Scanner; Recommended):** Trader pastes their Monero subaddress (`8…`) manually or scans their wallet's Receive QR code using their device camera via `getUserMedia`. Works universally with all Monero wallets (Cake Wallet, Monerujo, Feather, Official GUI, Stack Wallet).
  - **Option B (OS Deep Link `monero:` URI):** Clicking an external wallet button launches the native wallet app on desktop or phone via `monero:` URI handler to request a transfer or address.
  - **Option C (Hardware Device Bridge):** Desktop Chromium WebHID / WebUSB bridge directly to Ledger or Trezor for hardware-verified payout address retrieval.
- **What each would change:** Option A requires zero third-party integrations and is already functional in `apps/web/src/screens/setup/Wallet.tsx`. Option B requires custom native wallet protocol handlers. Option C adds `@trezor/connect-web` and `@ledgerhq/hw-transport-webhid` packages.

---

## 3. 12 Nov Note #32 (`6f7af3e7`) — Suggested Wallets List vs Interactive Buttons on `/setup/wallet`
- **Screen:** `/setup/wallet`, `setup-wallet`, `main.x2f-start__main`
- **Owner quote:** *"It really make no sense asking for these wallets by name of they are not offering a specific connection system so we need to offer the connection system for the monero wallets that have it and I suggest that we also have a list of suggested monero wallets like we have on the screen now but they shouldn't be buttons like they do something"*
- **Context:** The owner noted that `<button role="radio" className="x2f-start__chip">` confuses users into thinking the button initiates an automated wallet connection. On 16 Nov #7 (`7fd0d91a`), the owner gave follow-up direction: *"This should be more of a recommendation of well known monero wallets available today. If there are more we can list those too and say and many more. Please use your favourite and enter in an address from that wallet."* (Assigned to Job 27 `wip/agy-wallet-list`).
- **Question for Owner:** How should the recommended Monero wallets be presented on `/setup/wallet`?
- **Options:**
  - **Option A (Static Recommendation Badges + Single Address Input; Owner 16 Nov #7):** Display a non-interactive informational list of recommended wallets (Cake Wallet, Feather, Monerujo, Official GUI, Stack Wallet, "and many more") with a single address paste input field. Default the stored payout wallet app to `'other'` or remove per-app tagging.
  - **Option B (Keep Interactive App Chips; Current):** Retain the radio chip selection so Edge users continue to receive the targeted "Full Sync" privacy recommendation, and `POST /v1/wallets` records which wallet client is in use.
- **What each would change:** Option A replaces the interactive `<div className="x2f-start__chips" role="radiogroup">` in `apps/web/src/screens/setup/Wallet.tsx:95-101` with static text/badges and simplifies tests. Option B retains existing behavior.

---

## 4. 12 Nov Note #42 (`92778756`) — `/session-length` Help Links Destination
- **Screen:** `/session-length`, `session-length`, `div.x2f-field > p.x2f-fine:nth-of-type(2)`
- **Owner quote:** *"Again this should be moved down so there is not so much blank space and maybe we can full some of the space with links to faq, getting started, support, settings etc..."*
- **Context:** On `/login` (pre-login), `<HelpLinks />` routes visitors to public `/help/:topic` placeholder screens (`apps/web/src/screens/HelpTopic.tsx`). However, `/session-length` occurs during an active authenticated session. In review `review-agy-layout-2026-11-17.md` (B2), claude3 ruled that pointing `/session-length` to authenticated in-app screens (`/help#faq`, `/feedback`, `/settings/security`) is a product call that also breaks for team members (who have no access to `/settings/security`).
- **Question for Owner:** Should `/session-length` display the public pre-login `/help/:topic` links (matching `/login`) or link to authenticated in-app pages?
- **Options:**
  - **Option A (Public Pre-login Placeholders; Current / Recommended):** Keep the lead's 12 Nov call where both `/login` and `/session-length` route to public `/help/:topic` pages, ensuring uniform behavior for both solo traders and team members.
  - **Option B (Authenticated In-App Destinations):** Route signed-in traders to `/help#faq`, `/help#getting-started`, `/feedback`, and `/settings`, while conditionally hiding or redirecting the Settings link for team members.
- **What each would change:** Option A keeps `apps/web/src/ui/HelpLinks.tsx` lightweight without auth state props. Option B requires conditional session role checking inside `HelpLinks.tsx`.

---

## 5. 12 Nov Note #47 (`75bfbd3c`) — First Screen & Guided Tour Visual Hierarchy Reversals
- **Screen:** `/welcome` (`WelcomeScreen`) and guided tour (`tour/engine.ts`)
- **Owner quote:** *"The first screen is going to welcome them to X2F, and they can select \"tour\" or \"skip and get started.\" The logo will be large and in the middle of the screen, and \"Welcome to\" will be displayed diagonally from the top left moving down right diagonally to the big logo in the middle of the screen... once the important features are explained the next button will change to next screen."*
- **Context:** Job 2 (`wip/agy-landing`) implemented the diagonal `"Welcome to"` text and `"Next screen"` tour button labels, reversing earlier design/lead rulings (`tour-stops.md:91` specified that single-run trader story tours stay with `"Next"`, and `tour-motion.md` hid links under 760px).
- **Question for Owner:** Confirm whether the visual reversals implemented on `wip/agy-landing` are approved:
  1. Diagonal `"Welcome to"` tilted toward the center logo, appearing directly above the horizontal heading `"Welcome to X2F"`.
  2. Button label switching from `"Next"` to `"Next screen"` at the final feature stop of each page (stops 5, 10, 12, 14, 16) during the 17-stop trader tour.
  3. Keeping the 4 navigation links visible on viewports under 760px tall by compacting padding rather than hiding them.
- **Options:**
  - **Option A (Approve Reversals; Current in `wip/agy-landing`):** Retain all three changes matching the owner's literal note description.
  - **Option B (Strict Design System Alignment):** Keep the horizontal heading alone (hide diagonal lead-in), use `"Next"` throughout the story flow tour, and hide links under 760px height.
- **What each would change:** Option A keeps the code in `apps/web/src/screens/welcome/WelcomeScreen.tsx` and `apps/web/src/tour/engine.ts`. Option B reverts those changes to base `origin/wip/third-demo-r3`.

---

## 6. 13 Nov Note #21 (`0b68b013`) — Capitalization of the Word "Terms"
- **Screen:** `/setup`, `setup-terms`, Section 9 paragraph 2
- **Owner quote:** *"Should the word terms be capitalized?"*
- **Context:** The word "Terms" is capitalized throughout `apps/web/src/screens/setup/Terms.tsx:247`, `apps/staff-web/src/ui/TermsStep.tsx:102`, and `apps/web/src/screens/setup/termsText.ts:167` (e.g. `"If you agree to X2F's rules and Terms, tick the box..."`, `"When these Terms change, X2F shows them again..."`).
- **Question for Owner:** Should "Terms" remain capitalized as the formal proper noun title of the legal agreement across all screens, or be lowercased to "terms"?
- **Options:**
  - **Option A (Capitalized "Terms"; Current):** Keep "Terms" capitalized throughout legal intros, buttons, and terms text to denote the official X2F Terms of Service.
  - **Option B (Lowercase "terms"):** Lowercase to "terms" except when referencing the full title "Terms of Service".
- **What each would change:** Option A requires no code edits (already capitalized in codebase). Option B updates strings across `apps/web/src/screens/setup/Terms.tsx`, `termsText.ts`, and `apps/staff-web/src/ui/TermsStep.tsx`.

---

## 7. 13 Nov Note #24 (`8a11bb3d`) & Note #29 (`99e62425`) — TOTP Authenticator Password Requirement & Standalone Enrolment
- **Screen:** `/setup/login`, `setup-login`, `#_r_1_-totp`
- **Owner quotes:**
  - `#24`: *"why did it only become available after selecting password. Is there a reason why having an OTP requires a password?"*
  - `#29`: *"you should be allowed to have otp without a password but it wouldn't let me select it without letting me choose a password first... if over of the others is selected then totp should be allowed to be the only accompany one because remember the have their login name still too"*
- **Context:** An RFC 6238 TOTP authenticator code is a 6-digit numeric time-based token (1,000,000 possible codes). Standard security architecture uses TOTP as a second factor alongside a knowledge factor (password), not as a standalone sole credential. In `apps/web/src/screens/setup/Login.tsx:48,92-97`, users can now tick and enroll TOTP alongside PGP, WebAuthn security keys, or passkeys without requiring a password. However, `apps/api/src/auth/password.ts:274-277` only validates TOTP codes during password login, while PGP and WebAuthn logins authenticate via their own asymmetric challenges without an OTP prompt.
- **Question for Owner:** How should TOTP behave when enrolled alongside passwordless security methods (PGP or WebAuthn)?
- **Options:**
  - **Option A (Informative Card Copy; Current / claude2 review M3):** Keep the server authentication flow unchanged: PGP and WebAuthn authenticate independently without an OTP step; when Password is not ticked, the TOTP card explains: *"X2F asks for this code only when you log in with a password. A PGP key, passkey or security key logs you in without it."*
  - **Option B (Require TOTP on All Logins):** Extend the server API so that if a user has enrolled TOTP, every login method (including PGP and WebAuthn) prompts for a 6-digit TOTP code after completing the primary cryptographic challenge.
  - **Option C (Allow Standalone Login Name + TOTP):** Allow a trader to log in using only their private username and a 6-digit TOTP code without any password, PGP key, or WebAuthn device.
- **What each would change:** Option A requires no further code changes. Option B modifies `apps/api/src/auth/webauthn.ts` and `apps/api/src/auth/pgp.ts` to require a secondary TOTP verification step. Option C creates a new login endpoint `POST /v1/auth/totp-login` and introduces high risk of credential brute-forcing.

---

## 8. 13 Nov Note #34 (`b851dfbf`) — Security Key Illustration Artwork Style
- **Screen:** `/setup/security-key`, `setup-security-key`, `main.x2f-start__main`
- **Owner quote:** *"Too much empty screen real estate maybe a picture of a big security key here or like 4 or 5 different ones side by side all by different companies as examples of what they can look like"*
- **Context:** `apps/web/src/screens/setup/SecurityKeyArt.tsx:10-65` and `setup.css:1124-1152` currently render a responsive 4-key SVG outline row representing standard physical connectors (`USB-A`, `USB-C`, `NFC card`, `Lightning`) with generic form factors, marked `data-placeholder="design-to-draw"`.
- **Question for Owner:** Should X2F commission illustrated artwork of specific commercial security key models, or retain generic connector form factors?
- **Options:**
  - **Option A (Generic Connector SVG Outlines; Current):** Retain generic vector outlines representing physical interfaces (`USB-A`, `USB-C`, `NFC card`, `Lightning`), avoiding brand logos and third-party trademarks while clearly communicating how keys plug into phones and computers.
  - **Option B (Commission Commercial Hardware Illustrations):** Request design drawings of specific commercial keys (e.g., YubiKey 5 NFC, Google Titan, Nitrokey 3, Feitian ePass).
- **What each would change:** Option A requires no further assets and keeps bundle size small. Option B requires design to deliver SVG/PNG artwork assets.
