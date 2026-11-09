# Security review: wip/lead-front-door (2026-11-08)

- Branch: origin/wip/lead-front-door, head **2f6d2c978f86755568564eb95756e624bc26a6a5**, against origin/main (1ffa1930).
- Reviewer: independent security reviewer (read-only, throwaway worktree, since removed).
- Owner rule: "No one gets to make it past the front door and see behind the curtains without signing an agreement, creating an account and logging in. There are no free tours for outsiders."

## Verdict

**Ready to land for the API and web gate, with one owner question (F1).** The gate is sound. Every trader-API route that returns marketplace data (offers, offer detail, method counts and best rates, price, news, the site banner and trading pause) now runs behind `requireInside`. That is a live full session of a `trader` account on the current Terms. Recovery sessions get 403, stale Terms get 403 `terms-required`, staff sessions get 401 (wrong realm), and nothing reaches the database before the check. The open routes all serve the front door and leak nothing more than they must. The web router puts every screen behind `BehindTheDoor`. `returnTo` cannot leave the origin.

F1 asks the owner to decide whether team members must sign the Terms themselves; today they never do. F2 is a hardening item for the route-list test. F3 is a wording mismatch the lead should confirm. The branch merges cleanly with current origin/main (the method picker is web-only and reads `/v1/methods`, which is now gated; its e2e stub defaults to signed-in).

## Tests run (under `flock ~/x2f-comms/check.lock`)

RESULTS_PLACEHOLDER

## Route table (trader API, `apps/api/src/app.ts` buildApp; all registered unconditionally)

Legend: **Inside** = `requireInside` (`auth/frontDoor.ts:20`: trader, full, current Terms, any member, no touch). **Trader** = `requireSession({kinds:['trader']})` or similar: full session, current Terms, owner-only unless `member` is set. **+rec** = also lets recovery sessions in. **+stale** = also lets stale Terms in. Every route under **Own** returns only the caller's own account, trades or chats.

### Public (no session); all listed in `PUBLIC_ROUTES` with a reason

