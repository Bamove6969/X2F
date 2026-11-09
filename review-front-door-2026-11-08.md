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

## Review 6a5949a6 (cloud lead reviewer, 8-9 Nov)

- Branch `wip/lead-front-door`, head **6a5949a6** (merged with main 0c6f3f16). I reviewed `git diff origin/main...HEAD` (64 files) in /home/user/X2F/.claude/worktrees/front-door. Read-only; no code changed, no commit.
- Owner rule under test: "No one gets to make it past the front door and see behind the curtains without signing an agreement, creating an account and logging in. There are no free tours for outsiders." Also: a session that ends lands on the Landing board, and a signed-out visitor to any screen goes to `/?returnTo=`.

### Verdict: APPROVED WITH MINOR

F1, F2 and F3 from the 2f6d2c97 review are fixed correctly. I found no route that serves marketplace or account data to an outsider, a recovery session, or a session on old Terms (owner or member). The route-list tests read the real route table. `returnTo` cannot leave the origin. A valid invite no longer names the vendor in its payload, its copy or the WebAuthn options, and a bad invite still answers only `not-found`. Nothing here weakens CSP, headers, the service worker or static serving. What is left: one dead end for members (UX, no leak), the Logo/shell merge with wide-shell, and small hardening and comment fixes.

### Tests run (serialised runner)

- `apps/web/test/frontDoor.test.tsx` + `apps/web/test/team.test.tsx`: **2 files, 78/78 passed** (log `fd-review-web-*`).
- `apps/api/test/frontDoor.test.ts` (and `team.test.ts`): **did not run.** The Postgres global setup failed three times on `docker port <id> 5432/tcp: no public port published`. This is a box/Docker fault (6 of the 12 logs in scratchpad/logs show the same error), not the branch. It must run green before landing.
- Playwright: **not run** (the common brief forbids it). The builder says many specs passed one at a time and the full check was not run.
- `npm ci` was run in the worktree to do this (the brief allowed it). The worktree is otherwise unchanged.

### (1) Gate coverage

- Every marketplace read now runs behind `requireInside` (`apps/api/src/auth/frontDoor.ts:20`): GET /v1/offers (`offers/routes.ts:526`), /v1/offers/:id (`:566`), /v1/methods (`methods/routes.ts:80`), /v1/price (`price/routes.ts:15`), /v1/news (`news/routes.ts:17`), and the inside view of /v1/site (`site/routes.ts`, via `insideAccount`). `viewer()` is gone, so no handler has a null-viewer path left.
- The F1 member check is in the shared gate (`auth/sessions.ts:383-387`): `row.member_id !== null && ma.terms_version !== current` gives 403 `terms-required`. Every `requireSession` route therefore enforces it, not only `requireInside`. The one Terms check outside the gate (`offers/routes.ts:385` `assertTermsCurrent`, used for relisting) checks the member too. `GET /v1/account/me` `termsCurrent` (`routes/account.ts`) matches the gate, so the web's `isInside` and the API agree.
- **The route-list tests enumerate the real table.** `apps/api/test/frontDoor.test.ts:17-29` wraps Fastify's `onRoute` on the app that `testApp` builds with `buildApp`. Every route registration in `app.ts:271-334` is unconditional; the only conditional block is the cancel-return watcher, which registers no route. Test `:91` requires the routes with no session guard to equal `PUBLIC_ROUTES`. Test `:106` requires every session-guarded GET to be in exactly one of two sets: `requireInside`, which must equal READS (each READS route then gets checks for logged out, forged cookie, stale Terms, recovery and member on stale Terms), or `OWN_DATA_READS`. Neither list can drift without the test failing. I checked all 29 `OWN_DATA_READS` entries: each returns only the caller's own account, trades, chats, team or settings.
- The web route table test (`apps/web/test/frontDoor.test.tsx:22`) also reads its paths from `App.tsx`, not from a hand list.
- No route leaks. The one gap in the enumeration is F2b below: non-GET routes behind a session are not classified.

### (2) returnTo

`apps/web/src/api/client.ts:69 safeReturnTo` is unchanged and tested in `test/client.test.ts`. I also ran it directly:

