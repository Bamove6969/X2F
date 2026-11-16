# Review: wip/third-signup-r3 @ 90972d6e (signup round 3), 16 Nov 2026

**Verdict: CHANGES NEEDED.** There is one blocking finding. Invisible Unicode "letters" and marks get through
the wider display-name set, so blank names and pixel-identical copies of another trader's name are possible
(B1, proven at the API). There are five minors. Two are look-alike gaps in the staff and reserved checks (M1, M2).
One is that TOTP silently does nothing for logins without a password (M3). One is that the shown password is
exposed to spell-check and keyboard learning (M4). The last is that the sign-up e2e specs are red from the merge
and the title change (M5). The rest is sound: the server's method rules, the TOTP enrolment binding, the otpauth
link and success state, PGP facts, usernames and escaping. The API project is green.

## Scope
- `git log origin/main..90972d6e` (main 4f0afa14). The review covers what third-signup-r3 adds on top of
  wip/lead-signup-v2 (dadf72c4) and wip/lead-demo-r2 (3190919d):
  - 20e9fffd (behaviours 1-5) and f1068c58 (behaviours 6-7, wording, layout);
  - the merges: a33dfc49 (read with `--remerge-diff`: members.ts, App.tsx, chat/engine.ts and auth/Login.tsx import
    conflicts, schema.test migration lists) and d88f8792 (no conflicts);
  - 2364324b (tripwire lists, from signup-v2) and 90972d6e (frontDoor list, team.test 200->204, schema.test).
- Spec: origin/comms:signup-r3-spec-2026-11-13.md. Owner notes: origin/comms:owner-demo-notes-2026-11-13.jsonl
  (setup-login, setup-display-name, setup-password, setup-authenticator, setup-backup, setup-pgp-key).
- I read every file in 20e9fffd and f1068c58, and every API file this branch changes (migration 610,
  nudge/names.ts, nudge/routes.ts, auth/frontDoor.ts). For context I also read unchanged API code:
  auth/totp.ts, auth/methods.ts, auth/password.ts, accounts.ts, team/members.ts and auth/pgp.ts.

## Findings

### Blocking

**B1. Invisible characters still pass the display-name check. They allow blank names and pixel-identical copies of other traders' names.**
`packages/accounts/src/username.ts:96-113` (DISPLAY_CHARS, BAD_MARK, `checkDisplayName`) refuses `\p{Cc}`/`\p{Cf}` by
leaving them out of the allowed set. It still allows two groups of invisible characters:
- invisible characters whose category is *letter*: the Hangul fillers U+3164, U+FFA0, U+115F and U+1160 (`\p{Lo}`);
- invisible *combining marks* placed after a letter: the variation selectors U+FE00-FE0F and U+E0100-E01EF, the
  combining grapheme joiner U+034F, and the Mongolian free variation selectors U+180B-180D (`\p{Mn}`).

All of these are Unicode Default_Ignorable code points, which is the zero-width class the spec says to refuse.
Probe output (`checkDisplayName`, run in my worktree):
```
hangulFillerOnly    "ㅤ"x5          -> {"ok":true,"name":"ㅤㅤㅤㅤㅤ"}      (renders blank)
hangulFillerAsSpace "BobㅤSmith"    -> {"ok":true,"key":"bobㅤsmith"}      (looks like "Bob Smith", other key)
halfwidthFiller     "BobﾠSmith"    -> ok
variationSelector   "alice️"       -> {"ok":true,"key":"alice️"}           (looks exactly like "alice")
cgj                 "alic͏e.k"     -> ok
mongolianFVS        "alice᠋"       -> ok
```
Failure scenario: trader `alice` has a good reputation. A scammer signs up as `alice` + U+FE0F. The name looks
identical on every offer, profile and chat, but its `display_key` is different. That gets past the
case-insensitive uniqueness check (`accounts.ts:95-98`) and the ban list, because bans are recorded by
`display_key` (`bans.ts:235-241`). A Hangul filler can stand in for a space (`BobㅤSmith`). A name made only
of fillers is blank on screen. Before this branch only ASCII was allowed, so an exact visual copy was
impossible: owner rule F4 accepted look-alikes such as 0/o between traders, but not identical copies.
API-level proof: see the "Review probe" result under Tests.
Fix: in `checkDisplayName`, refuse `/\p{Default_Ignorable_Code_Point}/u` (it covers all of the above, plus
U+200B-200F, U+2060-2064 and U+FEFF), before or with the DISPLAY_CHARS test. Add the cases above to
`username.test.ts` and to `signup-rules.test.ts`. As defence in depth, `lookAlikeKey` could strip `\p{DI}` too.

### Minor