| Route | Returns | Holds? |
|---|---|---|
| GET /healthz | `{ok:true}` | yes |
| GET /v1/site | outside: `{maintenance:{kind}|null}` only; inside: banner, pause, message (`site/routes.ts:96`) | yes; tested both sides, the message never leaks outside |
| POST /v1/logout | nothing | yes |
| GET /v1/terms | `{version}` only (`routes/account.ts:223`) | yes |
| GET /v1/pgp/signing-key | X2F's public key | yes |
| POST /v1/register/{password,pgp/*,webauthn/*} | sign-up (Terms acceptance enforced by `assertTermsAccepted`, `accounts.ts:283`) | yes (see F4) |
| POST /v1/login/{password,pgp/*,webauthn/*,second-factor,backup} | log-in | yes |
| POST /v1/login/approval/:id/{poll,cancel} | status only (waiting/expired/blocked) | yes |
| POST /v1/team/invite | with a valid secret code (256-bit, 24 h): the vendor's display name, the member's display name, roles, expiry; a used, expired or wrong code gives `{"error":"not-found"}` | see F3 |
| POST /v1/team/join/{start,finish}, /second/{webauthn,pgp}/{start,finish} | member sign-up, needs the invite code or setupId | yes (see F1) |

### Inside (`requireInside`); changed by this branch

| Route | Logged out | Recovery | Stale Terms | Test |
|---|---|---|---|---|
| GET /v1/offers | 401 | 403 | 403 | frontDoor.test READS |
| GET /v1/offers/:id | 401 (same body for real and missing ids) | 403 | 403 | READS + no-leak test |
| GET /v1/methods | 401 | 403 | 403 | READS |
| GET /v1/price | 401 | 403 | 403 | READS |
| GET /v1/news | 401 | 403 | 403 | READS |
| GET /v1/site (inside view) | outside view | outside view | outside view | site tests |

### Session-guarded, own data only (unchanged; checked that none returns marketplace data about others)

- Account: GET /v1/account/me (+rec +stale, member any), logout-timer, devices, sessions, methods (+rec +stale); GET /v1/account/alerts (+rec); POST /v1/account/terms (+rec +stale, owner-only); login-name, confirm/*, add-key pgp/webauthn/totp/password (+rec, held refused); DELETE methods and recovery-sessions; GET/POST /v1/account/approvals*.
- Offers: GET /v1/account/offers, POST /v1/account/offers/status, PATCH /v1/offers/:id (+stale, member offers); POST /v1/offers.
- Trades: GET /v1/trades/:code, events, final-alert-seen, confirmations, dispute, appeal (FINISH_OPEN_TRADES: +rec, held allowed, member trades; participants only); identity, attestation (trader); POST /v1/offers/:id/take, /v1/trades/:code/wallet.
- Chats: /v1/chats*, /v1/trades/:code/chat (trader, owner-only).
- Reviews: /v1/reviews/pending, /v1/trades/:code/review[/skip] (trader).
- Nudges and blocks: POST /v1/nudges, GET/PUT /v1/account/nudges, GET/POST/DELETE /v1/account/blocks (trader).
- Wallets: /v1/wallets*, /v1/wallets/rule. Push: GET/POST/DELETE subscription (VAPID public key). Events: GET /v1/events (SSE, trader, no broadcast topics; only per-account and per-trade events).
- Other: /v1/method-suggestions (POST), /v1/feedback, /v1/feedback/form (+rec +stale +held, write only), traded-total setting, past-rep (own), team owner routes (GET /v1/team, audit, invites: trader, owner-only).

The staff app (`staff/app.ts`) is a separate realm. A staff session on the trader API gets 401 (`sessions.ts`, the `row.app` check), and `requireInside` refuses non-trader kinds. Its public routes (login, invite accept by token: role, hours and expiry only) return no marketplace data. This branch does not change them.

### The gate (`auth/sessions.ts:333-385`)

- No cookie gives 401 before any DB query. A forged cookie misses the token-hash lookup and gives 401 (tested). Revoked, idle or absolute-expired sessions give 401. A wrong-realm (staff) session gives 401. A session of a `member` login account itself gives 401. A removed member gives 401. A disabled account or member gives 403.
- Recovery sessions get 403 `recovery-session`. Non-trader kinds get 403 `wrong-account-kind`. A stale `terms_version` gets 403 `terms-required`. All of this happens in a preHandler, before the handler's query parsing or any read, so a logged-out caller learns nothing from timing or counts (tested: real offer id vs missing id give the same 401 body).
- "Half set-up" on the server means Terms not current. Sign-up refuses to create an account without the current Terms (`assertTermsAccepted`), so a trader account is never created without them. Skipping the optional setup steps (backup, wallet) still leaves a fully signed-up account. That matches the owner rule (agreement, account, login).

### Web

- `App.tsx`: every screen except /login, /login/backup, /setup/*, /terms and /team/join sits under `<BehindTheDoor>`. It renders nothing while the session loads, sends anyone outside to `/login?returnTo=…` or `/terms?returnTo=…`, and limits a recovery session to Security, its own trades and Feedback. The catch-all goes to /sell and then to the login. The front-door screens call only auth, Terms and invite APIs (checked across screens/auth and screens/setup). The desktop header is hidden on the front door for anyone not inside. React Router matches case-insensitively and FRONT_DOOR does not, which fails closed (`/SELL` is still gated).
- A 401 from any call sends the shell to the login (`client.ts` `sessionGoneListener`).
- `returnTo` (`client.ts:69 safeReturnTo`, unchanged): verified directly. `//evil.com`, `https://evil.com`, `https:evil.com`, `/\evil.com`, `/..//evil.com`, `/.//evil.com`, `/%2e%2e//evil.com`, `/\t/evil.com`, `///evil.com` and `javascript:` all become the default. `/%2F%2Fevil.com` and `/%5Cevil.com` stay as same-origin encoded paths (harmless). The Login link to `/setup?returnTo=` encodes an already-sanitised value.

## Findings

### F1 (Medium, owner decision): team members get inside without ever signing the Terms

- `apps/api/src/team/members.ts:373` creates the member's login account with `termsVersion: null`. No step of `/v1/team/invite`, `/v1/team/join/*` or `screens/auth/MemberInvite.tsx` shows or records the Terms.
- `requireInside` (`auth/frontDoor.ts:20`, `member: 'any'`) checks only the **team account's** `terms_version` (`auth/sessions.ts:385`: `row` is the team account; the member's own account is joined only for `disabled_at`).
- Scenario: a vendor invites anyone. That person opens the link, makes a login name and two factors, and from then on browses every offer, rate, count and news item, and can trade for the vendor, without ever agreeing to anything. Under the owner's wording ("without signing an agreement") this is a free pass for every invited person.
- Side effect: after a Terms version bump, a member gets 403 `terms-required` and the web sends them to /terms. `POST /v1/account/terms` (`routes/account.ts:282`) has no `member` option, so it answers 403 `owner-only`, and the member is stuck until the vendor accepts. That is a UX dead end, not a leak.
- Fix (if the owner wants members to sign): have `/v1/team/join/finish` (or the last factor's finish) require `acceptedTerms === config.termsVersion` and store it on the member account. In `requireSession`, for `member_id !== null`, also select `ma.terms_version` and give 403 `terms-required` when it is stale. Let `POST /v1/account/terms` accept a member session and write the member account's row. Add the Terms step to MemberInvite. Add a frontDoor test: a member session on a stale member Terms gets 403 on every READS url.

### F2 (Low, hardening): the route-list test proves "some session", not "the front door"

- `apps/api/test/frontDoor.test.ts` ("the route list") skips every route where `runsWithSession(preHandler)` is true. A future GET returning other traders' data behind `requireSession({ allowRecovery: true })`, `allowStaleTerms`, or a guard without `kinds` would pass. Only the hand-kept READS list (5 urls) checks the 401/403 behaviour.
- No current route is affected (see the route table).
- Fix: mark `requireInside` (a symbol, as SESSION_HOOK does) and add a second list, `OWN_DATA_GETS`, with a reason for every GET route that is session-guarded but not `requireInside`. The test fails when a new GET is neither. Also derive READS from the routes that carry `requireInside`, so each gets the 401, recovery-403 and stale-403 checks automatically.

### F3 (Info, lead confirm): a valid invite still names the vendor to a logged-out holder

- `routes/team.ts:215`, `team/members.ts:343`: `POST /v1/team/invite` with an unused, unexpired code returns `team` (the vendor's display name), the member's display name, roles and expiry. The branch makes only **used, expired or wrong** invites anonymous (`{"error":"not-found"}`, tested in `test/team.test.ts` and `web/test/team.test.tsx`).
- The brief said "invites never name the vendor to a logged-out visitor". The code is a 256-bit, single-use, 24-hour secret, so this is the person the vendor chose, or anyone they forwarded the link to. It is a reasonable design, but it differs from the brief's wording. Confirm which one the owner meant. If it must be anonymous until joined, return only roles and expiry until the first factor is proved, and show the vendor name after `join/finish`.

### F4 (Info, residual): sign-up reveals whether a display name exists

- `POST /v1/register/*` answers 409 `names-unavailable` for a taken display name, so an outsider can test whether trader "X" exists. This is inherent to unique public names and predates this branch. Note it as accepted residue, or rate-limit it (the register budget already applies).

## Not findings (checked)

- `insideAccount` treats every 401 and 403 as outside and rethrows anything else. A recovery or stale-Terms session sees only the outside site view (tested).
- `touch: false` on reads: polling never keeps an idle session alive (tested on /v1/site and /v1/news).
- The maintenance `onRequest` gate gives every outsider 503 `maintenance`, which is the same fact `/v1/site` already tells them.
- `viewer()` was removed. `viewerId` is now always the caller, so blocks always apply and `markOpensAt` always runs. No null-viewer path remains.
- `/v1/events` has no marketplace broadcast. The staff app is unchanged.
