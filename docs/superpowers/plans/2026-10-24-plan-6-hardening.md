# Plan 6: Hardening and launch prep — Implementation Plan (DRAFT for owner approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DRAFT, 2026-10-24.** Nothing is built from this plan until the owner approves it. Every owner choice is listed under "Assumptions (owner has not decided yet)" with options and a recommendation; tasks that depend on one say so and use only the named setting.

**Goal:** Make X2F safe to run on mainnet. The database is unreachable from the internet and backed up encrypted with keys kept apart. Stored-secret keys live in a hardware-backed vault. Nothing logs an IP address. A front proxy and the Tor onion services limit each source. The owner is alerted without user data being collected. The web app is tamper-evident, and the native apps resume escrow work after a pause. Then the external audit, the bug bounty and the launch follow.

**Architecture:**
- **`deploy/`** holds host-neutral configuration for every host: HAProxy, Tor, PostgreSQL, WAL-G, systemd units, nftables, journald, sshd, monerod, Prometheus and Alertmanager. It also holds the runbooks. **`tools/deploy` (`@x2f/deploy`)** lints that tree: no IP logging, no secrets, hardened units, a closed database. It also runs the proxy behaviour tests against a pinned HAProxy container.
- **Hosts:** front (HAProxy, Tor), app (API, relay, node proxy), moderation (moderation process, vault access), database (PostgreSQL, WAL-G) and monerod. The topology is assumption D3. The database and moderation hosts have no public address.
- **Secrets:** `SecretBox` becomes async and gains a `KeyedMac` sibling. A vault adapter for the backend the owner picks (D4) implements both. Env/file key rings stay for development and tests only, and a launch preflight refuses them in production.
- **Web tamper evidence:** SRI and import-map integrity are added at build time, the CSP carries hashes, builds are reproducible with a signed release manifest, and an outside monitor compares the live site against that manifest.
- **`apps/native`** is a Capacitor 8 project wrapping `apps/web/dist`. It resumes escrow work when the app comes back to the foreground. Its auth and networking follow the spike in Task 19.

**Tech Stack:** Node 24.22.1, npm 11.21.0, TypeScript 7.0.2, vitest 5.0.3, fastify 5.12.x (as pinned at the time; R31), pg 8.23.1, openpgp 6.3.2, React 19.3.0, Vite 8.3.3, @playwright/test 1.63.0, Semgrep 1.178.0, PostgreSQL 17.11. **New dependencies** (14-day rule: each was published on or before 2026-10-10. The version is checked again with `npm view <pkg> time --json`, or against the release page, on the day it is added, and a newer version is taken only if it also passes the rule):

| Dependency | Version | Published | Where | Why |
|---|---|---|---|---|
| @capacitor/core, @capacitor/cli, @capacitor/ios, @capacitor/android | 8.5.3 | 2026-10-07 | `apps/native` | Native wrappers (spec 8) |
| @capacitor/app | 8.1.2 | 2026-10-02 | `apps/native` | Foreground/background events for resume |
| pkcs11js | 2.1.7 | 2026-07-28 | `apps/api`, `apps/moderation` | **Only if D4 = (a) YubiHSM 2.** A native addon: `ignore-scripts=true` stays, and the one package is built by an explicit `npm rebuild pkcs11js` step (new ruling, Task 10) |
| @aws-sdk/client-kms | 3.1149.0 | 2026-10-09 | `apps/api`, `apps/moderation` | **Only if D4 = (b) cloud KMS.** Large dependency tree; an audit-count check is part of Task 10 |
| HAProxy (container `haproxy:3.4.6-alpine`, pinned by digest at task time) | 3.4.6 (3.4 LTS) | 2026-09-28 | front host, `tools/deploy` tests | Front proxy |
| tor | 0.4.9.14 | 2026-10-07 | front host | Onion services, PoW defence |
| WAL-G | v3.0.9 | 2026-08-20 | database host | Encrypted base backups and WAL archive (PGP public-key encryption) |
| lego | v5.5.2 | 2026-09-23 | front host | ACME certificates |
| Prometheus / Alertmanager / node_exporter / postgres_exporter / blackbox_exporter | v3.15.0 / v0.34.1 / v1.12.1 / v0.20.1 / v0.29.0 | 2026-09-25 / 2026-09-17 / 2026-07-14 / 2026-07-08 / 2026-10-07 | monitoring | Owner alerting |
| SoftHSM | 2.7.0 | 2026-01-20 | test container only | PKCS#11 contract tests (D4 = a) |
| OpenBao | v2.7.1 | 2026-10-01 | vault host, test container | **Only if D4 = (c).** No npm dependency (HTTP API through `fetch`) |

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md`. Sections 1 (principles; "No single breach of X2F's servers can move user funds"), 3.2 (resume, don't fail), 3.3, 4.1 (no IPs, Tor, retention), 6.2 (passkeys in Capacitor), 6.3 (security-key options; stored-secret protection; per-visitor limits are Plan 6), 6.4 (escrow-key backup to the user's PGP key), 6.5 (tamper defence, ASVS L3, audit, bounty), 6.6 (separate staff address, owner overview), 8, 9, 10 (phases 3 and 4) and 11.2. **Also read:** `docs/superpowers/plans/2026-10-15-roadmap.md` (deferred items), `docs/security/plan-1-review.md` (finding 2), `docs/security/plan-2-review.md` (F1, F7, R7, ASVS 2.8.2), `docs/dev-setup.md` (key rings, `X2F_LEGACY_SECRETS`, rewrap; on `wip/lead-p2-fuc` until merged) and `docs/superpowers/rulings-and-lessons.md` (R5, R26, R27, R30–R33).

**Builds on:** Plans 1 and 2 (built), FU-C (`wip/lead-p2-fuc`: `SecretBox`, `keyringBox`, key rings, migration 011, `rewrap-totp`, `X2F_LEGACY_SECRETS`), Plan 3 (the API internal listener, `apps/moderation`, `escrowStore`, `cosignPolicy`, `useEscrow`, Web Push, the trade screens), Plan 4 (staff API on its own origin, maintenance mode, owner alerts, emergency stop) and Plan 5. Tasks 15–18 and 20 start only after the Plan 3 tasks they name are merged. Tasks 1–14 depend only on Plans 1–2 and FU-C, except where a step names a Plan 3 or Plan 4 file.

## Global Constraints

- **No IP addresses are logged anywhere** (spec 4.1, R5): not by the apps, HAProxy, Tor, PostgreSQL, monerod, sshd, journald, nftables or the monitoring stack. The per-source limits keep source addresses (clearnet) or Tor circuit ids (onion) only in HAProxy's memory, in stick tables that expire after 10 minutes. They are never written, exported or exposed through a stats socket.
- **No analytics or third-party trackers, and no third-party scripts** (spec 4.1). No third-party service terminates TLS for X2F (D9).
- **Non-custodial** (spec 1, 3.1). Nothing in this plan adds a key. The moderator key stays only in `apps/moderation`, and per-trade keys stay on devices.
- **Target standard: OWASP ASVS Level 3** (spec 6.5).
- **The database is never reachable from the internet.** Only the API and moderation roles connect, from their hosts. Every runtime role is least-privilege, and no runtime role owns a schema or is a superuser.
- **Backups are encrypted to a public key whose private half is never on the database host, the backup storage or any app host** (D7).
- **Secret keys:** in production the stored-secret keys (password pepper, recovery-code MAC, TOTP sealing, PGP-key sealing, the moderation keystore key) come only from the vault (D4). `X2F_LEGACY_SECRETS=off` at launch.
- **Migrations run only while the API and the moderation process are stopped** (FU-C M3). Rolling deploys across a migration are not allowed.
- **Front-proxy starting values** (technical defaults, tuned on staging; every value is one named setting in `deploy/haproxy/haproxy.cfg`):
  - Per source: a clearnet IPv4 address, a clearnet IPv6 /64, or an onion circuit.
  - Limits per source: 20 concurrent connections; 120 HTTP requests per 10 s; 20 requests per minute to `^/v1/(login|register|backup|second-factor)/`; 8 concurrent WebSockets to the relay; 60 requests per 10 s to the node proxy.
  - Over the limit, the reply is HTTP 429 with body `{"error":"slow-down"}`, `content-type: application/json` and `SECURITY_HEADERS`. A connection over the concurrency limit is refused.
  - Timeouts: `http-request 10s`, `client 30s`, `server 60s`, `connect 5s`, `http-keep-alive 5s`, `tunnel 1h` (relay WebSockets), `client-fin 10s`.
  - `maxconn 20000` globally.
  - `tune.bufsize 65536`, so a 32 KiB armored PGP key in a JSON body passes.
- **Tor onion services:** `HiddenServicePoWDefensesEnabled 1`, `HiddenServiceEnableIntroDoSDefense 1`, `HiddenServiceExportCircuitID haproxy`, `HiddenServiceMaxStreams 64`, `HiddenServiceMaxStreamsCloseCircuit 1`, `SafeLogging 1`, log level `notice` at most.
- **Monitoring collects no user data:** metrics are aggregate counters and gauges whose labels come from fixed lists. They carry no account ids, usernames, trade codes, addresses, amounts, IPs or circuit ids, and Prometheus keeps them for 15 days.
- Every dependency is pinned exactly and passes the 14-day rule. `npm audit --omit=dev` is clean, apart from exceptions under the standing rulings (R31, R33). `ignore-scripts=true` stays.
- `npm run check` passes at the end of every task. Full checks run through `~/x2f-comms/run-check.sh <log>` (R32). Every agent pushes to its own `wip/p6-<task>` branch at each commit (R30).
- Plan 6 migrations are numbered `6xx` (`apps/api/migrations/6xx_*.sql`, `apps/moderation/migrations/6xx_*.sql`).
- Server clock only: new modules take `clock: () => Date`.
- Logs never contain trade codes, request bodies, secrets, key material or IPs. Config errors name the variable, never the value.
- UI copy comes from the boards. Where no board exists, the copy is marked `// COPY-UNSIGNED` for the owner to sign off.

## Assumptions (owner has not decided yet)

Each is used only through the named setting or task. None is decided by this plan. "Rec." is the planner's recommendation.

- **D1 Hosting provider and server type.**
  - Options:
    - (a) Mainstream EU dedicated servers (cheap and reliable; identity checks; check their terms on crypto services).
    - (b) Privacy-oriented hosts that take crypto payment (less identity checking; smaller networks and DDoS capacity; no managed key service).
    - (c) Big cloud (managed HSM/KMS and strong DDoS protection, but identity checks, US legal reach and a risk of being dropped).
    - (d) Own hardware in colocation (full control, and a hardware HSM can be attached; most effort and up-front cost).
  - Rec.: dedicated servers, not shared VPS, in the jurisdiction the lawyer advises (spec 11.2). Pick a provider whose terms explicitly allow a non-custodial P2P crypto service, and use (d) for the moderation/key host if colocation is affordable. `deploy/` works on any of them.
