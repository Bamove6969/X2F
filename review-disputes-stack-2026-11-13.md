# Security review: wip/lead-disputes-stack 1cff3d66 (rulings, mod-screens, mod-gate, ruling-payout, main 4f0afa14), 2026-11-13

This file is not committed. Reviewer: independent security reviewer, read-only on code. I worked in a
detached worktree at 1cff3d66 with a fresh `npm ci`. Every test ran under `~/x2f-comms/check.lock`
with the timeout inside the flock. I did not touch dockerd: the API suite's own setup started its
Postgres container through the docker CLI, as it always does. The worktree and node_modules were
removed afterwards.

Scope: what is new since the four approvals (rulings 41f0021a, mod-screens 0e2d2957, mod-gate
d2330b2a, ruling-payout a42dad1b):
- the five merges: 07ca8854, 19670424, 3d266ef4, a7e0149a and 3c63c18e;
- X3: 2fde4872 and 39a521fa;
- Haveno finding 2 and ruling-payout N1/N2: 2551c874 and abb3dfb1;
- D-032 in the gate: d236c1b7 (RED) and 1cff3d66. The brief named 8a8c9b4c, but that object does
  not exist in the repository. d236c1b7 is the RED commit for 1cff3d66.

Threat model, as in the gate reviews: the API and its database are fully compromised. `gate.bin`,
MOD_KEYSTORE_KEY, MOD_SIGNING_SECRET, the staff-site build, and the owner's and honest staff's keys
are not.

## Verdict

@@VERDICT@@

## 1. The merges

I replayed every merge with `git show --remerge-diff`. I also checked that no test from any input
went missing: every `it(`/`test(` name in the five inputs (rulings, mod-screens, mod-gate,
ruling-payout and main), across every test file, against HEAD. Only names that an input added
(absent at its merge base with main) count as dropped. Two names came up, and both are renames
with the same body:
- the lien test now cites "g63 poster pays; owner question O3";
- buyerCancel's settle tripwire is now "the ruling gate only decides ... (the executor, execute.ts,
  does)". It keeps the recursive walk of `gate/` and `cli/`, the type-only escrow imports and the
  dynamic `import('@x2f/escrow')` check.

