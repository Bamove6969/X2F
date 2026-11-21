# Staff and moderation threat table

What each compromised component can do to dispute chats and proofs today, and what is accepted until the chat key-membership design (design-chat-membership-keys-2026-11-08, comms folder; its section 10 has the full table) is built. Kept in step with docs/coordination.md, Plan 4 Task 11.

| Compromised | What it can do today | Why, and what stops worse | Until |
|---|---|---|---|
| API (X2F's server) | Seal text as the moderator: **no** (design build task 9, landed 18 Nov). | `/internal/chat/send` takes only ciphertext a certified staff device of a staff member on the case sealed and countersigned (`x2f/mod-countersign/v1`); the moderation process checks the countersign by the device key its own gate certified, its age (5 min) and request id (single use), and signs only that. The dev switch `X2F_DEV_MOD_CHAT` is gone. | — |
| API | Read a disputed chat or the unblurred proof: **no.** | The read is the chat key re-wrapped by the moderation process to the staff member's certified device; staff-web decrypts (design build task 9). The reader role still cannot select envelopes, nor any staff wrap. No proof read exists (`NEEDS_P5_PROOF_ENVELOPE`). | The proof key re-wrap, once the unblurred proof exists. |
| API host user | Read moderation's keystore key and signing secret: **no, if deployed as required.** | The API and moderation run as separate OS users; the socket is 0660 to a dedicated group in a directory moderation owns (review 8 Nov I-3, docs/coordination.md deploy requirement). The same uid could read `/proc/<pid>/environ`. | Plan 6 builds the users, group and directory. |