**M1. The reserved-word and staff look-alike fold misses Latin look-alikes that NFKD does not decompose.**
`lookAlikeKey` (username.ts:57, "NFKD without its combining marks ... HOMOGLYPHS") maps accents, full-width forms
and Cyrillic/Greek letters to Latin. It leaves other Latin letters alone: the dotless ı (U+0131), the small
capitals (ᴀ ᴅ ᴍ ɪ ɴ, U+1D00 block), Latin alpha ɑ (U+0251), script ɡ, ʟ and others. All of these are
`Script=Latin`, so the mixed-script rule does not catch them either. Probe:
`"admın.bob"`, `"ᴀᴅᴍɪɴ bob"` and `"ɑdmin bob"` all return `ok:true`, so they are not reserved. A staff name
`Mira…` written `Mıra…` folds to `mıra…`, not `mlra…`, so `assertNewNames` (`accounts.ts:34-36`) and
`members.ts:141-143` accept it (API probe under Tests). The spec says "The confusables and impersonation checks
still apply to both".
Fix: add the common ones to HOMOGLYPHS (ı→i, ɑ→a, ɡ→g, ɪ→i, ʟ→l, ɴ→n, the U+1D00 small capitals to their letters,
ꞵ→b, ...). The more robust option is to allow Latin letters only when their NFKD base is a-z, plus a short
allow-list (ß æ ø œ ł đ þ ð). Best is a UTS #39 confusables skeleton.

**M2. The staff-name check compares whole keys, so a punctuation or space swap passes.** `accounts.ts:34-36` and
`team/members.ts:141-143` refuse a name only when `lookAlikeKey(name) === lookAlikeKey(staffName)`. The new
character set adds `,`, `'`, `:` and the space, which makes near-identical copies easy. For a staff name
`Mira.K`, the names `Mira,K`, `Mira K`, `Mira_K` and `Mira-K` are all accepted (API probe under Tests). `isReserved`
already compares a "flat" key with every non-letter/digit removed. The staff check should do the same.
Fix: compare `lookAlikeKey(x).replace(/[^\p{L}\p{N}]+/gu, '')` on both sides, in both places, and add a test.

**M3. TOTP with a PGP, passkey or security-key login (and no password) is never asked for at login. The copy still says "after your password".**
Server: the login second step exists only on the password path (`auth/password.ts:274-277`; the confirm check is
`password.ts:295-312`). The PGP and WebAuthn logins never read `totp` (no reference in `auth/pgp.ts` or
`auth/webauthn.ts`). An account that ticks PGP + Authenticator therefore logs in with PGP alone. Its TOTP stays
dormant until a password is added later.
What does hold, and answers the focus questions:
- no account can end up with TOTP as its only factor, or with no real factor. `leavesLogin` (`methods.ts:293-299`)
  counts only pgp, keys, passkeys and password. Backup login with `kind:'totp'` is 403 (`recovery.ts:209`).
  Enrolment needs a session, and a session needs a primary method.
- enrolment is bound to the session and to the method windows. Finish reads the challenge `where session_id = $3`
  (`totp.ts:255-258`), `consumeChallenge` re-checks the session, and `recheckWindowInTx` runs for a start let
  through on the window (`totp.ts:286-287`). The server needed no change, and the branch makes none.
Web: `setup/Login.tsx:78` still says "After your password, type the 6-digit code ... your password alone is not
enough". `setup/MoreMethods.tsx:122` says "Each time you log in with your password, you then type the 6-digit
code". The card is badged "Medium". With PGP + TOTP the user believes they have a second factor and they do not.
Fix (copy, COPY-UNSIGNED): when no password is ticked, say what the app is for, or that it will only ask for a
code with a password. Whether TOTP should become a second step of every login is a decision for the owner (Q1).

**M4. The password eye shows the password in a field without `spellCheck={false}`, `autoCorrect` or `autoCapitalize`.**
`apps/web/src/ui/PasswordInput.tsx:15`: when shown, the field becomes `type="text"`. Browser spell-check services
send text-field contents to the cloud ("spell-jacking": Chrome Enhanced Spell Check, Edge Editor, Grammarly-type
extensions), and mobile keyboards learn and suggest typed words. A password field is exempt from this. A
shown one is not. Failure scenario: an Android user taps the eye to check a typo. Gboard learns the password and
later suggests it in chat. Or Chrome's enhanced spell check sends it to Google.
Fix: on the input, set `spellCheck={false} autoCorrect="off" autoCapitalize="none"` (the attributes cost nothing
while the field is hidden too). Optionally switch back to hidden on submit. Add one test for the attributes.
Otherwise the component is sound. The value is never copied out, `autoComplete` passes through unchanged, the
button is `type="button"` (it does not submit the form), it is 44 px and has `aria-pressed` and a label.