| Item | Result |
|---|---|
| withDispute lock order (07ca8854) | **Kept.** The order is the trade row, the dispute row, `lockPartyTotals`, both parties' `accounts` rows `for key share` in id order, then this dispute's `liens` `for update`, all before `fn` appends to the log. Both sides' blocks are kept in that order, and the comment says so. |
| openGateStore (a7e0149a) | **Kept.** mod-gate's P6 (a missing gate.bin throws; only init-gate makes one) and ruling-payout's `{ lock }` (gate.lock taken before the read, released on any open error) are combined. The `init` option stays removed. `mkdir` is gone, which is right: init-gate makes the directory. |
| main.ts gate factory (a7e0149a) | **Kept.** mod-gate's inline gate block was dropped in favour of ruling-payout's factory. The factory runs only once the instance lock is held, opens with `{ lock: true }` and keeps the P6 behaviour: an open error releases the instance lock, the start throws and the process exits 1. The reader has `statement_timeout`. stop runs sync.stop then store.close. |
| OfferSwitchRefusal (3c63c18e) | **Kept.** It has both `'lien'` (rulings) and `'outside-trade-band'` (main). The lien checks in chat/offers/take match 41f0021a one for one (`hasActiveLien`/`ACTIVE_LIEN_SQL`: 2/4/4 uses). |
| Migrations | **Correct.** On an empty database they apply 210, 211, 212, 301 … 390, 400, 401, 420 … 540, 550. The three expected lists in schema.test.ts agree with that order. 211/212/400/401/550 depend only on lower numbers. 211's grants (staff_invites id, token_hash, role, tap_id, account_id, used_at) all come from 205; the gate does not read 540's `kind`, and does not need to. On a database already at main, the runner applies 211/212/400/401/550 by name after 540 (a set-based runner), which works because none of them touches what 420–540 created. |
| Other conflict hunks | alerts/ownerAlert kinds (union kept), StaffShell routes (MeContext plus /notifications), App routes, api.ts sections, intent.ts (`issuedAt?` on reset-staff-security, add-owner-key and settings), and tests (`trade-ban` accountAction, the main deal's `methodId`/`instructionsSha256`). Each keeps both sides. |

**Merge defect (minor, not security):** 3c63c18e left `apps/staff-web/src/ui/staff.css` with the
`@media (max-width: 900px) { .x2f-staff-case {...} }` block unclosed. It lost its closing `}`, and
the O-040 `.x2f-staff__badge` rule now sits inside it, so the owner's unread badge is styled only
below 900 px. Fix: add the `}` after `.x2f-staff-case`'s rule.

## 2. X3 (2fde4872, 39a521fa), the KEY_TAP_CALLERS tripwire and ClockOut

- The dialog appends `labels[k]` to each signed field. React escapes it, so the labels cannot hide
  or replace a field.
- ModCase: the reason and evidence hashes are computed in the browser:
  - Propose: from the text typed here.
  - Approve: from `p.reason`/`p.evidence`, the same strings the panel renders above the button. The
    test checks both.
  - The outcome and XMR labels come from the very values signed.
  - `round1Id` is now in the intent, and its label pairs `round1.id` with `round1.outcome` from
    the same API object. The gate binds the id to a round 1 it authorised itself (B2). Only the
    outcome text beside it is the API's word, so a lying API can misdescribe round 1 but cannot
    point the tap at another ruling.
- **X3-1 (minor): the `code` label is not from the signed data.** The label is
  `incident ${c.incidentId}`, and `incidentId` is a separate API field (`disputes.incident_id`), not
  derived from `c.code`. ModCase signs `c.code` as the API returns it and never compares it with the
  route parameter it loaded (`/disputes/:code`; the API also resolves incident ids there). So a
  lying API can show "incident D-7RWD", the case the moderator opened, next to another trade's code.
  - The gate binds the code to the recorded amount (the amount must match), but nothing binds a tap
    to the case the moderator is assigned to. Haveno F2 point 4, "dispute agent against trade", is
    still not built.
  - A compromised API can therefore move an honest moderator's single tap below the limit onto
    another disputed trade with the same amount.
  - Today this fails safe: no `create-invite` caller exists, so the gate has no staff and
    authorises nothing.
  - Fix:
    - (a) refuse to open the tap unless `normalizeTradeCode(c.code)` equals the route parameter
      when that parameter is a code;
    - (b) label `code` with the code itself (or something derived from it), not `incidentId`;
    - (c) owner question Q2 below.
- StaffGrants: `labels={{ accountId: name }}`. The name and the id come from the same API row.
  `set-grants` is an API-only tap (not a gate kind), so the API is trusted for it anyway. This is
  the accepted limit (a name-to-id mapping from the API).
- ClockOut (from main): the `payout-address` intent is built from the address typed in the sheet,
  and the dialog shows the whole address. The test now uses `honestTapStart`, so the challenge
  check runs. `payout-address` is API-only. Acceptable.
- Tripwire: `KEY_TAP_CALLERS = [ModCase, StaffGrants, ClockOut]`, each with a test. Round 4's
  suggested additions are present: no `navigator.credentials`, and `@simplewebauthn/browser`
  imported only by name in the five files. There is still no caller for `create-invite`,
  `reset-staff-security`, `settings`, `switch-on`, `add-owner-key` or the stop. So no owner
  registry tap can be made from the staff site, and the D-032 reset below cannot be reached from
  the UI yet.

## 3. Haveno finding 2 (2551c874, abb3dfb1)

**Can a forged, replayed, stale or altered statement get a trader to co-sign? No.** And nothing
co-signs a mod-built set today.

- **Statement and domain separation.** The bytes are `x2f/ruling-statement/v1\0` + canonical JSON,
  with exact keys, the outcome and winner agreeing, 1–16 payouts, and positive decimal amounts.
  Every message signed with MOD_SIGNING_SECRET, and every verify under its public key:

  | Message | Signed bytes |
  |---|---|
  | Trade and chat attestations | `x2f/attestation/v1\0` + JSON |
  | Internal requests | `x2f/api-internal/v1\0` method `\0` path `\0` at `\0` bodyHash |
  | Relay register | `x2f/relay-register/v1\0` + JSON |
  | Relay close | `x2f/relay-close/v1\0` + JSON |
  | Ruling statement | `x2f/ruling-statement/v1\0` + JSON |

  - The prefixes are distinct, each ends in NUL, and none is a prefix of another.
  - No verifier in the API, the relay or `@x2f/trade` checks undomained bytes under this key.
  - The envelope, join and identity-proof domains use other keys.
  - Domain separation holds. F1's exposure point (one online key for all five) stands as before:
    an owner question from the earlier review.
- **Gate.** `replayed` covers a ruling id it authorised, shown again for another code or round.
  `stale-round` covers an unseen ruling at or below the highest round it authorised on that trade.
  Both are checked before the tap agreement. Round 2 after round 1 still works.
- **Executor:**
  - The payout is recorded (saved) first.
  - `no-escrow` holds while the watcher's own `mod_party_links.escrow_address` (the moderation
    database, not the API) is missing.
  - The statement is built from the execution record, so it is identical after a restart:
    `issuedAt = recordedAt`, and Ed25519 is deterministic.
  - It is signed and announced, and only a 200/201 lets the hand-over go ahead (`announce-failed`
    otherwise, retried every pass).
  - The announcement is per process (`announced` map), so after a restart it is posted again before
    any hand-over.
