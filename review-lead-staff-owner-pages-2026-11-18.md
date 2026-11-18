# Review: wip/lead-staff-owner-pages @7ed3db4d (Plan 4 Task 17), 18 Nov 2026

Reviewer: independent security reviewer (cloud lead helper). Base wip/lead-land-tw 001959cc, 4 commits
(b280b483, e72d0008, a78c6c47, 7ed3db4d). One round.

**Verdict: APPROVE** (minors below do not block).

## Tests run (targeted, outside the lock, `nice -n 10`, per the 18 Nov lock rule)

- `@x2f/api`: site.test, staff/web.test, staff/matrix.test, staff/settings.test, staff/members.test
  (invites live in members.test): 5 files, 183 passed, 0 failed.
- `@x2f/staff-web`: ownerPages.test, webauthnTripwire.test: 2 files, 30 passed, 0 failed.
- Typecheck `@x2f/api` and `@x2f/staff-web`: clean.
- Not run: the full `npm run check` (the brief asked for targeted runs only), Playwright owner.spec.

No test was weakened: the only edits to existing tests are additions (site.test's logAlarm case,
web.test's `/staff` app-page and `/staff/*` 404 cases, three new KEY_TAP_CALLERS entries).

## What was checked

- **Invite creation.** The browser makes inviteId (randomUUID), the token (32 bytes from
  getRandomValues, base64url) and expiresAt (serverNow + 24 h), and builds the `create-invite`
  intent with `inviteTokenHash(token)`. The server (invites.ts, unchanged here) re-derives the
  intent from the request body and consumes the tap in the insert transaction, so a swapped token,
  hash, role or expiry fails the tap. Expiry is capped server-side at now + TTL + skew; the
  inviteId/token_hash insert is `on conflict do nothing` → 400, and the tap is single-use, so an
  invite cannot be reused or extended. The link is shown in a read-only `data-mask` input, kept
  only in React state, never put in the URL, history, storage or console; responses carry
  `referrer-policy: no-referrer` and `no-store`.
- **Role, switch-on, remove, grants.** `set-role {accountId, role}`, `switch-on {accountId, role}`,
  `remove-staff {accountId}` and `set-grants` are each bound by the page and re-derived by the API
  (members.ts, unchanged); none can be done without a tap. Switch-off goes with no tap (lead call).
  The owner's row renders no action and the API's `lockTarget` refuses `owner-protected`.
- **Settings and pay.** A change to the large-trade limit or appeal window takes a `settings` tap of
  all three values after the change; first-response-only goes untapped, as the API allows. Pay
  takes a `pay-settings` tap of all four values; the tap intent and the PUT body come from the same
  render's `nextPay`, so they agree.
- **Emergency stop / resume.** `emergency-stop` and `resume-trading` taps, as the API requires.
- **Banner.** Rendered as React text only (no `dangerouslySetInnerHTML` anywhere in staff-web);
  the server trims, refuses control characters and enforces 140 code points (`banner-too-long`).
  The client counter is stricter (counts untrimmed), which is harmless.
- **`/staff` routing.** Only the exact path `/staff` (query stripped) serves index.html; `/staff/`,
  `/staff/v1`, `/staff/anything`, `/STAFF/v1/x` stay the API's 404 (tested). No API route is
  `/staff` alone, so nothing JSON is shadowed; index.html is public anyway.
- **`logAlarm`.** Added only in `readStaffSiteState` (staff routes); `readSiteState` and
  `GET /v1/site` are untouched, and site.test asserts the key is absent for both trader and
  outside callers.
- **Tripwire.** StaffList, StaffOverview and StaffSettings are listed in KEY_TAP_CALLERS with
  ownerPages.test covering each intent.

## Minors (non-blocking)

1. StaffList shows the API's returned `link` rather than one it builds itself. The API already
   sees the token, so this is not a leak, but a misconfigured `staffOrigin` (or a tampered
   response) would hand the owner a link to another origin. Suggest checking that `r.link` is
   `${location.origin}/invite/${token}` (or building it locally) before showing it.
2. Tap dialogs label `accountId` with `displayName ?? ''`, so a member without a display name
   gets a blank name in the dialog. Fall back to the account id.
3. Observations, not changes in this branch: login-hours changes and the banner take no tap (as
   the API was built). Widening someone's hours arguably grants power; if the owner wants it
   tapped, that is an owner question, not a fix here.
