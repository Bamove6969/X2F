# SonarQube local setup and first scan (2026-11-01)

Owner-approved local-only static analysis. No code leaves the PC. No secrets in this file
(admin password and scan token are in `~/x2f-comms/secrets/sonarqube-local.txt`, mode 600, dir 700).

## Setup

- Server: **http://127.0.0.1:9000** (bound to 127.0.0.1 only). Log in as `admin` with the password from the secrets file.
- Image: `sonarqube:25.9.0.112764-community` (built 2025-09-23). Embedded H2 database (fine for one local user; not upgradeable across major versions, so a future upgrade means a fresh volume and a rescan).
- Scanner: `sonarsource/sonar-scanner-cli:11.4.0.2044_7.2.0`.
- Telemetry off (`SONAR_TELEMETRY_ENABLE=false`; server log confirms "Sharing of SonarQube statistics is disabled"). Update center off (`SONAR_UPDATECENTER_ACTIVATE=false`).
- `vm.max_map_count` on this WSL host is already 1048576, so Elasticsearch bootstrap checks were NOT disabled.
- Volumes: `sonarqube_data`, `sonarqube_extensions`, `sonarqube_logs` (named, persist across restarts/removal of the container).
- Networks: the server is on the default bridge (for the 127.0.0.1:9000 port) and on `sonar-internal`, a Docker `--internal` network with no route out. The scanner container runs only on `sonar-internal`, so it can reach the local server and nothing else.
- Default admin password changed to a random 36-char one (admin:admin now rejected). Project `x2f` (private) created; a project-analysis token `x2f-scan` generated.
- Container has `--restart unless-stopped`: it comes back when Docker starts unless you stopped it by hand.

### Start / stop

```
docker start sonarqube        # start (takes ~1-2 min to reach UP)
curl -s http://127.0.0.1:9000/api/system/status   # wait for "status":"UP"
docker stop sonarqube         # stop
docker logs -f sonarqube      # logs
```

### Scan

```
~/x2f-comms/tools/sonar-scan.sh [WORKTREE_PATH] [PROJECT_KEY] [extra -D options]
# default: ~/x2f, project x2f. Works on linked worktrees (mounts the main .git read-only for blame).
```

The script mounts the worktree read-only and puts scanner scratch in a tmpfs, so it never writes into the repo
(verified: `git status` clean after the scan). Excluded: `node_modules`, `dist`, `dist-fixtures*`, `coverage`,
`fixtures` (incl. test fixtures), `**/*.dc.html`, `test-results`, `playwright-report`, `.scratch`, `.claude`, `.regtest`, `*.png`.
Test files (`*.test.*`, `*.spec.*`, `test/`, `e2e/`) are indexed as tests, not sources. Full scan takes ~4 min
(JS/TS analysis ~2 min). Scanning another worktree with the same key overwrites the `x2f` results; pass a
second key (e.g. `x2f-wip`) and create that project first if you want them side by side.

## First scan: ~/x2f, branch compassionate-johnson-k95ssr @ 52b7a0e

Quality gate (Sonar way): **PASSED**. 44,853 lines of code (TS/TSX, some JS, Python, HTML, CSS).

| Measure | Value | Rating |
|---|---|---|
| Bugs | 42 | Reliability D |
| Vulnerabilities | **0** | Security A |
| Security hotspots | 68 (22 high, 18 medium, 28 low probability) | Review E (none reviewed yet) |
| Code smells | 512 | Maintainability A |
| Duplication | 0.6% | |
| Coverage | n/a (no coverage report fed in) | |

Hotspots by rule: SQL built from strings S2077 x22; hardcoded IPs S1313 x14; regex backtracking S5852 x13;
"hard-coded password" S2068 x10; bidi characters S6389 x5; http URLs S5332 x2; SHA-1 S4790 x1; PATH S4036 x1.
Bugs: S2871 sort without comparator x19, S6324 control chars in regex x21, reduce without initial value x1, HTML table header x1.
Top code smells: cognitive complexity S3776 (67), `void` operator S3735 (24).

## Top 10 security-relevant findings (triaged by reading the code; nothing fixed)

