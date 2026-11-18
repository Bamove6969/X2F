# Review: wip/lead-proof-upload @74d8bb5a against main 75f7b5b4 (18 Nov 2026)

Independent security and privacy review, one round. The branch merges the proof stack
(wip/lead-proof-tripwire-6 34861503) onto main in 39be9465, then adds Plan 5 Tasks 14-15 in
3e2d5747..74d8bb5a: migration 585, `prepareUnblurred`/`sendUnblurred`, the engine's
`sendUnblurred` and its `away` receipt, the SendUnblurred card, the blur check after a send, and
e2e proof.spec. Everything new for users sits behind `VITE_X2F_PROOF_UPLOAD` (off by default),
**except the engine's `away` receipt, which runs in every build**.

**Verdict: CHANGES NEEDED.** Two Important findings, I1 and I2. Both are small and should be fixed
before the flag is turned on. I1 is in code that ships with the flag off. The merge is clean, the
unblurred copy is sealed to the moderator only, and no test was weakened.

## Tests run (review worktree, detached at 74d8bb5a, `nice -n 10`, outside the lock per the 18 Nov rule)

- web (`@x2f/web`), 15 files, **361/361 passed**: proof-render-tripwire, chatProof, chatProofReceive,
  chatProofSend, sendUnblurred, dispute, dispute-tripwires, disputeSlot, proofUpload, blurEditor,
  chatEngine, quoteScreen, tradeTerms, cantDoThat-lint, proofStackSeams. The log shows stray
  `ECONNREFUSED 127.0.0.1:3000` lines from jsdom fetches; no test failed.
- api (`@x2f/api`), 5 files, **159 passed and 1 todo**: proofs, proofUploadWire, disputes/staff,
  blurCheck, schema. The todo is the existing NEEDS_P4_CHAT_MEMBERSHIP `it.todo` in staff.test.ts
  and is not new.
- auth-client flows.test: **15/15 passed**.
- `tsc --noEmit`: apps/web and apps/api both clean.
- Not run: the full `npm run check`, Playwright proof.spec, staff-web or moderation suites, and
  copy-lint or separation-check outside the lint test listed above.
- Probe (a scratch test, deleted afterwards, not committed): I1 below reproduces. It fails as
  described.

## 1. The merge 39be9465

The conflict resolutions are sound. Nothing from the tripwires or proof checks was dropped.

- **auth/frontDoor.ts, auth/hold.ts:** main's blur-check rows were kept, both
  `POST …/proofs/:proofId/blur-check` and `POST …/blur-checks/:proofId`, in OWN_DATA_WRITES and in
  LIVE_SESSION_EXEMPT, plus `GET …/blur-checks`. The stack's duplicates were dropped because the
  keys would collide (TS1117). The stack's own new rows survive: `GET`/`PUT …/proofs/:id` in
  frontDoor and `PUT …/proofs/:id` in LIVE_SESSION_EXEMPT. The two sides' wording differs, but
  they classify the routes the same way.
- **flows.test NOT_AUTH_CLIENT:** the three proof routes are spelled `proofs/:id|:proofId`, as the
  route tree reports them, and `blur-checks/:proofId` keeps its name. Main's blur-check entry was
  renamed and not lost. The test passes.
- **quoteScreen BLUR_CHECK_LINE:** the stack's S-M2 rule holds (`termsFor` drops the line unless
  the upload flag is on). The resolution expects 24 lines and adds
  `not.toContain(BLUR_CHECK_LINE)`, which is stronger than either parent. tradeTerms.test still
  pins the gating.
- **disputes/staff.test:** the stack's NEEDS_P4_CHAT_MEMBERSHIP tripwire is intact. It still
  requires that no staff proof route exists, that only proofs/ and retentionJobs name the proof
  tables, that blurCheck.ts imports exactly `isStoredProof`, and that `readableProof` filters to
  `kind in ('proof', 'evidence')`.
- **cantDoThat-lint:** the cap moved from 67 to 69, one step for each side's entry (askHint, then
  PROOF_CANT_USE and CHAT_PROOF_GONE). The new commit e594ff5c adds `not-for-me` to
  NOT_REFUSAL_CODES rather than raising the cap.
- **schema.test:** 580 and 585 appear in all three lists. The lien tripwire's absence comes from
  main, where liens have landed; the merge did not remove it.

