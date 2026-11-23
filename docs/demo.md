# The local demo (`npm run demo`)

A one-command demo of the whole real X2F stack on this machine, with **fake money only**: a
private Monero regtest chain, throwaway keys made fresh on every start, and seeded demo traders.
It is for trying the product end to end (sign in, browse, take an offer, fund the escrow, pay,
release, leave feedback). It is not a deployment and nothing in it is ever used in production.

## Start and stop

```sh
npm run demo        # starts everything in the background, prints the URL, then returns
npm run demo:stop   # stops every demo process, removes the demo Postgres container, deletes .demo/secrets
```

`npm run demo` sets `X2F_DEMO=1` itself. Starting again first stops the previous demo and wipes
`.demo/` (a fresh chain, fresh secrets, fresh accounts every time).

It needs: Node 24 and `npm ci` (docs/dev-setup.md), Docker (if `docker info` fails for your user,
run it as `sg docker -c 'npm run demo'`), and monerod, which it installs and verifies with the
same `tools/regtest/fetch-monerod.sh` the regtest tests use (into `.regtest/bin/`; needs `curl`,
`gpg`, `bzip2`). The first start takes a few minutes (the web build and 130 regtest blocks).

What runs, all bound to 127.0.0.1:

| Piece | Where |
| --- | --- |
| Gateway: the web app, the API and `/relay` on one origin | **http://localhost:4400** |
| Gateway: the node proxy's origin (the wallets in the browser sync through it) | http://localhost:4401 |
| API (public) / internal listener / staff API | 18080 / 18081 / 18082 |
| Relay / relay admin | 18787 / 18788 |
| Node proxy (to monerod's restricted RPC) | 18789 |
| monerod `--regtest --offline` (full RPC / restricted RPC / p2p) | 18481 / 18482 / 18480 |
| Postgres 17 in Docker, container `x2f-demo-postgres`, data on tmpfs | 54329 |
| Demo moderator (moderation service, miner, faucet) | no port |

A second demo beside a running one (demo r6: build and check a new worktree while the old one
keeps serving): `DEMO_PORT_OFFSET=10 npm run demo` adds 10 to every port above (4410 / 4411,
API 18090, Postgres 54339 ...) and uses its own Postgres container, `x2f-demo-postgres-10`. The
container a demo started is kept in `.demo/pg-container`, so `npm run demo:stop` in that worktree
removes that one and never the other demo's. For a check that should leave the owner's comments
alone, also set `DEMO_NOTES_PUSH=0` and `DEMO_NOTES_FILE` to a scratch file.

The guide (`/__demo/guide`) opens with "New in this demo": each new or fixed screen with the
owner's demo note numbers it answers; `/__demo/guide/legal` shows
`docs/terms-legal-review-2026-11-23.md` as a page.

Process ids are in `.demo/pids.json`, logs in `.demo/logs/<name>.log`, the logins in
`.demo/logins.txt`, the secrets in `.demo/secrets/` (the authenticator secrets in
`.demo/secrets/totp.json`; all gitignored).

## Accounts

Every demo account's password is **`Demo-Monero-2026!`**. Sign in with the **login name** (the
private one), not the display name. The login then asks for an authenticator code: run

```sh
npm run demo:code ana-demo     # or with no name: every account's current code
```

and type the 6 digits (each code works once; a new one comes every 30 seconds). Or add the
account's authenticator secret from `.demo/logins.txt` to any authenticator app. Password plus
authenticator code is a strong login, so a demo account works at once in a new browser; a
password alone would start the 24-hour hold (R42) and leave the account unable to trade.

**The door (demo only, `tools/demo/door.ts`).** On the real app a password + authenticator login
on a browser the account does not know is refused when no device is logged in to approve it (hold
model v3, 403 `approval-unavailable`); only a passkey, security key or PGP key gets in. The seeded
accounts have none of those, so the gateway lets them in: when a seeded account's password step
passes and the account has no logged-in session, that browser is recorded as known for it before
the code is checked. Accounts you make yourself in the demo get no door.

