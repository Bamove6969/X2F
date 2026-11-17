# Re-verify: wip/second-seckey-fixes @ 64ea5c1f (17 Nov 2026)

**Verdict: NOT READY to land as is**, though the fixes themselves are sound.
- B1, M1 and M2 from review-third-seckey-fix-2026-11-16 are fixed. No test was weakened.
- My probes found no way for a staff, owner or member account to register or use an unattested key.
- The blockers are not in the 7 fix commits:
  1. The head's full check is red. There are 10 vitest failures, all inherited from the demo-r2 base (3190919d). None comes from this fix.
  2. The branch does not merge cleanly onto main 4f0afa14. There are 4 conflicts, all from the demo-r2 base. The 7 fix commits themselves apply cleanly.
- **The fix layer is approvable once the base is green and merged.** It needs one more check pass after that.

Reviewer: independent security reviewer (claude2 helper), read-only.
- Worktree: /home/user/wt/rv-seckey-fixes, detached at 64ea5c1f, with a fresh `npm ci`.
- Nothing committed. Probes were reverted.

## Scope
`git log fe6765c7..64ea5c1f` holds 8 commits: 88516969, b4ae3137 and a7322fc6, 85e7e274 and 2b51ef80, 0ae388d9 and 811a69db, and READY 64ea5c1f. They change 16 files (+546/-23), and I read all of them. Context I also read:
- review-third-seckey-fix-2026-11-16.md;
- to-lead.log lines 409, 410, 414, 423, 427, 439 and 441.

## Findings by fix

### B1 (copy-lint): fixed
- In keyErrors.ts, the four sentences are reworded from "can't" to "don't".
- `method-not-allowed` and its text now come from `ui/cantDoCodes.ts` (`KEY_MODEL_REFUSED_CODE` / `_TEXT`).
- A new test runs `lintSource` on the file.
- The full `npm run copy-lint` passes on the head.

### M1 (trader retry on any attestation error): fixed. Staff, owner and member stay closed (probed)
`webauthn.ts:299` now reads:

```ts
const plain = a.accountKind === 'trader' ? withoutAttestation(a.response) : null;
```

The non-trader 403 for an unknown model comes first (line 294), unchanged.

Why a non-trader cannot get an unattested key through this path:
- `accountKind` is read fresh on every request, never from the challenge.
  - Add-key finish uses `req.auth.kind`, from `requireSession`'s join on `accounts` (sessions.ts:389).
  - The Plan 4 helper (`verifyWebAuthnRegistrationOnly`) uses `accountById`.
  - Sign-up hard-codes `trader`, and every new account is a trader.
- So a kind change between start and finish is judged by the kind at finish.
- `member` sessions are refused outright by `requireSession` (sessions.ts:411).
- A key from the retry is always `fmt none`, so it is stored `attested=false`.
- `attested` can only become true from a statement that really verified: `packed` + x5c + allowlist.
- After a promotion, login filters keys by the account's current kind:
  - `webauthnAssertionOptions` uses `allowed(account.kind, …)`;
  - `verifyWebAuthnAssertion` uses `row.account_kind`, joined fresh.
  - So a promoted trader's unattested key is never offered or accepted.
  - The staff app adds `stillAllowlisted` on top.

Probe (`webauthn.test.ts`, my worktree only, reverted). A trader starts add-key, so the options carry `attestation: none`. Then `update accounts set kind = <staff|owner|member>`, then finish:
- staff:
  - `none` → 403 method-not-allowed;
  - a chain from another root (an allowlisted AAGUID, then an unlisted one) → 401 webauthn-failed;
  - in every refused case, no row is stored;
  - a key whose real packed statement verifies and is allowlisted → 201 `attested=true`. That is correct, because it is a genuinely attested key.
- owner: `none` → 403. PROBE3 below covers the rest.
- PROBE3 (results in the Tests section) also covers:
  - owner and member for all four attestation cases;
  - a trader who registers an unattested key through the retry and is then promoted to staff, owner or member. The key is not offered, the assertion is refused, and a key tap (`only: attested`) gives 403.