- **D2 Jurisdiction.** The lawyer's advice (spec 11.2). It also sets where backups may be stored (D5).
- **D3 Topology and budget.**
  - Options:
    - (a) 2 hosts (front + app; database).
    - (b) 4 hosts (front; app; moderation; database), with monerod on the front host.
    - (c) 5 hosts: (b) plus a separate monerod host.
  - Rec.: (c). The moderation host holds the only server-side escrow key and should share nothing with public-facing processes, and monerod's peer-to-peer port is its own attack surface. Get quotes; prices vary widely by provider.
- **D4 Vault backend for secret keys** (Tasks 9–11).
  - Options:
    - (a) YubiHSM 2 on the moderation/key host, over PKCS#11. Keys never leave the hardware. Needs physical access (D1 d) and two units for redundancy.
    - (b) Cloud KMS backed by an HSM (for example AWS KMS). No hardware to run, but an account with identity checks, an outside network dependency and a large SDK.
    - (c) OpenBao Transit on a separate hardened host. No npm dependency, but it is a software vault: hardware-backed only if its seal is kept in an HSM or KMS.
  - Rec.: (a) if D1 allows hardware, else (b). The adapter interface is the same for all three, so this can change later.
- **D5 Backup storage location.**
  - Options:
    - (a) S3-compatible object storage at a second provider, in a jurisdiction the lawyer approves, with object lock (immutability).
    - (b) A storage server at the same provider.
    - (c) Both.
  - Rec.: (a). Backups survive the loss of the hosting account, and object lock stops an attacker on the database host from deleting them.
- **D6 Backup retention.**
  - Options: 7, 14 or 30 days of daily base backups, with WAL kept back to the oldest one.
  - Rec.: **14 days.** Data deleted under spec 4.1 (chats and proofs at 90 days, disputes at 30 days, training copies at 6 months) is then gone from backups within 14 days of deletion, and the Terms and FAQ say so (spec gap G1).
  - Setting: `WALG_RETAIN_FULL`, and object lock set to the same number of days.
- **D7 Who holds the backup decryption key.**
  - Options:
    - (a) The owner, on a YubiKey (OpenPGP), plus a sealed offline paper copy in a second place.
    - (b) (a) plus a second trusted person.
  - Rec.: (a).
  - The release-signing key (D15) and the login-signing key (R7) are different keys.
- **D8 Disk unlock after a reboot.**
  - Options:
    - (a) A passphrase typed over SSH into the early-boot environment (the strongest; needs the owner at every reboot).
    - (b) Network-bound unlock from a key server on another host (unattended reboots; seizing both hosts unlocks both).
    - (c) The provider's TPM (weak against the provider).
  - Rec.: (a) for the database and moderation hosts, (b) for front, app and monerod.
- **D9 DDoS protection.**
  - Options:
    - (a) Only the hosting provider's network-level filtering.
    - (b) A TLS-terminating CDN (it sees every IP and every byte, and could inject code: this conflicts with spec 4.1 and 6.5).
    - (c) A non-terminating network scrubbing service.
  - Rec.: (a), adding (c) only if attacks happen. Never (b).
- **D10 HTTPS on the onion.**
  - Options:
    - (a) Plain `http://` onion (Tor already encrypts and authenticates the address). It needs Task 19 to confirm that `__Host-` cookies and WebAuthn behave in Tor Browser.
    - (b) A paid DV certificate for the `.onion` from a certificate authority that issues them.
  - Rec.: (a), falling back to (b) if Task 19 shows cookie or WebAuthn trouble.
- **D11 How staff reach the staff address** (spec 6.6).
  - Options:
    - (a) A private onion with client authorization (unlisted; only authorized browsers can connect). This works only if Tor Browser supports the security-key taps staff must use.
    - (b) A WireGuard VPN from each staff device to the app host, with the staff site bound to the VPN address only.
    - (c) A public staff hostname behind the front proxy.
  - Rec.: (b), or (a) if Task 19 shows WebAuthn works in Tor Browser. Not (c).
- **D12 Owner alert channel for infrastructure.**
  - Options:
    - (a) In-app owner alerts and Web Push through the API. These fail when the API is down.
    - (b) Self-hosted ntfy on the monitoring host, with the owner's phone app.
    - (c) Signal messages from the monitoring host (needs a phone number for the sender).
    - (d) The owner's own email, outside the app.
  - Rec.: (a) for app events, (b) for infrastructure, plus an outside "dead-man's switch" at a second provider that alerts when the monitoring host goes quiet.
- **D13 External audit and penetration test** (spec 6.5).
  - Options: one firm for both, or a code and cryptography audit from one firm and a penetration test from another. Candidate firms of the right kind include Trail of Bits, NCC Group, Least Authority, Cure53, Quarkslab and Radically Open Security.
  - Rec.: two firms (audit, then pen test). Get 3 quotes each; scope is in Task 23. Budget: owner.