If the same account is already logged in somewhere else (another browser, or a script), a new
login asks that device to approve it (number matching, Plan 2 Task 16): log the other one out
first, or approve from it (the logged-in device shows three numbers; tap the one the new device
shows).

Only a vendor can post offers (owner, 2 Nov 2026). The cast and `ana-demo` are made vendors by the
seeder, straight in the demo database (becoming one for real needs a passkey, security key or PGP
key); `ben-demo` and `cy-demo` stay traders, so you can see both. The seed signs the Terms with
each account's display name typed (the sign-up's signature, migration 316).

Yours, with no offers, to trade with yourself (one browser profile or device per account, since
each trade's escrow keys live in that browser):

| Login name | Shown as | Type |
| --- | --- | --- |
| `ana-demo` | demo_ana | vendor |
| `ben-demo` | demo_ben | trader |
| `cy-demo` | demo_cy | trader |

The cast, each with offers already posted (USD and CAD, Zelle, Cash App, Interac, Venmo, Amazon
gift cards, Wise, PayPal):

| Login name | Shown as |
| --- | --- |
| `satoshi-login` | satoshi_ghost |
| `mira-login` | mira.k |
| `nightowl-login` | nightowl_44 |
| `kettle-login` | kettle.moss |
| `lowtide-login` | lowtide_rx |

Every account has a password, an authenticator (throwaway secret) and one throwaway payout wallet.

`lowtide_rx` also posts offers in euros (SEPA Instant) and pounds (Faster Payments), and the seed
makes two trades through the real API so **My trades** has rows for `lowtide-login`: one it cancels
at once (Completed, `cancelled`) and one left open in `setup` (Open). The escrow keys live in a
browser, so the seed never sets up an escrow: the open one is cancelled by the API's timer 60
minutes after the seed and then moves to Completed. No XMR or fiat moves for either. A released
trade, a rating and a dispute need the escrow and are done by hand (the guide below). The demo
runs no staff-web: the staff API listens on 127.0.0.1 only, so there are no moderator screens and
nobody can take a dispute here.

**The guide.** `GET /__demo/guide` on the gateway is a plain checklist of every screen, with a link
to each and the seeded account to use (`tools/demo/guide-page.ts`, `tools/test/demo-guide.test.ts`).
It reads what the seed made from `.demo/state/seed.json` (login names, offers, trade codes; no
secrets) and, like `/__demo/codes`, never reaches the API.

## What is fake

- **The money.** The chain is a private regtest chain on this machine (`--regtest --offline`, no
  peers). Its XMR is worthless and exists only until `npm run demo:stop`. Addresses look like
  mainnet ones (regtest uses the mainnet address format) but are only ever used on this chain.
- **Funding.** When the seller starts funding (taps **Copy address** or **Copy amount** on the
  funding screen, or completes the hold that opens the wallet app; the trade records
  `fund-started`), the demo moderator's faucet wallet pays the escrow exactly what the trade asks,
  standing in for the seller's own wallet app. A block is mined every 3 seconds, so the 10
  confirmations take about half a minute.
- **The seller must be online** for an offer to show **Trade** (otherwise only "Message"): log the
  seller in, in its own browser, before the buyer takes.
- **The fiat payment.** Nothing is paid; the buyer just taps "I've paid".
- **Every secret.** The server keys, key rings, PGP signing key, VAPID keys, moderation signing
  key and keystore key, the X2F fee wallet (whose keys are thrown away) and the Postgres password
  are random per start, in `.demo/secrets/` (chmod 600), and die with the demo. So are the demo
  accounts' authenticator secrets.
- **The leaked-password list** has a single entry ("password").
- **The miner and the faucet** are the only demo pieces in `tools/demo/moderator.ts`. It runs the
  real moderation service (attestation, the moderator's escrow party, the chain watcher that
  reports `setup-done`, `chain` and `settled`, the moderator desks), only with a 4-second watcher
  period instead of 15 seconds. The API runs its own trade timer loop. Everything else is the real
  code: the real API, moderation service, relay, node proxy, web build, escrow runtime and 2-of-3
  multisig.

What is **real**: the XMR prices. The API asks the public price sources (spec 11.6) over the
internet, as in production, so offers quote live market rates. Without internet, market-priced
offers cannot be taken (409 `price-unavailable`).

## Comments on the running demo

The gateway adds one script tag (`/__demo/notes.js`) to the app's HTML, so anyone with the demo open
can leave comments the way one does on a shared page: tap **Comment** (top-right, drag it if it is
in the way), tap the spot, type, Send. A numbered pin stays on that spot for that screen; tapping it
opens the thread, where you can add to it or **Resolve** it. A red mark on a pin means a new reply.
Nothing in `apps/` or the production build knows about this: it is `tools/demo/` only, and the app's
Content-Security-Policy is unchanged (one same-origin script; styles through the DOM's style objects).

Everything is kept next to each other, outside `.demo/`, so a demo restart does not wipe it:

| File in `~/x2f-comms/` | What |
| --- | --- |
| `demo-notes.jsonl` | Comments, and follow-ups (those have `parentId`) |
| `demo-replies.jsonl` | Replies, by `noteId` |
| `demo-resolved.jsonl` | Resolved threads, by `noteId` |

To answer a comment, on this machine only (there is no HTTP route for replies):

```sh
npm run demo:reply <comment id> "Thanks, changing it"
```

The page picks it up within 15 seconds; earlier demos' comments can be answered too (their ids are
in the downloaded file). `DEMO_NOTES_FILE` moves the three files.

**It builds on the earlier demos.** On start the gateway reads every `owner-demo-notes-*.jsonl`
on `origin/comms` (or a local `comms` branch) with `git show`, read only and with no network, and
adds `DEMO_NOTES_SEED` when set (comma-separated `.jsonl` files, or folders whose
`owner-demo-notes-*.jsonl` are read). With the three local files, read on every request, that is one
record: each comment, follow-up, reply and resolved thread once, by id (the 16 Nov file on comms
repeats the 12 and 13 Nov notes; they count once). Every earlier comment shows as its pin on its
screen, opens its thread, and can be added to, answered and resolved; resolved ones stay hidden.
Those writes go to the local files only; comms is never written from here (but see GitHub below).

**One running number.** A comment's number is its place in time order among all comments (ties by
id), across every screen and every session: the same on every start and on every computer with the
same notes. Follow-ups take no number. A new comment is the highest + 1 (with the notes on comms on
16 Nov, the first new one is 91). If origin/comms cannot be read (offline, or no comms branch in
this checkout: `git fetch origin comms` adds it), only the local files count, and the start-up
`Comments:` line says so.