- No app code changes `accounts.kind`; only SQL does, guarded by the triggers in `202_staff.sql`. Promotion is therefore an operator action, and the key filter at login covers it.

The retry still checks challenge, origin, RP ID, type, UP and alg, and the branch's own test confirms a wrong origin still gets 401. The M1 test also covers staff, owner and member with "another root" and "expired leaf" → 401, and unlisted or no-statement models → 403.

### M2 (demo RP adoption): fixed for LAN and tailnet, with one residual (informational)
- `gateway-core.ts:243` adopts only when the TCP peer is loopback (`isLoopbackPeer`: 127/8, ::1 or v4-mapped) **and** `X-Forwarded-Proto: https`.
  - The phone listener (`DEMO_PHONE_IP`) and the tailnet TLS listener see non-loopback peers, so they can never adopt.
  - The test checks this from a real non-loopback interface.
- A failed restart now clears `origin` (rp-adopt.ts:68), and the next page load retries.
- **Residual (I1, demo only):** a DNS-rebinding page opened in a browser *on the demo machine itself* would reach the gateway from 127.0.0.1.
  - Once the name rebinds, its fetch is same-origin, so it can set `X-Forwarded-Proto: https` with no preflight, and its Host is the attacker's name.
  - It would then pin the RP ID ("the first host stays").
  - The impact is the one the earlier review stated: keys stop working for the rest of the demo; fake money, no session theft.
  - It needs the owner to browse a hostile page on the demo host, on the gateway's port. I don't think this needs fixing for a demo. An optional hardening: also require `Sec-Fetch-Mode: navigate`, or a host suffix allowlist for preview domains.
- **Production cannot be pinned:**
  - The API reads `X2F_RP_ID` / `X2F_ORIGINS` from env only (config.ts:202-206). Nothing in `apps/*` or `packages/*` reads Host, X-Forwarded-Host or X-Forwarded-Proto to build an RP or origin.
  - relay and node-proxy set no trustProxy.
  - `tools/demo/*` is imported by nothing in apps/packages, and `separation-check` passes.
  - Every demo process refuses to start without `X2F_DEMO=1` and a regtest node (guard.ts).

### Owner 16 Nov success state ("Name this key", green card): safe
- **XSS:** the name is rendered as a React text child (`{name}` in `KeyAdded`). There is no `dangerouslySetInnerHTML` anywhere in apps/web/src.
- **Length:**
  - the input has `maxLength=60`;
  - `keyNameShown` trims to 60 code points;
  - the server's `cleanLabel` strips `\p{Cc}\p{Cf}`, trims, and caps at `LABEL_MAX = 60` code points;
  - the request body is under Fastify's default limit.
- **Security decisions:** the label is not used in any. It is only stored and listed back to the owner of the account (webauthn.ts, hold.ts:260, ownerKeys.ts:45 list). Alerts carry `{ method }` only. No policy, allowlist or uniqueness check reads it.
- **m1 (cosmetic):** the green card shows the name as the client trimmed it, without the server's Cc/Cf strip. A name with, for example, U+202E would show differently in the card than in Settings. It is only the user's own text shown back to them. Optional: apply the same strip in `keyNameShown`.
- **m2 (UX, owner):** the step's `done` is recorded only on Continue. If the user leaves the green card without pressing Continue, the key is on the account but setup still lists the step. A second try would say "already on your account". This is acceptable, but it is worth knowing.
- A staged add (hold) still goes to `finish.done` (the "waiting" state), unchanged.
- Passkeys keep the old auto-advance (owner Q5 in the READY line).