## 2. The unblurred copy goes only to the moderator

The sealing, storage and visibility hold. One leftover-plaintext residual is listed as m1.

- **Recipients:**
  - `sealProofUnblurred` goes through `sealProofEnvelope`. That function refuses any caller `to`
    and takes the recipients from `PROOF_RECIPIENTS['proof.unblurred'] = ['mod']`.
  - The worker (`chat-send-unblurred`) and the engine both re-parse the payload with
    `parseProofPayload('proof.unblurred')`, which takes only exact keys.
  - chatEngine.test opens the envelope as the moderator, and gets `not-for-me` as both the seller
    and the sender itself.
  - A `proof.unblurred` sealed to a trader by a hostile client never reaches a line:
    `openChatMessage` falls through to `notChat` because the type is not the chat message type.
- **The API stores only ciphertext:**
  - `PUT ?kind=unblurred` stores the body as is. It is accepted only from the side the open
    dispute names, and only once per request.
  - The same transaction sets `proof_request_sent_at`, which is only a time. The CHECK on 585
    cannot be broken, because nothing ever clears `proof_requested_at`.
  - A trader's GET of an unblurred proof returns 404 for both sides (proofs.test and
    proofUploadWire).
  - Nothing in the route logs the id, the code or the size.
- **No plaintext, file name or EXIF leaks:**
  - `prepareUnblurred` reuses `readPicked`: the file is read once, its header checked and its
    bytes zeroed in `finally`.
  - `photoTakenAt` is worked out and then thrown away; the unblurred payload has no time field.
  - `finishProof(picture, [])` re-encodes from pixels and runs `cleanImage` and `assertClean`, so
    only IHDR/IDAT/IEND remain (proven in proofUpload.test and proofUploadWire).
  - The file name is never read.
  - The ciphertext is bound to kind `unblurred` and does not open as `proof`.
- **Pixels zeroed on every path:**
  - `sendUnblurred` zeroes `picture.rgba` in `finally`.
  - SendUnblurred zeroes after a prepare that lands once the card is unmounted, and again in the
    send's catch.
  - `checkedPixels` zeroes before it refuses.
  - See m1 for the encoded bytes.
- **The seller cannot get it:** there is no trader GET, the envelope is sealed to the moderator
  only, and no staff proof route exists yet (the tripwire above).
- **`proofRequest.sentAt` reaches only the side that was asked:**
  - `loadView` builds `proofRequest` only when `proof_request_side === side`. proofs.test checks
    that the other side gets `null`.
  - The PUT publishes no live event.
  - The board line and the chip are built from `d.proofRequest.sentAt`, so they also show only to
    the side that was asked.

## 3. The `away` receipt and the evidence gap

### I1 (Important, live in every build): an away receipt swallows the gap marker for lines the relay dropped before it

The away branch moves `lastSeq` to the away envelope's seq and stores `gapBefore` on the away
receipt. The snapshot then withholds every `away` receipt (`withheld`), so that `gapBefore` is never
shown. The sender's next shown line works out its own `gapBefore` from the away seq, which gives
`false`.

The result: if the API drops seq 8 and 9 of an honest buyer and then delivers the buyer's unblurred
copy at seq 10, the seller sees no gap anywhere. The gap marker (review M1) exists to make a
dropped line visible. This hides it.

Probe: in the seller-side away test, seal and drop one buyer line before the copy. The expected
`['buyer', 'after', true]` comes back as `false`.

Exploiting this needs an honest sender's copy, which needs the flag on. A hostile trader can only
hide their own lines, which they could leave unsent anyway. The engine code itself ships with the
flag off.

Fix (engineering): carry a withheld away receipt's `gapBefore` onto that sender's next shown line,
or compute shown lines' gaps against the last shown or decided seq while counting the away seq as
present. Add the probe as a regression test.

### Owner question (not blocking): a message sealed only to the moderator is invisible to the counterparty

A modified client can seal any type (text, a `proof.attached`, payment details) to `['mod']` or to
`[self, mod]`. The counterparty's engine now takes it as `away`: no line and no placeholder. Before
this branch the envelope was skipped without a receipt, and the sender's next line showed a gap.

Why it matters only a little:
- The content is the sender's own words, signed by them; nothing can be forged against the other
  side.
- The moderator cannot tell from the envelope whether the counterparty's slot was real (non-recipient
  slots are random bytes), so they cannot know the other side never saw it.