**Download my notes** (next to **Comment**) saves `owner-demo-notes-<date>.jsonl`: the whole record
in time order, each comment with its number, each follow-up, then the replies (`"kind":"reply"`) and
resolved threads (`"kind":"resolved"`). It reads back as an earlier file with the same numbers and
state. `GET /__demo/notes/download` is same-origin only (another port on this machine is refused too).

**GitHub.** The gateway also puts that file on the `comms` branch for you (`tools/demo/notes-push.ts`),
30 s after the last new comment, follow-up or resolve, once at start, and once at `npm run demo:stop`,
as `owner-demo-notes-<today's date>.jsonl` (the same file, updated through the day), committed
"owner demo notes <date> (auto)". It works in its own git worktree, `~/x2f-comms/.comms-push`, so your
checkout, its branch and any work in it are never touched. It only adds that one file to comms, with
`git push origin HEAD:comms`; if comms moved meanwhile it starts again on top of the new comms and
keeps the other copy's lines, and it never force-pushes. git uses your own login and never asks for
anything; your git name is used if you set one, else `owner`. If it cannot push (offline, not logged
in), your notes are safe on this computer and it tries again every 2 minutes; under the **Comment**
button the page shows "Saved on this computer — not on GitHub yet" or "On GitHub", and the gateway's
log (`.demo/logs/gateway.log`) says why. `DEMO_NOTES_PUSH=0 npm run demo` turns it off.