1. **apps/api/src/static/serve.ts:159** (S5852, medium): `.replace(/[.\s]+$/, '')` runs on the first segment of the *request path*, i.e. untrusted input. A long run of dots/spaces followed by another character backtracks quadratically. Bounded by Node's URL/header size limit (~16 KB), so worst case is a small CPU spike per request, but it is the one regex hotspot on attacker-controlled input. **Likely real, low severity**; worth a non-backtracking rewrite.
2. **apps/api/src/trades/purge.ts:25** (S2077): `set local role ${PURGE_ROLE}` interpolates an identifier. It is a module constant, not input. False positive, but the only spot where an SQL identifier (not a value) is interpolated; worth a "constant only" comment like store.ts has.
3. **apps/api/src/trades/store.ts:207** (S2077): insert with a column list built from an array. Comment says columns are fixed literals; values are `$n` parameters. False positive.
4. **apps/api/src/nudge/routes.ts:136 / :263** (S2077): query composed with `${PUBLIC_NAME}` and `${blockedEitherWaySql('$1::uuid','$2::uuid')}` helpers. Helpers take placeholder strings, not user data. False positive; the remaining S2077 hits (chat/retention.ts:44,70,76; disputes/routes.ts:226; disputes/store.ts:16; internal/routes.ts:200,384; team/members.ts:81,184,257,328; trades/store.ts:215,342; trades/take.ts:252,271; wallets/routes.ts:55,64,219) are the same pattern (constant SQL fragments such as `NEXT_SEQ`, `WALLET_COLUMNS`, `LIVE_MEMBER`, `OFFER_SQL`; all values parameterized).
5. **packages/staff/src/canonical.ts:49, packages/protocol/src/payload.ts:97, packages/accounts/src/confirmAction.ts:38** (S2871 "bug"): `Object.keys(o).sort()` with no comparator in canonical-JSON / signing / hash code. Sonar suggests `localeCompare`; **do not apply that**: default code-unit order is deterministic, locale order is not, and changing it would break signatures and the hash chain. Mark these "won't fix". (Same rule on apps/api/src/db/migrate.ts:17 and auth/attestation.ts:87 sorts filenames; fine.)
6. **apps/api/src/trades/chain.ts:53, apps/moderation/src/link.ts:63-64, apps/node-proxy/src/server.ts:120** (S5852): `/\/+$/` trailing-slash trim. Quadratic in theory, but inputs are operator config URLs, not requests. Low.
7. **apps/api/src/auth/leaked.ts:24** (S4790 SHA-1): used as the Have I Been Pwned lookup key, as the comment says; not password storage. False positive.
8. **S2068 "hard-coded password"** at apps/api/src/auth/hold.ts:515, auth/methods.ts:189,246, auth/password.ts:109, packages/auth-client/src/api.ts:95, apps/web/src/screens/settings/Methods.tsx:33, setup/Welcome.tsx:20, ui/cantDoCodes.ts:77-78: route names, UI labels, error text and an SQL constant containing the word "password". False positives. The only literal credential is **spikes/phase0-browser/server.mjs:47** (`"spike-password"` for a regtest spike wallet) - not shipped code.
9. **apps/api/src/push/endpoint.ts:52-64** (S1313 x14): hardcoded private/reserved IP ranges. This is the SSRF block list for push endpoints - intended. Worth a reviewer checking it is complete, not removing it.
10. **Bidi characters in tests** (S6389): apps/api/test/news.test.ts:133, offers.test.ts:262,506, profiles.test.ts:234, packages/auth-client/test/confirm.test.ts:159 - deliberate test inputs for the bidi-character refusals (e.g. `BAD_TERMS_CHAR` in apps/api/src/offers/routes.ts:124, which is also why the S6324 "control character in regex" bugs fire). False positives.

Other minor: S5332 plain http in tools/parity/serve-boards.ts:77 and spikes/phase0-browser/server.mjs:121 (local dev tools); S4036 PATH in tools/regtest/global-setup.ts:5 (test harness).
Non-security bugs worth a look: apps/web/src/screens/settings/Security.tsx:149 `reduce()` with no initial value (throws on an empty array); apps/web/test/attestation-flow.test.ts:1437 test with no assertion (the single BLOCKER).

**Bottom line:** 0 vulnerabilities; of 68 hotspots, one looks like a real (low) issue (#1). The rest are false positives or intended, and can be marked Safe/Reviewed in the UI so the hotspot review rating reflects that.