- So it is an asymmetry (one-sided claims the other side could not rebut), not a forgery.

Two options, both changing what users see, so they are not decided here:
- (a) Keep `away` only while `view.disputeOpen`, because `sendUnblurred` sends only then. Outside a
  dispute, fall back to the old skip, so the gap still shows.
- (b) When the staff reader is built, it should say plainly that any line may not have been seen by
  the counterparty, and should show a `proof.unblurred` as "sent to you only".

A neutral placeholder for the counterparty ("a message for the moderator only") would tell them a
request happened. That contradicts "the other side is never told" (proofs.test), so it needs the
owner's call.

Recommendation: (a) now, and (b) as a requirement on the staff reader.

## 4. Proof-render tripwire

The new code only encrypts. In both apps, ChatProof.tsx is still the only place that calls
`decryptProof`. SendUnblurred, upload.ts, engine.ts and seams.tsx contain no `<img>`, object URL,
`data:` or storage calls. The tripwire file is unchanged from 34861503 and passes.

## 5. No test weakened

Every line removed from tests between 39be9465 and 74d8bb5a is one of three things:
- a mechanical `sendUnblurred` stub added to the ChatClient or engine fakes;
- the `sentAt: null` field added to the expected `proofRequest`;
- 585 appended to the schema lists.

From the merge itself, dispute-tripwires only rewords the UnblurredRequest comment; the lien
tripwire was already gone on main. The new code adds no skip, only or todo.

## Further findings

### I2 (Important, flag-gated): if the chat post fails after the PUT, the trader is told "Sent" but the moderator has no key

`sendUnblurred` stores the ciphertext, which also sets `sentAt` on the server, and only then posts
the key. If the post fails (429 `slow-down`, `refused`, or `uncertain` from a network or 5xx error),
three things happen:
- The card shows the error, but the next dispute poll brings `sentAt`, so the card switches to
  "Sent to <mod> at …". The system card "You sent an unblurred proof to the moderator only" and the
  chip appear too.
- A retry is refused with 409 `not-requested`, because one copy per request already exists.
- The moderator holds a blob they cannot open, and nothing tells them the key never came.

`sendProof` has the same order, but a proof can be sent again under a new id; the copy cannot.

Options for the lead:
- (a) Engineering: on a post failure after a successful PUT, keep the payload (key and facts, not
  the pixels) in memory and retry only the post. The card says "not sent yet" until the post
  succeeds.
- (b) A behaviour change: let the side that was asked replace its copy while the request stands.

Recommendation: (a). It needs no new API rule.

### Minors (not blocking)

- **m1:** `finishProof` does not zero its working buffers on every path:
  - the copy, if `encode` throws;
  - the first PNG `bytes`, when it falls back to JPEG;
  - the uncleaned `bytes`;
  - `clean`, if `assertClean` or the size check throws.

  `sendUnblurred` also zeroes `fin.bytes` only after a successful `encryptProof`. The proof path
  has the same leftovers, but here they hold the unblurred picture. Zero them in `finally` blocks.
- **m2:** SendUnblurred's "Sent to {mod} at", "Send unblurred proof to {mod}" and DisputeRoom's
  "Unblurred copy · moderator only" carry no COPY-UNSIGNED marker. They may be board lines; please
  confirm, or mark them.
- **m3:** proof.spec covers only the payment-proof path. No browser test drives SendUnblurred end to
  end (the PUT body is ciphertext, and the envelope opens for the moderator only). The unit and
  wire tests cover it; an e2e case would be cheap once I1 and I2 are fixed.
- **m4:** the PUT runs before the post, so a purged chat or a closed dispute between the two leaves
  an orphaned unblurred blob. It is kept until the trade's retention, so it is covered.
- **m5:** two small formatting nits: an extra blank line at the end of the staff.test describe, and
  `sendUnblurred: async () => after ,` spacing in chatProof.test.

## Owner and lead questions

1. The counterparty-hidden moderator-only messages (section 3): option (a) with the dispute-only
   `away`, option (b) as a requirement on the staff reader, or a visible placeholder?
   Recommendation: (a) and (b).
2. I2: retry only the chat post (engineering), or let the copy be replaced while the request
   stands (behaviour)? Recommendation: retry only the post.

---