A comment records the text, the screen (path, short hash, `data-screen`), the viewport, the tap as
pixels and percent, a CSS-style path of the tapped element and up to 120 characters of its visible
text. It never reads a form field, cookie or token; on wallet, setup, login and security screens the
tapped text is left out, and long address- or key-like strings are replaced with `[hidden]`.
`POST /__demo/notes` is same-origin only, JSON only, 4 KB at most, 30 writes a minute. `/__demo/*`
never reaches the API (`tools/test/demo-notes.test.ts`).

## Fixed: a release never finished on the seller's side

Until 10 Nov, after the seller held **Payment received** and the buyer's device co-signed, the
buyer saw "Released" but the seller's screen stayed on "Signing… keep this page open" and the
trade stayed `settling` (the moderator logged `sweep-unproven`). The seller's device could never
look its release up on the daemon in the browser bundle. Fixed by `wip/lead-release-settle-2`
(merged here; not on main until the lead's security review): see `docs/coordination.md`, "P0 8
Nov". Likely still true on the demo (from the code, not tried): reloading a trader's page
mid-trade reopens its regtest escrow wallet in-process, whose HTTP has the same cause and cannot
send in the browser (regtest only); keep each trader's page open from take to settled.

## The guards

- **`X2F_DEMO` must be exactly `1`.** Every demo process (`demo.ts`, the gateway, the moderator,
  the seeder) refuses to start otherwise (`tools/demo/guard.ts`).
- **Regtest only.** The gateway, the moderator and the seeder ask their daemon `get_info` and refuse unless it
  reports `nettype: fakechain` with none of `mainnet`, `stagenet` or `testnet`, and unless its
  URL is on 127.0.0.1; `demo.ts` checks both monerod RPC ports the same way before it starts the
  API, relay, node proxy or any other service. The guard is covered by `tools/test/demo-guard.test.ts`.
- **This machine only.** Everything binds to 127.0.0.1. The one exception: when
  `tailscale ip -4` succeeds, the gateway also serves HTTPS (a self-signed certificate made per
  start) on that Tailscale address, ports 4443 (the app) and 4444 (the node proxy), so your own devices on your tailnet can open it.
  The gateway refuses any address outside Tailscale's 100.64.0.0/10. Nothing ever binds 0.0.0.0,
  and no public tunnel is opened unless you ask for one (below).
- **A public link, only when asked.** `DEMO_TUNNEL=cloudflared npm run demo` starts two Cloudflare
  quick tunnels (no account; `cloudflared` on the PATH, or its path in `DEMO_CLOUDFLARED`) to
  127.0.0.1:4400 and 127.0.0.1:4401, and builds the app for their `https://….trycloudflare.com`
  URLs (printed at the end and in `.demo/urls.json`). Or bring your own two HTTPS tunnel origins:
  `DEMO_PUBLIC_ORIGIN=https://app… DEMO_PUBLIC_NODE_ORIGIN=https://node… npm run demo`. An
  explicit https port is kept, so a Tailscale Funnel works with its other ports:
  `tailscale funnel --bg --https=8443 http://127.0.0.1:4400`, `tailscale funnel --bg --https=10000
  http://127.0.0.1:4401`, then `DEMO_PUBLIC_ORIGIN=https://<host>.ts.net:8443
  DEMO_PUBLIC_NODE_ORIGIN=https://<host>.ts.net:10000 npm run demo` (a funnel is public too; turn
  each off with `tailscale funnel --https=8443 off`). The web
  build, the relay's wss URL, the node proxy URL, the allowed origins and the CSP then use them
  (`tools/demo/origins.ts`, `tools/test/demo-origins.test.ts`); localhost keeps working. **A quick
  tunnel is public: anyone who has the URL can open the demo and sign up.** It is fake money only
  (regtest), and the tunnels end with `npm run demo:stop`. Passkeys are made for the tunnel's host
  name; password logins work everywhere.
- **Any one https origin (a preview pane, a tunnel).** The demo's web build is made with
  placeholder origins for the relay and the node proxy; the gateway fills them, in the app's
  JavaScript and in the CSP, with the origin each request was sent to, and routes `/relay` and the
  node's RPC paths by path. So the app, the API, the relay and the node all work on one origin, port
  4400 alone, whatever https host name sits in front of it (`tools/demo/self-origin.ts`,
  `tools/test/demo-self-origin.test.ts`). The gateway accepts a request's own origin only when it is
  `https://` plus the request's Host or X-Forwarded-Host, and hands the API and the node proxy the
  demo's primary origin in its place. An http Origin is never taken this way: the gateway is clear
  text on 127.0.0.1, so an https Origin can only come through a TLS front, never from a page that
  rebinds a name to 127.0.0.1. Nothing in `apps/*` changed.
- **Security keys and passkeys under a preview pane.** WebAuthn needs the RP ID to be the page's
  own host name, and the API starts with `localhost` (or the tunnel's host). Opened from any other
  https host, the browser refused every key before asking it (owner, 13 Nov: "Unable to add
  security key", USB and NFC). So the first time a page is loaded from such a host (not an IP
  address) through a local https front (a loopback peer sending `X-Forwarded-Proto: https`, as the
  preview pane's proxy and tunnel clients do; a LAN or tailnet client's Host is never taken), the
  gateway restarts the API with that host as `X2F_RP_ID` and its origin added to
  `X2F_ORIGINS`, holding API requests for the few seconds that takes (`tools/demo/rp-adopt.ts`,
  `tools/test/demo-rp-adopt.test.ts`; the API's environment is kept for it in `.demo/secrets/env.json`,
  0600; the adopted host is in `.demo/state/rp-origin.json`). A failed restart adopts nothing and
  the next page load tries again (`rp-adopt-failed` in the gateway log; each `self-origin` line
  shows the peer and X-Forwarded-Proto). The first host stays; keys and
  passkeys then work under it only (localhost still opens the app, and passwords work everywhere).
  Only a request from a loopback peer (the preview pane's forwarder) can be adopted, and
  `X-Forwarded-Host`/`-Proto` count only from one: a client on the phone's LAN address or the
  tailnet cannot choose the host. `DEMO_ADOPT_HOST=<host name>` pins the one host that may be
  adopted (set it when you know the preview's host).
  Not with a public tunnel (its host is the RP ID already); `DEMO_ADOPT_SELF=0` turns it off. The
  tailnet address is an IP, which can never be an RP ID: use localhost, a tunnel or the preview there.
  If the preview pane shows the app inside a frame, the browser may still refuse keys there: open
  the same address in its own tab.
- **Codes on a page.** `GET /__demo/codes` on the gateway shows the seeded accounts' current
  authenticator codes (what `npm run demo:code` prints), for a phone. Only the seeded accounts'
  throwaway secrets are in it; it never reaches the API (`tools/demo/codes-page.ts`).
- **On the phone itself (Android "Linux Terminal").** Inside the Android Terminal Debian VM,
  `npm run demo` (or `X2F_DEMO_PHONE=1 npm run demo` anywhere; auto-detected from `/dev/vsock` and
  the `droid` user, `X2F_DEMO_PHONE=0` turns it off) also makes the gateway's port 4400, and
  nothing else, listen on the VM's private address (`hostname -I`), because the Terminal app
  forwards only ports the VM listens on at its own interface. Allow port 4400 in the Terminal app's
  port notification or its settings, then open http://localhost:4400 in Chrome on the phone: the
  origin stays http://localhost:4400. Every other service stays on 127.0.0.1 (`tools/demo/phone.ts`,
  `tools/test/demo-phone.test.ts`).
- **The node proxy needs its own origin.** monero-ts drops any path in a daemon URI, so
  `VITE_NODE_PROXY_URL` (here and in production) must be a bare origin such as
  `https://node.example.org`, never `https://example.org/node`.
- **Never in a product build.** Nothing in `apps/*` or `packages/*` may import `tools/demo` or
  `@x2f/demo`, or depend on it: `npm run separation-check` fails if anything does
  (`tools/test/separation.test.ts`). The demo's web build goes to `apps/web/dist-demo/`
  (gitignored), never `apps/web/dist`.