- **API (`ruling-statement`, migration 550):**
  - The report arrives over the signed internal link.
  - The API checks the shape and the signature, round 1, the code, `disputed`, the trade's escrow
    address, and the published round-1 escrow ruling's id and outcome (`d.round1` after an appeal;
    not after-refund).
  - `insert … on conflict do nothing` then a compare, so the first statement stays. The same one
    again is 201; any other is 409 `statement-conflict`.
  - The trader route serves participants only (`roleInTrade`; listed in OWN_DATA_READS).
  - A compromised database can store anything there. The device's own check is what counts, and
    garbage can only block (409, so `announce-failed`): it fails closed.
- **Web `ruled`:**
  - A mod-built `dispute-buyer`/`dispute-seller` set needs `ruling` in the context.
  - `rulingStatementValid` checks it against the pinned key, the device's trade code and its own
    party's escrow address, round 1, `winner === this role`, and `payouts` equal to `o.to` in order
    and amount.
  - `is(...)` independently requires `o.to` to be this side's own `payoutsFor` at its own address.
  - Each case is refused: a forged key, another trade, another escrow, round 2, an altered payout,
    and the loser's side.
- **Runtime not wired (fails closed), confirmed:**
  - `runtime.ts` `context()` never sets `ruling`, so `ruled` is false for every mod-built set.
  - The runtime builds outcomes only from its own intents (`outcomeFor`).
  - The tripwire (`dispute-tripwires.test.ts`) fails if `runtime.ts` ever mentions `'mod'` or
    `rulingAllowsCosign`, and now records that the context must carry `ruling`.
  - Nothing co-signs a ruling today.
- **Info (test hygiene):** abb3dfb1 deleted the RED runtime test `apps/web/test/disputeCosign.test.ts`
  (from 2551c874) rather than flipping it, because the runtime path stays NEEDS_PLAN_4_MOD_COSIGN.
  The negative half, "nothing on the API's disputed alone, nor on a forged/replayed/stale/altered
  statement", held today and could have stayed as a runtime test. Suggest restoring that half.
  Until then the tripwire is the only runtime-level guard.

## 4. Ruling-payout N1 and N2

- **N1 fixed.** `verify()` always runs `verifyChain(chain)`, checkpoints or not. A result with
  `head === null` is not ok and raises "the log is empty to this reader". `logVerifiedAt` is
  stamped only on ok, so the sealed overdue clock also fires. The branch flipped the earlier
  reviewer's proof D to expect the alarm. The declared residual (a consistently forged view)
  stands.
- **N2 fixed.** gate.lock holds `{pid, boot, start}`, with `start` from field 22 of
  `/proc/<pid>/stat`, parsed after the last `)`.
  - Our own pid is stale unless this process holds the lock (`heldHere`, by resolved path; a second
    lock in the same process is refused).
  - Another boot, or a live pid with another start time, is stale.
  - A bare-pid file is read as before.
  - The takeover is still unlink-then-`wx`, so two successors starting at once could both win. Two
    processes cannot both be in the gate factory, though, because the DB instance lock is taken
    first. Acceptable.
- **Info (pre-existing, from mod-gate and ruling-payout, not new here):** `cli/pin-owner.ts`
  opens the store without `{ lock: true }`. Run while the service holds the gate, its save and the
  service's next save overwrite each other: a lost pin (fail-closed), or lost `executions` and
  checkpoints. Suggest `{ lock: true }` in pin-owner, so it refuses while the service runs.

## 5. D-032 owner security reset in the gate (d236c1b7, 1cff3d66)