**M5. The sign-up e2e specs are red on this branch: 7 failed, 33 passed. Both causes come from this branch.**
- (a) `apps/web/e2e/signup-v2.spec.ts:13` still mocks `/v1/terms` as `TERMS_VERSION = '2026-11-09'`. The merge
  a33dfc49 brought in demo-r2's Terms text, `TERMS_TEXT_VERSION = '2026-11-12'` (`setup/termsText.ts:17`). The Terms
  screen therefore shows `terms-stale` and disables `terms-tick`. Every journey through `acceptTerms`
  (`signup-v2.spec.ts:109`) times out after 30 s. That is 5 failures: `:143` and `:284` at 443x794 and 390x844,
  plus `:329`. Together they hide the round-3 e2e additions in 20e9fffd and f1068c58 (TOTP link, success state,
  eye). Fix: import `TERMS_TEXT_VERSION` in the spec instead of hard-coding it, as setup.spec.ts already uses '2026-11-12'.
  Result with only that line changed locally: see Tests.
- (b) `e2e/setup.spec.ts:242` ("the PGP path matches every Setup board", at 390x844 and 360x800) fails parity with
  `board SetupPgpKey: board copy missing: "Set up your account"`. f1068c58 changed the header title to "Adding
  your public PGP key", which is the owner's request, but the board `design/x2f-app/SetupPgpKey.dc.html` still
  says "Set up your account". Fix: update the board's title (design), or record the deviation where the parity
  helper keeps its known differences. Do not drop the check.

### Info

**I1. The otpauth link and the success state are good. No secret leak found.** The secret appears only in the
start response (`totp.ts:235`). `/v1` answers `cache-control: no-store` (`app.ts:266`). The `<a href="otpauth://…">`
(`settings/Totp.tsx:120`) goes to a custom scheme, so it adds no history entry and sends no Referer. On success
`setEnrol(null)` drops the secret from state before the green status shows. A staged (held) enrolment skips the
success claim. There is no `console.*` and no storage in Totp.tsx. Things the owner may want to know:
(a) "Copy code" puts the secret in the OS clipboard history (Windows cloud clipboard, Gboard), which the spec asked for;
(b) on desktop, or on iOS without a handler, the link does nothing or shows "address invalid";
(c) the TOTP label is the display name (`totp.ts:110-112`), which can now hold `:`. otpauth encodes it, but some
apps split the decoded label on `:`, so the account may show oddly. This is cosmetic.

**I2. Migration 610 removes the database guard on `display_key`.** It is now enforced only in the app. Every
write I found takes the key from `checkDisplayName`: `accounts.ts:364` via `assertNewNames`, `members.ts:243`, and
`nudge/routes.ts` via `displayKeyOf`. No other `lower(` use is left in apps/api/src. That is fine today. A cheap
guard that still works would be a check limited to ASCII names, for example
`check (display_name !~ '^[ -~]*$' or display_key = lower(display_name))`.

**I3. PGP key facts (behaviour 6) are correct.** The `<…>`, `(comment)`, any `x@y` and Cc/Cf/Co/Cn characters are
removed, and the result is capped at 64 code points. `name` is never stored or returned by the API (`inspectOrRefuse`
callers use only the fingerprint and expiry, `pgp.ts:710, 784, 866, 933`). React escapes it. The cost: every
`inspectPublicKey`, including the public PGP login start (`pgp.ts:710`), now also runs `getPrimaryUser`, with keys
capped at 32 KiB. That is small.

**I4. Usernames keep the strict ASCII set, and `$` is not added.** This matches the spec. `checkNames` compares
the normalised display key with the login key, and the web and the API share one implementation
(`@x2f/auth-client` re-exports `@x2f/accounts`).

**I5. XSS and URLs.** No `dangerouslySetInnerHTML` or `innerHTML` in apps or packages. Display names in paths
are `encodeURIComponent`'d (`settings/blockApi.ts:39, 45`), so the new `# ? % &` are safe. `findByPublicName`
normalises the same way as sign-up.

**I6. Merged tree: two web tripwires are red, inherited from lead-demo-r2.** `selection-ink.test.ts` (new orange
in `welcome/welcome.css` and `tour/stage.css`) and `proof-render-tripwire.test.ts` (a CSS `url(` in
`tour/TourProvider.tsx`). Both fail the same way at origin/wip/lead-demo-r2 3190919d (I ran them there), so they
are not from this branch, but the branch is red on them until the demo's owner fixes them.