- These all become `/sell`: `//`, `https:`, `javascript:`, backslash, raw control characters (tab, CR, LF), `/..//`, `/%2e%2e//`, and anything over 2048 characters, before or after normalising.
- `/%2F%2Fevil.com`, `/%5Cevil.com`, `/%2e%2e%2f%2fevil.com` and `/%09/evil.com` come back **as they are**, as same-origin opaque paths. I found no sink that decodes them before navigating: every follow is react-router `navigate`/`<Navigate>`, and `browserGo` (`client.ts:43`) only ever gets a fixed pathname plus an encoded `returnTo`. These paths land on the catch-all and then `/`, so they are harmless. The brief's wording is "no encoded slashes", though; see F4 (Minor).
- Landing (`screens/auth/Landing.tsx:70`), Login and Terms all pass `returnTo` through `safeReturnTo` before they use it or carry it on. `doorVerdict` builds it from `safeReturnTo(pathname+search)`.

### (3) Terms for members

- Stale member Terms: `/terms`, then `POST /v1/account/terms` (now `member: 'any'`, `routes/account.ts:297`). This writes only the member's own login account (`kind = 'member'` and the `team_members` subquery), then goes back to `returnTo`. No loop, tested at `frontDoor.test.ts:204`.
- `join/start` checks the invite first and then the Terms (`routes/team.ts:228-233`), so a bad invite still answers 404 whatever `acceptedTerms` is. `join/finish` checks again (`:251`), so a Terms bump in between gives 400 and the account is not made on old Terms.
- **Known gap (F5): a member on current Terms whose team account is on old Terms.** It leaks nothing: the gate gives 403 on every read, and `/v1/site` shows only the outside view (tested at `:219-229`). It is a lockout loop that needs a person to click, not an automatic redirect loop:
  1. `doorVerdict` (`session/frontDoor.tsx:67`) sends every screen behind the door to `/terms`.
  2. The member is told "The Terms of Service have changed... accept them to keep trading". Accepting gives 204 and changes nothing, and they are sent straight back to `/terms`.
  3. They cannot reach Settings to log out (no logout on `/terms` or `/`), so on a shared device the session lasts until the idle timer.
  4. Open trades stay reachable through the API (FINISH_OPEN_TRADES allows stale Terms), but the web sends `/trade/:code` to `/terms` too. A member cannot finish a trade in the web UI until the account owner accepts.

  So this is more than a UX gap: it is a lockout of the member with no way to log out, and no data leaks. Severity Minor for security. The wording needs an owner decision (Q1).
- Deploy note: every existing member has `terms_version = null`, so every member gets the Terms screen on their next visit. That is the intended F1 behaviour, and the lead should expect it.

### (4) Invite never names the vendor

- `InviteView` no longer has `team` (`team/members.ts:305-309`, `inviteView` `:345`), and neither does `@x2f/auth-client` `TeamInviteView`. The copy is "You are invited to a team as {name}, for {roles}." (`teamCopy.ts:95`).
- Other answers on the join path: `join/finish` returns `{setupId, setupUntil, needs}`. The PGP challenge uses the fixed `PGP_PURPOSE['team-join']`. The WebAuthn options carry `rpName = siteName` and the member login account's random placeholder `display_name`. None of these names the vendor.
- `team.spec.ts` checks that `main` does not contain the vendor's name, and checks the join/start body with `acceptedTerms`.
- A wrong, used or expired invite gives 404 `not-found` with no body detail. The member's display name, which the account owner chose, is still shown; that is the owner's own choice of text.
- Residue: `openInvite` still selects `t.display_name as team` into `InviteRow` (`members.ts:314,332`). Nothing returns it, but a future `{...row}` spread would put it back (F6).

### (5) `apps/web/src/ui/Logo.tsx` against wip/lead-wide-shell

Both branches add the file, so the merge is an add/add conflict, and the two APIs are incompatible:

| Branch | API | Drawing | Used by |
|---|---|---|---|
| front-door | `Logo({height, className})` | the 120 px mark with the coin rim | Landing |
| wide-shell | `Logo({size: 24 \| 32, decorative})` | the small marks; dot through the `.x2f-logo__dot` class; `decorative` sets aria-hidden | DesktopShell, MethodList and TradeGlance |

