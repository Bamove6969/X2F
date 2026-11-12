# Device-bound sessions (S-085), 12 Nov 2026

Register row S-085 (owner, 30 Oct lead window): "Device-bound sessions (DBSC-style, non-copyable
browser key) = new task BEFORE mainnet." This spec is the lead helper's design. It is built behind
two flags that are off by default. Nothing changes for anyone until both are on.

## 1. What main has today

- **Session cookie.** `__Host-x2f_session` (`apps/api/src/auth/sessions.ts`) holds a bearer
  token: 32 random bytes, HttpOnly, Secure, SameSite=Strict, Path=/. The server stores only its
  SHA-256 (`sessions.token_hash`). "Stay logged in" rotates the token (`rotateSessionToken`), and
  the old one lives to the session's old end (`prev_token_hash`). Whoever holds the cookie value
  is the session, from any machine.
- **Device cookie.** `__Host-x2f_dev` (`auth/device.ts`) is 32 random bytes, HMAC'd into
  `trusted_devices` ("known device" for new-login approval). It is also a bearer value: copying it
  copies the "known device".
- **WebCrypto keys.** The web app already keeps non-extractable AES-GCM `CryptoKey`s in IndexedDB
  to wrap the escrow store (`apps/web/src/escrow/store.ts`) and the chat store
  (`apps/web/src/chat/store.ts`). There is no signing key and nothing proves possession of a key to
  the API.
- **Who calls the API.** The web app uses three fetch paths: `api()` (`apps/web/src/api/client.ts`),
  the auth client (`apps/web/src/screens/auth/authApi.ts`, which every login, setup and approval
  flow goes through), and the chat and escrow HTTP adapters. It also uses one `EventSource`
  (`GET /v1/events`), which cannot set headers.

## 2. Threat model

**In scope (what this stops).** Theft of the cookie *values*:
- malware or an extension that reads the browser's cookie store or profile files;
- a backup or sync of the profile;
- a copy from a shared or seized machine;
- a log line or a proxy that saw a `Cookie` header;
- a `document.cookie` read (blocked anyway by HttpOnly).

Today any of these gives a full session from anywhere until the session ends (up to 12 h for a
trader session, longer with "Stay logged in"). With binding on, a copied session becomes useless
within `BOUND_TTL` (10 minutes) of the copy, because keeping it alive needs a signature from a
private key the browser cannot export.

**Out of scope (what this does not stop).**
- **Code running in the page or the profile while the person is logged in** (XSS, a malicious
  extension with page access, malware driving the browser). It can use the key through WebCrypto
  without exporting it, exactly like the app does. Binding limits theft to "while the attacker is
  on the device", not "forever, anywhere".
- **Theft of the IndexedDB `CryptoKey` record itself.** A non-extractable key is not exportable
  through WebCrypto. A browser stores it in the profile, though, and an attacker with full
  file-system access to an unlocked profile may still be able to lift it; how much protection
  there is depends on the browser and the OS. It is not hardware-backed (unlike Chrome's DBSC,
  which uses a TPM where present).
- **Live interception of TLS traffic.** Out of scope; TLS is the answer.
- **A stolen login method** (password plus code, a passkey). That is a new login, not a copied
  session; the login rules and the new-device approval cover it.
- **The device cookie.** It stays a bearer value. Binding it to the same key is a follow-up (§9).

## 3. Scheme (DBSC-style short-lived bound cookie)

The session cookie stays exactly as it is. A second, short-lived cookie proves that the session's
key was used recently. Only the bound cookie expires fast. Renewing it needs a signature over a
fresh server challenge.

1. **Key.** At first use the web app generates an ECDSA P-256 key pair with WebCrypto,
   `extractable: false`, usage `sign`. It keeps the `CryptoKey` pair in its own IndexedDB database,
   `x2f-device-key`, one per browser profile and reused by every session there (like the device
   cookie). Only the public key is ever read out (SPKI).
2. **Binding at login.** Every POST through the auth client carries the public key in a header,
   `X2F-Session-Key: <base64url SPKI>`. `openSession`, the single place every login, sign-up,
   recovery, approval and team-join session is created, reads it.
   - With the server flag on and a well-formed P-256 key, the new session row stores `bound_key`
     and is issued its first bound cookie in the same response.
   - A malformed header is 400 `bad-request`: the client asked for binding and must not be left
     believing it got it. It is checked in an `onRequest` hook on the trader API, at the top of
     every request that carries it, before any body is read or any login factor (a code, an
     approval, a challenge) is checked or spent (review S5). The staff API ignores the header.
   - No header leaves the session unbound (§6).
   - Binding happens at creation, so there is no window in which a thief can bind first, and the
     key can never be changed or removed for the life of the session: no route unbinds.
   - No proof of possession is needed at binding. Binding a key you do not hold only locks out your
     own new session.