**I7. 90972d6e changes `team.test.ts` from 200 to 204 for a member's appeal**, to match main's D-011 appeals. That
is outside sign-up, and the lead should confirm it is intended main behaviour and not a merge artefact.

## Questions for the owner (via the lead)

- **Q1 (M3). With PGP, a passkey or a security key and no password, the authenticator app adds nothing at login.**
  The owner's note ("remember they have their login name still too") reads as if he thinks TOTP adds a factor
  there. Options: (a) keep it allowed but say plainly that it asks for a code only with a password (copy change
  only); (b) make the code a second step after every login method (server work, and it weakens the phishing-proof
  keys' one-tap flow); (c) go back to "needs a password". Recommendation: (a) now, and decide on (b) separately.
- **Q2 (B1/M1). Look-alike copies between traders.** F4 allows look-alikes between traders. With Unicode,
  full-width `Ａlice` or accented `Alicé` sit next to `Alice` as different accounts. Recommendation: refuse
  invisible characters (B1, not optional), and consider making `display_key` the NFKC + accent-stripped fold, so
  that near-identical trader names count as taken.

## Tests

Node 24.22.1, `npm ci` in a detached worktree at 90972d6e. Heavy runs used `flock /tmp/claude-0/heavy.lock`.

- **The branch's own and touched vitest files** (11 files): packages/accounts `username.test.ts` and `pgp.test.ts`;
  apps/web `passwordInput`, `pgpKeyFacts`, `securityKeyArt`, `signupV2`, `task28-names`, `totpEnrol`,
  `task28-units`, `proof-render-tripwire` and `selection-ink`. Result: **199 passed, 2 failed**. The 2 failures
  are `selection-ink` "orange is only on the primary action…" and `proof-render-tripwire` "no CSS picture…".
  Both also fail at origin/wip/lead-demo-r2 3190919d (2 failed, 10 passed there), so they are inherited (I6).
- **API project** (`vitest run --project @x2f/api`, real Postgres container): **117 files, 2727 passed, 0 failed,
  1 todo**. That includes signup-rules.test.ts with the new round-3 cases and schema.test.ts.
- **Review probes** (not committed; deleted after running):
  - `checkDisplayName` probe (packages/accounts): the output is quoted in B1 and M1.
  - An API probe, `apps/api/test/zz-review-names.test.ts`, built on the header of `signup-rules.test.ts`:
    **2 passed**, which means every attack name below was **accepted with 201**:
    ```ts
    const reg = (displayName: string) => new Browser(app).post('/v1/register/password', {
      displayName, loginName: name('priv'), password: GOOD, deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG,
    });
    it('a pixel-identical copy of a trader name with a variation selector is accepted', async () => {
      const base = `Alice${n++}x`;
      expect((await reg(base)).statusCode).toBe(201);
      const copy = await reg(`${base}️`);
      expect(copy.statusCode, copy.body).toBe(201);                 // B1: same look, second account
      const filler = await reg('ㅤㅤㅤㅤㅤ');
      expect(filler.statusCode, filler.body).toBe(201);             // B1: blank name
    });
    it('a staff name with a dotless i, or with a comma for a dot, is not reserved', async () => {
      const staff = await seedAccount(deps, { kind: 'staff', loginName: null, displayName: `Mira.K${n++}` });
      const s = (await deps.db.query('select display_name from accounts where id = $1', [staff])).rows[0].display_name;
      const dotless = await reg(s.replace('i', 'ı'));         // M1
      const comma = await reg(s.replace('.', ','));                 // M2
      const space = await reg(s.replace('.', ' '));                 // M2
      expect([dotless.statusCode, comma.statusCode, space.statusCode], s).toEqual([201, 201, 201]);
      const adm = await reg('Admın Desk');
      expect(adm.statusCode, adm.body).toBe(201);                   // M1: reserved word not caught
    });
    ```
- **e2e** (Playwright, chromium at /opt/pw-browsers/chromium, `--workers=1`, under the lock):
  `setup.spec.ts` and `signup-v2.spec.ts` at 90972d6e: **33 passed, 7 failed**. The 7 are:
  `setup.spec.ts:242` at 390x844 and 360x800 (board SetupPgpKey title, M5b);
  `signup-v2.spec.ts:143` and `:284` at 443x794 and 390x844, and `:329` (stale Terms mock, M5a).
  Rerun of `signup-v2.spec.ts` with only `TERMS_VERSION = '2026-11-12'` changed locally (then reverted):
  **7 passed, 0 failed**. So the round-3 e2e steps (TOTP link, success state, eye) work once the mock is fixed.
- **Not run**: the full web vitest project (only the touched files above) and the Monero regtest, escrow and
  node-proxy projects (downloads.getmonero.org is blocked here, and this branch does not touch them).
