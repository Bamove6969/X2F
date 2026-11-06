# Review: origin/wip/lead-fido-refresh @fbcbe80 (vs a3a7d7f)

**Verdict: APPROVED.** Nothing blocks. One item should land before the 2026-11-01 refresh (R1, the scripts).

Verified: attestation.test.ts + webauthn.test.ts on a `git archive` of fbcbe80 under flock: 2 files, 43/43 passed. `tsc --noEmit` for apps/api: clean. I checked every allow-list line against its statement file, and checked what was left out against the verified MDS payload in the scratchpad (script below).

## (1) Traders: no regression
- Spec §6 and Plan 2 Task 8 (plan-2 lines ~410-412) put no attestation rule on traders. Traders get `attestationType: 'none'` (webauthn.ts:105). `assertCredentialAllowed` lets a trader use any passkey or security key whatever `attested` says (webauthn.ts:90-91). Nothing gates on a trader's `attested`: the wallet-wait, badge and method lists count by `kind`, not `attested` (routes/account.ts:56, wallets/routes.ts:294). `ownerReady` and `pairAllowed` use `attested` only for the owner and staff.
- Before this change a trader's packed response was checked against the single YubiKey-5-only list. Now it is checked against the staff list, which is wider. At worst, a few more trader rows get `attested=true`, which is cosmetic. The comment at webauthn.ts:260 says so honestly.
- Pre-existing, not from this diff (FYI): `MetadataService` is process-wide and `strict`. A trader whose client sends `packed` anyway (it ignored `none` conveyance) with an AAGUID outside the snapshot gets 401 `webauthn-failed` (webauthn.ts:254-256 only maps unknown-authenticator to 403 for non-traders, then `failed()`). Browsers strip to `none`, so this only matters for a future native/APK client. The wider snapshot makes it slightly rarer. Worth a Plan 4/APK note: for traders, retry without metadata or treat it as unattested.

## (2) Owner identification: robust
- The account kind comes from the DB. `req.auth.kind` comes from the session row joined to accounts (sessions.ts:260), and `verifyWebAuthnRegistration` uses `accountById(...).kind`. The trader sign-up route hard-codes `'trader'` and creates a trader account. A unique index `one_owner` (001_accounts.sql:18) allows one owner, and no code changes `accounts.kind`.
- A non-owner gains nothing from the owner list, because owner ⊆ staff (checked: 34 owner, 58 staff, union 58).
- The owner cannot get round the rule on the routes that exist:
  - Account route: `kind='security-key'` + not on the owner list → `attested=false` → 403 (tested).
  - Plan 4 helper (`kind=null`): falls to `passkey` → 401 when UV is off, 403 for an owner passkey.
  - Owner passkey options are refused (webauthn.ts:103).
  - The owner has no recovery path.
- Minor M1 (defence in depth, Plan 4): the rule is enforced only when a key is registered. An owner key registered under an older list stays `attested=true` and keeps logging in, and `ownerReady` counts it. The same holds for a key that a later refresh drops (e.g. a new `*_COMPROMISE` status). No owner exists yet (first-run owner setup is Plan 4 and not built), so nothing is affected today. Suggestion: in `verifyWebAuthnAssertion` / the login finish for `account_kind='owner'`, also require `aaguid ∈ owner list`, and do the same for staff. Then a refresh that drops an AAGUID takes effect without a data migration.

