# Patch policy

One page. It says how fast a known vulnerability must be fixed, how an emergency patch and a rollback go for this repo as it is built today, and what is still undefined. Feeds to watch: [advisories.md](advisories.md). Automation behind it: `.github/dependabot.yml` (version and security update PRs) and `.github/workflows/deps-audit.yml` (daily `npm audit --omit=dev` and OSV-Scanner; a critical or high finding fails the run).

## Deadlines

Counted from the moment an advisory affecting something we run is published (or we learn of it), not from when we notice.

| Severity | Patched and deployed within | Notes |
|---|---|---|
| Critical | 24 to 48 hours | Start at once. A critical one that is actively exploited, or touches keys, funds, escrow or auth, is a 24-hour case. |
| High | 7 days | |
| Medium and low | Monthly | Batched into the monthly dependency round (the Dependabot weekly PRs, merged once a month at the latest). |

Rules that interact with this:

- The 14-day release-age rule for new dependency versions (rulings R31 and R33) is waived for a security fix at critical or high: take the fixed version as soon as it exists. Exact pinning still applies: pin the fixed version exactly (no `^`, no `~`), and for a transitive dependency use an `overrides` entry, as R33 did for fast-uri and serialize-javascript.
- A finding with no fixed version yet: record it in `docs/superpowers/rulings-and-lessons.md` as a time-limited exception (like R31 and R33) with the date it ends, and look for a mitigation (feature off, input blocked at the edge).
- "Deployed" counts, not "merged". The clock stops when the fix runs in production.
- A failed `deps-audit` run is an alert, not noise. Whoever receives it triages the same day.

## Servers: operating-system patches

Every server (API host, moderation host, relay, node proxy, Tor, monerod and wallet-rpc hosts) runs `unattended-upgrades` for Debian or Ubuntu security updates, and the security origin is the only automatic one. Enable it with `apt install unattended-upgrades` and `dpkg-reconfigure -plow unattended-upgrades`; set `Unattended-Upgrade::Automatic-Reboot "false"` unless the host is covered below, and watch `/var/run/reboot-required`. Kernel and libc fixes need a reboot: schedule it inside the deadline above and stop services in the order given in the runbook so that no trade is mid-signing. Do not auto-upgrade Node, PostgreSQL, Tor or monerod from third-party repositories or tarballs: those are patched by hand through this policy, because a surprise restart or major bump on a payments service is itself a risk. Also run NTP (or chrony) on the API and moderation hosts (see docs/coordination.md, auto-refund margin).

## Containers

No Dockerfile, compose file or image build exists in the repo today (checked 2026-11-08), so there is nothing to scan and the Dependabot `docker` block is commented out. If images are ever shipped: scan every image with Trivy (`aquasecurity/trivy-action`, pinned to a full commit SHA) in CI on build and daily on the published tag, fail on critical and high with a fix available, pin base images by digest, rebuild on every base-image security release, and uncomment the Dependabot docker block.

## Emergency patch runbook

Based on how the repo really runs: Node 24, each service started with `tsx src/main.ts` (apps/api, apps/relay, apps/node-proxy, apps/moderation); the web app built by `vite build` and served by the API (`apps/api/src/static/serve.ts`); PostgreSQL with separate databases for the API and for moderation; SQL migrations applied by a runner that runs every not-yet-applied file (`apps/api/migrations`, `apps/moderation/migrations`); a root `package-lock.json` with exact pins.