3. **Bound cookie.** `__Host-x2f_bound` (HttpOnly, Secure, SameSite=Strict) holds 32 random bytes.
   A disabled account answers 403 `account-disabled` before this check (re-verify Info), so a
   bound session on a disabled account sees "account disabled", not the login page.
   The row stores its SHA-256 and `bound_until = now + BOUND_TTL` (10 min). For a bound session,
   `requireSession` refuses any request whose bound cookie is missing, wrong or past
   `bound_until` with 401 `session-proof-required`. That includes `GET /v1/events`, which carries
   cookies like any request.
4. **Refresh.** Two routes, the only ones that accept a bound session without a fresh bound cookie
   (`requireSession({ allowUnproven: true })`; every other session check still applies):
   - `POST /v1/account/session/proof/challenge` → `{ challenge, session }` (`session` is the
     session's id, as `GET /v1/account/sessions` shows it). The challenge is stateless (review
     MF1): base64url of a 16-byte nonce, its expiry (now + 2 minutes) and an HMAC-SHA-256 under
     `subkey('session-proof')` over the session id, the expiry and the nonce. Nothing is stored,
     so any number may be outstanding (several tabs renewing at once), and asking for one, or
     answering one wrongly, never spoils another (a cookie thief cannot log the person out this
     way). An unbound session gets 409 `not-bound`.
   - `POST /v1/account/session/proof { challenge, signature }`. The challenge must be this
     session's own (the HMAC) and unexpired. It is single-use: the first answer to it records its
     nonce in `session_proof_nonces` until it expires, whether the signature then passes or fails.
     The signature is ECDSA P-256 / SHA-256 in WebCrypto's IEEE-P1363 form, over the UTF-8 bytes
     of the v2 message (review S1):

     ```
     x2f-session-proof-v2\n<origin>\n<session id>\n<challenge>
     ```

     `<origin>` is the page's origin (the server uses the request's checked `Origin`). On success
     a new bound cookie is set and `{ boundUntil }` is returned; on failure, 401 `proof-invalid`.
   - Budget (review S2, re-verify R2): refused proofs are charged to a strict per-session budget
     (`SESSION_PROOF_BUCKET`, 20 at once, 10 a minute; 429 `slow-down`). A valid proof is never
     charged, so whoever holds a copied session cookie cannot spend what a valid renewal needs.
     Challenges have no per-session cap (re-verify 2): they write nothing (one HMAC, one indexed
     select), the deployment's request limits cover them (the API has no app-wide limiter), and a
     per-session cap would be shared with the thief while the person needs a new challenge for
     every renewal.
   - Renewal keeps the previous bound cookie valid until the earlier of its own end and now + 60 s
     (`BOUND_OVERLAP_MS`, columns `bound_prev_hash` / `bound_prev_until`, re-verify R1), as the
     session token's `prev_token_hash` does. Every tab shares the one cookie jar, so a request
     another tab already sent with the old cookie still passes. Only the one previous cookie gets
     the overlap. A copied cookie still dies within `BOUND_TTL`.

   The web app refreshes ahead of time, at a third of `BOUND_TTL`, while a bound session is open.
   Renewals are serialised across the profile's tabs with the Web Lock `x2f-proof` where the
   browser has Web Locks (review MF1). `api()` and the auth client renew once on a 401
   `session-proof-required` and retry the request once, also when the renewal was refused
   (another tab may have renewed the shared cookie); only a second `session-proof-required`, or a
   renewal answering `not-authenticated`, ends the session. A renewal that meets the network, a
   5xx or a 429 is `retry-later` (review MF2): the request fails like a network error, and the
   session is not ended; the timer or the person's next action renews again.
5. **Logout** never needs the proof (`logoutRoute` reads only the session cookie), so a browser
   that lost its key can always log out.

**Why this shape.** A signature on every request was considered and rejected. `EventSource`
cannot add headers. The chat and escrow adapters would each need the signer. Every request would
pay an ECDSA verify. A replay window would still be needed. The short-lived cookie confines the
crypto to one route every few minutes, and every existing fetch path keeps working unchanged. It
is the pattern of Chrome's Device Bound Session Credentials (DBSC); the browser's native DBSC
(`Sec-Session-Registration` / `Sec-Session-Response`) is Chrome-only today, so this does the same
thing in page JavaScript, which works in every browser with WebCrypto and IndexedDB.