**Keep wide-shell's copy** (it lands first in batch 2 and has more callers and the a11y switch). Add the big mark to it, either as `size: 120` with a `height` override or as a separate `LogoLarge` export, and change `Landing.tsx:81` to use it.

The merge also conflicts in `App.tsx` `Layout`: wide-shell replaces `DesktopHeader` with `DesktopRail`/`WideTop` through `wideFrameOf`, and its `PRE_LOGIN = /^\/(login|setup|terms|team\/join)(\/|$)/` does not include `/`. Whoever resolves the merge must keep the front-door rule: no rail (no links behind the door) on `/`, or on any door screen, for someone not inside. Add `^/$` to `PRE_LOGIN` and keep the `door && !isInside` condition. `shell.spec.ts` (nav count 0 on `/`, wide) would catch a mistake here, but only when Playwright runs (F7).

### (6) CSP, headers, service worker, static serving

Nothing in the diff touches `public/`, `sw.js` (it still caches nothing), `index.html`, the vite config, the security headers or the CSP. `landing.css` has no `url()` or `@import`. The new SVGs use presentation attributes (`fill=`), not `style=`, so the CSP without `'unsafe-inline'` still holds. There is no `dangerouslySetInnerHTML`. `cache-control: no-store` on `/v1/*` is unchanged.

### (7) e2e coverage

- Specs that cover the gate: `shell.spec.ts` (Landing on `/`, no app nav, no market requests while logged out, `/sell/ZELLE` goes to `/?returnTo=`, Log in carries it on), `news.spec.ts` (logged-out `/news` goes to Landing and makes no `/v1/news` request), `login.spec.ts` (Landing first, and recovery goes to Security, not the market), `setup.spec.ts` and `quote.spec.ts` (from a quote link, through Landing and the shortest setup route, back to the quote), and `team.spec.ts` (Terms first, invite text with no vendor, `acceptedTerms` in the body, a removed member goes to `/?returnTo=`). The other specs gained `signedIn` stubs.
- Every spec stubs the API with `page.route`, so the e2e suite tests the web's routing, never the API gate. The API gate is covered only by `apps/api/test/frontDoor.test.ts`, which could not run here.
- No spec covers the member-on-stale-Terms web flow or the F5 loop.
- None of this ran in this review. The builder reports green one spec at a time; the full check has not run.

### Findings

