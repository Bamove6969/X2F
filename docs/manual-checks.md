# Manual checks

Checks a person must do on a real device. Record the date, device, OS and app versions, and the result.

## Wallet links from TradeFund (Plan 3 Task 22, P3-M12; spec line 314, 6.4 "Funding"; spec line 164, Phase 0 "Wallet links work on Android")

Owed before Task 31. Open a trade's TradeFund screen as the seller on the device (a fixtures build,
`vite build --mode fixtures`, serves the screen without a live escrow; see `apps/web/e2e/fund.spec.ts`
for how the escrow state and the trade view are stubbed), hold "Open in <wallet>" for 1.5 s, then
let go: the wallet must open on the RELEASE (the button says "Release to open" once the time is
reached; the opening runs inside the release event so the browser grants user activation).

For every row below:

- (a) Use a non-round amount, 1.2625 XMR, and once an amount with all 12 decimals, e.g.
  1.000000000001 (`monero:<address>?tx_amount=1.000000000001`). Record whether the wallet keeps
  EVERY digit. A wallet that rounds causes a short payment (TradeFund then asks for the remainder)
  or an over-payment (the trade grows, spec 11.1).
- (b) Compare the address the wallet filled in with the one on the screen: at least the first 8 and
  the last 8 characters.
- (c) Record what happens when the wallet is NOT installed (expected: the browser says it cannot
  open the link, or nothing happens; "Use another wallet (QR code or address)" must still work).

| Platform / browser | Wallet | Opens on the release | Address matches (first/last 8) | 1.2625 kept | 12 decimals kept | Not installed: what happens | Date / device / versions | Who |
| ------------------ | ------ | -------------------- | ------------------------------ | ----------- | ---------------- | --------------------------- | ------------------------ | --- |
| iPhone, Safari | Cake Wallet | not checked yet | | | | | | |
| iPhone, Safari | Edge | not checked yet | | | | | | |
| iPhone, installed home-screen web app (standalone mode treats custom schemes differently; the spec expects iPhone users on the PWA) | Cake Wallet | not checked yet | | | | | | |
| iPhone, installed home-screen web app | Edge | not checked yet | | | | | | |
| Android, Chrome, the 1.5 s hold then release (Task 22 review I2: Phase 0 checked a plain tap on a link, not the hold) | Cake Wallet | not checked yet | | | | | | |
| Android, Chrome, the 1.5 s hold then release | Edge | not checked yet | | | | | | |
| Android, installed home-screen web app | Cake Wallet | not checked yet | | | | | | |
| iPad with a trackpad: hold 1.5 s and release, then once hold 5 s or longer and release (a mouse-style pointer gets user activation on pointerdown and it expires after about 5 s, so a long hold may open nothing) | Cake Wallet | not checked yet | | | | | | |

Phase 0 (spec line 164): on Android (Firefox, Cake Wallet) a plain `monero:` link opened Cake Wallet
with the address and amount filled in. That was a tap on a link with a round amount, not the
hold-and-release above; it covers no row of this table.
