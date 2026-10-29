# Phase 0 results: escrow in a real browser and on a phone

Run 2026-10-14 (about 22:40–23:30 PDT). **Throwaway spike code**, not product code.

## Verdict: GO

The 2-of-3 Monero multisig escrow works with monero-ts running **in ordinary web pages**: the buyer in desktop Chrome, the seller in **Firefox on an Android 14 phone**, talking only through a message relay over home Wi-Fi. Setup, funding, release and refund all completed, and the payouts arrived.

## Setup

- monero-ts 0.11.16 (browser bundle via esbuild; Node's `assert` shimmed, other Node-only modules stubbed), monerod v0.18.5.3 private regtest chain, downloaded and checked against binaryFate's signed hashes (key `81AC 591F E9C4 B65C 5806 AFC3 F0AF 4D46 2A0B DF92`).
- Buyer: Chrome 155 on this Linux laptop. Seller: Firefox 157 on Android 14 (8 cores). Moderator: Node on the laptop.
- Both pages loaded over plain `http://` on the LAN (not a secure context). monero-ts ran fine anyway.
- Parties exchanged multisig data only through a long-polling mailbox, standing in for X2F's encrypted relay.

## Results

| Scenario | Laptop dry run (both roles in desktop Chrome) | Laptop buyer + phone seller |
|---|---|---|
| 1. Normal trade: seller + buyer release to buyer | PASS, 0.998192 XMR | PASS, 0.998190 XMR |
| 2. Mutual cancel: buyer + seller refund the seller | PASS, 0.998192 XMR | PASS, 0.998189 XMR |
| 3. Dispute won by buyer: moderator + buyer | PASS, 0.998192 XMR | Not completed: harness mined exactly 10 blocks after funding and the wallets saw the escrow one block short of unlocked. Harness bug (now mines 12), not an escrow fault. The phone's part in this scenario (setup) completed in 17.7 s. |

The rest of each 1 XMR went on network fees.

## Timings on the phone (seller, Firefox, Android 14)

| Step | Time |
|---|---|
| Create wallet (load WebAssembly, make keys) | 8.3–9.1 s |
| Whole escrow setup (4 message rounds, includes waiting for the others) | 16.5–17.7 s |
| See the funded escrow after blocks arrive | 0.5–2.6 s |
| Swap multisig state | 0.9–1.6 s |
| Build release transaction | 2.8 s |
| Co-sign and broadcast | 2.2 s |

The laptop's own setup was 11–19 s. Setup takes **4 message rounds** (prepare, make, two key exchanges), not 3 as noted from the single-process spike.

## Findings for the product

1. **Phones pause background pages.** In the first phone run, the user switched to Cake Wallet mid-trade and the seller's page failed while building the release ("Failed to get earliest fork height"). The real app must **save escrow progress and retry or resume** every step, and tell users to keep X2F open during the few seconds of signing. The native Capacitor app should keep the work alive in the background.
2. **"Open in Cake Wallet" works on Android.** A `monero:<address>?tx_amount=0.0001` link opened Cake with the address and amount filled in correctly. iPhone and Edge are still untested.
3. **Linux desktop has no handler for `monero:` links.** Feather (Flatpak) does not register for them, so desktop funding is copy-paste or QR, as the design already allows.
4. **The wallet code reaches the node by host and port only.** monero-ts drops any path in the node address (`/daemon` was ignored), so X2F's node proxy must serve Monero's normal paths (`/json_rpc`, `/getblocks.bin`, …) at its own root or on its own host.
5. **Browser bundle size:** about 4 MB for the page plus a 3.6 MB worker. Fine on Wi-Fi; worth measuring on mobile data later.
6. Chrome on Android warns that the plain-http test page "doesn't support a secure connection". The real site is HTTPS-only, so this only affects tests.

## Not covered yet

- An iPhone (Safari) and Edge's handling of `monero:` links.
- A real network across the internet and Tor (this was one home Wi-Fi network).
- Monero's stagenet or testnet with real block times (regtest blocks were made on demand).
- Larger escrows and many concurrent trades.

## Files

`escrow.mjs` (one party's escrow steps, shared by browser and server), `server.mjs` (page, node proxy, mailbox, moderator, funding and checks), `client.mjs` + `index.html` (browser side), `results.json` (raw timings from the phone run).
