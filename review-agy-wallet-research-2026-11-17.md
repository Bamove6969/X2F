# Review: wip/agy-wallet-research @a014d5b0 (agy Job 4) — 17 Nov 2026, lead helper (taking over from claude3)

Branch: `origin/wip/agy-wallet-research` a014d5b0, one commit on wip/third-demo-r3 1fa6bed1. One file:
`docs/research-monero-wallet-connect-agy-2026-11-16.md` (new, 158 lines). No app code.
Order: AGY-ORDERS.md Job 4 (research only, no code; check comms research first; give a recommendation).
Compared against comms `research-wallet-connect-2026-11-12.md`, `research-monero-connect-broad-2026-11-12.md`, the
owner's 16 Nov #7 answer (`7fd0d91a`: a list of well-known wallets "and many more", one address field) and the code
on 1fa6bed1 / 94337781. claude3's 16 Nov 17:35 line ("good, evidence-cited; 3 claims spot-checked") had no review file;
this is that file.

## VERDICT: APPROVE WITH MINORS

Forbidden-areas check (rule: agy touches only UI, copy, docs, research): the diff is one research doc. No money,
escrow, keys, login security, fees, liens, disputes or payout code is changed. Nothing BLOCKING.

The doc builds on the 12 Nov research instead of repeating it, and adds the Monero GUI/CLI, hardware-wallet and
Stack Wallet rows the 12 Nov tables lacked. The code citations I checked are right:
- `setup/Wallet.tsx:95-101` (the eight radio chips), `Wallets.tsx:490-503` (chips), `Wallets.tsx:550` (the "Scan address
  QR code" comment), `fund.ts` `WALLET_NAMES`, `wallets-model.ts` `WALLET_APPS` (8 codes), the Edge Full Sync tip.
- `TradeFund.tsx:206/216/231/259/275`: the phone hold button says "Open in <wallet>", releasing it sets the
  'opened' mark and posts `fund-started`.
- The Edge/Stack/Feather `monero:` handler facts match the 12 Nov doc (which cites the wallets' source).

## Minors

**M1. §4 item 1 overstates what happens after the hold.** It says the hold "permanently disables the button ... even
though no wallet ever opened". On the base, once `opened` is set the QR code and copy buttons are shown
(`TradeFund.tsx:293-302`: `fallback` renders when `opened`), and the docstring (:6-8) says the QR and copy stay until
funded. What is true: the button turns into "Waiting for your payment…" and `fund-started` is recorded even if the
wallet did not open (Edge/Stack on a phone). Fix: say that, and drop "permanently disables".

**M2. New wallet facts have no sources.** §2.1-2.4 (Monero GUI `.desktop`/`Info.plist`/registry handlers, Trezor
`moneroGetAddress`, Ledger APDU over WebHID, Stack Wallet subaddresses "verified", Cake/Feather sign-verify menus) give
no file, commit or doc link, unlike the 12 Nov doc. Fix: add the source (repo path at a commit, or doc URL) for each,
or mark the item "not verified".

**M3. The recommendation now has an owner answer next to it.** §6.2 proposes "Scan wallet QR code" + "Paste" + a plain
list. The owner answered on 16 Nov #7: a recommendation list and one address field (Job 27). A camera scanner is a
new feature the owner has not asked for. Fix: add a line at the top of §6: "Owner answered 16 Nov #7 (`7fd0d91a`);
the scanner is an open question, not part of Job 27."

**M4. §6.3 (TradeFund on phones) is not agy's to build.** Changing when the funding button shows, or when
`fund-started` is sent, touches the funding flow (money). Fix: mark §6.3 "for the lead (funding flow; agy does not
change TradeFund)". If anyone builds it, it goes through a money review.

## Checks
- Docs-only branch: no vitest/Playwright change.
- Merge: the doc path exists on no other branch; merges cleanly into wip/third-demo-r3.
- Full check: see the line at the end of this file.

## Questions for the owner (product only)
- Should X2F add a camera "scan the wallet's receive QR code" button next to the address field on /setup/wallet and
  /wallets? (Research §6.2; not in the 16 Nov #7 answer.)
- On a phone, for wallets that do not open `monero:` links (Edge, Stack), should the "Open in <wallet>" button be
  replaced by the QR code and copy buttons? (Research §6.3; a funding-flow change for the lead.)

- Full check: queued on the shared lock (detached chain lead-agy-chain.sh); not finished at handback. Verdict stands only once it is green.