## 4. Server data

Migration `570_device_bound_sessions.sql` adds these columns to `sessions`, all null by default:
- `bound_key bytea`: SPKI DER of a P-256 public key, at most 200 bytes;
- `bound_token_hash bytea`, `bound_until timestamptz`;
- `bound_prev_hash bytea`, `bound_prev_until timestamptz`: the previous bound cookie during its overlap;

and the table `session_proof_nonces (nonce, session_id, expires_at)`: the used challenges' nonces,
deleted with their session, and pruned per session by the proof route once expired.

The key is a public key: it is not secret and is never logged.

## 5. Flags

- **API:** `X2F_DEVICE_BOUND_SESSIONS` = `off` (the default) or `on`. With `off`:
  - the header is ignored;
  - nothing is bound;
  - `requireSession` checks nothing new, even on a session bound while the flag was on (turning it
    off is the kill switch);
  - both proof routes answer 404 `not-found`.
- **Web:** `VITE_X2F_DEVICE_BOUND=1` at build time. Without it, the app makes no key, sends no
  header and runs no refresh.
  - Where it lives: `apps/web/src/session/deviceKey.ts` (the key, the header value, `renewProof`,
    the refresh timer); `authFetch` in `apps/web/src/screens/auth/authApi.ts` adds the header to
    every auth-client POST; `api()` (`apps/web/src/api/client.ts`) and `authFetch` renew once and
    retry once on `session-proof-required` (§3.4: `retry-later` never ends the session); `useSession`
    starts the timer on a signed-in answer and `sessionEnded` stops it. The timer also stops for
    good on 409 `not-bound` or the flag-off 404. Tests: `apps/web/test/deviceKey.test.ts`.

## 6. Fallback when the key is missing

- **No WebCrypto or IndexedDB, or a refused key generation** (some private modes, very old
  browsers): no header is sent, and the session is unbound and works exactly as today. Whether
  such a session should be refused, or count as weaker, before mainnet is an owner question (§8).
- **Key lost after binding** (site data cleared while the session cookie survived, or another
  profile): the bound cookie expires within 10 minutes. The challenge then cannot be signed (the
  app has a different key, or none), so the session ends: `api()` treats a refused renewal
  followed by a second `session-proof-required` as a gone session and sends the person to log in
  again.
  Logging in binds a new session to a new key.
- **Unsupported key type sent:** 400 at login, so a client bug is seen at once rather than leaving
  a silently unbound session.

## 7. Browser support

WebCrypto ECDSA P-256 with non-extractable keys stored in IndexedDB (structured clone of
`CryptoKey`) works in:
- current Chrome, Edge, Firefox and Safari (desktop and iOS 14+);
- Tor Browser (Firefox ESR) in its normal security level.

IndexedDB is unavailable, or wiped at the end of each session, in some private or "never remember
history" modes. There the key lives only as long as the window, which still binds that session
(the session dies with the window too). Where IndexedDB throws, the fallback in §6 applies.

## 8. Owner questions (behaviour the user sees)

1. **Unbound sessions at mainnet.** With the flags on, a browser that cannot make a key still
   logs in unbound (today's protection). Should it instead:
   - (a) be refused,
   - (b) count as a "weak" session (limited like a weak login), or
   - (c) stay allowed?

   Recommendation: (b), with a notice.
2. **Re-login after clearing site data.** Clearing site data now also logs the person out within
   about 10 minutes. Recommendation: accept, and say so on the Devices page.
3. **`BOUND_TTL` of 10 minutes.** Shorter means a stolen copy dies sooner, at more refreshes.
   Recommendation: 10 minutes.
4. **Staff app.** Not wired yet: staff sessions are never bound. Recommendation: bind staff-web
   next, with the same routes on the staff API.
5. **Sessions opened before the flags go on (review S3).** A session is bound only when it is
   created, so every trader session already open at flag-on stays unbound for the rest of its life,
   with today's protection (a copied cookie works until the session ends: 12 hours, or longer with
   "Stay logged in"). Either:
   - (a) accept it: those sessions age out on their own; or
   - (b) revoke every unbound trader session once at flag-on, which logs everyone out once and makes
     every new session bound (where the browser can make a key).

   Recommendation: (b) at mainnet launch, when few sessions exist; (a) if the flags go on later,
   with a notice. Decide before switching on.

## 9. Not in this change

- Binding the device cookie (`trusted_devices`) to the same key.
- Showing "bound to this device" on the Devices page.
- Native DBSC headers where Chrome offers them.
- The staff app.
- An alert when a bound session's proof fails repeatedly (possible theft signal).