What the gate does: `reset-staff-security` is now a registry kind and an ISSUED_AT kind. Step 0 runs
the issuedAt/age/counter checks and spends the tap as `reset:<id>`. Step 1b runs the first time it
acts on a tap. The person must be known, not removed, not the owner and not in `removedIds`, and
the link id must not be an invite's. If so, it checks `inOrder` on `security:<account>`, drops the
person's creds, closes their earlier reset links and binds `resets[id] = {accountId (from the
signed intent), closed}`. While the link is open (the signed expiry, the person not removed, the
API not reporting `used`), registrations made through `inviteRegistrationChallenge(tokenHash)`
with attestation and the allowlist become keys.

| Question | Answer | Evidence |
|---|---|---|
| Can the API forge it? | **No.** Only a verified tap by a pinned owner key counts. A senior's tap or no tap changes nothing, and the gate keeps the keys it verified. | branch tests; challenge binding (X1/X2) |
| Replay it? | **No.** The nonce is spent; a second tap for the same link adds nothing; a finished, expired or superseded link takes no key, even if the API later says `used = false`. | branch tests; PoC R2 |
| Re-point it? | **No.** The account comes from the signed intent, not the database. The same link named for someone else is refused (`reset-rebound`). | branch test |
| Reset the owner? | **No.** `intent.accountId === ownerId` is refused, and the owner is never in `g.staff`. | PoC R1 |
| Race an invite? | **No.** A reset id that is an invite id is refused, and an invite id that is a reset id is refused (`invite-is-reset`), whichever comes first. | branch test; PoC R7 |
| Reset link as an invite? | **No** for the id. A link's id never becomes an invite. The two kinds share the registration challenge (`inviteRegistrationChallenge(tokenHash)`), so a key registered through one link could count for the other only if the owner tapped both with the same token hash. Low impact: see R5, which already gives that power. | code |
| issuedAt order per person? | **Yes.** `inOrder(t, 'security:<account>')`: an older reset shown after a newer one is spent `out-of-order`; the newer link stays. | PoC R2 |
| Re-enable a switched-off or removed person? | **No.** `revoked`/`removed` are untouched; a reset after `remove-staff` is refused. | PoCs R3, R4 |

**D-1 (owner question; the B1 residual, now with higher impact):**
- The owner's browser makes the link's token, but `POST /staff/v1/members/:id/reset-security`
  sends the token itself to the API, as invites do. A compromised API therefore knows it.
- While the link is open (up to its expiry), the API can register its own attested, allowlisted
  security key through the link, and the gate accepts it as one of the person's keys.
- For an invite (B1) that gives a new staff member. For a reset it gives an **existing** member,
  typically switched on and possibly a senior who can approve. PoC R5: an attacker key signs as
  the senior.
- A reset starts when the person contacts the owner, which is a natural pretext for social
  engineering.
- The fix is the one already recommended for B1: an owner `add-staff-key` tap after comparing the
  key check code (`staffKeyAccepted`), which covers resets too. Until then this is fail-safe only
  because no staff site caller can make a reset or an invite tap.

**D-2 (minor, hardening):**
- The gate puts no bound on the signed `expiresAt` of a reset link (nor of an invite). The API's
  `linkOf` caps it at 24 h, but under this threat model the API is the party lying. The owner sees
  `expiresAt` in the dialog but is unlikely to read it.
- PoC R6: a 2099 expiry plus an API that never reports `used` keeps the link open, and a key
  registered 30 days later is taken.
- Fix: in step 1 and step 1b, refuse (or close) a link whose `expiresAt − issuedAt` exceeds 24 h
  plus the skew. For `create-invite` this needs `issuedAt`, which it already carries.

## Tests run

@@TESTS@@

## Trial merge with wip/lead-batch10a (7650ebdf)

@@BATCH10A@@

## Owner questions

1. **D-1 / B1 residual (now also resets):**
   - Confirm each staff key the gate takes, from an invite or a reset link, with an owner
     `add-staff-key` tap after comparing the key check code?
   - Recommended: yes, before the gate goes live with staff or offers resets.
2. **Haveno F2 point 4 (case assignment):**
   - Should a ruling tap count only from a moderator the moderation service itself saw assigned to
     that trade?
   - That needs a signed assignment record: for example, an owner- or senior-tapped `assign`
     intent, or the proposer's own tapped `take-case`.
   - Today a compromised API can move an honest moderator's tap onto any disputed trade of the same
     amount (X3-1).
   - Recommended: yes, for mainnet; at least fix X3-1 (a) and (b) now.
3. (Carried over, unchanged) F1 key split, F3/F4, M-R2 `remove-owner-key`: still open from the
   earlier reviews.
