# Re-review 3 (confirm pass): wip/lead-mod-chat @a88a5cac, 18 Nov 2026

This is an addendum to `re-review-2-lead-mod-chat-2026-11-18.md`. It covers 5 commits on top of 82c8d4de, in a detached scratch worktree; no branch code was changed.

## Verdict: CHANGES NEEDED (one new M; all five round-3 minors are fixed)

### The five minors

| Minor | Status | Checked |
|---|---|---|
| m1 | Fixed | `retryable()` treats 5xx, 401, 408, 409 and 429 as transient. Only any other 4xx stops a notice. There is a test. |
| m2 | Fixed | The watermark is raised only from signed API-clock times: the switch-on's or the reset's issuedAt. A device the gate revoked on its own clock keeps the 2-minute allowance on `before-revoke`. A revoke-device tap revokes as of its signed issuedAt (never later than now), compared strictly. My skew probe P3 (gate clock 10 s ahead) now passes, and so do P1 and P2. New probes P5 (revoke, then re-certify the same key 1 s later, in one sync) and P6 (the same across two syncs): both live, so no new dead end there. |
| m3 | Fixed | `staff-device-certified` goes in-app and by push to the owner, in-app to the person (not to the owner twice), and as one Jabber account-change notice when the person has Jabber set up. The detail holds the staff id and device id only, with COPY-UNSIGNED copy. The push is after commit and never fails the route. There is a test. |
| m4 | Fixed | An OR over every byte, as `sodium_is_zero` does. There is a test with a secret that is zero except for its last byte. |
| m5 | Fixed | The NaCl core1 and core2 vectors are in `sealedWebCrypto.test.ts`. |

### M1 (new, found on this pass; the code dates from N8 at 4cc00750): a revocation made with a second security key is lost if the gate syncs it together with the certification

`apps/moderation/src/gate/devices.ts:116`: `verified.sort((a, b) => a.c.counter - b.c.counter)` sorts the device taps of *all* keys by their signature counters. But counters are per authenticator, so they cannot be compared across keys. The source already returns taps in the API's order (`order by finished_at, id`).

Failure scenario (scratch gate test P4, using the owner's two keys):
1. A device is certified with key 1, whose counter is high.
2. Before the next sync (60 s, or longer while moderation is down), it is revoked with key 2, whose counter is low.
3. The gate judges the revoke first, finds no such device, and refuses it as `device-revoke`. The tap is spent.
4. The gate then certifies the device. It is live in the gate until it expires (365 days), while the API lists it as revoked.

The same happens to a staff member who has a backup key. This is exactly the reaction m3's new alert asks for ("If this was not you, revoke it"). A quick revocation of a planted key, made with the other key, is silently undone, and the device stays a valid re-wrap target for a compromised API. A switch-off or a security reset still revokes it.

Fix:
- Keep the API's order across keys. Judge counter order only within one key: a stable sort by credential then counter, or no sort at all with a per-key running mark (the N8 view already gives the pre-sync mark).
- Test: certify with one key and revoke with another of the same person in one sync, with the revoking key's counter lower. The device must not be live.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| moderation: notices, gateDevices, internal, gate, grant | 5 | 126 |
| protocol: sealedWebCrypto, chatV2 | 2 | 27 |
| api: staff/devices, chatGrant, staff/members | 3 | 48 |

My gate probes are kept (not committed) at `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/rr3-zzProbe.test.ts`: P1-P3, P5 and P6 pass; P4 fails. Playwright was not re-run: nothing staff-web changed. Runner I is running the full suite.