1. **Confirm.** Read the advisory. Is the vulnerable code reachable in what we run? Run `npm audit --omit=dev` and `npm ls <package>` to see every copy. Note the severity and the deadline above. Tell the lead, who tells the owner for a critical.
2. **Branch** from main: `wip/security-<id>`. Bump the exact pin in the workspace `package.json` (all workspaces that use it together, as with fastify in R31) or add an `overrides` entry for a transitive copy. Run `npm install`; the lockfile diff must contain only the intended packages.
3. **Check.** Run the targeted tests for the touched workspaces, then the full `npm run check` once on the final merge result (audit and semgrep included). A critical fix may land on one green check plus a second reviewer; do not skip the review.
4. **Land** on main through the usual path. Tag the deployed commit (`deployed-YYYY-MM-DD-<short sha>`) so a rollback target is always known.
5. **Deploy order** (docs/coordination.md): the **API first**, then moderation. Moderation expects whatever the new API serves, and an older API refuses newer moderation reports with 400. The moderation service takes a Postgres advisory lock and is **one process only**: **stop the old moderation process before starting the new one** (a rolling or overlapping deploy makes the new one log `moderation-instance-locked` and exit 1). Run a supervisor that restarts it, since it also exits 1 on `moderation-instance-lock-lost`. Relay and node-proxy have no ordering rule recorded; restart them after the API and moderation, one at a time. Migrations: stop the API, run the migrations, start it (docs/dev-setup.md notes cases where a rolling deploy breaks, e.g. migrations 011 and 012). A new web build is just a new `dist` served by the API.
6. **Verify.** `/healthz` on the API and staff API, the moderation log shows no `moderation-instance-locked` or `desk-record-stale` storms, an open trade still advances (a test trade on stagenet if one is available), `npm audit` on the deployed lockfile is clean for the advisory.
7. **Record.** Add a line to docs/coordination.md or the rulings file: advisory id, versions, deploy time, who.

### Rollback

- **Code:** redeploy the previous tag in the same order (API first, then moderation, old moderation stopped before the new one starts). Restore the previous `package-lock.json` with `npm ci`; never `npm install` during a rollback.
- **Database:** migrations here are forward-only (no down files). A rollback after a migration has run needs the previous code to tolerate the new schema, or a restore from a backup taken before the deploy. Take a `pg_dump` (or a snapshot) of both databases before any deploy that includes a migration. Note docs/dev-setup.md on backups: older backups may still hold data the app has since sealed, so keep them as protected as the key ring.
- **Funds:** never roll back anything that has moved or signed coin state. If a patch touches escrow, signing or release paths, stop and ask the lead and owner whether to pause new trades first (the "trading hold" and pause mechanisms are described in HANDOFF.md; the exact operator procedure is not defined).
- **Decision to roll back:** if step 6 fails and the fix cannot be corrected inside an hour, roll back, then fix forward on the branch.

## Not defined yet

- **No production deployment exists in the repo.** There is no deploy script, process supervisor or systemd unit, reverse proxy configuration (nginx or Caddy), Tor hidden-service setup, or hosting choice. This runbook describes the sequence the code requires, not commands that can be copied. The first real deployment task must turn steps 5 and 6 and the rollback into scripts.
- **Process supervision** for the moderation service (needed so its exit 1 restarts it, with the old process stopped first).
- **Backups:** schedule, location, encryption, retention, and a tested restore. Nothing is written down beyond the warnings in docs/dev-setup.md.
- **Staging environment** to rehearse a patch before production. Regtest and stagenet tooling exist (`tools/regtest`) but are not a deploy rehearsal.
- **Patch owner and on-call:** who receives the GitHub failure notification and the advisory feeds, who acts on a weekend, and who tells the owner. Currently the lead.
- **monerod and monero-wallet-rpc, Tor, PostgreSQL, libsodium upgrades:** where they run and how they are installed is undecided, so their patch path is "by hand, inside the deadlines above". A mandatory Monero hard fork has no fixed procedure yet.
- **Pause or maintenance mode** for new trades during an emergency deploy: the mechanism and the user-facing wording are owner decisions and are not specified.
- **Secret rotation after a compromise** (the key rings in docs/dev-setup.md have a rotation procedure per ring; a full emergency rotation drill is not written).
- **Notification path for users** after a security incident (owner and legal decision).