## (3) AAGUID correctness: all correct
I checked every line against its statement file: AAGUID = filename, description and firmware match the README text, and the root issuer is right (Yubico for YubiKey 5 and Security Key, Google for Titan).
- Owner list: all 34 are `YubiKey 5 *` with `firmwareVersion` ≥ 5.7.0 (5.7.1, 5.7.4 and 5.8.0 lines, including FIPS and CCN). None are missing: every staff YubiKey 5 entry on firmware ≥ 5.7 is on the owner list.
- Staff list adds YubiKey 5 on 5.4.2 and with no stated firmware (cb69481e, fa2b99dc = 5.1-era), the Security Key series (5.4.3/5.7.x/5.8.0 and the legacy ones with no stated firmware) and Titan v2 (42b4fb4a). These match Yubico's published AAGUID table as I know it (e.g. a25342c0 = 5 NFC 5.7, 2fc0579f = 5 NFC 5.2/5.4, fa2b99dc = 5 NFC 5.1).
- What was left out of the payload is right:
  - all YubiKey 5 / Security Key "Preview" and "RC Preview" entries (NOT_FIDO_CERTIFIED);
  - YubiKey Bio (not in the owner's rule);
  - third-party "Security Key" products (Excelsecu, TOKEN2, VeriMark, uTrust, Hyper), whose roots are not Yubico's.
- Firmware from the AAGUID is sound. Yubico gives each firmware line its own AAGUIDs. The AAGUID is in authData signed by the attestation key. SimpleWebAuthn's packed check also compares the leaf certificate's id-fido-gen-ce-aaguid extension. So a genuine pre-5.7 key cannot present a 5.7 AAGUID. All Yubico products share one root CA, so the AAGUID check, not the root check, is what separates families. That is correct.

## (4) Startup check and README parsing: fine, small nits
- It fails closed. `main.ts:41` awaits `init()`. `init` throws on a missing `## Owner allowlist` or `## Staff allowlist` heading, a statement not named after its AAGUID, a statement with no roots, or an allow-listed AAGUID with no statement. `isAllowed` is false before init.
- Minor M2 (attestation.ts:17-30, 70-71): an empty list is accepted silently. Example: a refresh run that leaves "## Owner allowlist" with no lines would start fine, and every owner key registration would then fail with 403. The repo test asserts >10, but only for the repo README. Suggest that `init` throws when either list is empty.
- Nit: the line regex is lowercase-only (`[0-9a-f-]{36}`), so an upper-case AAGUID line is skipped silently. The repo test (files == union of lists) would catch it for the repo data. The owner ⊆ staff invariant is tested on the repo data, not checked at runtime. That is fine.

## (5) Tests: meaningful
- attestation.test.ts:
  - The owner/staff split is tested on real AAGUIDs: 5.8, 5.7.1, 5.4.2, 5.1, Security Key 5.7.4, Titan, Bio and a Preview.
  - A data-rule test: owner entries are `YubiKey 5` with firmware ≥ 5.7, and every staff YubiKey 5 on 5.7+ is on the owner list.
  - The lists are kept apart.
  - An owner-only AAGUID without a statement is refused.
- webauthn.test.ts:450-471 runs end to end: staff with a staff-only key → 201; owner with the same key → 403 `method-not-allowed`; owner with an owner-list key → 201; the DB rows are checked.
- Minor M3: the staff-list data test (attestation.test.ts ~line 423) checks only description prefixes. It does not check the root issuer the README rule states (Yubico for YubiKey 5 / Security Key, `O=Google` for Titan). A third-party "Security Key …" statement would pass it. Add a root-subject check with `node:crypto` X509Certificate.
- Minor M4: no test for the owner path through `verifyWebAuthnRegistration` with `kind` omitted (Plan 4 helper) using a staff-only key. It should give 403 or 401 and store no row.
- Nit: the two tests that use the real SNAPSHOT call `init()` with the real clock and the default `warn`. From 2026-11-01 they print the stale-snapshot JSON line to stderr in every test run. Pass `warn: () => {}` (or a fixed clock) there. Nothing asserts on API stderr, so this is noise, not a failure.

## (6) Reproducibility: commit the scripts
- R1 (recommended before the 11-01 refresh): commit verify + extract. They are the only record of how the 58 files and both lists were made. The README describes the rule, but the line format, sorting, image-field stripping and status filter live only in `scratchpad/mds-scripts/extract.py`. A refresh is due within days. Without the scripts, the next person rewrites them and the README text and allow-list order will drift.
- Before committing, fix two things:
  - (a) `verify.mjs` imports from the absolute path `/home/flem/x2f/node_modules/...`; change it to the package import `@simplewebauthn/server/helpers`.
  - (b) `extract.py` shells out to `openssl` and is Python; the repo's tools are TS run with tsx. Suggest one `tools/fido-mds/refresh.ts`: verify with `verifyMDSBlob`, take root subjects from `node:crypto` X509Certificate, write the statements and print both README sections.
- Do not commit `payload.json` (7.9 MB). The serial and SHA-256 in the README are enough to fetch it again.
- Note: the status filter excludes an entry if any status in its history is bad. That is conservative and fine, but say "any status report, past or present" in the README.

## MDS nextUpdate 2026-11-01 warning
- It is not harmful or noisy. It is one JSON line on stderr per API start, the server keeps running on the snapshot, and the line holds only the date (tested).
- It is also expected. MDS3 BLOBs are reissued around their `nextUpdate`, so "no newer BLOB on 10-28" is normal, not FIDO being late.
- What should happen: keep the warning, and do not add a grace period or move the date. On or after 2026-11-01, fetch again and expect a serial above 291. Then run the committed scripts, update the serial, date, nextUpdate and SHA-256, and diff the lists and root certificates. If FIDO still serves serial 291 after 11-01, the warning is correct to flag that, and that fact should be written in the README Source section ("checked YYYY-MM-DD, still serial 291").
- The real-SNAPSHOT tests should inject `warn` (nit above) so CI logs stay clean.
