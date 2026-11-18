# Re-review 5: wip/lead-mod-chat @978d1b2b (the merge of main 5c937ab9, train-1 proofs; decision 16), 18 Nov 2026

This follows `re-review-4` (APPROVE at 18a41386). New since then:
- d82fa080: the chat.spec stub, test only;
- 95cb5393: the merge of main 5c937ab9;
- 978d1b2b: the proof.spec stub, test only.

I read it in a detached scratch worktree and changed no code.

## Verdict: CHANGES NEEDED (one red test from the merge; the security design holds)

Decision 16 (option i) is sound as built, and the merge kept every guard on both sides. One API test is red at this head: B1, a single comment line. Fix that and this is APPROVE WITH MINORS (m1, m2).

## B1. A red test: the merge put back a marker the branch's own test forbids

- File: `apps/api/src/disputes/staffRoutes.ts:638`.
- The conflict resolution took main's comment `// NEEDS_P4_CHAT_MEMBERSHIP (was NEEDS_P5_PROOF_ENVELOPE; proof storage landed, Task 14). OPEN (lead): …` above `proof-request`.
- `apps/api/test/disputes/staff.test.ts` › "landed (was NEEDS_P4_MOD_COUNTERSIGN) …" asserts that the file never matches `/NEEDS_P4_MOD_COUNTERSIGN|NEEDS_P4_CHAT_MEMBERSHIP|X2F_DEV_MOD_CHAT|chat-keyed/`. It fails at 978d1b2b; at 18a41386 that line was `NEEDS_P5_PROOF_ENVELOPE`.
- Failure: the runner's full suite is red, so the head cannot land.
- Fix: keep main's wording, with `NEEDS_P5_PROOF_ENVELOPE` as the marker, which is what the branch renamed the proof parts to.
- Not a security issue.

## Decision 16, checked

**API (`apps/api/src/chat/routes.ts:419-452`).**
- In a keyed chat a v1 body goes through `checkChatEnvelope` with `from` equal to the session's role. It is stored only under the chat row's `locked()` transaction, and only when an open dispute of this trade has `proof_request_side` equal to the sender's role and no v1 from that side since `proof_requested_at`.
- Every other v1 gets 400, which fails closed.
- There is still one budget take per well-formed post.
- Tests cover: no request; the wrong side; exactly one, then a second refused, then a new request allowing one more; a closed dispute.

**The race between two v1 posts for one request.**
- Both run under the chat row lock, so the second sees the first's row (`created_at >= proof_requested_at`) and gets 400. This is correct in code but has no concurrent test (m2).

**A re-opened request.**
- `proof-request` sets a new `proof_requested_at` (and clears `proof_request_sent_at`), so exactly one more v1 is allowed. A request for the other side moves the slot to that side.
- Edge (m1): `now` is read before the lock. A re-request that commits between that read and the insert lets the old post count against the new request's check, while its `created_at` predates the request. That leaves room for one more v1 for the same request.
- Impact: one extra moderator-only v1 that no trader engine opens.

**R16 for everything else (`apps/web/src/chat/engine.ts:261-292`, `:524-602`; `chatCrypto.ts:405-415`).**
- In a keyed chat the engine throws `V1InKeyedChat` for any `v === 1` before `openChatMessage`.
- With `tk` set, `openChatMessage` parses only v2 (`checkChatEnvelopeV2`, then `openChat`). The v1 `open(... allowSelf)` branch runs only in an unkeyed chat.
- `reopen` passes `tk` too. No other web path opens a chat v1: I grepped for `open(` in apps/web/src.
- A v2 `proof.unblurred` under TK is refused as "not a chat message".
- **Smuggling through the v1 slot:** a sender can seal any text with a real slot for the counterparty. The counterparty's app never opens it (the engine test "v1 text sealed with a real slot for the reader" pins this). Only a modified, colluding counterparty client could read it, and that is outside R16. Moderator-only content from the asked side is the design. The moderator reader, once built, must decide the type (decision 16, item 4).
- **Getting the other trader to do work (`v1SignedBy`, `engine.ts:286`):**
  - It calls Plan 1's `open` with `myRole: from` and no `allowSelf`.
  - `envelope.ts:395-428` checks shape, trade and participant, verifies the Ed25519 signature, and then throws `not-for-me` at line 428 before any `crypto_box_open`.
  - Line 435's `not-for-me` cannot be reached, because `from === myRole` always.
  - The cost is one signature check over at most 16 KiB. The reader learns only whether the sender's own signature verifies, which is public.
- **Forging "away":**
  - It needs `h.from === e.senderRole`, a trader role, an open dispute in the API's view, and a valid signature by that trader's attested key. So no one can make an away receipt for the other trader.
  - A compromised API replaying the sender's own old v1 under a new id makes a second away receipt. It shows nothing, and `lastSeq` takes the max, so there is no gap confusion. INFO.
  - A trader's own away receipt only takes a seq.

**`proof.attached` as v2.** `sealProofAttached` runs `parseProofPayload` and "only the buyer sends a payment proof". It fails closed if `PROOF_RECIPIENTS['proof.attached']` is not exactly buyer, seller and mod. The reader's kind rules (`chatCrypto.ts:432-433`) are byte-for-byte main's.

## The merge kept both sides

- **Train-1 proof code:** `packages/proof`, `apps/api/src/proofs` and `apps/web/src/proof` are identical to main 5c937ab9. The chat-side proof checks (parse, buyer-only proof, evidence only in a dispute, seller proof refused) are as on main.
- **Mod-chat:**
  - `apps/staff-web/src/keys`, `src/chat`, `apps/moderation/src/internal`, `staff/devices.ts`, `ModCase.tsx`, `DeviceCard.tsx` and `vite.config.ts` are unchanged by the merge.
  - The gate's only merge changes are main's `requireUserVerification: true` in `verify.ts` and `registry.ts`. That is stricter, and identical to main.
  - The webauthnTripwire list is the union of main's three owner screens and the branch's `ui/DeviceCard.tsx`.
- **CSP:** STAFF_CSP is unchanged from 18a41386: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. `staff/web.ts` only adds the `/staff` page route from main.

## Minors

- **m1. `apps/api/src/chat/routes.ts:431` (the `now` taken before `locked`).** See "A re-opened request" above. Fix: take `now` inside the locked callback, or compare against `clock_timestamp()` in SQL.
- **m2. `apps/api/test/chatGrant.test.ts:483` ff.: no concurrent test.** Add `Promise.all` of two v1 posts for one request, expecting exactly one 201 and one 400.

## Tests (nice, no lock; Playwright under the lock)

| Suite | Files | Result |
|---|---|---|
| web: chat*, disputeGrant, proofStackSeams, proofUpload, proof-render-tripwire, dispute-tripwires | 17 | 363 passed |
| staff-web (whole project) | 20 | 176 passed |
| protocol + proof (whole projects) | 23 | 638 passed |
| api: chat, chatGrant, chatKeyRecord, chatKeys, proofs, proofUploadWire, disputes/staff, disputes/trader, staff/web, staff/devices, schema | 11 | 275 passed, **1 failed (B1)** |
| moderation: gateDevices, gate, internal, grant, notices | 5 | 130 passed |
| Playwright staff-web (all) | | 16 passed |
| Playwright web: chat, proof, proof-ocr, dispute, dispute-room | | 36 passed |

The full `npm run check` is not run here; it is the runner's.