- **F2b (Minor, hardening): non-GET session routes are not classified.** `apps/api/test/frontDoor.test.ts:112` keeps only GETs. A future POST that returns other traders' data (a "search" POST, say) behind a plain `requireSession({allowRecovery})` would pass both lists. No current route does this: they all return the caller's own write result. Fix: either classify every session-guarded route (an `OWN_DATA_WRITES` list, or assert that the `sessionWriteRoutes` set is all own-account), or assert that no non-GET route is named like a read.
- **F4 (Minor, hardening): `safeReturnTo` keeps percent-encoded `/`, `\` and control characters.** `apps/web/src/api/client.ts:69`. Scenario: `/?returnTo=%2F%252F%252Fevil.com` comes back as `/%2F%2Fevil.com`. It is same-origin and harmless today, but a future sink that decodes `returnTo` (say a `location.assign(decodeURIComponent(...))`) would open a redirect. Fix: return `DEFAULT_RETURN` when the raw value, after one decode, matches `/%(2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i`, and add these cases to `test/client.test.ts`.
- **F5 (Minor; owner wording Q1): a member whose team account is on old Terms is stuck with no way to log out.** `apps/web/src/session/frontDoor.tsx:67` and `screens/setup/Terms.tsx:249-253`. The scenario is in section (3). Fix, which needs the API to tell the cases apart:
  - `GET /v1/account/me` returns `termsCurrent: false` together with a field such as `termsBlockedBy: 'account' | 'me'`.
  - `doorVerdict` sends `'account'` to a "Your account owner needs to accept the new Terms" screen with a Log out button, not to `/terms`.
  - The `/terms` screen also gets a Log out link: a stale-Terms account owner has no logout today either.
  - Add a web unit test and an e2e test for this path.
- **F6 (Minor): `openInvite` still loads the vendor's name.** `apps/api/src/team/members.ts:314,332` (`InviteRow.team`). Drop the column from the select and from the type, so a later change cannot send it to someone holding only the invite.
- **F7 (Minor, process): the gate's tests did not run in this review.** Before landing, run `apps/api/test/frontDoor.test.ts`, `team.test.ts`, `offers.test.ts`, `news.test.ts` and `site.test.ts` with Postgres working. After the wide-shell merge, run at least `shell.spec.ts`, `team.spec.ts`, `login.spec.ts` and `quote.spec.ts`.
- **F8 (Minor, comments): stale comments say browsing needs no session.** `apps/api/src/app.ts:272` ("as every visitor sees them"), `:290` ("browsing needs no session") and `:311` ("reading needs no session"). Update them, so that no one "restores" the open routes from the comments.
- **F9 (Minor, copy marker): one new string has no `COPY-UNSIGNED` marker.** `apps/web/src/screens/settings/teamCopy.ts:96` (`termsIntro`). The marker above `invited` covers only that line.

### Owner questions

- **Q1 (F5):** what should a team member see when they have accepted the current Terms but the account owner has not? Recommendation: a short screen, "Your account owner needs to accept the updated Terms before you can continue", with Log out. No vendor name is needed, since the member is already a member. Today they see "The Terms of Service have changed... accept them to keep trading" again and again.
- **Q2 (wording, unsigned):** "You are invited to a team as Aurora, for Trades." and "Before you join, read the Terms of Service to the end and accept them. The key points first:". Both are marked unsigned.
- **Q3 (what an invite holder sees before signing):** today the invite holder sees their given name, roles and expiry **before** the Terms screen. Under "no free tours", is that all right? Recommendation: yes. The invite is the account owner's own secret, single-use, 24-hour message to this person, and it contains nothing from the marketplace.

## Re-verify 6a5949a6 -> eb2a86bb (F4, F6, F8, F9, F2b; cloud lead reviewer, 9 Nov)

- **Scope:** `git diff 6a5949a6 eb2a86bb`, five commits: `b9995705` F4, `3487ba0d` F6, `6afbf57e` F8, `5668f36b` F9, `eb2a86bb` F2b. Worktree /home/user/X2F/.claude/worktrees/front-door, clean. Read-only.
- **Tests (serialised runner):**
  - api `test/frontDoor.test.ts`: **19/19 pass**. This was F7's "did not run" in the review above; it ran now that Docker works.
  - web `test/client.test.ts`: **72/72 pass**.
  - Not run (not in this brief): api `team.test.ts` (it holds the new F6 assertion at team.test.ts:206), `offers`, `news` and `site`, and Playwright. F7 stays open for those.

### Verdict: APPROVED

F4, F6, F8, F9 and F2b are closed. I accept the F4 scope decision. The F2b list has no write route that should be behind the front door and is not. F5 (the member lockout, owner Q1) and F7 (the rest of the test runs) are still open, as before.

### F4: closed; the path-only scope is right
- **Change:** apps/web/src/api/client.ts:76 refuses `%2f`, `%5c`, `%00`-`%1f` and `%7f` (any case) in the part of the raw value before the first `?` or `#`. Tests: client.test.ts:118-130 (path cases), :135 (arriving double-encoded through `?returnTo=`), :142 (allowed cases).
- **Why an encoded slash in the query or fragment cannot change the origin, even after a sink decodes the value once:**
  1. What `safeReturnTo` returns always starts with `url.pathname` (client.ts:84). That is one `/` and not `//` (client.ts:83), and after this fix it holds no encoded `/`, `\` or control character. So one decode leaves the path starting with exactly one `/`, followed by a character that is none of `/`, `\`, tab or newline.
  2. Whether a URL is network-path (`//host`), has a scheme, or is backslash-confused is decided only by its first characters. Decoding `%2F` in the query or fragment changes characters after a `?` or `#` that is already there. It cannot make the start become `//`, and it cannot add a scheme.
  3. A decoded `%3F` or `%23` in the path (not refused) only cuts the path shorter, for example `/%3F//evil.com` -> `/?//evil.com`, which is path `/` on the same origin. It cannot create a `//` at the start either.
  4. The query has to keep encoded slashes: a nested `returnTo` (`/wallets?add=1&returnTo=%2Fsell`) needs them. Every screen that follows a nested value runs it through `safeReturnTo` again: Wallets.tsx:250, Landing.tsx:70, and `returnToFrom` in Login, BackupLogin, News, SetupFlow and Terms. The only navigation sinks that leave react-router are `browserGo` (client.ts:43, fed only by `redirect`, which builds the value from `safeReturnTo`) and Login.tsx:404 (a fixed `AWAY_URL`). There is no `decodeURIComponent` anywhere in apps/web/src.
- **Residual (Info, no action):** a value encoded twice in the path, such as `/%252F%252Fevil.com`, passes. Only a sink that decodes twice would turn it into `//evil.com`. No such sink exists. The finding I raised was about a single decode, so this is outside it.

### F6: closed
- `openInvite` now selects `tm.id, tm.account_id, tm.display_name, tm.roles, tm.invite_expires_at` (apps/api/src/team/members.ts:332), and `InviteRow.team` is gone. The join to `accounts t` stays only for the live-account check.
- team.test.ts:206 checks the row's keys and that the vendor's name is not among the values. It was not run here.

### F8: closed
The comments at app.ts:272, :291 and :313 now say that browsing, News and the full site view are behind `requireInside`. They match the code.

### F9: closed
`COPY-UNSIGNED` is now above `JOIN_COPY.termsIntro` (teamCopy.ts:96-97). The wording is still for the owner's copy page (Q2).

### F2b: closed; the list is sound
- **Test:** apps/api/test/frontDoor.test.ts:106-132 now classifies every method except HEAD. A session-guarded non-GET must be in `OWN_DATA_WRITES` (frontDoor.ts:87). A `requireInside` route must be a GET in READS, so a write behind `requireInside` also fails. No route may be in two lists, and each list holds only the methods it should.
- **Checked every one of the 55 entries for a write that should be gated but is classified own-data.** None is. The front door forbids four kinds of caller from seeing marketplace data: an outsider, a recovery session, a session on old Terms, and a member without a role. Only routes whose guard is weaker than `requireInside` could leak to them:
  - The trade-making routes (`POST /v1/offers` at offers/routes.ts:438, `POST /v1/offers/:id/take` at take.ts:228, `POST /v1/chats` at chat/routes.ts:231, `POST /v1/nudges` and `POST /v1/account/blocks` at nudge/routes.ts:341-345) use `requireSession({kinds:['trader']})`, with no `allowRecovery` and no `allowStaleTerms`. That is at least as strict as `requireInside`: they refuse recovery sessions and old Terms, and a member needs a role or is `owner-only`. The only difference from `requireInside` is `touch`.
  - The routes that let recovery sessions or old Terms through are these: the add-method routes (webauthn.ts:974-981, pgp.ts:937-946, password.ts:405, methods.ts:433), `POST /v1/account/terms` (account.ts:297), `POST /v1/feedback/form` (form.ts:176), `POST /v1/account/offers/status` and `PATCH /v1/offers/:id` (stale Terms only; turning on and relisting still check the Terms, offers/routes.ts:382, :665), and the FINISH_OPEN_TRADES trade routes (trades/routes.ts:69, participants only). Each one writes to the caller's own account or trade and answers only with that result.
  - `POST /v1/account/blocks` answers 404 for a name that is not a trader. That tells the caller whether a display name exists, but only to a full trader session on current Terms. So it is inside the door and is not a front-door issue. It is the same oracle that sign-up already has (F4 in the first review above).
- **Residual (Info):** the test proves that every write is *classified*, not that a reason is *true*. A future write added to `OWN_DATA_WRITES` with a weak guard and a marketplace answer would still pass, so the reviewer has to read the reason. The reads have the same limit, and that is acceptable.
