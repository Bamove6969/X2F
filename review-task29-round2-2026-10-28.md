# Re-review: Plan 3 Task 29 (Your wallets), fix round, wip/t3-p3-task29 @19fd56e. APPROVED (minors below), 2026-10-28

Reviewer: lead's helper (read-only). Original: docs/superpowers/reviews/2026-10-26-p3-task29.md.

## Verification run
Scratch worktree: main line 9123b4f, then T29 @19fd56e merged (clean), then T28 @b7e27c5 merged (one App.tsx conflict, resolved as below). On that combined tree:
- `tsc -p apps/web --noEmit`: clean.
- vitest `test/wallets.test.tsx test/wallets-model.test.ts test/app-routes.test.ts`: 3 files, 11/11 pass.
- playwright `wallets.spec.ts` (Chromium, 390x844): 15/15 pass. Parity pixels for Wallet: 26.37%, reported but not blocking.
- Worktree removed afterwards.

## Findings from round 1
1. **I1 (?add=1 loop): fixed.** Wallets.tsx:311-314 goes to returnTo only when `saved.every(w => w.usable)`. Otherwise the screen stays and shows the "can be paid from …" notice (321-328) and the Waiting row, and Back goes to returnTo (353). There is a vitest for each branch (wallets.test.tsx:170, :192). On the take side, plan line 665 says BuyQuote shows "Add a wallet" when no wallet is usable. So Back lands on a quote that waits for a tap and does not call the take again: no loop.
2. **I2 (two primaries): fixed.** `<ConfirmOpenProvider value={confirmOpen || popup}>` wraps WalletsFoot, and WalletsFoot uses `usePrimaryVariant()` (198-213). RulePopup's Continue and ConfirmSheet's Confirm are then the only `[data-primary]`. The test at wallets.test.tsx:204 walks list → popup → form → confirm and asserts exactly one primary in each state. A11y: Sheet is `role=dialog aria-modal=true`, traps focus and gives focus back to Save on close, so the footer stepping down never leaves keyboard users without the sheet's primary.
3/5/6/9: recorded as follow-ups in coordination.md (a70ae53), wording accurate.
4. **Fixed.** wallets-model.ts re-exports MAX_WALLET_BATCH from @x2f/auth-client. apps/web/package.json and package-lock.json are identical to the main line (no @x2f/accounts).
7. **Fixed.** The QR button is gone (comment at 469). There is a test (wallets.test.tsx:221).
8. **Fixed.** Wallets.css: `height: 100dvh` and `__main { min-height:0; overflow-y:auto }`. The e2e at :356 checks that Save stays in 844 px and the document does not scroll.
10. **Fixed.** The stub and its tripwire are gone. Adding goes through `withConfirm(walletsAction(addresses), post, prove)` with Task 30's real ConfirmSheet.

## Wallet-address safety (checked)
- **Token bound to the exact list.**
  - The client computes `walletsAction(drafts.map(d => d.address))` once, and `post` reuses the same `drafts` array for both requests (Wallets.tsx:291-307). Editing the form while the sheet is open cannot change what gets sent.
  - The server recomputes `addressesHash` from the trimmed, ordered list it has validated (routes.ts checkWalletInput) and redeems the token against exactly that action, inside the insert transaction.
  - Order, membership and count are all in the hash (auth-client confirm.test.ts:121-125). Trimming is the same on both sides.
  - The client always sends `{ wallets: [...] }`, so the server always asks for `add-wallets`. withConfirm refuses to prove a different kind.
- **A swap by the server or by XSS.**
  - The sheet shows `describeAction(action)`, which carries the address ends from the client's own list. A different list needs a new proof.
  - Same-origin XSS or a hostile server is outside what the client can defend, as before. One optional hardening, not required: compare `saved[i].address` with `drafts[i].address` and show an alert on a mismatch.
- **Device-side address validation.** Still missing (follow-up 3, recorded). The server validates network and integrated-ness.
- **returnTo.** Always passes through `safeReturnTo` (client.ts:69-81): same-origin path only, no `//`, no `\`, no control characters, bounded length. No open redirect.
- **24-hour wait rule.**
  - The server matches spec 6.3 "Wallet rules refined" and HANDOFF: the first wallets never wait; later ones wait 24 h unless confirmed with PGP, a passkey or a security key; a batch shares one `usable_from`.
  - The client wording (ruleLines/ruleNote) and the shared-wait notice match. The e2e covers the shared clock (:308).

## Main-line merges
- d2dc0d9 and 19fd56e: the App.tsx diff against the main line is only the Wallets import and `/wallets → <Wallets />`. Package files are back to the main line.
- edfb3b9 brings in 73f7e70 (the Task 15 parity fix), which T28 also carries. It merges cleanly.

## Task 28 App.tsx clash: the described resolution is right
- Thanks to 0cdf231 the imports now auto-merge.
- The only conflict is the three-line route block. The correct result is:
  ```
  <Route path="/wallets" element={<Wallets />} />
  <Route path="/setup/*" element={<SetupFlow />} />
  <Route path="/terms" element={<Terms />} />
  ```
  That is T29's /wallets line and T28's /setup and /terms lines.
- Verified: tsc clean, app-routes test green, the wallets e2e green on that result.
- No other file conflicts. parity.ts and coordination.md auto-merge.

## Minor (do not block)
- **M1. Refusals shown as "Check the addresses and try again".** Wallets.tsx:37-44 (addError) turns every other refusal into that sentence.
  - Scenario 1: a backup-login (recovery) session taps Save. The API answers 403 `recovery-session` before any confirm (routes.ts walletConfirm), and the user is told to check addresses they typed correctly.
  - Scenario 2: the token expires between the sheet and the retry (`confirm-invalid`): same sentence.
  - Fix: route through Task 30's `refusalText(e, fallback)` and add sentences for `recovery-session` and `confirm-invalid`.
- **M2. Coming back via ?add=1 opens the popup again.** Wallets.tsx:223 (`popup = addMode`). After a waiting save, tapping Back and then Trade on the quote leads to `/wallets?add=1` again: the popup opens over the Waiting row and the "can be paid from" notice is gone. Suggestion: in addMode, when every wallet is waiting and none is usable, show the wait notice instead of opening the popup. UX only.
- **M3. Parity check weakened (Task 15 owners).** parity.ts:276-286 (merged 73f7e70) dropped the right and bottom bounds. Text moved off the right edge, or clipped inside a non-scrolling `overflow:hidden` box, now counts as shown. This is acceptable for the inner-scroller case but looser than before. Belongs to Task 15, not T29.
- **M4. ?add=1 navigation adds a history entry.** Wallets.tsx:312 uses `navigate(returnTo)` without `replace`, so after a usable add the browser Back returns to the Add-a-wallet popup. Use `{ replace: true }`.
