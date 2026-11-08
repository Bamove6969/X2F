# Advisory feeds to watch

Checked 2026-11-08 with an HTTP request: every URL below answered 200 unless the Status column says otherwise. "Verified" means the page exists, not that it is current. Anything that matters here goes through the deadlines in [patch-policy.md](patch-policy.md).

| Component | What to watch | URL | Status |
|---|---|---|---|
| Node.js | Security release announcements | https://nodejs.org/en/blog/vulnerability | Verified |
| Node.js | Release blog (all releases) | https://nodejs.org/en/blog/release | Verified |
| Node.js | Release schedule and end-of-life dates (repo pins Node 24) | https://nodejs.org/en/about/previous-releases | Verified |
| Node.js | Security working group | https://github.com/nodejs/security-wg | Verified |
| PostgreSQL | Security information and CVE list | https://www.postgresql.org/support/security/ | Verified |
| PostgreSQL | News archive (carries each minor-release announcement) | https://www.postgresql.org/about/newsarchive/ | Verified |
| PostgreSQL | Versioning and end-of-life policy | https://www.postgresql.org/support/versioning/ | Verified |
| libsodium | Releases | https://github.com/jedisct1/libsodium/releases | Verified |
| libsodium | Security advisories | https://github.com/jedisct1/libsodium/security/advisories | Verified (the page exists; the project rarely publishes advisories, so watch releases too) |
| monerod and monero-wallet-rpc | Release notes (both binaries ship in each release) | https://github.com/monero-project/monero/releases | Verified |
| monerod and monero-wallet-rpc | Downloads and current required version | https://www.getmonero.org/downloads/ | Verified |
| monerod and monero-wallet-rpc | Project blog (hard-fork and mandatory-upgrade announcements) | https://www.getmonero.org/blog/ | Verified |
| monerod | Hard-fork height table (the code is the schedule of record; there is no separate schedule page) | https://github.com/monero-project/monero/blob/master/src/hardforks/hardforks.cpp | Verified |
| monerod | Security advisories | https://github.com/monero-project/monero/security | Verified |
| Tor | Release announcements (forum) | https://forum.torproject.org/c/news/tor-release-announcement/28 | Verified |
| Tor | Release blog category | https://blog.torproject.org/category/releases/ | Verified |
| Tor | tor-announce mailing list | https://lists.torproject.org/mailman3/postorius/lists/tor-announce.lists.torproject.org/ | Verified |
| Tor | Release notes of the tor daemon | https://gitlab.torproject.org/tpo/core/tor/-/raw/main/ReleaseNotes | Verified |
| OpenPGP.js | Security advisories | https://github.com/openpgpjs/openpgpjs/security/advisories | Verified |
| OpenPGP.js | Releases | https://github.com/openpgpjs/openpgpjs/releases | Verified |
| Fastify | Security advisories | https://github.com/fastify/fastify/security/advisories | Verified |
| Fastify | Security policy (how to report, supported lines) | https://github.com/fastify/fastify/security/policy | Verified |
| Fastify | Releases | https://github.com/fastify/fastify/releases | Verified |
| nginx | Security advisories | https://nginx.org/en/security_advisories.html | Verified |
| nginx | Change log | https://nginx.org/en/CHANGES | Verified |
| nginx | nginx-announce mailing list | https://mailman.nginx.org/mailman/listinfo/nginx-announce | Verified |
| Caddy | Security advisories | https://github.com/caddyserver/caddy/security/advisories | Verified |
| Caddy | Releases | https://github.com/caddyserver/caddy/releases | Verified |
| Debian | Security information | https://www.debian.org/security/ | Verified |
| Debian | Security advisories (DSA) list | https://www.debian.org/security/dsa | Verified |
| Debian | debian-security-announce mailing list | https://lists.debian.org/debian-security-announce/ | Verified |
| Debian | Security tracker (per CVE and package) | https://security-tracker.debian.org/tracker/ | Verified |
| Ubuntu (if a server runs it) | Security notices | https://ubuntu.com/security/notices | Verified |
| All npm packages | GitHub advisory database | https://github.com/advisories | Verified |

Not verified: no entry failed; one guess was dropped. `https://www.getmonero.org/resources/moneropedia/hard-fork.html` returned 404, so the hard-fork schedule row points at the source file instead.

## How to use this

- Prefer email or RSS where offered (tor-announce, nginx-announce, debian-security-announce, PostgreSQL news). GitHub pages: "Watch" the repo with "Security alerts" and "Releases" ticked.
- Monero is the one that can stop the product: a mandatory hard fork makes an old monerod or monero-wallet-rpc unable to follow the chain. Read each release's notes for a fork height and plan the upgrade before it.
- The owner or the lead reads the feeds; who exactly is not decided yet (see "Not defined yet" in patch-policy.md).
