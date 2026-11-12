# Security review: `wip/lead-proof-code` b3d64bf1 (P-020, the encrypted fixed chat notice `proof-code-hidden`)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-pcode` at b3d64bf1 (base main 6ebed537), fresh `npm ci`, removed afterwards; dockerd not restarted.
The branch is a single commit (13 files, +394/-17), all in `apps/web`: `chat/notices.ts`, `chatCrypto`, the engine, `serve` and `client`, ChatPanel and its CSS, and `proof/uploaderChecks.ts`. It is unwired: nothing calls `sendNotice` until Plan 5 Task 15.

## Verdict: PASS. 0 Major, 0 Minor, 3 Info (N1-N3)

## The questions

**Readers refuse altered words, unknown notices, extra keys, notices bundled with payment details, and moderator-signed notices.** `openChatMessage` accepts a notice only when all of these hold:
- the payload has exactly two own keys, `text` and `notice`. Three keys (`text`, `notice`, `pay`) are neither "packaged" (two keys with `pay`) nor "noticed", so they are refused, and so is any extra key;
- `notice` is an *own* key of `CHAT_NOTICES` (`hasOwnProperty`, so `toString` and `__proto__` are refused, as are non-strings);
- `text`, after the ordinary `checkChatText`, is exactly `CHAT_NOTICES[id]`. A trailing space is refused (tested);
- the signer is not `mod`. A moderator-signed notice outside a dispute first meets `mod-not-allowed` (retried later); inside one, it is `bad-message`.

On success the message carries the reader's *own* copy of the wording, never the sender's string. Each case is in `chatNotice.test.ts`, including a lying text under the right notice id.

**A refused notice doesn't move the replay guard.** `openChatMessage` advances its guard on a local `ReplayGuard` and returns the new guard only on success; the engine assigns `state = r.state` only after that.
- A refused notice becomes a `refused` receipt, and the cursor passes it.
- The guard stays where it was, so the sender's seq stays free (tested: the refused seq 0 then opens as the real notice on the same state).
- The cold re-read (`reopen`) goes through the same `openChatMessage` checks.

**sendNotice is refused before the trade is secured.** `sendNotice` calls `post(chat, sealChatNotice, true)`, the same `secured` path as payment details: `not-ready` unless the chat is `ready` and `view.tradeSecuredAt !== null`, before anything is sealed or posted (tested). The worker refuses an unknown `notice` with `refused` before it reaches the engine (tested). `sealChatNotice` refuses an unknown notice, or any role but buyer or seller.

**Nothing lets the notice spoof the moderator style.**
- The moderator's violet is tied to `data-from="mod"` and `x2f-chat__who`.
- A notice line keeps the real sender's `data-from` and name, adds `data-notice`, and renders in `x2f-chat__autonotice` (muted, italic, never `--x2f-mod`).
- A moderator can't send a notice at all (refused on seal and on open).
- The live announcement says "<sender's name>: <reader's own wording>".
- Typing the notice's words as an ordinary message gives an ordinary bubble, not a notice line.

**Tests were not weakened.** `chatEngine.test.ts` and `payDetailsFeed.test.tsx` only gained a `sendNotice` stub on their fakes. `buyerPay.test.tsx` changed one line, and ChatPanel gained a P-020 case.

## Info

- **N1. "Automated proof check" reads as X2F speaking.** The notice is only the sender's own app saying so, as `notices.ts` says. A cheating buyer on a modified client can send it with a proof that never had a code, to explain the code away under a label that sounds official. The seller's card runs its own check and trusts none of this (uploaderChecks), so nothing decides on it. But the wording is COPY-UNSIGNED, and I would have design attribute it, along the lines of "From <name>'s app: their blur covered the trade code in this proof."
- **N2. The notice is not bound to a proof.** It says "this proof" but names none; any trader can send the fixed words at any time, even with no proof posted. When Task 15 lands, consider carrying the `proofId` in the payload (checked with `isProofId`) and showing the notice beside that proof.
- **N3. The secured rule is enforced only on the sending side.** A modified client can post a notice before the trade is secured, and readers will show it, unlike a payment package, which they hold. That is harmless (fixed words, no details), so I'm noting it, not asking for a change.

## Tests run (serialised runner)
- web `chatNotice.test.ts`, `chatPanel.test.tsx`, `chatCrypto.test.ts`, `chatEngine.test.ts`, `payDetailsFeed.test.tsx`: 127/127 passed (5 files)

Not run: the rest of the web suite, Playwright, `npm run check`.