# Round 2: wip/lead-proof-upload @03b12cdd (18 Nov 2026)

New commits since round 1:
- 8e071018: red tests.
- 34597bc6: the fixes for I1, I2, m1 and m2, plus the lead's call to keep `away` only during a
  dispute.
- 1dfe1c01: a merge of main 708d821d (the retention promise).
- 03b12cdd: a chat that is not ready on this device does not answer the receipt question.

**Verdict: APPROVE.** I1 and I2 are fixed, the merge is clean and no test was weakened. Three new
minors follow; none of them blocks.

## Tests run (review worktree, detached at 03b12cdd, `nice -n 10`, outside the lock)

- web: 16 files, **388/388 passed**. These are the round-1 set plus sessionForget.
- api: 6 files, **167 passed and 1 todo**. These are proofs, proofUploadWire, disputes/staff,
  blurCheck, schema and purge. The todo is the same NEEDS_P4_CHAT_MEMBERSHIP one as before.
- auth-client flows.test: **15/15 passed**.
- `tsc --noEmit`: apps/web and apps/api both clean.
- Not run: the full `npm run check`, Playwright, staff-web and moderation.

## Round-1 findings

- **I1 fixed.** `snapshot` now walks the receipts in server order. A withheld `away` receipt's
  `gapBefore` carries onto that sender's next shown line, even when that line arrives in a later
  sync. Refused receipts stay out of the gap count, as before. New tests cover the dropped-line case
  and the later-sync case.
- **Lead call (option a).** The `away` branch now also requires `view.disputeOpen`. Outside a
  dispute, a trader's moderator-only envelope is skipped as before, so the next line shows a gap.
  Tests cover both sides of the rule.
- **I2 fixed.**
  - `sendUnblurred` now uploads once, then posts the key with a bounded backoff (four tries, about
    13 s). After that it throws `UnblurredPostFailed`, whose `retry` posts the same payload again and
    nothing else.
  - The kept payload holds the key and the picture's facts, never its pixels. It lives in memory
    only, and `forgetLocalSession` clears it.
  - "Sent", the system card and the chip now need one of two things: this tab saw the post succeed,
    or the chat holds this side's own `away` receipt from at or after the request
    (`modOnlySentAt`: server times only, own side only).
  - `sentAt` alone shows "checking", then "lost" (COPY-UNSIGNED wording, flagged as an owner
    question). A chat that is not ready here rejects, so the card claims neither.
- **m1 fixed.** `finishProof` zeroes the copy, the PNG it drops for JPEG, the uncleaned bytes and a
  refused cleaned result. `sendProof` and `sendUnblurred` zero `fin.bytes` in `finally`.
- **m2 fixed.** The chip and the new strings carry COPY-UNSIGNED.

## The merge 1dfe1c01

- RETENTION_JOBS keeps `purgeProofsJob` and puts main's `purgeTradesJob` after it; purge.test
  agrees.
- `trade_proofs.trade_code` is `on delete cascade`, so deleting a whole trade can neither fail nor
  leave proofs behind. `proof_id_tags` (the one-time ids) is not tied to the trade, which is
  correct.
- schema.test lists 580, 585 and 701 in order.
- The staff.test, purge.test and dispute-tripwires changes against main are the stack's and this
  branch's own. Main's retention tripwires were retired on main.

## No test weakened

- The sendUnblurred tests removed ("sentAt alone shows Sent", "the card and chip from sentAt") are
  replaced by tests of the stricter I2 rule.
- The retention tripwires were removed on main when that work landed.
- No skip, only or todo was added.

## New minors (not blocking)

- **n1:** the dispute-only `away` rule is applied when the envelope is read, not by when it was
  posted. A moderator-only envelope sent before the dispute opened, and first read by the
  counterparty's device after it opened, becomes `away`: no line and no gap. A device that read it
  earlier showed a gap. Consider also requiring the envelope's `at` to be at or after the dispute's
  opening, or accept this as residual.
- **n2:** `chatUnblurredReceipts` checks `phase === 'ready'` but not `more`. If a sync stops at its
  page cap before reaching the copy's receipt, the card can say "lost" until a later sync. Reject
  while `more` is true, the same as not-ready.
- **n3:** when the receipt question fails, `askUnblurredReceipt` stores nothing and nothing emits,
  so the card stays "checking" until something else re-renders it. A retry on the dispute poll
  would end that.
