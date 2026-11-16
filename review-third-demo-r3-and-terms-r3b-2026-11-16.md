# Code review: wip/third-demo-r3 (1ccbb0b9) and wip/third-terms-r3b (0866f8b7)

- Date: 2026-11-16. Reviewer: independent (claude2 helper), read-only on code.
- Against: origin/main 4f0afa14.
- Status: complete.

## Verdict
- wip/third-demo-r3 1ccbb0b9: CHANGES NEEDED, for one mechanical item (B1: two stale board reference shots keep the web vitest project red; inherited from lead-demo-r2, not caused here). With B1 fixed: APPROVE WITH MINORS (M1-M4).
- wip/third-terms-r3b 0866f8b7: APPROVE WITH MINORS for the code and plumbing (version, pin, e2e constants, COPY-UNSIGNED all consistent). The copy has 11 questions for the owner; Q1 (owner's appeal access no longer disclosed), Q3 (the timer paragraph says "whoever started the trade" can cancel, contradicting its own last bullet and the product) and Q9 (what is really purged at day 30) should be answered before the text is signed.

## Findings at a glance
- B1 demo-r3: serve-boards.test red, BuyMain/Main refs stale since 5faed49e.
- M1 demo-r3: tour hole snaps while the ring glides (glide lost in 86f53562).
- M2 demo-r3: signupV2.test drops the PGPony-before-OpenKeychain order check the owner asked for.
- M3 demo-r3: `method-not-allowed` (a real server refusal) marked not-a-refusal.
- M4 demo-r3 (demo tooling): any LAN client can claim the adopted RP ID first via Host/X-Forwarded-Host.
- I1-I4, I6 demo-r3; I5 terms-r3b (stale mocked version in owner-copy.spec).
- Terms note mapping: 21 notes: 18 applied (d1156603 merged with the draft, as 5cde3ea7 asked), 3 changed (1c176a20, 7db61414, 0b68b013), 0 missing; one kept item dropped (9cdeeb48 owner-access sentence, Q1); Part 2 Q1-Q11 for the owner.

## Scope
- Part 1: origin/wip/third-demo-r3 1ccbb0b9 (== wip/third-demo-r3-fix; did not move at fetch 16 Nov).
  - main..1ccbb0b9 carries lead-demo-r2 3190919d (demo round 2), wip/third-signup-r3 90972d6e (separate security review by second) and terms-r3b 0866f8b7 (part 2). This part reviews what is only on demo-r3: `git log 1ccbb0b9 ^90972d6e ^0866f8b7` = 20 commits (4 seckey-fix commits 8acc3388..fe6765c7, the 2 merges, 14 fix/test commits bde163cd..1ccbb0b9).
- Part 2: origin/wip/third-terms-r3b 0866f8b7. One commit on lead-demo-r2 3190919d (the rest of main..0866f8b7 is demo round 2, out of scope here).

# Part 1: wip/third-demo-r3 1ccbb0b9

## Findings

### M1. The tour's hole no longer glides between stops; the ring does, so for 250 ms the ring and the hole are apart
- `apps/web/src/tour/TourProvider.tsx:458` (`<path className="x2f-tour__dim" d={dimPath(...)}>`), `apps/web/src/tour/tour.css:204-216` (the `.x2f-tour__hole` transition and in/out animation rules were deleted; `.x2f-tour__ring` keeps `transition: x y width height 250ms`).
- fdd02939's message says its stroke version kept "the hole still glides between targets"; 86f53562 replaced the stroke with a `d` attribute that has no transition, and its message does not mention that the glide is gone. Before this branch the hole (a mask rect) moved with the same 250 ms transition as the ring and faded in/out with it.
- Scenario: on Next, the cut-out jumps to the new target at once while the 2 px ring travels there over 250 ms, so the ring crosses dimmed screen and the new target is lit before the ring arrives; on the 'out' phase the ring fades but the hole stays cut. Visible on every stop change for users without reduced motion.
- Fix (pick one, designer to confirm): set the path through CSS, `style={{ d: \`path("${dimPath(...)}")\` }}` with `transition: d 250ms var(--x2f-tour-ease-out)` inside the same no-preference block (no `url()`, so the proof tripwire still passes; Chromium and Firefox animate `d`, Safari snaps, which is today's behaviour anyway); or tween the hole rect in the existing rAF; or record "hole snaps, ring glides" as a DESIGNER-REVIEW change in the commit and design notes.

### M2. signupV2.test drops the PGPony-before-OpenKeychain order check, which still holds and which the owner asked for
- `apps/web/test/signupV2.test.tsx:117-125` (65bfd45c): removed `expect(t.lastIndexOf('PGPony')).toBeLessThan(t.lastIndexOf('OpenKeychain'))` and `/recommend PGP/i`, added `toContain('on Android PGPony (we recommend it')`.
- The owner's note e6d8122c (13 Nov, /setup/login): "recommend PGPony as the recommended Android app. You can recommend openkeychain as well but please definitely the other one first". The new text still puts PGPony before OpenKeychain, so the order assertion would pass unchanged; removing it is a loosening with no behaviour change behind it. The e2e signup-v2.spec:174 check was rewritten the same way (it pins a phrase, which does keep the order inside the phrase, so that one is fine).
- Scenario: a later copy edit moves OpenKeychain ahead of PGPony on Android ("OpenKeychain or PGPony (we recommend it ...)") with the phrase edited to match; no test notices, against the owner's explicit note.
- Fix: keep the `lastIndexOf` order assertion next to the new `toContain`.
- Source of "owner, 16 Nov" (commit 65bfd45c, the parity exception at `e2e/parity.ts:274`): not found in origin/comms (owner-answers-register, owner-decisions, to-third.log, to-lead.log have no PGPony entry). See Q1.

### M3. A real server refusal is marked not-a-refusal: `method-not-allowed` in keyErrors.ts
- `apps/web/src/screens/auth/keyErrors.ts:61` (bde163cd) puts `// not-a-refusal: why a key step failed` on `if (code === 'method-not-allowed') return KEY_ERROR.notAccepted;`. `method-not-allowed` is the API's 403 refusal (staff and owner key-model allowlist, `apps/api/src/auth/webauthn.ts` `verifyRegistration`), shown inline as "This key model isn't accepted yet." It is exactly what copy-lint's "every refusal goes through CantDoThat" rule is for; the other four pragmas on this file (framed, wrongAddress, noAlgorithm, unsupported) are browser faults and fit the pragma.
- The ceiling is exact, not padded: I counted with `tools/copy-lint.ts countPragmas` over apps/web/src at 1ccbb0b9 = 74 (keyErrors.ts 5), so the 67 -> 74 bump matches the pragmas present. The question is only whether this one should be a not-a-refusal.
- Scenario: staff and owner refusals of a key model escape the CantDoThat review, and the ratchet now counts a refusal as an explanation, so moving it later lowers nothing visible.
- Fix: mark it `cant-do-that-todo` (a refusal still shown inline; the todo count is already at its ceiling of 4, so that needs a reviewed raise) or, better, route `method-not-allowed` through `refusalText`/CantDoThat with a `cantDoCodes.ts` entry; ceiling back to 73. Lead call.

### M4. Demo gateway: any client that reaches it can claim the adopted RP ID first, for good
- `tools/demo/rp-adopt.ts:55-66` with `tools/demo/gateway-core.ts:214,239,269` and `tools/demo/self-origin.ts:62-67` (seckey-fix b444794c, on demo-r3). The gateway binds 0.0.0.0 (`gateway.ts:6,92`), DEMO_ADOPT_SELF defaults to 1 (`demo.ts:224`), the self origin comes from `X-Forwarded-Host` or `Host` as sent by the client, and any non-loopback host counts as https. The first `GET` with `Accept: text/html` from such a host restarts the API with that host as `X2F_RP_ID`, adds `https://<host>` to `X2F_ORIGINS`, and is kept ("a later one does not move it again").
- Scenario: another device on the LAN (or a scanner) sends `GET / Host: mybox.local Accept: text/html` before the owner opens the preview pane: the API restarts, the RP ID is `mybox.local`, and the owner's preview-pane host can never make a key again until the demo is restarted. A crafted name also lands in X2F_ORIGINS.
- Demo tooling only (fake money), so minor. Fix: adopt only a host that matches an expected preview pattern or `DEMO_ADOPT_HOST`, or only from a loopback peer (the preview pane's forwarder), and ignore `X-Forwarded-*` unless the peer is loopback.

### B1. The web vitest project is red on 1ccbb0b9: two board reference shots are stale
- `apps/web/test/serve-boards.test.ts:90` fails: "BuyMain: board changed since refs/BuyMain.png was captured", "Main: board changed since refs/Main.png was captured".
- Cause: 5faed49e (no-russia, merged into lead-demo-r2) removed 3 lines from design/x2f-app/BuyMain.dc.html and Main.dc.html without recapturing `refs/` and `refs/manifest.json`. Checked the hashes: fine on main 4f0afa14, stale on lead-demo-r2 3190919d and on 1ccbb0b9. Not caused by this branch, but demo-r3's job was to make the merged tree green (it fixed seven other inherited tripwires) and this one is left.
- Scenario: `npm run check` / the full vitest gate fails on the demo-r3 tree; anyone landing it from here gets a red web project.
- Fix: recapture the two refs with tools/parity/capture-refs.ts (apps/web/src/ui/README.md) and commit the PNGs and manifest entries.

### I1. bundle.test's satoshi_ghost exception is exact and fails safe
- `apps/web/test/bundle.test.ts:13-31`. Allows exactly FirstTradeStage.tsx's code occurrences (15; comment-start lines skipped). mira.k and "fixture" stay at 0. If the minifier ever folds repeated strings the count drops and the test fails (fragile in the safe direction). Fine. The name itself is a product question (Q2).

### I2. Test changes checked and justified by real behaviour (no loosening found besides M2)
- `loginApproveV2.test.tsx:76-78`: tokens.json has sheet-title 26/32 and screen-title 30/34 since b8489a7b (owner layout); the test was stale.
- `apps/api/test/webauthn.test.ts:578-600`: one trader per key because sign-up v2 (review M1(b)) lets the sign-up window add a first key only; the tested property (any model, attested or not, stored `attested: false`) is unchanged and still checked for all four keys.
- `packages/trade/test/payFields.test.ts:279`: 62 -> 60 is SBP and MIR, removed with Russia (5faed49e).
- `packages/auth-client/test/flows.test.ts:73`: `GET /v1/trades` is the web app's My trades (D-005), called from screens/trades/api.ts.
- `apps/web/test/selection-ink.test.ts:87-92`: three new orange allowances (welcome ring, tour pretend primary/hold, scan line) are the design 12 Nov drawings; designer to confirm, as with every ORANGE_ALLOWED entry.
- `e2e/parity.spec.ts:281-292`: the `{{…}}` pattern test moved from SetupBackup "Add {{choice}}" (now a known exception, lead call 12 Nov, parity.ts:171) to BadgeSettings "Featured {{featuredCount}} of 2" (present in design/x2f-app/BadgeSettings.dc.html); it still proves both the miss and the fill.
- `e2e/parity.ts:255-276`: both new exceptions are real changes: PgpKey.tsx:120 title "Adding your public PGP key" (signup-r3 spec line 30) and PgpChallenge.tsx:155 names PGPony. The boards are not updated yet (design debt, not a test problem).
- `e2e/team.spec.ts:248-256`: the fresh phone gets the same `x2f.welcome.seen` storageState the config gives every other spec (WELCOME_SEEN_KEY, welcomeSeen.ts:6); origin LOCAL matches the spec's own localhost base. Justified: the welcome screen is once per device and tour.spec covers it.
- `tools/demo/secrets.ts:60`: `subkeys: []` makes the demo PGP key signing-only, matching the API's sign-up v2 refusal of an encrypting signing key.

### I3. Phone min-height (1ccbb0b9) is correct where there is no header
- `ui.css:567` subtracts `var(--x2f-shell-header, 0px)`, which is only set on a phone shell body that has `.x2f-screen-header` (`ui.css:2724`), so screens without the header keep the old height. Same pattern as setup.css:14, Wallets.css:11, trade.css:27,42.

### I6. The 67 -> 74 ceiling reason misattributes three of the seven
- `apps/web/test/cantDoThat-lint.test.ts:154-155` says "five lines in keyErrors.ts, and two from the sign-up round-3 and Terms merges". Measured with countPragmas: lead-demo-r2 3190919d (= terms-r3b, which changes no pragma) is already at 70, three over its own ceiling of 67 (that is one of the 8 failures on terms-r3b, below); signup-r3's merge is net -1; keyErrors.ts +5; total 74. The count is right, the history in the comment is not. Fix: "67 -> 70 lead-demo-r2 (tour and layout: name them), 70 -> 69 sign-up round 3, 69 -> 74 keyErrors.ts".

### I4. tools/test/demo-rp-adopt.test.ts:28 `void restarts.push(o) ?? new Promise(...)`
- Vite warns "will always return the right operand". It works (void gives undefined), but reads like a bug; `(restarts.push(o), new Promise(...))` or a block body says what it means.

## Part 1 questions for the owner (via the lead)
- Q1 (copy source): 65bfd45c and the parity exception cite "owner, 16 Nov" for "PGPony is the recommendation for Android (it need not come first overall)". I found no record of it in origin/comms; the last written word is e6d8122c (13 Nov): "definitely the other one [PGPony] first". The new text keeps PGPony ahead of OpenKeychain on Android, so it fits both. Recommend the lead records the 16 Nov instruction in owner-answers-register.md so the copy has a source.
- Q2 (product): the tour's pretend trade is with "satoshi_ghost" ("Vendor", "Your review shows on satoshi_ghost's profile straight away", FirstTradeStage.tsx:58,440). The name is not reserved (packages/accounts/src/username.ts:62 RESERVED_TOKENS), so a real trader can register it and every new user's tour then shows a real account as a trusted vendor. Recommend reserving it (or using a name that cannot be registered, for example one with "x2f" in it, which is reserved).
- Q3 (design): M1, hole snaps while the ring glides; keep the glide (recommended) or accept the snap.

## Part 1 test results (worktree /home/user/wt/rv-demo at 1ccbb0b9, node 24.22.1, npm ci clean)
- `tsc -p apps/web --noEmit`: 0 errors.
- Branch's own vitest files (10 files: web bundle, cantDoThat-lint, loginApproveV2, selection-ink, signupV2, keyErrors; auth-client flows; trade payFields; tools demo-rp-adopt; api webauthn with its Postgres container): 10 files, 147 passed, 0 failed.
- Full `@x2f/web` vitest project: 151 files, 2210 passed, 1 failed (serve-boards stale refs, B1).
- Full Playwright web suite (`--workers=1`, chromium 1243): 566 passed, 0 failed, 52 skipped (design-shots.spec runs only with X2F_DESIGN_SHOTS=1; refund.spec skips when its reference PNG is absent). The touched/asked specs again on their own (fold, tour, shell, setup, parity, team, signup-v2): 172 passed, 0 failed, 0 skipped.
- Pragma count (my probe, tools/copy-lint countPragmas over apps/web/src): not-a-refusal 74, todo 4.
- Not run: the full API project (only webauthn.test.ts, the one API file the branch changes); Monero regtest/escrow/node-proxy (downloads.getmonero.org blocked here); semgrep.

# Part 2: wip/third-terms-r3b 0866f8b7

One commit on lead-demo-r2 3190919d (the demo text the owner was reading: TERMS_TEXT_VERSION 2026-11-12, a467c7e7, merged into the demo 12 Nov 13:49 UTC; his notes are 22:18-23:25 UTC the same day). 11 files: termsText.ts, Terms.tsx, new TermsParagraphs.tsx, setup.css, staff-web TermsStep.tsx and kit.ts, parity.ts, setup.spec.ts, signup-v2.spec.ts, task28-units.test.tsx, termsSignature.test.tsx.

## Owner note -> applied / changed / missing

The 21 notes: the 20 with `dataScreen: "setup-terms"` plus 5cde3ea7 (no screen; it quotes section 1). CSS `section:nth-of-type(N) > p:nth-of-type(M)` = section N, paragraph M of the 2026-11-12 text (mapping rule from terms-draft-2026-11-12.md; checked against 3190919d).

| Note | Where (12 Nov text) | Result | Notes |
|---|---|---|---|
| d1156603 | s1 p1 | applied, merged | His opening, tidied ("let's" -> "lets", "&" -> "and"). "the payment method that suits them" became "cash, bank transfers or the payment app that suits them" (the draft's list folded in). Q5. |
| 5cde3ea7 | s1 p1 | applied | "Marry them without overlap": the draft's facilitator / not a party / not a bank / never holds your coins are all kept, no sentence repeated. |
| 2b956e27 | s2 p1 | applied | Word for word, commas added. |
| ce105e5c | s2 p2 | applied | Word for word. Replaces "Keep your login method and any backup safe". |
| fa68e7c5 | s2 p2 | applied | Word for word ("protect sanctity" -> "protect the sanctity"). Its trailing "One person" is the start of p3, kept. "Reset them" now follows "account age and reputation", so "them" reads as the age and reputation, not the login details. Q6. |
| ee588531 | s3 p2 | applied | "vendors" -> "vendor's"; "take advantage of" -> "taken advantage of". The old "other trader's terms" becomes "the vendor's terms". Q7. |
| a4288e0b | s3 p3 | applied | Word for word from "instantly undone". Lawyer flag: "funds recovered" is a promise (Q10). |
| e76c0661 | s3 p5 | applied | "through that payment method" -> "using the payment method requested". |
| e32651c6 | s3 p5 | applied, see Q3 | His cancel sentence replaces "the seller can cancel the trade, and the refund of all the escrowed XMR to the seller's wallet starts at once"; his three points are bullets. Factual conflict, Q3. |
| 77b566e9 | s3 p5 | applied | The late-buyer sentence is the 4th bullet, as asked ("in bullet form to my previous comment"). |
| a3926f51 | s4 p1 | applied | "Whoever posts the ad pays is responsible" -> "Whoever posts the ad is responsible" (the stray "pays" dropped). "We don't get paid unless you both do" kept. |
| 1c176a20 | s4 p1 | changed | "Responding to someone else's ad is always free. You are a trader or a vendor." became one sentence "..., whether you are a trader or a vendor." Reasonable reading of a fragment; owner to confirm (Q8). |
| 7db61414 | s5 p2 | changed | His appeal sentence replaces "If the decision is appealed, a senior moderator or X2F's owner can see the same." "Decide the final binding decision" -> "make the final, binding decision", and the branch adds ", with the same access". The disclosure that X2F's owner can see the chat on appeal is gone. Q1. |
| 10359141 | s5 p2 | applied | Word for word. |
| 3cee4166 | s5 p2 | applied | Word for word. Lawyer Q-10 of 12 Nov now applies more strongly (Q10). |
| 433a045c | s5 p3 | applied | His sentence replaces 358d1d75's paragraph, as he said ("we really only need to say here"). Dropped with it: "within the time shown with the decision" and "who had no part in the first decision" (R37). Q2. |
| 32f73419 | s6 p1 | applied | His 30/90 wording ("90 day mark" -> "90-day mark"). It replaces p1's "X2F keeps only what a trade needs, and deletes it after a set time (below)." Q4 (scope of "keep all of this"), Q9 (what is purged). |
| 32cc5284 | s6 p1 | applied | "X2F does not track you, does not use analytics and removes location and device details from uploads." kept word for word. |
| ada78b2b | s6 p3 | applied | The old 30/90 paragraph is removed. |
| 952db275 | s7 p1 | applied | "a government" -> "a government agency". Board sentence, so a parity exception was added (parity.ts:212-215, why given). |
| 0b68b013 | s9 p2 | changed (a question was answered by the branch) | He asked "Should the word terms be capitalized?" on s9 p2, which already says "these Terms". The branch capitalised "Terms" in the two intros (Terms.tsx:247, staff TermsStep.tsx:102) and left the body as is. Q11. |

Kept from the 12 Nov round (checked one by one against a467c7e7's comments): 9fe3fa43 (names), 4e04a245 (team members), e79231ba (escrow), ca2b6a83 (disputed), aaf06c2f (screenshot), 7a830826 (timers, the 2-hour example), p11-18 late-buyer sentence (now a bullet), 10475770 (fee, "Very simple."), d1c8cb70 (dispute opening), d1a46566 (tracking sentence). Not kept: 9cdeeb48's owner-access sentence (Q1) and 358d1d75's paragraph (replaced as he asked; Q2). KEY_POINTS, TERMS_DRAFT_NOTE, sections 8 and 9: unchanged.

## Version, hash and signature plumbing

- `TERMS_TEXT_VERSION` 2026-11-12 -> 2026-11-14 (termsText.ts:20) with a dated comment and COPY-UNSIGNED.
- `termsSignature.test.tsx:197` pin: version 2026-11-14 with a new sha256; checked by running it (below). The new bullets test (`:205-219`) checks one list, right after the timer paragraph, 4 items, the late-buyer sentence last.
- e2e: `setup.spec.ts:40` and `signup-v2.spec.ts:13` now 2026-11-14. signup-v2.spec was still on 2026-11-09 at 3190919d, so this also fixes a stale constant.
- Server: `X2F_TERMS_VERSION` is required config (apps/api/src/config.ts:225); the demo sets it from TERMS_TEXT_VERSION (tools/demo/demo.ts:174), so the demo cannot drift. Production must set it on deploy (stated in the commit).
- Staff invite: staff-web takes the same TERMS and TERMS_TEXT_VERSION from the trader app (kit.ts:30) and the same TermsParagraphs, so staff sign the same text.
- I5: `apps/web/e2e/owner-copy.spec.ts:19` still mocks `/v1/terms` as 2026-11-09. Harmless (that spec never opens the Terms), but it is the one stale version string left.
- COPY-UNSIGNED: on the version comment and on every changed paragraph (termsText.ts:63,71,73,86,88,94 (the timer block, lines 94-98, one comment), 113,124,127,135), and on the intro (Terms.tsx:246). The staff intro's existing COPY-UNSIGNED covers its edit.
- Layout: `.x2f-terms__bullets` uses the paragraphs' muted ink, a 20 px indent and 8 px under the list; no global list reset applies, so the markers show. Nothing in the text is wider than the box (setup.spec phone checks, below).

## Questions for the owner (via the lead)

Wording is the owner's; each is a question with a recommendation, not a rewrite.

- Q1 (privacy, s5 p2, note 7db61414): the 12 Nov text said "If the decision is appealed, a senior moderator or X2F's owner can see the same" (p11-2; the 12 Nov draft's Q-9 recommended keeping it for honest disclosure). His new appeal sentence replaced it, and the branch's ", with the same access" covers the senior moderator only. Should the Terms still say that X2F's owner can see the chat on appeal? Recommend yes: "... a senior moderator or X2F's owner will make the final, binding decision, with the same access", or whichever he prefers, since the owner can see it in fact.
- Q2 (s5 p3, note 433a045c): his shorter paragraph drops two facts from the 12 Nov text: the appeal must come within the time shown with the decision, and the senior moderator had no part in the first decision (R37). Keep them? Recommend yes, one clause each, in his appeal sentence in p2.
- Q3 (accuracy, s3 p5, note e32651c6): "whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account". In the product only the seller funds the escrow and only the seller gets the refund (the trade machine; s3 p3 "Only the seller funds the escrow"; the 4th bullet "If you paid late and the seller cancels"). The trade is "started" by whoever takes the ad, who can be the buyer. And the refund goes to the seller's own wallet, not "their account" (s1: X2F "never holds your coins"). Recommend: "If the allotted time has run out, the seller can immediately cancel and the funds in escrow go back to the seller's own wallet." The paragraph now contradicts its own last bullet, so this one matters most.
- Q4 (s6 p1, note 32cc5284 "Keep all of this"): did "all of this" mean the whole first paragraph, including "X2F keeps only what a trade needs"? The branch kept only the tracking sentence. Recommend keeping "X2F keeps only what a trade needs." (a data-minimisation promise), without "(below)".
- Q5 (s1, d1156603): his "the payment method that suits them" is now "cash, bank transfers or the payment app that suits them" (the draft's list). OK, or his "payment method"? Recommend his "payment method", since cash is not an app.
- Q6 (s2 p2): after his new sentences, "X2F has no way to reset them for you" follows "your account age and reputation are irreplaceable", so "them" reads as age and reputation. Recommend "X2F has no way to reset your login details for you".
- Q7 (s3 p2, ee588531): "the vendor's terms". Anyone can post an ad, and in X2F "vendor" is a status. Should it say "the ad poster's terms" or "the other trader's terms" (the old words), or does he mean vendor here? Recommend "the other trader's terms".
- Q8 (s4 p1, 1c176a20): "whether you are a trader or a vendor" is the branch's reading of his "You are a trader or a vendor." Confirm.
- Q9 (privacy accuracy, s6 p1, 32f73419): "after which the entirety of the trade is purged" and "At the 90-day mark it is all purged, no exceptions". The code deletes the chat at 30 days (90 after a dispute closes, `apps/api/src/chat/retention.ts:8`), but the trade row stays and its payout and refund addresses are kept 90 days (`apps/api/src/trades/purge.ts:5,11`) for every closed trade. The chat clock also runs from when the dispute closes, while his text says "90 days after completion". The 12 Nov text overclaimed too ("erases it for good"), but "the entirety" is stronger. Recommend the lead says what really goes at day 30 and 90 and either the code or the text is brought into line before the Terms are signed off; lawyer to check.
- Q10 (lawyer): "it can be disputed and the funds recovered, to the best of our abilities" (s3 p3) and "the same as though the trade never happened to begin with" (s5 p2) read as promises; 12 Nov Q-10 already flagged the second.
- Q11 (0b68b013): his question about capitalising "terms" was answered by the branch, which capitalised it in both intros. Send it to him as an answer ("we capitalised Terms where it names this document; OK?") rather than treat it as decided.

## Part 2 test results (worktree /home/user/wt/rv-terms at 0866f8b7, node 24.22.1, npm ci clean)
- `tsc -p apps/web --noEmit`: 0 errors; `tsc -p apps/staff-web --noEmit`: 0 errors.
- Branch's own vitest files: termsSignature.test.tsx and task28-units.test.tsx: 2 files, 36 passed, 0 failed (the 2026-11-14 pin's sha256 matches the text).
- `@x2f/staff-web` project (uses the same text and TermsParagraphs): 5 files, 52 passed.
- `@x2f/web` project: 139 files, 2110 passed, 8 failed (7 files). All 8 are inherited from lead-demo-r2 3190919d and are in files this commit does not touch: bundle.test x2 (tour's satoshi_ghost), cantDoThat-lint (70 > 67), kit-tokens (scan-line glow), loginApproveV2 (title sizes), proof-render-tripwire (mask url()), selection-ink (tour orange), serve-boards (B1). demo-r3 fixes the first seven on top of this commit; terms-r3b is not meant to land alone.
- Playwright (`--workers=1`): setup.spec, signup-v2.spec, quote.spec (the other spec that opens SetupTerms), shell.spec, fold.spec: 120 passed, 0 failed, 1 skipped (fold.spec:319, folded posture, skipped by its own guard when this Chromium does not report the posture; it passed in the demo-r3 run). On demo-r3, which carries this text, the full suite also passed (Part 1).
- Not run: API project (the commit touches no API code; X2F_TERMS_VERSION is config), Monero projects (downloads.getmonero.org blocked), semgrep.

Worktrees /home/user/wt/rv-demo and /home/user/wt/rv-terms were removed after the runs. Nothing was committed or pushed.
