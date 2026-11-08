# The local demo (`npm run demo`)

A one-command demo of the whole real X2F stack on this machine, with **fake money only**: a
private Monero regtest chain, throwaway keys made fresh on every start, and seeded demo traders.
It is for trying the product end to end (sign in, browse, take an offer, fund the escrow, pay,
release, leave feedback). It is not a deployment and nothing in it is ever used in production.

## Start and stop

```sh
npm run demo        # starts everything in the background, prints the URL, then returns
npm run demo:stop   # stops every demo process and removes the demo Postgres container
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

If the same account is already logged in somewhere else (another browser, or a script), a new
login asks that device to approve it (number matching, Plan 2 Task 16): log the other one out
first, or approve from it.

Yours, with no offers, to trade with yourself (one browser profile or device per account, since
each trade's escrow keys live in that browser):

| Login name | Shown as |
| --- | --- |
| `ana-demo` | demo_ana |
| `ben-demo` | demo_ben |
| `cy-demo` | demo_cy |

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

## What is fake

- **The money.** The chain is a private regtest chain on this machine (`--regtest --offline`, no
  peers). Its XMR is worthless and exists only until `npm run demo:stop`. Addresses look like
  mainnet ones (regtest uses the mainnet address format) but are only ever used on this chain.
- **Funding.** When a seller taps "Fund escrow", the demo moderator's faucet wallet pays the
  escrow exactly what the trade asks, standing in for the seller's own wallet app. A block is
  mined every 3 seconds, so the 10 confirmations take about half a minute.
- **The fiat payment.** Nothing is paid; the buyer just taps "I've paid".
- **Every secret.** The server keys, key rings, PGP signing key, VAPID keys, moderation signing
  key and keystore key, the X2F fee wallet (whose keys are thrown away) and the Postgres password
  are random per start, in `.demo/secrets/` (chmod 600), and die with the demo. So are the demo
  accounts' authenticator secrets.
- **The leaked-password list** has a single entry ("password").
- **Pieces production does not have wired yet**, played by the demo moderator
  (`tools/demo/moderator.ts`): the moderator's escrow party, the chain watcher that applies
  `setup-done`, `chain` and `settled`, and the trade timer loop. Everything else is the real code:
  the real API, moderation service, relay, node proxy, web build, escrow runtime and 2-of-3
  multisig.

What is **real**: the XMR prices. The API asks the public price sources (spec 11.6) over the
internet, as in production, so offers quote live market rates. Without internet, market-priced
offers cannot be taken (409 `price-unavailable`).

## The guards

- **`X2F_DEMO` must be exactly `1`.** Every demo process (`demo.ts`, the gateway, the moderator,
  the seeder) refuses to start otherwise (`tools/demo/guard.ts`).
- **Regtest only.** The moderator and the seeder ask their daemon `get_info` and refuse unless it
  reports `nettype: fakechain` with none of `mainnet`, `stagenet` or `testnet`, and unless its
  URL is on 127.0.0.1; `demo.ts` checks both monerod RPC ports the same way before starting any
  service. The guard is covered by `tools/test/demo-guard.test.ts`.
- **This machine only.** Everything binds to 127.0.0.1. The one exception: when
  `tailscale ip -4` succeeds, the gateway also serves HTTPS (a self-signed certificate made per
  start) on that Tailscale address, ports 4443 (the app) and 4444 (the node proxy), so your own devices on your tailnet can open it.
  The gateway refuses any address outside Tailscale's 100.64.0.0/10. Nothing ever binds 0.0.0.0
  and no public tunnel is opened.
- **Never in a product build.** Nothing in `apps/*` or `packages/*` may import `tools/demo` or
  `@x2f/demo`, or depend on it: `npm run separation-check` fails if anything does
  (`tools/test/separation.test.ts`). The demo's web build goes to `apps/web/dist-demo/`
  (gitignored), never `apps/web/dist`.