- **D14 Bug bounty platform and amounts.**
  - Options: self-run (a `security.txt` contact, PGP-encrypted reports, XMR payouts) or a platform (HackerOne, Intigriti, YesWeHack, Immunefi; most require reporters' identity).
  - Rec.: self-run.
  - Suggested amounts, the owner decides, paid in XMR at the payment-day rate:
    - **Critical** (moving user funds, breaking non-custody, owner or staff takeover, mass account takeover): $10,000–$25,000.
    - **High:** $2,000–$5,000.
    - **Medium:** $500–$1,500.
    - **Low:** $100–$300.
- **D15 Release-signing key holder.** Rec.: the owner, on a YubiKey (OpenPGP). It is a new key used only to sign releases, with its fingerprint published next to the login-signing key's.
- **D16 Mainnet database at launch.**
  - Options:
    - (a) A fresh, empty database (testnet accounts do not carry over).
    - (b) Migrate testnet accounts.
  - Rec.: (a). There is nothing to migrate, legacy secret counts are 0 from day one, and no testnet data reaches mainnet.
- **D17 Native app distribution.**
  - Android options: direct signed APK from the site, F-Droid, Google Play.
  - iOS: the App Store or TestFlight only. Apple's rules for crypto apps (guideline 3.1.5) and its developer-account identity checks may block or delay it (gap G7).
  - Rec.: Android direct APK and F-Droid first, Play after the lawyer's review; iOS after the lawyer reviews Apple's rules. Spec 10 already puts the native apps after the web launch.
- **D18 "Require a security key to log in" when the keys are lost.**
  - Options:
    - (a) Recovery codes still work, under the existing 24-hour hold.
    - (b) No way back in.
  - Rec.: (a).
- **D19 "Use your own Monero node"** (Plan 3 P3-M3).
  - Options:
    - (a) Native apps only.
    - (b) The web app too, by widening CSP `connect-src` to any https or onion origin (this weakens tamper defence).
    - (c) Drop it.
  - Rec.: (a). It is built in Task 21 only if the owner picks (a).
- **D20 Device-key trust on first use (Plan 3 OD-1).**
  - Options: build it now, or defer it until the auditors weigh in. The escrow check words already give an outside-X2F comparison.
  - Rec.: defer. It is not a task in this plan.
- **D21 Tor in the native apps** (spec 4.1: "Tor is built into the native apps' networking").
  - Options:
    - (a) Embed Arti (the Tor Project's Rust Tor) through a custom native plugin. This matches the spec, but there is no mature Capacitor plugin, so it is a large piece of work.
    - (b) Detect Orbot and offer the onion endpoints when Orbot is running.
    - (c) Clearnet only at first.
  - Rec.: (b) for the first native release, (a) later. This departs from the spec, so the owner must agree.
- **D22 Domain name and registrar.** The WebAuthn RP ID is the domain, and changing it later invalidates every passkey and security key (gap G13). Rec.: choose the permanent domain now, at a registrar that does not publish owner details.

## Review Focus

The inputs and failure modes the spec implies but no task's main tests exercise, most likely to bite first. Each has a test in the task named.

1. **Restoring the moderation database from a backup** brings back `mod_party_state` saves older than the moderator's last multisig signature. Resuming one and co-signing a different set reuses nonces and leaks the moderator's key share (R26). After any restore, every restored party must run a fresh export/import round before it co-signs. Test in Task 7.
2. **The vault is unreachable mid-day** (HSM unplugged, KMS outage). Password, TOTP and recovery logins and TOTP enrolment must answer 503 `busy` (fail closed) without crashing, never fall back to env keys, and raise `x2f_vault_errors_total`. Test in Task 10.
3. **A legitimately large request through the proxy:** a 32 KiB armored PGP key in a register body, or a 1 MiB node-proxy body. The proxy limits must not refuse it. Test in Task 2.
4. **A relay WebSocket left quiet for 20 minutes** while a party waits for its counterparty must stay open through the proxy (`timeout tunnel 1h`); only `client`/`server` idle timeouts apply to plain HTTP. Test in Task 2.
5. **Tor Browser at the "Safest" level** (JavaScript off) on the onion sees a plain `<noscript>` message explaining that X2F needs JavaScript and how to switch to "Safer", not a blank page. Test in Task 13.

## Deferred items owned by Plan 6, and where they land

| Item (source) | Task |
|---|---|
| Per-source limits in front of the API (Plan 2 F1) and the relay (Plan 1 finding 2) | 2, 3 |
| Request and header timeouts against slow connections | 2 |
| Reverse-proxy and Tor access logs off (R5) | 1, 2, 3 |
| WebAuthn on the `.onion` origin; passkeys inside Capacitor | 4, 19, 21 |
| Security-key tap to fund escrow; "Require a security key to log in" (spec 6.3) | 16, 15 |
| HSM/KMS for the key store (ASVS 2.8.2; Plan 2 review; FU-C `keystore.ts`) | 9, 10, 11 |
| `X2F_SERVER_KEY` kept outside normal config (Plan 2 review) | 10, 11 |
| Own payout address taken from the API's wallet list (Plan 3 Task 12 follow-up) | 17 |
| Escrow-key backup to the user's PGP key, and the lost-device test (spec 6.4; Plan 3 P3-I14 and X-6; Plan 1 review) | 18 |
| SRI (Plan 3 Task 33) | 13 |
| "Use your own Monero node" (Plan 3 P3-M3) | 21 if D19 = (a) |
| Device-key TOFU (Plan 3 OD-1) | not built (D20) |
| `.onion` CSP exception (`apps/api/src/static/serve.ts` comment) | 3 |
| Production size of the leaked-password list (operator) | 25 |
| X2F PGP signing key revocation procedure (Plan 2 review, R7) | 11 |
| PGP-signed rulings and encrypted staff alerts (Plan 4 A9) | not built; security-key taps already authorize rulings. Listed for the owner in Task 26 |

## Interfaces assumed from FU-C and Plans 3–4 (reconcile here only)

- FU-C `apps/api/src/auth/keystore.ts`:
  - `interface SecretBox { seal(plain, context): Buffer; open(sealed, context): Uint8Array; isCurrent(sealed): boolean }`
  - `keyringBox(ring: Keyring, legacyKey?)`
  - blob formats `0x00` (legacy) and `0x01` (key ring)
- FU-C config: `Config.passwordPeppers`, `Config.recoveryCodeKeys`, `Config.totpKeys: Keyring`, `Config.legacySecrets: boolean`; `subkey(config, 'totp'|'decoy'|'device'|'pgp-key'|'pgp-start')`.
- FU-C tools: `rewrapTotpSecrets({ db, config })`, run as `npm run rewrap-totp -w @x2f/api`.
- Plan 3:
  - The API internal listener (private interface, `/internal/v1/*`).
  - `apps/moderation`: `startModeration({ ..., keystoreKey, signingSecret })` and its database `x2f_moderation` (`mod_party_state`, `mod_wallet_secrets`).
  - The web app's `escrowStore`, `cosignPolicy(ctx, outcome)` and `useEscrow(code)`, which resumes every stored trade on page load.
  - Web Push.
  - `POST /v1/trades/:code/identity`.
- Plan 4: `buildStaffApi` on the staff origin, maintenance mode (escrow timers pause), owner alerts and the emergency stop.

---

## Part A — Hosting, network and the database

### Task 1: Deploy tree, the no-IP-logging lint and the IP scanner

**Files:**
- Create: `tools/deploy/{package.json,tsconfig.json,vitest.config.ts}`, `tools/deploy/src/{lint.ts,ipscan.ts,rules.ts}`, `deploy/host/{journald-x2f.conf,sshd-x2f.conf,sysctl-x2f.conf}`, `deploy/postgres/postgresql.x2f.conf`, `deploy/monerod/monerod.conf`, `deploy/README.md`
- Modify: root `vitest.config.ts` (add `tools/deploy`), root `package.json` (`semgrep` scans `deploy` too)
- Test: `tools/deploy/test/{lint.test.ts,ipscan.test.ts,tree.test.ts}`, `tools/deploy/test/fixtures/bad/*`

**Interfaces:**
- Produces:
  - `type RuleId = 'haproxy-log' | 'tor-log' | 'pg-log-host' | 'pg-log-statement' | 'journald-retention' | 'sshd-log' | 'monerod-log' | 'nft-log' | 'secret-in-tree' | 'unit-hardening' | 'pg-hba' | 'pg-listen'`
  - `interface Finding { file: string; line: number; rule: RuleId }`
  - `lintDeploy(root: string): Finding[]`. Later tasks add rules to `rules.ts`.
  - `findIpAddresses(text: string, allow?: ReadonlySet<string>): string[]` returns IPv4 and IPv6 (including compressed forms and `::ffff:` mapped) addresses found in free text.

- [ ] **Step 1: Write the failing tests.**
  - `lint.test.ts`, one bad fixture per rule, each giving exactly one finding of that rule:
    - an HAProxy file with a `log` line or `option httplog` (`haproxy-log`);
    - a torrc with `Log info stdout`, or without `SafeLogging 1` (`tor-log`);
    - a PostgreSQL fragment with `log_connections = on`, `log_hostname = on`, or a `log_line_prefix` containing `%h` or `%r` (`pg-log-host`);
    - a PostgreSQL fragment with `log_statement` other than `'none'`, or `log_min_duration_statement` other than `-1` (`pg-log-statement`);
    - a journald file with `MaxRetentionSec` missing or over `7day` (`journald-retention`);
    - an sshd drop-in without `LogLevel QUIET` (`sshd-log`);
    - a monerod config without `log-level=0` and `log-file=/dev/null` (`monerod-log`);
    - an nftables file with a `log` statement (`nft-log`);
    - a file holding `-----BEGIN .*PRIVATE KEY-----`, or a key-ring-shaped value `\b\d{1,5}:[A-Za-z0-9+/]{43}=` (`secret-in-tree`).
  - `ipscan.test.ts`:
    - finds `203.0.113.7`, `2001:db8::1`, `::ffff:198.51.100.2` and `fe80::1%eth0`;
    - does not report `v0.18.5.3`, `3.4.6`, `1.2.3` or a trade code;
    - honours `allow`.
  - `tree.test.ts`: `lintDeploy('deploy')` on the real tree returns `[]`.
- [ ] **Step 2:** Run `npx vitest run --project @x2f/deploy`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement `lintDeploy` (line-based checks per file kind, chosen by path under `deploy/`) and `findIpAddresses`. Write the real config files:
  - journald: `Storage=persistent`, `MaxRetentionSec=7day`.
  - sshd: `LogLevel QUIET`, `PasswordAuthentication no`, `ListenAddress` set per host at install time, `PermitRootLogin no`.
  - sysctl: `fs.suid_dumpable=0`, `kernel.core_pattern=|/bin/false`.
  - PostgreSQL logging: `log_connections = off`, `log_disconnections = off`, `log_hostname = off`, `log_line_prefix = '%m [%p] '`, `log_statement = 'none'`, `log_min_duration_statement = -1`.
  - monerod: `restricted-rpc=1`, the RPC connection flags from `docs/dev-setup.md`, `log-level=0`, `log-file=/dev/null`, `no-igd=1`.

  `deploy/README.md` maps each file to its host and its install path.
- [ ] **Step 4:** Run the project tests, then `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(deploy): deploy tree, no-IP-logging lint, IP scanner (R5)`.

### Task 2: Front proxy: TLS, timeouts and per-source limits (F1, Plan 1 finding 2)

**Files:**
- Create: `deploy/haproxy/haproxy.cfg`, `deploy/haproxy/errors/429.http`, `deploy/haproxy/lego.service`, `deploy/haproxy/lego.timer`
- Modify: `tools/deploy/src/rules.ts` (new rule `haproxy-limits`: every public frontend has the stick tables, the timeouts and no `stats socket`)
- Test: `tools/deploy/test/proxy.test.ts` (Docker, the pinned `haproxy:3.4.6-alpine` digest, `--network host`, a stub upstream on loopback), `tools/deploy/test/lint.test.ts` (new rule)

**Interfaces:**
- Consumes: the Global Constraints proxy values; `SECURITY_HEADERS` (`apps/api/src/static/serve.ts`), copied into the 429 file.
- Produces:
  - Frontends `fe_web` (443: `x2f.example` web and API), `fe_relay` (443 SNI `relay.*`, WebSocket), `fe_node` (443 SNI `node.*`) and `fe_metrics` (loopback only, the HAProxy Prometheus exporter, aggregates only).
  - The onion frontends of Task 3 reuse the same backends.
  - Source key: `src,ipmask(32,64)`.

- [ ] **Step 1: Write the failing tests** in `proxy.test.ts`. The test starts HAProxy with the real config, with test certificates and loopback upstreams through a test-only include, and connects from `127.0.0.2` and `127.0.0.3` (`localAddress`).
  - **F1:** source A sends 25 `POST /v1/login/webauthn/start` in a minute and gets 429 `{"error":"slow-down"}` (with `referrer-policy`, `x-content-type-options` and `strict-transport-security`) after the 20th. Source B's 1st request in the same minute reaches the upstream.
  - Source A opens 21 concurrent connections: the 21st is refused, and source B still connects.
  - Source A holds 8 relay WebSockets: the 9th is refused, and source B opens one.
  - **Slow headers:** a client sending one header byte per second is closed by 11 s and never reaches the upstream.
  - **Review Focus 3:** a 40 KiB JSON body to `/v1/register/pgp/start` and a 1 MiB body to `fe_node` both reach the upstream intact.
  - **Review Focus 4:** a relay WebSocket idle for 20 minutes stays open. A fake clock is not possible here, so the test runs with `tunnel 1h` overridden to `tunnel 25s` and `client 5s`, and asserts the socket is still open at 15 s.
  - HAProxy wrote nothing to stdout or stderr during the run (`findIpAddresses` on the captured output is `[]`, and the output is empty apart from the startup line).
  - The lint rule flags a frontend without `http-request track-sc0`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Write `haproxy.cfg`:
  - TLS 1.2+ with the Mozilla intermediate ciphers, HTTP/2, HSTS left to the app's headers, and `http-request deny` for any Host not in the configured list.
  - Stick tables `st_src` (conn_cur, conn_rate, http_req_rate(10s)), `st_login` (http_req_rate(60s)) and `st_relay` (conn_cur). Every table has `expire 10m`.
  - The 429 file, no `log` lines, and no `stats socket`.
  - `option forwardfor` **off**: the API must never receive a source address (R5).
  - lego renews certificates through the HTTP-01 challenge on `fe_web` port 80, which only redirects to https otherwise.
- [ ] **Step 4:** Run the tests, then `npm run check`. Expect PASS.
- [ ] **Step 5:** Mark the Plan 2 test `F1` (`apps/api/test/security-review.test.ts`) as "fixed in front: see tools/deploy/test/proxy.test.ts". The in-process behaviour stays pinned.
- [ ] **Step 6:** Commit `feat(deploy): front proxy with per-source limits and timeouts (F1, relay finding 2)`.

### Task 3: Tor onion services and onion origins in the app

**Files:**
- Create: `deploy/tor/torrc`, `deploy/runbooks/onion-keys.md`
- Modify: `deploy/haproxy/haproxy.cfg` (frontends `fe_onion_web`, `fe_onion_relay` and `fe_onion_node` on loopback with `accept-proxy`, the same backends and limits, keyed on the circuit id that Tor puts in the PROXY source address); `apps/api/src/static/serve.ts`; `apps/api/src/config.ts`; `tools/deploy/src/rules.ts` (rule `tor-onion`)
- Test: `apps/api/test/headers.test.ts`, `apps/api/test/onion.test.ts`, `tools/deploy/test/proxy.test.ts`, `tools/deploy/test/lint.test.ts`

**Interfaces:**
- Produces:
  - `interface SiteProfile { origin: string; relayOrigin: string; nodeProxyOrigin: string; onionLocation?: string }`
  - `X2F_SITES`, a JSON array of `SiteProfile`, replaces `X2F_RELAY_ORIGIN` and `X2F_NODE_PROXY_ORIGIN`. Those two stay accepted as a single-profile shorthand when `X2F_SITES` is unset.
  - `cspFor(profile: SiteProfile, scriptHashes?: readonly string[]): string`
  - `serveWeb` picks the profile whose origin's host equals the request `Host` exactly. Any other host gets 421 `misdirected`.
  - `index.html` gets `<meta name="x2f-origins" content='{"relay":"…","node":"…"}'>` per profile. The web client reads its relay and node origins from it.
  - Three onion services, each with its own key: web, relay and node. They are separate origins because monero-ts keeps only host and port.

- [ ] **Step 1: Write the failing tests.**
  - `onion.test.ts`:
    - `X2F_SITES` with a clearnet and an onion profile, the onion one having `http://<56 chars>.onion` and `ws://<56>.onion`, is accepted **without** `X2F_ALLOW_INSECURE_ORIGINS`.
    - An `http://` non-onion, non-loopback origin is still refused.
    - A request with `Host: <onion>` gets a CSP whose `connect-src` lists only the onion relay and node.
    - The clearnet HTML carries `onion-location: http://<onion>/<same path>`.
    - An unknown Host → 421.
    - The meta tag matches the profile.
  - `proxy.test.ts`: PROXY v1 headers from two different `fc00:dead:beef:4dad::` circuit addresses get separate login limits.
  - `lint.test.ts`: `tor-onion` flags a torrc service missing any of the Global Constraints onion options.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The `.onion` exception in `origin()` is for hosts matching `^[a-z2-7]{56}\.onion$` only. Write the torrc:
  - the three services and their options;
  - `SocksPort 0`, so the front host's Tor offers no client proxy;
  - `SafeLogging 1`, `Log notice stdout`;
  - `HiddenServicePort 80 127.0.0.1:<frontend port>`.

  The runbook covers making the keys offline, backing them up encrypted to the D7 key, installing them, rotating them (and publishing the new address, signed), and what to do if a key leaks.
- [ ] **Step 4:** Run the tests, then `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging (stagenet):**
  - Tor Browser opens the web onion.
  - The app loads, logs in with PGP, and connects to the onion relay and node.
  - `tor` writes no address to the journal: run `findIpAddresses` over 24 hours of `journalctl -u tor`.
- [ ] **Step 6:** Commit `feat(onion): onion services, per-circuit limits, onion site profiles and CSP`.

### Task 4: WebAuthn per origin (clearnet and onion RP IDs)

**Files:**
- Create: `apps/api/migrations/601_webauthn_rp.sql`
- Modify: `apps/api/src/config.ts` (`rpIdFor(origin): string`), `apps/api/src/auth/webauthn.ts`
- Test: `apps/api/test/webauthn.test.ts`

**Interfaces:**
- Produces:
  - `webauthn_credentials.rp_id text not null`. Existing rows are set to the configured clearnet RP ID by the migration.
  - Every ceremony uses `rpIdFor(request Origin)`.
  - `allowCredentials` and assertion lookups filter on that `rp_id`.

- [ ] **Step 1: Write the failing tests.**
  - A passkey registered on the onion origin is stored with the onion RP ID.
  - Login on the clearnet origin does not offer it, and an assertion for it presented on clearnet → `webauthn-failed`.
  - The reverse holds too.
  - A staff or owner account's security key registered on clearnet still works on clearnet.
  - An origin not in `X2F_ORIGINS` → 403, as today.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The Security screen copy (Plan 3) for an onion visitor reads "Passkeys and security keys are saved per address. A key added on the .onion address works only there." `// COPY-UNSIGNED`.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(auth): WebAuthn RP ID per origin (onion and clearnet)`.

### Task 5: Database network and least-privilege roles

**Files:**
- Create: `deploy/postgres/{pg_hba.conf,roles.sql}`, `deploy/host/nftables-db.conf`, `apps/api/src/db/privilege.ts`
- Modify: `deploy/postgres/postgresql.x2f.conf` (`listen_addresses` = the private address only, `password_encryption = scram-sha-256`, `ssl = on`, `ssl_min_protocol_version = 'TLSv1.3'`); `apps/api/src/db/pool.ts` (`createPool(url, max, applicationName)`); `apps/api/src/main.ts`; `tools/deploy/src/rules.ts` (`pg-hba`, `pg-listen`)
- Test: `apps/api/test/privilege.test.ts`, `tools/deploy/test/lint.test.ts`

**Interfaces:**
- Produces roles (`roles.sql`, idempotent):
  - `x2f_owner` (NOLOGIN; owns the `x2f` database objects; migrations `SET ROLE x2f_owner`).
  - `x2f_migrator` (LOGIN, member of `x2f_owner`; used only by `npm run migrate`).
  - `x2f_api` (LOGIN; `SELECT, INSERT, UPDATE, DELETE` through `ALTER DEFAULT PRIVILEGES FOR ROLE x2f_owner`; no `CREATE` on any schema; no `TRUNCATE`; on the Plan 4 activity log, `INSERT, SELECT` only).
  - `x2f_mod` (LOGIN; `CONNECT` only on `x2f_moderation`, which `x2f_api` cannot connect to).
  - `x2f_backup` (`REPLICATION` and `pg_read_all_data`; used by WAL-G).
  - `x2f_monitor` (`pg_monitor` only).
  - `REVOKE ALL ON DATABASE ... FROM PUBLIC` and `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
- `assertLeastPrivilege(db: Queryable, expectedRole: 'x2f_api' | 'x2f_mod'): Promise<void>` throws `Error('db: role is too powerful: <reason>')` when:
  - `rolsuper`, `rolcreaterole`, `rolcreatedb` or `rolbypassrls` is set;
  - the role is a member of `x2f_owner`;
  - it has `CREATE` on any schema;
  - it owns any table;
  - `current_user` differs from `expectedRole`.
- `main.ts` calls it before listening. The pool's `application_name` is `x2f-api` (moderation: `x2f-moderation`).
- `pg_hba.conf`:
  - only `hostssl x2f x2f_api <app host>/32 scram-sha-256`;
  - `hostssl x2f_moderation x2f_mod <moderation host>/32 scram-sha-256`;
  - `hostssl replication x2f_backup` (local or the backup host), and `local` for `x2f_migrator` and `postgres` with `peer`;
  - no `trust`, no `0.0.0.0/0`, no `::/0`.
- `nftables-db.conf`: default drop; 5432 only from the app and moderation hosts; SSH only from the D11/admin VPN.

- [ ] **Step 1: Write the failing tests** (Docker PostgreSQL 17.11, the existing harness, applying `roles.sql` then migrating as `x2f_migrator`).
  - `x2f_api` can `SELECT`/`INSERT`/`UPDATE`/`DELETE` on **every** table in `information_schema.tables` (catches a migration that forgets grants), and cannot `CREATE TABLE`, `ALTER TABLE accounts`, `TRUNCATE sessions` or `DROP`.
  - `x2f_api` cannot connect to `x2f_moderation`.
  - `assertLeastPrivilege` passes for `x2f_api` and throws for the test superuser, for `x2f_migrator` and for a role granted `CREATE` on `public`.
  - `createPool` sets `application_name`.
  - Lint: a `pg_hba.conf` with `trust`, or `host all all 0.0.0.0/0`, is flagged; `listen_addresses = '*'` is flagged.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Migrations from 601 on start with `SET ROLE x2f_owner` (the harness applies it too). `docs/dev-setup.md` gains the production database URL rules: `x2f_api` for the API, `x2f_migrator` for `npm run migrate`.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging:**
  - From a host outside the private network, `nc -vz <db public address> 5432` fails (the database host has no public address at all where D1 allows).
  - From the app host, `psql "sslmode=verify-full ..."` as `x2f_api` works, and the same as `postgres` is refused.
- [ ] **Step 6:** Commit `feat(db): private-only PostgreSQL, least-privilege roles, API privilege guard`.

### Task 6: Deploy procedure: migrations only with the API stopped, and a schema handshake

**Files:**
- Create: `apps/api/src/db/schemaCheck.ts`, `deploy/runbooks/deploy.md`
- Modify: `apps/api/src/db/migrate.ts`, `apps/api/src/main.ts`; the same handshake in `apps/moderation/src/main.ts` against its own migrations
- Test: `apps/api/test/migrate-guard.test.ts`

**Interfaces:**
- Produces:
  - `migrate(db, dir?, opts?: { liveCheck?: boolean })`. When `liveCheck` is true (the CLI default), it refuses with `Error('migrate: stop x2f-api and x2f-moderation first (<n> connected)')` while `pg_stat_activity` shows any backend with `application_name in ('x2f-api','x2f-moderation')`. It exits 2 and applies nothing.
  - `assertSchemaCurrent(db, dir): Promise<void>` throws `Error('db: schema is behind this build: <names>')` or `Error('db: schema has migrations this build does not know: <names>')`. `main.ts` calls it before listening, so an old API cannot run against a new schema, and a new one cannot run against an old schema.

- [ ] **Step 1: Write the failing tests.**
  - With a pool connected as `application_name = 'x2f-api'`, the CLI-mode `migrate` refuses and `schema_migrations` is unchanged.
  - With none connected, it applies.
  - `assertSchemaCurrent` throws in both directions (a missing file; an extra row) and passes when equal.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `deploy.md`, in order:
  1. Owner turns on maintenance mode (Plan 4; escrow timers pause).
  2. Stop `x2f-api` and `x2f-moderation`. The relay and node proxy keep running.
  3. Take an on-demand `wal-g backup-push` (Task 7).
  4. `npm run migrate -w @x2f/api` as `x2f_migrator`.
  5. Run any data tool the release notes name (for example `rewrap-totp`).
  6. Start `x2f-moderation`, then `x2f-api`.
  7. Smoke checks: `GET /healthz`, a test PGP login, preflight (Task 11).
  8. Owner turns maintenance off.

  It also gives the rollback path: restore to the backup from step 3 if a migration fails after commit.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(db): migrate refuses while the API runs; schema handshake at start (FU-C M3)`.

### Task 7: Encrypted backups, purge-before-listen, restore drills, and a safe moderation restore

**Files:**
- Create: `deploy/backup/{walg.env.example,x2f-backup.service,x2f-backup.timer,x2f-walg-retain.service,x2f-walg-retain.timer}`, `deploy/runbooks/backup-restore.md`, `tools/ops/restore-drill.sh`, `apps/moderation/migrations/601_restore_epoch.sql`
- Modify: `deploy/postgres/postgresql.x2f.conf` (`archive_mode = on`, `archive_command = 'wal-g wal-push %p'`, `archive_timeout = 300`); `apps/api/src/retention.ts`, `apps/api/src/main.ts`; `apps/moderation` party resume; `tools/deploy/src/rules.ts` (`backup-keys`)
- Test: `apps/api/test/retention.test.ts`, `apps/moderation/test/restore.test.ts`, `tools/deploy/test/lint.test.ts`

**Interfaces:**
- Produces:
  - `runRetentionOnce(deps: Deps, jobs: RetentionJob[]): Promise<RetentionLog[]>`. `main.ts` awaits it **before** `listen`, so a restored database purges everything past its deadline before anyone can read it. It refuses to start if any job fails.
  - WAL-G env: `WALG_PGP_KEY_PATH` points at a **public** key, `WALG_S3_PREFIX` (D5), `WALG_COMPRESSION_METHOD=zstd`.
  - Retention: `wal-g delete retain FULL <D6 days> --confirm`, daily.
  - Both databases (`x2f`, `x2f_moderation`) are backed up.
  - Moderation: `mod_restore_epoch (epoch int not null)`, one row. `mark_restored()` (a SQL function owned by `x2f_owner` and run by the restore runbook) increments it. Every saved party state records the epoch it was saved under.
  - `resumeParty(...)` treats a save from an earlier epoch as `restored`, which forces R26's fresh export/import round before any cosign.

- [ ] **Step 1: Write the failing tests.**
  - `retention.test.ts`: with rows past their deadline (a challenge, a removed wallet address, and the Plan 3 and 4 jobs registered by then), `runRetentionOnce` deletes them before `buildApi` is listening (the fake app records the order), and a throwing job makes `main` refuse to start.
  - **Review Focus 1, `restore.test.ts`:** a party saved at epoch 1, then `mark_restored()`, then resumed, runs `exportState`/`importState` before `cosign` (a spy on a fake engine records the call order). A party saved at the current epoch resumes without the extra round.
  - Lint: `walg.env.example` containing `PRIVATE KEY` → `backup-keys`; `WALG_PGP_KEY_PATH` naming a `*secret*`/`*private*` path → flagged; missing `archive_command` → flagged.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `backup-restore.md` covers:
  - Making the backup key pair offline (D7) and installing only the public key.
  - The schedule: daily base backup at 03:00 UTC, continuous WAL.
  - Object lock set to D6.
  - Restore: fetch, decrypt with the offline key on the restore host only, `wal-g backup-fetch` plus recovery to a point in time, `mark_restored()` on `x2f_moderation`, start with preflight.
  - Why deleted data lives in backups for up to D6 days.

  `restore-drill.sh` restores the latest backup to a throwaway staging host, runs `assertSchemaCurrent`, `runRetentionOnce` and preflight, compares table row counts with production's monitor view, prints a pass/fail line with no data, and destroys the host.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging:**
  - Run the first restore drill end to end, and record the time it takes in `backup-restore.md`.
  - Schedule drills monthly, plus after every major PostgreSQL upgrade. The runbook keeps a dated drill log.
- [ ] **Step 6:** Commit `feat(backup): encrypted WAL-G backups, purge before listen, restore epoch for moderation (R26)`.

### Task 8: Disk encryption and host hardening

**Files:**
- Create: `deploy/systemd/{x2f-api.service,x2f-relay.service,x2f-node-proxy.service,x2f-moderation.service,monerod.service}`, `deploy/host/{nftables-front.conf,nftables-app.conf,nftables-moderation.conf,nftables-monerod.conf}`, `deploy/runbooks/disk-encryption.md`, `deploy/runbooks/host-setup.md`
- Modify: `tools/deploy/src/rules.ts` (`unit-hardening`, `nft-default-drop`)
- Test: `tools/deploy/test/lint.test.ts`

**Interfaces:**
- Produces: every X2F unit has
  - a dedicated `User=`;
  - `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes` (except the moderation unit when D4 = (a), which gets `DeviceAllow=` for the HSM only);
  - `LimitCORE=0`;
  - `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `CapabilityBoundingSet=` (empty);
  - `ReadWritePaths=` limited to its own data directory;
  - `EnvironmentFile=` with mode 600 (development only; production secrets come from the vault, Task 11).

- [ ] **Step 1: Write the failing tests:** a unit missing any of the settings above → `unit-hardening`; an nftables file whose input chain policy is not `drop` → `nft-default-drop`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Write the units and the firewalls:
  - front: 80 and 443 in;
  - app: only from the front host to the API, relay and node-proxy ports, and the internal listener only from the moderation host;
  - moderation: no inbound except admin SSH;
  - monerod: p2p 18080 public, RPC only from the app host.

  `disk-encryption.md` covers:
  - LUKS2 (argon2id) on every data volume and on swap, or swap off (secrets in memory must not reach disk unencrypted);
  - the unlock method by host (D8);
  - checks: `cryptsetup status`, `lsblk -f`, `swapon --show`;
  - what to do when a disk is replaced.

  `host-setup.md` covers unattended security updates, time sync, SSH keys only through D11's admin path, and no password logins.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging:** every check command in `disk-encryption.md` shows encrypted volumes, and `systemd-analyze security x2f-api` scores "OK" or better (exposure ≤ 3.0).
- [ ] **Step 6:** Commit `feat(deploy): hardened units, default-drop firewalls, disk-encryption runbook`.

## Part B — Secret key custody

### Task 9: Async `SecretBox` and a `KeyedMac` interface

**Files:**
- Modify: `apps/api/src/auth/keystore.ts`, `apps/api/src/auth/{password.ts,recovery.ts,totp.ts,pgp.ts}`, `apps/api/src/tools/rewrap-totp.ts`; `apps/moderation/src/keystore.ts` (adopt the same interfaces)
- Create: `apps/api/test/helpers/secretBoxContract.ts`
- Test: `apps/api/test/keystore.test.ts`, the existing password, recovery, TOTP and PGP tests

**Interfaces:**
- Produces (replacing the sync interface; no behaviour change):
  - `interface SecretBox { seal(plain: Uint8Array, context: string): Promise<Buffer>; open(sealed: Buffer, context: string): Promise<Uint8Array>; isCurrent(sealed: Buffer): boolean }`
  - `interface KeyedMac { current: number; mac(keyId: number, data: Uint8Array): Promise<Buffer> }`. The password pepper and the recovery-code HMAC go through this. `mac` with an unknown id rejects.
  - `keyringBox(ring, legacyKey?)` and `keyringMac(ring: Keyring): KeyedMac` are the env/file implementations.
  - `Deps.secrets: { totp: SecretBox; pgpKey: SecretBox; pepper: KeyedMac; recovery: KeyedMac }` is built once in `main.ts`.
  - PGP v4 keys stored encrypted (today under `subkey('pgp-key')`) move to `secrets.pgpKey`. Format byte `0x00` marks the existing blobs, with a rewrap tool as for TOTP: `npm run rewrap-pgp -w @x2f/api`.
  - `secretBoxContract(name, make: () => Promise<SecretBox>)` and `keyedMacContract(...)` are shared vitest suites: round trip; wrong context rejects; a flipped byte rejects; a blob from another key id opens while that key is held and rejects after it is removed; `isCurrent`; `mac` is deterministic per key id and differs across ids.

- [ ] **Step 1: Write the failing tests:** both contract suites against `keyringBox` and `keyringMac`; `rewrap-pgp` moves format-0 PGP blobs and is idempotent; the existing suites are updated to `await`.
- [ ] **Step 2:** Run. Expect FAIL (sync interface).
- [ ] **Step 3:** Implement. Callers are already in async handlers; keep one Argon2 verify per path (Plan 2 RF3).
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `refactor(secrets): async SecretBox and KeyedMac; PGP-key sealing through the box`.

### Task 10: Vault adapter for the chosen backend (D4)

**Files:**
- Create: `apps/api/src/auth/vault/{index.ts,pkcs11.ts | kms.ts | openbao.ts}` (only the one D4 picks), `tools/hsm-test/Dockerfile` (D4 = a: SoftHSM 2.7.0 from the signed tarball; D4 = c: the OpenBao v2.7.1 image pinned by digest)
- Modify: `apps/api/src/config.ts` (`X2F_KEY_PROVIDER = 'keyring' | 'vault'`, plus the provider's settings), `apps/api/src/main.ts`, `apps/api/src/app.ts` (vault errors → 503 `busy`), `apps/moderation/src/main.ts`, `.npmrc` comment and new ruling R34 if D4 = a
- Test: `apps/api/test/vault.test.ts` (both contract suites against the adapter in the test container), `apps/api/test/vault-outage.test.ts`

**Interfaces:**
- Produces:
  - `vaultSecrets(cfg: VaultConfig): Promise<Deps['secrets']>`.
  - New blob format `0x02 ‖ vault key version (u16 BE) ‖ provider ciphertext`. The AAD is the header plus the context, as in format `0x01`.
  - Key handles are named `x2f-totp`, `x2f-pgp-key`, `x2f-pepper`, `x2f-recovery` and `x2f-mod-keystore` (moderation only). Each purpose has its own key, and the API's vault credential cannot use `x2f-mod-keystore`.
  - Per-operation calls: AES-GCM (or the provider's authenticated encryption with the context bound) for the boxes, HMAC-SHA-256 for the MACs. Keys never leave the vault.
  - `X2F_SERVER_KEY` (decoys, device cookies, PGP start) is fetched at start as a vault-wrapped data key (envelope), never from the environment, when `X2F_KEY_PROVIDER=vault`.
  - With `vault`, setting any of `X2F_PASSWORD_PEPPERS`, `X2F_RECOVERY_CODE_KEYS`, `X2F_TOTP_KEYS` or their `_FILE` forms is a config error: there is no silent fallback.
  - A metric counter `x2f_vault_errors_total{op}`, used by Task 12.

- [ ] **Step 1: Write the failing tests.**
  - The contract suites pass against the containerised vault.
  - **Review Focus 2, `vault-outage.test.ts`:** with the vault stopped mid-test, password login, TOTP second factor, recovery-code login and TOTP enrolment answer 503 `busy`. PGP, WebAuthn and existing sessions are unaffected. The process stays up, and `x2f_vault_errors_total` increases. No env key ring is consulted.
  - Config: `vault` plus `X2F_TOTP_KEYS` → error naming the variable.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the D4 adapter, with an `npm audit --omit=dev` and dependency-count note in the commit message.
  - D4 = a: the PKCS#11 session pool, a login PIN from a root-only file read at start, `CKM_AES_GCM` and `CKM_SHA256_HMAC`. R34 records the one-package `npm rebuild pkcs11js`.
  - D4 = b: KMS `Encrypt`/`Decrypt` with `EncryptionContext = { ctx: context }`, and `GenerateMac`.
  - D4 = c: OpenBao Transit `encrypt`/`decrypt` with `context`, and `hmac`, over `fetch` with mTLS.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(secrets): <backend> vault adapter for stored-secret keys (ASVS 2.8.2)`.

### Task 11: Key custody cutover, rotation runbooks and the launch preflight

**Files:**
- Create: `apps/api/src/tools/preflight.ts`, `deploy/runbooks/rotation.md`, `deploy/runbooks/incident.md`
- Modify: `apps/api/package.json` (`"preflight": "tsx src/tools/preflight.ts"`), `docs/dev-setup.md` (production uses `X2F_KEY_PROVIDER=vault`; env rings are for development and tests only)
- Test: `apps/api/test/preflight.test.ts`

**Interfaces:**
- Produces:
  - `preflight(deps, opts: { profile: 'production' | 'staging' }): Promise<PreflightResult>`
  - `type PreflightResult = { ok: boolean; checks: Array<{ id: PreflightId; ok: boolean }> }`
  - `npm run preflight -w @x2f/api` prints that JSON (ids and booleans only) and exits 1 if any check fails.
- `PreflightId` values, each true in production:
  - `legacy-secrets-off`: `X2F_LEGACY_SECRETS=off`.
  - `legacy-counts-zero`: the three FU-C counts and format-0 PGP blobs are all 0.
  - `key-provider-vault`.
  - `vault-reachable`: one seal/open and one mac round trip.
  - `least-privilege`: Task 5.
  - `schema-current`: Task 6.
  - `fido-fresh`: the MDS snapshot `nextUpdate` is more than 7 days away.
  - `leaked-list-size`: at least 10,000,000 bytes. A test list is far smaller; the measured production size is recorded in `docs/dev-setup.md` (Task 25).
  - `monero-network`: `mainnet` in production.
  - `origins-https-or-onion`.
  - `signing-key-mode`: the PGP signing key file is 600 and owned by the API user.
  - `no-insecure-origins`: `X2F_ALLOW_INSECURE_ORIGINS` unset.
  - In staging, `monero-network` expects `stagenet` and `legacy-*` may be on.

- [ ] **Step 1: Write the failing tests:** each check fails alone when its condition is broken (one case per id), and the output contains no key, URL or count beyond the booleans.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `rotation.md` gives, per secret (purpose, frequency, steps, the verification query or command, the rollback):
  - the password pepper, recovery-code key, TOTP key and PGP-key sealing key: rotate in the vault by adding a version, then rehash, rewrap or regenerate, then retire, using FU-C's count queries;
  - `X2F_SERVER_KEY`;
  - the moderation keystore key;
  - the **X2F login-signing PGP key** (R7): rotation, revocation certificate kept offline, publishing the revocation and the new fingerprint on the site and in the FAQ;
  - the release-signing key (D15);
  - the onion keys (Task 3);
  - TLS (lego);
  - database role passwords;
  - the backup key pair (D7): a new pair, then the next base backup, then the old private key kept until the old backups expire;
  - the fee wallet's view key (the spend key stays offline, spec 6.6).

  `incident.md` covers a suspected key leak, a host compromise, a lost HSM, emergency stop (Plan 4), and who to tell.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging:** with `X2F_KEY_PROVIDER=vault` and `X2F_LEGACY_SECRETS=off`, `npm run preflight -w @x2f/api` prints `"ok":true` (profile staging), and a full rotation of the TOTP key per `rotation.md` ends with `{"rewrapped":0,"failed":0}` on the re-run.
- [ ] **Step 6:** Commit `feat(ops): launch preflight, rotation and incident runbooks; vault-only key custody in production`.

## Part C — Monitoring and alerting

### Task 12: Monitoring and owner alerts without user data

**Files:**
- Create: `apps/api/src/metrics.ts`, `apps/relay/src/metrics.ts`, `apps/node-proxy/src/metrics.ts`, `deploy/monitoring/{prometheus.yml,alerts.yml,alertmanager.yml,blackbox.yml}`, `deploy/runbooks/alerts.md`
- Modify: the API internal listener (`GET /internal/metrics`), the relay admin listener (`GET /metrics`), node proxy (`NODE_PROXY_METRICS_PORT`, loopback, default 8790), `tools/deploy/src/rules.ts` (`prom-retention`: `--storage.tsdb.retention.time` ≤ 15d)
- Test: `apps/api/test/metrics.test.ts`, `apps/relay/test/metrics.test.ts`, `apps/node-proxy/test/metrics.test.ts`, `tools/deploy/test/lint.test.ts`

**Interfaces:**
- Produces: `renderMetrics(): string` (Prometheus text format, no dependency) in each app. The allowlist, `METRICS` in each `metrics.ts`:
  - API:
    - `x2f_http_responses_total{class}` (`2xx|3xx|4xx|5xx`)
    - `x2f_busy_total{bucket}` (the `limits.ts` bucket names)
    - `x2f_retention_last_success_timestamp_seconds{job}`
    - `x2f_price_source_up{source}` (spec 11.6 source names)
    - `x2f_moderation_report_age_seconds`
    - `x2f_escrows_overdue` (trades past a deadline with no state change for 30 minutes; a count only)
    - `x2f_vault_errors_total{op}`
    - `x2f_fido_next_update_timestamp_seconds`
  - Relay: `x2f_relay_connections{state}` (`pending|authenticated`), `x2f_relay_rejects_total{reason}` (the relay's close codes).
  - Node proxy: `x2f_node_proxy_in_flight`, `x2f_node_proxy_busy_total`, `x2f_node_up`.
- Alert rules (`alerts.yml`), routed by D12:
  - API, relay, node proxy or moderation down for 2 minutes;
  - `x2f_moderation_report_age_seconds > 300`;
  - database down;
  - WAL archive failing (postgres_exporter `pg_stat_archiver` failed count rising);
  - last base backup older than 26 h;
  - disk over 80%;
  - certificate expiry under 14 days;
  - FIDO `nextUpdate` under 7 days;
  - `x2f_vault_errors_total` rising;
  - `x2f_busy_total` or relay rejects over 10× their 7-day median (a flood);
  - `x2f_escrows_overdue > 0` for 15 minutes;
  - onion service unreachable (blackbox over a local Tor SOCKS on the monitoring host);
  - the Task 14 live-integrity check failing;
  - Alertmanager's `Watchdog` to the outside dead-man's switch.

- [ ] **Step 1: Write the failing tests** (per app).
  - After traffic that includes trade codes, usernames, addresses and loopback IPs, `renderMetrics()` output:
    - has only metric names in the allowlist;
    - has only label values from each label's fixed list;
    - contains no match for `findIpAddresses`, the trade-code pattern or any username from the test.
  - A route not in the allowlist adds no series.
  - Lint flags Prometheus retention over 15 days.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Counters live in memory and reset on restart. The metrics endpoints are only on the private listeners. `alerts.md` says what each alert means and the first three things to check.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on staging:** stop `x2f-api` and see the alert reach the D12 channel within 3 minutes; stop the monitoring host and see the dead-man's switch alert.
- [ ] **Step 6:** Commit `feat(ops): aggregate-only metrics, alert rules and owner alert routing`.

## Part D — Web tamper evidence

### Task 13: SRI, import-map integrity, tighter CSP and a noscript message

**Files:**
- Create: `apps/web/build/sri.ts`
- Modify: `apps/web/vite.config.ts` (plugin, `enforce: 'post'`), `apps/web/index.html` (`<noscript>`), `apps/api/src/static/serve.ts` (reads `dist/csp-hashes.json`; adds `cross-origin-resource-policy: same-origin`, and `require-trusted-types-for 'script'` if Step 5 shows no violations), the wasm loader in the escrow worker (`fetch(url, { integrity })` if the build emits `.wasm` files)
- Test: `apps/web/test/sri.test.ts`, `apps/web/e2e/integrity.spec.ts`, `apps/api/test/headers.test.ts`

**Interfaces:**
- Produces:
  - `addIntegrity(html: string, files: ReadonlyMap<string, Uint8Array>): { html: string; scriptHashes: string[] }`:
    - adds `integrity="sha384-…"` and `crossorigin` to every `<script src>`, `<link rel="modulepreload">` and `<link rel="stylesheet">`;
    - inserts `<script type="importmap">{"integrity":{…every emitted JS chunk…}}</script>` before the first module script;
    - returns the sha256 CSP source of that import map.
  - `sriPlugin(): Plugin` writes `dist/csp-hashes.json` (`{"scriptHashes":[…]}`).
  - `cspFor(profile, scriptHashes)` adds them to `script-src`.

- [ ] **Step 1: Write the failing tests.**
  - `sri.test.ts`: given a fixture HTML and files, every tag has the right sha384; the import map lists every `.js` file in `files`; the returned hash equals `sha256` of the inserted script's text; a file missing from `files` throws.
  - `headers.test.ts`: the CSP carries the hash from `csp-hashes.json`, and the API refuses to start serving web if the file is missing.
  - `integrity.spec.ts` (Playwright, phone size):
    - The production build loads with zero CSP or SRI console errors.
    - Flipping one byte in a lazily loaded chunk after the build makes loading that route fail with an integrity error, and nothing from the chunk runs.
    - **Review Focus 5:** with JavaScript disabled, the page shows the noscript text "X2F needs JavaScript. In Tor Browser, choose the Safer security level, not Safest." `// COPY-UNSIGNED`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check` and the Playwright suite. Expect PASS.
- [ ] **Step 5:** Add `require-trusted-types-for 'script'; trusted-types 'none'` and run the full Playwright suite. If any violation appears, remove the directive and record the offending sink in `docs/security/plan-6-review.md` (Task 26) instead.
- [ ] **Step 6:** Commit `feat(web): SRI and import-map integrity, CSP hashes, noscript notice`.

### Task 14: Reproducible web build, signed release manifest and live integrity check

**Files:**
- Create: `tools/release/{package.json,build.sh,manifest.ts,verify-live.ts}`, `tools/release/test/{manifest.test.ts,verify-live.test.ts}`, `deploy/runbooks/release.md`
- Modify: root `vitest.config.ts`, `apps/api/src/static/serve.ts` (serves `/release.json` and `/release.json.asc` from the web root)

**Interfaces:**
- Produces:
  - `build.sh` runs inside `node:24.22.1-bookworm-slim` (pinned by digest at task time) with `SOURCE_DATE_EPOCH` set to the commit time, `npm ci`, and `npm run build -w @x2f/web`.
  - `manifest(dir): { commit: string; files: Record<string, string> }` (sha256 hex per file, sorted keys).
  - The release manifest is signed by the owner with the D15 key (`gpg --detach-sign --armor`) off the server.
  - `verifyLive(baseUrl: string, manifest, fetchImpl?): Promise<{ ok: boolean; mismatched: string[] }>` fetches `index.html` and every manifest file, plus every asset `index.html` references. Anything not in the manifest is a mismatch.

- [ ] **Step 1: Write the failing tests.**
  - `manifest` is stable under file order and timestamps.
  - `verifyLive`, against a local fixture server, returns `ok` for an exact copy, and names the file for: a changed byte, an extra script tag pointing at an unlisted file, and a missing file.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Run `build.sh` twice in fresh clones on different days and machines. The manifests must be byte-identical; record the result in `release.md`. If they differ, fix the cause (for example chunk naming or the embedded time) before the task closes.
- [ ] **Step 6:** `release.md`:
  - build, compare with a second independent build, sign, publish (the site, the repo's release page, and the hash in the FAQ);
  - the monitoring host runs `verifyLive` every 15 minutes over Tor and clearnet (the Task 12 alert);
  - the web app is not a strong defence against a compromised server (gap G10): large trades are nudged to the native app (Task 20).
- [ ] **Step 7:** Commit `feat(release): reproducible web build, signed manifest, live integrity check`.

## Part E — Account and escrow hardening

### Task 15: "Require a security key to log in" (spec 6.3)

**Files:**
- Create: `apps/api/migrations/602_require_key.sql`
- Modify: `apps/api/src/auth/login.ts` (trader `completeLogin` path), `apps/api/src/routes/account.ts`, `apps/api/src/auth/actionInput.ts` (confirm actions `require-key-on` and `require-key-off`), `apps/api/src/alerts.ts`, the Plan 3 Security screen
- Test: `apps/api/test/require-key.test.ts`, the Security screen's unit and e2e tests

**Interfaces:**
- Consumes: Plan 2's pending second-factor flow (`issueSecondFactor`, the staff pending row) and confirm tokens.
- Produces:
  - `accounts.require_security_key boolean not null default false`.
  - `PUT /v1/account/require-security-key { enabled }` with a confirm token for the matching action, which must have been proved with a `security-key` credential (not a passkey, PGP or password).
  - Turning it on needs at least one registered `security-key`, else 409 `no-security-key`.
  - When on, a trader login whose first factor is not a security key ends in a pending second step that accepts only a `security-key` assertion. The session starts only after that step.
  - Recovery-code logins follow D18 (Rec. (a): allowed, under the 24-hour hold).
  - Alerts `require-key-on` and `require-key-off`.

- [ ] **Step 1: Write the failing tests:**
  - with it on, password + TOTP, PGP alone and passkey alone each end pending; only a security-key assertion finishes;
  - a security key as the first factor logs in at once;
  - turning it off with a passkey-proved token → 403 `wrong-method`;
  - with no security key → 409;
  - removing the last security key while it is on → 409 `last-login-method`;
  - recovery per D18.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(auth): require a security key to log in`.

### Task 16: Security-key tap to fund escrow (spec 6.3)

**Files:**
- Create: `apps/api/migrations/603_fund_key.sql`
- Modify: the Plan 3 `POST /v1/trades/:code/identity` handler, `apps/api/src/auth/actionInput.ts` (`{ kind: 'fund-escrow', trade: <normalized code> }`), `apps/api/src/routes/account.ts`, the Plan 3 trade room (seller) and the Security screen
- Test: `apps/api/test/fund-key.test.ts`, the trade-room e2e

**Interfaces:**
- Produces:
  - `accounts.fund_needs_security_key boolean not null default false`, set like Task 15.
  - When it is on, the **seller's** identity registration (which comes before escrow setup, so before any funding address exists) needs a confirm token for `fund-escrow` bound to that trade code and proved with a `security-key`. Without it: 403 `confirm-required` naming the action.
  - The seller's screen reads "Tap your security key to set up funding for this trade." `// COPY-UNSIGNED`.

- [ ] **Step 1: Write the failing tests:**
  - with it on, a seller without a token gets 403;
  - with a token for another trade, 403;
  - with a passkey-proved token, 403;
  - with a correct token, 200, and the token cannot be reused;
  - a buyer is unaffected;
  - with it off, behaviour is unchanged.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(trade): optional security-key tap before funding`.

### Task 17: Pin the buyer's own payout addresses on the device

**Files:**
- Create: `apps/web/src/escrow/payoutPins.ts`
- Modify: the Plan 3 escrow worker (`cosignPolicy` callers), the Your wallets screen and the trade-start wallet picker
- Test: `apps/web/test/payoutPins.test.ts`, `apps/web/test/cosignPolicy.test.ts`

**Interfaces:**
- Produces:
  - `payoutPins`: IndexedDB store `x2f-payout-pins`, wrapped like `escrowStore`, holding `{ address, label, pinnedAt }`.
  - `pin(address)` is called when the user adds a wallet on this device, or confirms "Is this your wallet ending …k3Fz?" `// COPY-UNSIGNED` the first time this device sees an API-listed wallet.
  - `isPinned(address): Promise<boolean>`.
  - `cosignPolicy` gets `own.payout` only from a pinned address. If the API's chosen payout for this trade is not pinned, the worker does not settle and shows `payout-not-confirmed` with the confirm prompt. It never settles silently.

- [ ] **Step 1: Write the failing tests:**
  - a stub API that swaps the buyer's payout for an unpinned address in the wallet list and the attestation → no `settle`, state `payout-not-confirmed`;
  - after the user confirms the true address on the device, settle proceeds;
  - a pinned address removed on the API still settles a trade already started with it (the pin is local);
  - a new device starts with no pins and asks once per wallet.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): device-pinned payout addresses; the API cannot choose a buyer's own address`.

### Task 18: Escrow-key backup to the user's PGP key, and the lost-device test (spec 6.4)

**Files:**
- Create: `apps/web/src/escrow/backup.ts`, `apps/api/migrations/604_escrow_backups.sql`, `apps/api/src/trades/backupRoutes.ts`
- Modify: the escrow worker (back up after every saved state change), Plan 3 retention jobs (backups deleted at the escrow store's deletion time: 30 days after close, or later per the Plan 3 Task 12 rule), Plan 3 restore UI
- Test: `apps/web/test/backup.test.ts`, `apps/api/test/escrow-backup.test.ts`, `tools/regtest/lost-device.test.ts`

**Interfaces:**
- Consumes: openpgp 6.3.2 (already pinned), lazy-loaded in the worker.
- Produces:
  - `makeBackup(record: EscrowRecord, publicKeyArmored: string, expectedFingerprint: string): Promise<string>` returns an armored PGP message and throws `wrong-key` when the key's fingerprint is not `expectedFingerprint`.
  - The device pins the user's own fingerprint the first time, after showing it ("Back up to your PGP key ending …"), so the API cannot swap the key.
  - `readBackup(decryptedText: string): EscrowRecord` marks the record `restored: true`, so R26's fresh export/import round runs before any cosign.
  - `PUT /v1/trades/:code/escrow-backup { armored, version }` (participant only, role from the session, ≤ 64 KiB, `version` strictly greater than the stored one, else 409) and `GET` the latest.
  - The server stores only the armored ciphertext.
  - Accounts with no PGP key see "No backup: add a PGP key in Settings to back up trades in progress." `// COPY-UNSIGNED`.

- [ ] **Step 1: Write the failing tests.**
  - `backup.test.ts`:
    - the round trip through a test key pair;
    - `wrong-key` for a swapped key;
    - a restored record forces exportState/importState before cosign (spy);
    - no plaintext secret appears in the armored text.
  - `escrow-backup.test.ts`:
    - a non-participant → 404;
    - an older version → 409;
    - over 64 KiB → 413;
    - deleted by retention.
  - `lost-device.test.ts` (regtest): the seller funds, the seller's device store is wiped, a new device restores from the backup (the test decrypts with the test key), and the release completes with the right payouts. A second case wipes the buyer's device after "I've paid".
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check` and the regtest suite. Expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): PGP-encrypted escrow-key backup and lost-device recovery`.

## Part F — Native apps

### Task 19: Native shell spike: origin, cookies, CSRF, WebAuthn and Tor (decision record)

**Files:**
- Create: `apps/native/spike/` (throwaway), `docs/native/spike-2026.md` (the decision record)

This task builds nothing that ships. It answers, on real devices (an Android 14+ phone, an iPhone on iOS 18+, and Tor Browser on desktop and Android), the questions the later tasks depend on, and records each answer with evidence.

- [ ] **Step 1: Origin and session.** Capacitor serves bundled files from `https://localhost` (Android) and `capacitor://localhost` (iOS). The API uses `__Host-` cookies with `SameSite=Strict` and an exact-`Origin` CSRF check. Test which option works on both platforms, and record it:
  - (a) Capacitor's native HTTP for API calls, so the cookies sit in the native jar;
  - (b) a token-in-memory session for native clients, through a separate `Authorization` header route set;
  - (c) loading the app from the real origin (`server.url`), which gives up bundled code and so tamper defence.

  Rec.: (a) if it keeps `SameSite=Strict` semantics, else (b). Never (c).
- [ ] **Step 2: WebAuthn.** Test passkeys and a YubiKey in Android WebView (WebAuthn support setting) and in iOS WKWebView with associated domains (`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`). If WebView WebAuthn fails, test a native passkey plugin and record its name, version, maintainer and publish date for the 14-day rule.
- [ ] **Step 3: Tor Browser.** Check whether `__Host-` cookies are set over `http://*.onion` (D10), and whether WebAuthn works on the onion (Tasks 4 and D11). Record each answer.
- [ ] **Step 4: Tor in the app (D21).** Measure the D21 option the owner picked: Orbot detection, or Arti embedding feasibility.
- [ ] **Step 5: Background.** Record what happens to an escrow signing round when the app goes to the background for 10 s, 60 s and 10 minutes, on both platforms.
- [ ] **Step 6:** Commit `docs(native): spike results and decisions for the native apps`. Bring the record to the lead and the owner before Tasks 20–22 start.

### Task 20: Capacitor apps with background resume, and the large-trade nudge

**Files:**
- Create: `apps/native/{package.json,capacitor.config.ts,src/resume.ts}`, `apps/native/android/`, `apps/native/ios/` (generated, then committed), `apps/web/public/.well-known/{assetlinks.json,apple-app-site-association}`
- Modify: `apps/web/src/main.tsx` (registers the native bridge when `Capacitor.isNativePlatform()`), the Plan 3 quote screen (nudge), `apps/api/src/static/serve.ts` (serves the two `.well-known` files with the right content types, an exception to `serveDotFiles: false` for exactly these paths)
- Test: `apps/native/test/resume.test.ts`, `apps/web/test/nudge.test.ts`, `apps/api/test/headers.test.ts`

**Interfaces:**
- Consumes: Plan 3 `useEscrow`, which resumes every stored trade on load. Here it is exposed as `resumeAll(): Promise<void>`.
- Produces:
  - `startResume(app: Pick<AppPlugin, 'addListener'>, resumeAll, clock): () => void` calls `resumeAll()` on every `appStateChange` to `isActive: true` and on `resume`. Calls are debounced so overlapping events run it once. A run still in flight is not restarted.
  - The bundled app carries the same CSP as the web (a meta tag from the same `cspFor`, with Task 13's hashes).
  - `webDir: '../web/dist'`; app ids `org.x2f.app` (placeholder until D22).
  - The quote screen shows, for trades at or above the large-trade limit (the Plan 4 setting) and only in the web build, "For large trades, the X2F app is safer than the website." with a link to the downloads page. `// COPY-UNSIGNED`

- [ ] **Step 1: Write the failing tests:**
  - background then foreground → one `resumeAll`;
  - two events within 500 ms → one;
  - foreground during a run → no second run until it ends;
  - the nudge appears at the limit, not below it, and never in the native build;
  - the `.well-known` files are served with `application/json`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the shell using the Task 19 decisions.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on devices:**
  - a full stagenet trade, phone to desktop, with the phone app sent to the background during setup, release signing and mutual cancel, completes after the app is reopened, each time;
  - record the timings in `docs/native/spike-2026.md`.
- [ ] **Step 6:** Commit `feat(native): Capacitor apps with escrow resume on foreground; large-trade nudge`.

### Task 21: Passkeys, security keys and Tor in the native apps (and own node if D19 = a)

**Files:**
- Modify: `apps/native/src/*`, `apps/native/{android,ios}` as Task 19 decided; `apps/api/src/config.ts` (the native app's origins in `X2F_ORIGINS` and the `rpIdFor` mapping: native apps use the clearnet RP ID through associated domains); the Settings screen (D19)
- Test: `apps/native/test/*`, `apps/api/test/webauthn.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the API accepts a WebAuthn ceremony from the native origin with the clearnet RP ID, and refuses one from any other origin;
  - if D21 = (b): `torRoute()` returns the onion profile only when Orbot reports ready, and clearnet otherwise, never mixed within a trade;
  - if D19 = (a): a user-set node URL is validated (`https:` or `.onion`, no credentials in the URL), is used only by the escrow worker, and is never sent to the API.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement as Task 19 recorded.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5: Verify on devices:**
  - register and log in with a passkey and a YubiKey (NFC on Android, USB-C or Lightning on iOS) in both apps;
  - with Orbot running (D21 b), the trade traffic goes to the onion endpoints: check on the front host that the clearnet frontends saw no request.
- [ ] **Step 6:** Commit `feat(native): passkeys and security keys in the apps; Tor routing per D21`.

### Task 22: Signed native builds (reproducible Android, signed iOS)

**Files:**
- Create: `tools/release/native-android.sh`, `tools/release/native-ios.md`, `deploy/runbooks/native-release.md`
- Modify: `apps/native/android/app/build.gradle` (reproducible settings: fixed JDK and Gradle versions from the Capacitor 8.5.3 template, no build timestamps, sorted resources)

- [ ] **Step 1:** `native-android.sh` builds the release APK/AAB in a pinned container (JDK and Android build tools at the versions the Capacitor 8.5.3 template requires, image pinned by digest) and prints the sha256 of the unsigned APK.
- [ ] **Step 2: Verify:** two builds of the same commit on different machines give the same unsigned-APK sha256. Record it in `native-release.md`. If they differ, fix the cause before the task closes.
- [ ] **Step 3:**
  - Android signing key: made offline and backed up encrypted to the D7 key, used for every release (a lost key means users must reinstall).
  - F-Droid metadata if D17 picks it.
  - Publish the APK hash next to the web manifest, signed with the D15 key.
- [ ] **Step 4:** `native-ios.md`: the App Store re-signs and encrypts the binary, so iOS builds cannot be reproduced by outsiders (gap G5). Publish the source commit and the Xcode version per release, and keep signing in the owner's Apple account (D17).
- [ ] **Step 5:** Commit `feat(release): reproducible signed Android builds; iOS release procedure`.

## Part G — Audit, bounty and launch

### Task 23: External audit and penetration test (spec 6.5)

**Files:**
- Create: `docs/security/audit-brief.md`, `docs/security/threat-model.md`, `docs/security/external-audit.md`

- [ ] **Step 1:** `threat-model.md` covers:
  - assets: users' coins in escrow, the moderator key, accounts, chats, the owner and staff accounts;
  - actors, including a compromised API, a compromised moderation host and a malicious counterparty;
  - trust boundaries, as in the `deploy/` hosts;
  - what each defence in Plans 1–6 stops, and the accepted residuals from the Plan 1, 2, 3 and 4 reviews.
- [ ] **Step 2:** `audit-brief.md` covers:
  - scope: all of `packages/`, `apps/` and `deploy/`, plus the cryptography (protocol envelopes, multisig flow, R10/R23/R26, PGP login, secret sealing);
  - the commit tag frozen for the audit;
  - build and test instructions;
  - a stagenet staging environment that mirrors production, with test accounts (traders; a moderator; an owner account with test YubiKeys);
  - the prior reviews;
  - the questions the reviews left for auditors (Plan 1 review "Open items", Plan 2 review "Audit:" items).
- [ ] **Step 3:** After D13: run the code and cryptography audit first, then the penetration test against staging, from the onion and from clearnet.
- [ ] **Step 4:** Record every finding in `external-audit.md` (id, severity, status, fix commit, retest result). Every Critical and High finding is fixed and retested by the firm before Task 25. Medium findings are fixed, or accepted by the owner in writing in that file.
- [ ] **Step 5:** Commit each document update `docs(security): …` as it happens.

### Task 24: Bug bounty and `security.txt`

**Files:**
- Create: `apps/web/public/.well-known/security.txt` (clear-signed with the D15 key at release time), `apps/web/src/pages/SecurityPolicy.tsx` (route `/security`), `docs/security/bounty.md`
- Modify: `apps/api/src/static/serve.ts` (serves `/.well-known/security.txt` as `text/plain; charset=utf-8` on every site profile)
- Test: `apps/api/test/headers.test.ts`, `apps/web/test/securityPolicy.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `GET /.well-known/security.txt` returns 200 `text/plain` on both clearnet and onion hosts;
  - the body has `Contact:`, `Expires:` (under 1 year away), `Encryption:`, `Policy:` pointing at `/security`, `Canonical:` and `Preferred-Languages: en`;
  - a test fails the build when `Expires` is under 30 days away;
  - `/security` renders the scope, the out-of-scope list, the safe-harbour statement, the D14 amounts and "Rewards are paid in XMR".
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `Contact:` is per D14. For a self-run bounty, use a PGP-encrypted submission form on `/security` that posts to a staff-only queue, or a mailbox the owner runs outside the app. The page text is `// COPY-UNSIGNED` for the owner and the lawyer.
- [ ] **Step 4:** `npm run check`. Expect PASS.
- [ ] **Step 5:** Commit `feat(security): security.txt and bug bounty policy page`.

### Task 25: Launch runbook and go-live (spec 10, phase 4)

**Files:**
- Create: `deploy/runbooks/launch.md`
- Modify: `docs/dev-setup.md` (the leaked-list production size, from the build tool's output)

- [ ] **Step 1:** `launch.md` lists every launch step with its check command and expected output, and dated sign-off lines:
  1. Task 23 closed: no open Critical or High findings.
  2. A dress rehearsal on staging completes every step below on stagenet.
  3. A fresh production database (D16) with `roles.sql`, then migrations.
  4. The vault keys generated (Task 10).
  5. `X2F_LEGACY_SECRETS=off`.
  6. `X2F_MONERO_NETWORK=mainnet`, and the starter limits (spec 2.3) on, at the owner's values.
  7. The FIDO snapshot refreshed.
  8. The production leaked list built, and its size recorded in `docs/dev-setup.md`.
  9. `npm run preflight -w @x2f/api` → `"ok":true`.
  10. The first encrypted backup taken and a restore drill passed.
  11. The emergency stop tested with a key tap (Plan 4).
  12. The onion addresses, the PGP login-signing and release-signing fingerprints, and the release manifest hash published, signed, on the site and in the FAQ.
  13. `security.txt` live.
  14. Monitoring green for 72 hours.
  15. The owner flips maintenance off.
  16. The bug bounty opens.
  17. The native apps follow when D17 allows.
- [ ] **Step 2: Verify:** the dress rehearsal is done and logged with dates in `launch.md`.
- [ ] **Step 3:** Commit `docs(ops): launch runbook and rehearsal log`.

### Task 26: Plan 6 security review

**Files:**
- Create: `docs/security/plan-6-review.md`
- Modify: `docs/superpowers/plans/2026-10-15-roadmap.md` (the Plan 6 row → built), `docs/security/plan-2-review.md` (the ASVS 2.8.2 row → Met if D4 = a or b; F1 → fixed in front)

- [ ] **Step 1:** The lead runs Claude Security from the main session over `apps/`, `packages/`, `tools/` and `deploy/`. It cannot run inside a subagent (Plan 2 review). Also run Semgrep with `deploy` included, `npm audit --omit=dev`, and the `security-review` skill on the branch.
- [ ] **Step 2:** Walk ASVS 4.0 Level 3 chapters V1 (architecture), V6.4 (secret management: 6.4.1 and 6.4.2 key vault), V7 (logging: no sensitive data, no IPs), V9 (communications), V10.3 (deployed-code integrity), V14 (configuration, build and dependencies, headers) requirement by requirement, in the format of `plan-2-review.md`.
- [ ] **Step 3:** Check each Review Focus item against its test, and try to break it: restore and nonce reuse, a vault outage, large bodies through the proxy, a quiet WebSocket, noscript.
- [ ] **Step 4:** An adversarial pass on the deployment:
  - from outside, scan the front host (only 80 and 443 open);
  - from the app host, try to reach `x2f_moderation` as `x2f_api` (refused);
  - grep 7 days of staging logs on every host with `findIpAddresses` (empty apart from the allowlist);
  - confirm that HAProxy's runtime offers no way to dump stick tables.
- [ ] **Step 5:** Record the findings and fixes, the accepted residuals with the owner's answers (gaps G1–G16; Plan 4 A9 not built), and the items for the external auditors. Fix every High and Medium finding before closing.
- [ ] **Step 6:** Commit `docs(security): plan 6 review, roadmap row`.

---

## Spec gaps found while planning (for the owner; nothing decided here)

- **G1 Backups keep deleted data.** The spec's retention rules (4.1) do not mention backups. Deleted data survives in encrypted backups for up to D6 days. The Terms and FAQ should say so.
- **G2 IPs in memory.** Per-source limits need the proxy to see source addresses (or circuit ids). They are held in memory for up to 10 minutes and never written. Spec 4.1 says "no IP addresses are logged", which stays true, but the FAQ should be exact about it.
- **G3 Passkeys are per address.** A passkey made on the clearnet site does not work on the `.onion` site, and the reverse (different RP IDs). Whether Tor Browser supports WebAuthn at all is checked in Task 19. The spec reads as if both just work.
- **G4 Native app sessions.** The native apps' origins do not fit the `SameSite=Strict` cookie and exact-`Origin` design (Task 19). Spec 6.2 only mentions linking the domain for passkeys.
- **G5 iOS builds cannot be reproducible.** Apple re-signs and encrypts App Store builds. Spec 6.5 says "signed, reproducible native builds"; Android can be reproducible, iOS only signed.
- **G6 Tor "built into" the native apps** (4.1) has no mature drop-in for Capacitor (D21).
- **G7 Apple's crypto-app rules and developer-account identity checks** may block or delay the iOS app (D17). The spec assumes it ships.
- **G8 Spec 10 phase 3 says "allowlists"** without saying which. This plan reads it as the payout-address protections (already built) plus the network allowlists in `deploy/`. Please confirm.
- **G9 Escrow-key backup owner.** The roadmap's deferred table gives it to Plan 3 (P3-I14), while Plan 3's own text (P3-I14, X-6) moves it to Plan 6. This plan includes it (Task 18), and the roadmap row is annotated.
- **G10 Web tamper defence has a ceiling.** CSP and SRI cannot stop a compromised server from serving altered HTML. Only the native apps and outside monitoring (Task 14) help. Spec 6.5 lists them together as defences.
- **G11 Restoring the moderation database** can lead to multisig nonce reuse (R26) unless restores are marked (Task 7). Spec 3.2's "resume, don't fail" does not cover restores.
- **G12 "Use your own Monero node"** conflicts with the strict CSP in the web app (D19).
- **G13 The domain is permanent** for WebAuthn: changing it later voids every passkey and security key (D22).
- **G14 Monitoring and owner alerts for infrastructure** are not in the spec, which only covers price health alerts (11.6).
- **G15 "Require a security key to log in" plus lost keys:** the spec does not say whether recovery codes still work (D18).
- **G16 PGP-signed rulings and encrypted staff alerts** (Plan 4 A9, deferred to Plan 6) are not built here, because security-key taps already authorize rulings. Confirm they can be dropped.