### Tests not weakened
- All 7 test-file changes are additive. `git diff fe6765c7 64ea5c1f` removes no `expect`, `it` or `skip`/`only`/`todo` line.
- The only deleted lines are a docstring and a `notAfter` expression in `softAuthenticator.ts`, replaced by an opt-in `expiredLeaves` (default unchanged).
- The new e2e `security-key.spec.ts` uses a real CDP virtual authenticator (USB and NFC) with server-shaped options, and stubs the API only.

## Blocking (not from the fix layer)

### N1: full `npm run check` is red on 64ea5c1f: 10 vitest failures, all inherited
I ran each step of `tools/check.sh` separately under the lock, so a red step did not hide the steps after it. Everything else is green: typecheck, copy-lint, separation-check, semgrep (0 findings) and audit (0 vulnerabilities).

`npx vitest run`: 373 files, **9 failed files, 10 failed tests, 6873 passed, 1 todo**.
- The 8 web failures are the same as on base 3190919d (prior review): bundle ×2, cantDoThat-lint (pragma ceiling), kit-tokens, loginApproveV2 tokens, proof-render-tripwire, selection-ink, serve-boards.
- `auth-client/test/flows.test.ts`: `GET /v1/trades` has no client method. That route comes from the demo-r2 trades-list.
- `trade/test/payFields.test.ts:279`: expected 62 rechecked rows, got 60. This is pay-field data.
- None of these files, and no route, is in the fix diff. All 10 are deterministic and come from the base.
- Under the 13 Nov rule this cannot be APPROVED until the base (wip/lead-demo-r2) is green.

### N2: does not merge cleanly onto main 4f0afa14
`git merge --no-commit 64ea5c1f` onto 4f0afa14 conflicts in 4 files:
- `apps/api/src/team/members.ts`
- `apps/api/test/schema.test.ts`
- `apps/web/src/chat/engine.ts`
- `packages/auth-client/src/index.ts`

The same 4 conflict when merging fe6765c7, or the demo-r2 base 3190919d alone. With the base merged first, the 7 fix commits apply on top with 0 conflicts. Main's changes to `auth/sessions.ts` (team-member hours) do not touch how `kind` is read. So the conflicts belong to landing demo-r2, not to this fix. I resolved nothing; that is a lead decision.

## Tests run (all under ~/x2f-comms/check.lock, with the timeout inside the flock; Node 24.22.1)
- Full check steps on a clean tree at 64ea5c1f:
  - typecheck 0, copy-lint 0, separation-check 0;
  - vitest 10 failed / 6873 passed / 1 todo (see N1);
  - semgrep 0 findings, audit 0 vulnerabilities.
- Playwright (Chromium at /opt/pw-browsers/chromium, `--trace off --workers=1`), setup.spec.ts + security-key.spec.ts: **38 passed, 0 failed**. That includes USB, NFC, the wrong-RP-ID and the 403 model-refused cases.
- The M1 test (`review M1`) passes in every probe run (2 passed with the probe).
- Probe for kind change and promotion: PROBE3_RESULT
- Not run:
  - a physical key;
  - the real demo stack behind a preview pane;
  - Monero regtest suites, beyond what `vitest run` includes.

## Owner questions (carried from the READY line; still open)
1. Where did you add the key on 13 Nov (the preview pane, a browser tab on the preview address, the tailnet, or the phone), and which model? Recommendation: retest on the next demo build in its own tab, with USB and NFC.
2. Approve the KEY_ERROR wording (COPY-UNSIGNED). Recommendation: yes, with "back of your phone" shown only on phones.
3. Should team members stay limited to the staff key list (Yubico 5 / Security Key / Titan v2)? Recommendation: yes. "Any FIDO2 key" applies to traders only.
4. The success state's wording ("Security key added", "Name this key (optional)") and the key picture (DESIGN: needs drawing). Recommendation: approve the wording; design draws the picture.
5. Should passkeys get the same green success state? Recommendation: yes, for consistency.
6. (New, m2) Leaving the green card without Continue leaves the setup step open. Recommendation: accept as is, or mark the step done as soon as the key is added and keep Continue only for moving on.
