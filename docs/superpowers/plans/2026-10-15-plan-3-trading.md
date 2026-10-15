# Plan 3: Offers and the trade flow (web app) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first web app and API in which a seller picks a payment method, takes a buyer's offer (or posts one), funds a 2-of-3 escrow from their own wallet with a `monero:` link, the buyer pays fiat and taps I've paid, and the seller presses and holds to release; with mutual cancel, extend, buyer no-show auto-refund, trader-side dispute opening, encrypted chat and nudges, every screen matching its X2F App board.

**Architecture:** A new pure package `@x2f/trade` holds the quote and fee-placement maths and the trade state machine, shared by server and browser. `apps/api` (Fastify + PostgreSQL, created by Plan 2) gains offers, trades, chat, nudge and price routes; the server is the only clock and applies every state change through the state machine. A moderation service inside the API joins every escrow as the `mod` party via Plan 1's `runParty`, watches the chain and runs the one automatic path (buyer no-show refund). The browser runs its own `runParty` in a Web Worker against `apps/relay` and a new `apps/node-proxy`, saving state to IndexedDB so every escrow step resumes after a reload. `apps/web` (React + Vite) implements the canvas boards.

**Tech Stack:** Node 22.23.3, npm 11.21.0 (`npx -y npm@11.21.0`), TypeScript 7.0.2 strict, vitest 5.0.3, React 19.3.0, react-dom 19.3.0, react-router 8.4.0, Vite 8.3.2, @vitejs/plugin-react 6.1.1, @playwright/test 1.63.0, fastify 5.12.5, pg 8.23.1, qrcode 1.5.4, lucide-react 1.49.0, @fontsource/familjen-grotesk 5.3.0, @fontsource/atkinson-hyperlegible-next 5.3.0, @fontsource/atkinson-hyperlegible-mono 5.3.0, Semgrep 1.178.0. Plus Plan 1's packages.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md` — sections 1, 2 (all), 3.2 lessons, 3.3, 4, 6.4, 6.5, 6.6 (trade codes, chat notice), 7, 8, 9, 11.1, 11.4, 11.5. Boards: Claude Design **X2F App** (https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH), mirrored in `design/x2f-app/*.dc.html`; tokens `design/design-system/tokens.json`; rules `design/design-system/README.md`.

**Builds on:** Plan 1 (`docs/superpowers/plans/2026-10-15-plan-1-escrow-core.md`), whose Interfaces are consumed exactly. One additive change to Plan 1 code: `EscrowSession.incoming()` (Task 6) and relay tickets (Task 5).

## Assumed Plan 2 interface (reconcile here only)

Plan 2 was not written when this plan was. Everything Plan 3 needs from it is below; if Plan 2's names differ, change this block and the tasks follow.

- `apps/api` exists (package `@x2f/api`) with `buildApi(o: ApiOptions): Promise<FastifyInstance>`; route plugins register with `app.register(plugin, { prefix: '/v1' })`.
- `app.db: pg.Pool`. Migrations are numbered SQL files in `apps/api/migrations/NNN_name.sql`, applied by `npm run migrate -w @x2f/api`. Table `users(id uuid primary key, username text unique, created_at timestamptz)`.
- `app.requireUser` preHandler sets `req.user: { id: string; username: string }` or replies `401 {"error":"login-required"}`.
- `listWallets(db: pg.Pool, userId: string): Promise<Wallet[]>`, `type WalletApp = 'cake' | 'edge' | 'feather' | 'monerujo' | 'stack' | 'gui-cli' | 'ledger' | 'trezor' | 'other'`, `interface Wallet { id: string; app: WalletApp; label: string; address: string; isDefaultPayout: boolean; usableAt: Date }` (`usableAt` is in the future while the opt-in 24-hour wait runs). `POST /v1/wallets` (with confirm-it's-you) and the setup endpoints (username, PGP key and challenge, password, backup) exist.
- Web: `useSession(): { user: { id: string; username: string } | null; loading: boolean }` from `apps/web/src/session/useSession.ts`.
- **Screens:** Plan 3 builds the Setup* and Wallet boards (Task 16) against those endpoints. If Plan 2 builds them instead, delete Task 16.

## Global Constraints

- Non-custodial: X2F holds at most one key per trade (the moderator's). The only automatic moderator signature is the buyer no-show refund, gated by Plan 1's `autoRefundDecision` and paying only the seller's refund address recorded at setup.
- Every dependency pinned exactly, published at least 14 days before 2026-10-15 (check `npx -y npm@11.21.0 view <pkg> time --json`; the versions above were checked). `npm audit` reports 0 vulnerabilities. `npm run check` (typecheck, tests, audit, Semgrep 1.178.0, copy lint) passes at the end of every task.
- Monero amounts are `bigint` atomic units everywhere; fiat is `bigint` cents. Shown as XMR with 6 decimals and fiat beside it in `ink-muted`.
- Fee: 1% (`feeFor` from `@x2f/core`), paid only by the ad poster, on completed trades only. The taker never sees a fee line anywhere (quote, fund, pay, released). The poster sees it itemised on the released screen: `X2F fee (1%, your ad) −0.012500 XMR` above `You receive`.
- Timers (server clock only): seller funds within **30 min**; escrow secured at **10** confirmations; buyer pays within **90 min** from secured; seller may extend by **30 min, at most twice**; final alert **15 min**; seller confirm window from the payment method profile (about **2 h** instant apps, up to **24 h** wires).
- Trade codes from `newTradeCode()`; the code is the trade ID in URLs, headers, memos and logs.
- Privacy: no analytics, no third-party scripts, styles or fonts (fonts self-hosted from @fontsource). OS-level notifications show only generic text ("Someone nudged you on X2F", "Something changed in a trade on X2F"). Server logs never contain trade codes, addresses, amounts or IPs.
- CSP on every HTML response: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' <RELAY_ORIGIN> <NODE_PROXY_ORIGIN>; img-src 'self' data:; style-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
- Design: night theme first; Monero orange fill only on the one primary action per screen (`data-primary` attribute, exactly one per screen); amber `caution` = waiting, teal `escrow` = escrow/done, rose `danger` = disputes/scam warnings, each always with a word and an icon; no emoji, no exclamation marks; usernames rendered exactly as set (no `text-transform`, no truncation without a full-name tooltip). Body text ≥ 16px on phones. No shadows except where a board draws one.
- Visual parity: every screen task names its board and passes `expectParity` (Task 8) at 390×844; trade-room screens also at 1280×800 against the Desktop board. Never run Playwright with `--update-snapshots` (it would overwrite the board references).
- Copy comes from the boards verbatim; spec wording where no board exists.

**Known gap for the owner (not solved here):** participant identity keys for a trade are distributed by the API. A compromised API could hand the seller a fake buyer key and, holding the moderator key, control two keys. Task 6 pins the moderation service's long-term signing key in the web build, which does not close this. Raise before the Plan 6 audit.

## Review Focus

1. **The page is backgrounded, reloaded or closed mid-setup, mid-funding or mid-release** (Phase 0 lesson): it resumes from IndexedDB and the trade settles exactly once. Test owned by Task 7 and Task 17.
2. **The seller sends the wrong amount** (short, or more than asked): short stays "Received X of Y, send the rest" and lapses at the deadline with a full refund to the seller; any excess goes back to the seller as an extra output on every outcome. Tests owned by Tasks 1 and 6.
3. **The phone's clock is wrong by ±10 min:** countdowns and what buttons allow follow the server's deadlines, never the device clock. Tests owned by Tasks 2 and 9.
4. **Two takers race for one offer, or one buyer takes the same offer twice while waiting for funding:** exactly one wins; the second gets a clear refusal. Test owned by Task 4.
5. **The price feed is down, stale (> 5 min) or sources disagree:** Trade is disabled with "Price unavailable right now" rather than quoting an old rate. Test owned by Task 3.

---

### Task 1: Quote and payout maths (`@x2f/trade`)

**Files:**
- Create: `packages/trade/package.json`, `packages/trade/tsconfig.json`, `packages/trade/src/money.ts`, `packages/trade/src/payouts.ts`, `packages/trade/src/deposit.ts`, `packages/trade/src/moneroUri.ts`, `packages/trade/src/index.ts`
- Test: `packages/trade/test/money.test.ts`, `packages/trade/test/payouts.test.ts`, `packages/trade/test/moneroUri.test.ts`

**Interfaces:**
- Consumes: `feeFor`, `Role` from `@x2f/core`; `Payout` from `@x2f/escrow`.
- Produces:
  - `type Side = 'sell' | 'buy'` (what the ad poster does with XMR); `posterRole(side: Side): 'seller' | 'buyer'`
  - `interface Price { currency: string; centsPerXmr: bigint }`
  - `rateFor(market: Price, marginBps: number): Price` — `centsPerXmr × (10000 + marginBps) / 10000`, rounded half up
  - `fiatCents(amountAtomic: bigint, rate: Price): bigint` — rounded half up to the cent
  - `atomicForFiat(cents: bigint, rate: Price): bigint` — floor (for "enter a fiat amount")
  - `formatXmr(atomic: bigint, decimals = 6): string`; `formatFiat(cents: bigint, currency: string): string` (`$412.50`)
  - `escrowPlan(a: { amountAtomic: bigint; poster: 'seller' | 'buyer'; depositAtomic: bigint }): { sellerFundsAtomic: bigint; depositAtomic: bigint; feeAtomic: bigint }` — `sellerFundsAtomic = amount + (poster === 'seller' ? fee : 0n)`
  - `type SettleKind = 'release' | 'mutual-cancel' | 'auto-refund' | 'lapse-refund'`
  - `payoutsFor(a: { kind: SettleKind; amountAtomic: bigint; feeAtomic: bigint; poster: 'seller' | 'buyer'; depositAtomic: bigint; balanceAtomic: bigint; buyerPayout: string; sellerRefund: string; feeWallet: string }): Payout[]` — index 0 always bears the network fee (Plan 1 rule):
    - release, poster seller: `[buyer: amount + deposit, fee: fee, seller: excess?]`
    - release, poster buyer: `[buyer: amount − fee + deposit, fee: fee, seller: excess?]`
    - mutual-cancel: `[seller: balance − deposit, buyer: deposit?]`
    - auto-refund and lapse-refund: `[seller: balance]` (exactly one payout, as `autoRefundDecision` requires)
    - `excess = balance − (sellerFunds + deposit)`, output added only when > 0; outputs of 0 are omitted; throws `RangeError('underfunded')` for release when `balance < sellerFunds + deposit`
  - `DEPOSIT_RULE = { freeBelowUsdCents: 20000n, newBuyerUnderTrades: 3, rateBps: 1500n }` and `depositFor(a: { amountAtomic: bigint; fiatUsdCents: bigint; buyerCompletedTrades: number }): bigint` — 15% of amount when the buyer has fewer than 3 completed trades and the trade is $200 or more, else `0n`. (Spec 11.4 proposed default; owner confirms.)
  - `moneroUri(address: string, amountAtomic: bigint): string` — `monero:<address>?tx_amount=<decimal, trailing zeros trimmed>`

- [ ] **Step 1: Failing tests.**
  - `rateFor({currency:'USD',centsPerXmr:32990n}, 40)` → `33122n`; `fiatCents(1_250_000_000_000n, {currency:'USD',centsPerXmr:33000n}) === 41250n`; `formatXmr(1_237_500_000_000n) === '1.237500'`; `formatFiat(41250n,'USD') === '$412.50'`.
  - `escrowPlan({amountAtomic:1_250_000_000_000n, poster:'seller', depositAtomic:0n}).sellerFundsAtomic === 1_262_500_000_000n`; poster buyer → `1_250_000_000_000n`.
  - Release, poster buyer, balance exact: `[{buyer,1_237_500_000_000n},{fee,12_500_000_000n}]`. Release, poster seller, balance 1.2626 XMR: third output `{seller, 100_000_000n}`. Release with balance short by 1 atomic unit throws `underfunded`. Mutual cancel with deposit 0.1875 XMR: seller first, buyer second. Auto-refund is a single payout of the whole balance.
  - `depositFor` at $199.99 / 0 trades → `0n`; $200.00 / 2 trades → 15%; $5,000 / 3 trades → `0n`.
  - `moneroUri('4Abc', 1_250_000_000_000n) === 'monero:4Abc?tx_amount=1.25'`; `moneroUri('4Abc', 1n)` ends `tx_amount=0.000000000001`.
- [ ] **Step 2:** `npm test -w @x2f/trade`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement the files above; export from `src/index.ts`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): quote, fee placement and payouts`.

### Task 2: Trade state machine (`@x2f/trade`)

**Files:**
- Create: `packages/trade/src/machine.ts`, `packages/trade/src/timers.ts`
- Test: `packages/trade/test/machine.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `TIMERS = { fundMin: 30, securedConfirmations: 10, payMin: 90, extendMin: 30, maxExtensions: 2, finalAlertMin: 15, disputeAfterRefundDays: 90 }`
  - `type TradeState = 'setup' | 'funding' | 'securing' | 'secured' | 'paid' | 'refund_requested' | 'settling' | 'released' | 'refunded' | 'lapsed' | 'cancelled' | 'disputed'`
  - `interface Trade { code: string; offerId: string; poster: 'seller' | 'buyer'; sellerId: string; buyerId: string; methodId: string; amountAtomic: bigint; feeAtomic: bigint; depositAtomic: bigint; sellerFundsAtomic: bigint; lockedRate: Price | null; confirmWindowMin: number; state: TradeState; escrowAddress: string | null; receivedAtomic: bigint; confirmations: number; takenAt: Date; fundBy: Date | null; fundingSeenAt: Date | null; depositBy: Date | null; securedAt: Date | null; payBy: Date | null; extensions: number; paidAt: Date | null; confirmBy: Date | null; finalAlertAt: Date | null; cancelProposedBy: 'buyer' | 'seller' | null; settling: SettleKind | null; txHash: string | null; dispute: { by: 'buyer' | 'seller'; at: Date } | null; closedAt: Date | null }`
  - `type TradeEvent = { type: 'setup-done'; escrowAddress: string } | { type: 'chain'; receivedAtomic: bigint; confirmations: number; rateNow: Price } | { type: 'mark-paid' } | { type: 'extend' } | { type: 'request-refund' } | { type: 'propose-cancel' } | { type: 'accept-cancel' } | { type: 'withdraw-cancel' } | { type: 'release-started' } | { type: 'settled'; kind: SettleKind; txHash: string } | { type: 'open-dispute' } | { type: 'tick' }`
  - `apply(t: Trade, e: TradeEvent, by: 'buyer' | 'seller' | 'system', now: Date): Trade` — pure; throws `TradeRuleError` with `code: 'wrong-state' | 'wrong-party' | 'too-early' | 'too-late' | 'deposit-missing' | 'no-extensions-left'`
  - `nextDeadline(t: Trade): Date | null` (for the server's timer loop)

Rules the tests pin (one test each):
- `setup-done` → `funding`, `fundBy = now + 30 min`. `tick` after `fundBy` with `receivedAtomic < sellerFundsAtomic` → `lapsed` (any partial funds are then refunded, Task 6).
- `chain` with `receivedAtomic ≥ sellerFundsAtomic` → `securing`, `lockedRate = rateNow` (only the first time), `fundingSeenAt = now`, `depositBy = now + 30 min` when a deposit is due.
- `chain` with `confirmations ≥ 10` and `receivedAtomic ≥ sellerFunds + deposit` → `secured`, `payBy = now + 90 min`.
- `mark-paid` (buyer) allowed in `securing` (buyer may pay early), `secured` and `refund_requested`; refused `deposit-missing` while a due deposit has not arrived; sets `confirmBy = now + confirmWindowMin` and clears `finalAlertAt`.
- `extend` (seller) only in `secured`, `now ≥ payBy`, `extensions < 2` → `payBy = now + 30 min`; third time → `no-extensions-left`.
- `request-refund` (seller) only when not paid and `now > payBy` (or `now > depositBy` while the deposit is missing) → `refund_requested`, `finalAlertAt = now`.
- `propose-cancel` from either side in `funding` … `paid`; `accept-cancel` by the other side → `settling` / `mutual-cancel`, or straight to `cancelled` when nothing was ever received; the proposer cannot accept their own.
- `release-started` (seller) in `securing`, `secured` or `paid` → `settling` / `release`.
- `open-dispute`: seller in `paid` any time; buyer in `paid` only after `confirmBy` (`too-early` before); buyer in `refunded` within 90 days → `disputed`. In `disputed`, `tick` changes nothing.
- `settled` → `released` or `refunded`, `closedAt = now`.

- [ ] **Step 1:** Write the failing tests above, plus the clock-skew test (Review Focus 3): `apply` is only ever given the server's `now`; a `mark-paid` with `now` 1 ms after a lapsed `fundBy` is refused `wrong-state`.
- [ ] **Step 2:** `npm test -w @x2f/trade`; expect FAIL.
- [ ] **Step 3:** Implement `apply` as a `switch` on `e.type` guarded by state and party; no I/O.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): trade state machine with server-clock timers`.

### Task 3: Payment method profiles, method lists and the price feed (`apps/api`)

**Files:**
- Create: `data/payment-method-profiles.json`, `apps/api/src/methods/profiles.ts`, `apps/api/src/methods/routes.ts`, `apps/api/src/price/feed.ts`, `apps/api/src/price/routes.ts`
- Test: `apps/api/test/profiles.test.ts`, `apps/api/test/price.test.ts`

**Interfaces:**
- Produces:
  - `interface MethodProfile { id: string; whatItIs: string; landsIn: string; checkPrompt: string; arrival: 'instant' | 'same-day' | 'days'; confirmWindowMin: number; fields: { key: string; label: string; kind: 'email-or-phone' | 'iban' | 'account' | 'postal' | 'text' }[] }`. Launch profiles: Zelle, Cash App, Revolut, Wise, Bank transfer (ACH), SEPA, Cash by mail, Custom method (spec 11.5 plus the PostOffer board). Zelle: `whatItIs: "Zelle: a US bank-to-bank instant transfer built into most US banking apps."`, `landsIn: "your bank account, checked in your bank's app"`, `confirmWindowMin: 120`. Wires: `1440`.
  - `getProfile(id: string): MethodProfile | null`; ids match `data/payment-methods.json`; a method without a profile can be browsed but posting it uses Custom method with the name prefilled.
  - `GET /v1/methods?side=sell|buy&currency=USD&sort=buyers|rate|az` → `{ live: MethodRow[]; all: MethodRow[] }`, `MethodRow = { id: string; name: string; group: string; offers: number; bestRate: string | null }`. `live` contains only methods with at least one live offer in that currency; `all` is the full catalog A–Z.
  - `interface PriceSource { name: string; fetch(currency: string): Promise<bigint> }` (cents per XMR); `createPriceFeed(sources: PriceSource[], o: { minSources: 2; maxAgeMs: 300_000; pollMs: 60_000 })` with `current(currency: string): Price | null` — median of the sources that answered in the last poll; `null` when fewer than 2 answered or the last good median is older than 5 min. Sources are configured in `PRICE_SOURCES` (spec open decision 6; at least three exchanges, owner picks).
  - `GET /v1/price?currency=USD` → `{ centsPerXmr: string; at: string }` or `503 {"error":"price-unavailable"}`.

- [ ] **Step 1: Failing tests:** every profile's id exists in the catalog and has a non-empty `landsIn`; no `landsIn` contains the method name ("arrived in Zelle" can't happen); median of 3 sources `[32900, 33000, 39000]` → `33000`; one source answering → `null`; last good median 5 min + 1 ms old → `null` and `/v1/price` returns 503 (Review Focus 5); `GET /v1/methods` with one live Zelle USD offer lists Zelle in `live` and every catalog method in `all`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Sources fetched with `fetch` and a 5 s timeout; no source failure throws past the feed.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): method profiles, live method lists, median price feed`.

### Task 4: Offers and taking an offer (`apps/api`)

**Files:**
- Create: `apps/api/migrations/101_trading.sql`, `apps/api/src/offers/routes.ts`, `apps/api/src/trades/store.ts`, `apps/api/src/trades/view.ts`, `apps/api/src/trades/routes.ts`, `apps/api/src/traders/summary.ts`
- Test: `apps/api/test/offers.test.ts`, `apps/api/test/take.test.ts`, `apps/api/test/view.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `newTradeCode` from `@x2f/core`; Plan 2's `requireUser`, `listWallets`.
- Produces:
  - Tables: `offers(id, poster_id, side, method_id, currency, margin_bps, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at)`, `trades(code primary key, …every Trade field…, buyer_payout text, seller_refund text, seller_wallet_app text)`, `trade_events(id bigserial, code, at, by, event jsonb)` (insert-only; a trigger rejects UPDATE and DELETE), `trading_holds(user_id, created_at, lifted_at)` and `site_flags(trading_paused boolean default false)` (both written by Plan 4, enforced here).
  - `POST /v1/offers` `{ side, methodId, currency, marginBps, minFiatCents, maxFiatCents, minTrades: 0|5|10|50, terms }`; `PATCH /v1/offers/:id` `{ status: 'live'|'paused'|'removed' }` (poster only); `GET /v1/offers?side&method&currency&sort=best|online|trades` → `OfferCard[]`, `OfferCard = { id; poster: TraderSummary; rate: string; marginBps; minFiatCents; maxFiatCents; depositRequired: boolean }`.
  - `TraderSummary = { username: string; completedTrades: number; online: boolean; lastSeenAt: string; typicalMinutes: number | null; positivePct: number | null; badges: string[] }` — `positivePct` and `badges` stay `null`/`[]` until Plan 5 fills them.
  - `POST /v1/offers/:id/take` `{ amountAtomic: string; walletId: string }` → `{ code }`. Refusals (`409 {error}`): `own-offer`, `out-of-range`, `not-enough-trades`, `trading-hold`, `trading-paused`, `price-unavailable`, `already-waiting` (one take awaiting funding per buyer per offer, enforced by a partial unique index), `wallet-not-ready` (wallet `usableAt` in the future). The taker's wallet becomes the buyer payout (taker is buyer) or the seller refund and funding app (taker is seller). The poster's default payout wallet fills their side until the payout wallet picker exists (dependent task D1).
  - `toTradeView(t: Trade, viewerId: string, serverNow: Date): TradeView` — the single serializer for `GET /v1/trades/:code`; includes `role`, `counterparty: TraderSummary`, `profile: MethodProfile`, deadlines as ISO strings, `serverNow`, and `fee` **only when the viewer is the poster**. Non-participants get 404.
  - Every write goes through `applyEvent(db, code, e, by): Promise<Trade>` in `store.ts`: `SELECT … FOR UPDATE`, `apply` (Task 2), update row, insert `trade_events`, publish to the event bus (Task 10).

- [ ] **Step 1: Failing tests:** post and list an offer; poster cannot take own offer; amount outside min–max refused; a 0-trade taker refused on a `minTrades: 5` offer; a held user cannot post or take; **two concurrent takes by the same buyer on one offer → exactly one `{code}`, the other `already-waiting`** (Review Focus 4, run with `Promise.all` against a real Postgres); `toTradeView` for the taker has no `fee` key at any state, for the poster has `fee.atomic === '12500000000'`; a third user gets 404; `trade_events` UPDATE raises.
- [ ] **Step 2:** Run (`docker run postgres` or the Plan 2 test database); expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): offers, take with guards, role-aware trade view`.

### Task 5: Trade identities and relay tickets

**Files:**
- Create: `apps/api/src/trades/identity.ts`
- Modify: `apps/relay/src/server.ts` (ticket check)
- Test: `apps/api/test/identity.test.ts`, `apps/relay/test/ticket.test.ts`

**Interfaces:**
- Consumes: `Participants` from `@x2f/protocol`; `buildRelay` from `apps/relay`.
- Produces:
  - `POST /v1/trades/:code/identity` `{ signPublic, boxPublic }` (once per role; second call 409); `GET /v1/trades/:code/participants` → `Participants` once buyer, seller and mod have registered, else `202`.
  - `POST /v1/trades/:code/relay-ticket` → `{ url: string }` where the URL is `<RELAY>/v1/trade/<code>?role=<role>&exp=<unix>&t=<base64url HMAC-SHA256(RELAY_TICKET_SECRET, code|role|exp)>`, valid 10 min. Chats get the same with the chat code.
  - `buildRelay` gains option `ticketSecret: Uint8Array`; the relay closes with **4401** when the ticket is missing, expired, or for another code or role. Plan 1's tests keep passing with a test secret.

- [ ] **Step 1: Failing tests:** participants appear only when all three registered; a buyer cannot register the seller's identity; relay: valid ticket connects; expired, wrong-role and wrong-code tickets close 4401; constant-time comparison (`timingSafeEqual`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check` (includes Plan 1's relay tests); expect PASS.
- [ ] **Step 5:** Commit `feat: trade identities and signed relay tickets`.

### Task 6: Moderation service — escrow party, chain watcher, timers, auto-refund

**Files:**
- Create: `apps/api/src/moderation/party.ts`, `apps/api/src/moderation/keystore.ts`, `apps/api/src/moderation/watcher.ts`, `apps/api/src/moderation/timers.ts`, `apps/api/src/moderation/autoRefund.ts`
- Modify: `packages/escrow/src/engine.ts`, `packages/escrow/src/monero.ts` (add `incoming()`)
- Test: `packages/escrow/test/incoming.test.ts`, `apps/api/test/moderation.test.ts` (regtest)

**Interfaces:**
- Consumes: `runParty`, `MoneroMultisigEngine`, `autoRefundDecision`, `generateIdentity` (Plan 1); `applyEvent` (Task 4); `payoutsFor` (Task 1); price feed (Task 3).
- Produces:
  - `EscrowSession.incoming(): Promise<{ txHash: string; amountAtomic: bigint; confirmations: number }[]>` (additive; monero-ts `getIncomingTransfers` / `getTxs`, including pool).
  - `startModeration(app: FastifyInstance, o: { daemonUri: string; relayUrl: string; keystoreKey: Uint8Array; feeWallet: string; signingKey: Uint8Array }): { stop(): Promise<void> }` — for every trade entering `setup`: generates the mod identity, signs its public keys with the long-term moderation key (public half pinned in the web build as `VITE_MOD_SIGNING_PUBLIC`), registers it, runs `runParty` as `mod` with `PartyState` stored AES-256-GCM-encrypted in `mod_party_state` (key from `MOD_KEYSTORE_KEY`, never in the database). On `ready()` applies `setup-done`.
  - Watcher: every 15 s per open escrow, `sync()` + `incoming()` → `chain` event with the sum received, the minimum confirmations and `rateNow`. Detects the escrow emptying → `settled` with the reported tx hash.
  - Timer loop: every 5 s applies `tick` to trades whose `nextDeadline` has passed.
  - Auto-refund: for `refund_requested` trades, once `autoRefundDecision({ paymentDeadline, markedPaidAt, finalAlertAt, now, recordedRefundAddress: seller_refund, proposed })` returns `ok`, calls `handle.settle({ kind: 'release', to: payoutsFor({kind:'auto-refund',…}), builder: 'seller', cosigner: 'mod' })`. The seller's app built and sent that release when the seller tapped Cancel & get refund (Task 15); the relay holds it. Any `ok: false` is logged by reason and retried on the next tick; nothing else ever makes the mod party settle in this plan.
  - Lapse refund: a `lapsed` trade with `receivedAtomic > 0` is refunded seller-built and buyer-cosigned (`payoutsFor` `lapse-refund`); the buyer's app co-signs automatically because it pays only the seller's recorded refund address (Task 7).

- [ ] **Step 1: Failing tests** (regtest, real relay, three parties; buyer and seller are Node `runParty` instances):
  - `incoming()` lists a funding tx with confirmations rising after mining.
  - Trade reaches `funding` after setup; funding short by 0.1 XMR stays `funding` and lapses at `fundBy` (fake clock), then refunds the seller in full (Review Focus 2).
  - Funding 0.1 XMR over: release pays the excess to the seller's refund address.
  - Mining 10 blocks moves `securing` → `secured`.
  - Buyer never pays; seller requests refund; at `finalAlertAt + 15 min − 1 ms` nothing moves; at `+ 15 min + 1 ms` the seller's refund address receives the balance minus network fee.
  - Buyer marks paid during the final alert: no refund is ever signed.
  - A seller-built auto-refund paying any other address is refused (`wrong-destination`) and nothing is broadcast.
  - Restarting the API mid-setup resumes the mod party from `mod_party_state`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): moderation party, chain watcher, timers and guarded auto-refund`.

### Task 7: Browser escrow runtime and the node proxy

**Files:**
- Create: `apps/node-proxy/package.json`, `apps/node-proxy/src/server.ts`, `apps/web/src/escrow/worker.ts`, `apps/web/src/escrow/store.ts`, `apps/web/src/escrow/policy.ts`, `apps/web/src/escrow/useEscrow.ts`
- Test: `apps/node-proxy/test/proxy.test.ts`, `apps/web/test/escrow-store.test.ts`, `apps/web/test/policy.test.ts`

**Interfaces:**
- Consumes: `runParty`, `wsTransport`, `MoneroMultisigEngine`, `generateIdentity` (Plan 1); trade routes (Tasks 4, 5).
- Produces:
  - `buildNodeProxy(o: { upstream: string }): FastifyInstance` — serves Monero's own paths **at its root** (monero-ts keeps only host and port): POST `/json_rpc` (allowlisted methods only: `get_info`, `get_last_block_header`, `get_block_header_by_height`, `get_block_headers_range`, `get_fee_estimate`, `get_version`, `get_output_distribution`, `hard_fork_info`), `/getblocks.bin`, `/getblocks_by_height.bin`, `/gethashes.bin`, `/get_o_indexes.bin`, `/getouts.bin`, `/get_transaction_pool_hashes.bin`, `/get_transactions`, `/sendrawtransaction`, `/get_height`, `/get_info`, `/is_key_image_spent`, `/get_transaction_pool`. Everything else 404. CORS only for the web origin. No request logging beyond counts.
  - `escrowStore`: IndexedDB database `x2f-escrow`, one record per trade code `{ partyState, identity (secret keys wrapped), seq }`. A non-extractable AES-GCM `CryptoKey` (stored in IndexedDB) wraps the identity secrets and the session password; deleted when the trade closes.
  - `cosignPolicy(t: TradeView, txPayouts: Payout[]): boolean` — the buyer's app co-signs automatically only (a) a `lapse-refund` that pays exactly the whole balance to the trade's recorded seller refund address, or (b) a release whose first payout is its own payout address with the expected amount; the seller's app co-signs only a mutual cancel matching `payoutsFor('mutual-cancel')`.
  - `useEscrow(code: string): { phase: 'idle' | 'setting-up' | 'ready' | 'signing' | 'done' | 'error'; keepOpen: boolean; release(): Promise<void>; buildRefund(): Promise<void>; proposeCancelSign(): Promise<void> }` — runs `runParty` in `worker.ts` (one worker per open trade), fetches participants and a relay ticket, verifies the mod identity's signature against `VITE_MOD_SIGNING_PUBLIC`, resumes automatically on page load for every stored trade. `keepOpen` is true while setup or signing is running and drives the "Keep X2F open while we secure the trade" bar.

- [ ] **Step 1: Failing tests:** proxy forwards an allowlisted `json_rpc` call and `/getblocks.bin`, refuses `json_rpc` `stop_daemon` and any path with a prefix (`/daemon/json_rpc` → 404); the store round-trips a `PartyState` and its stored secrets are not readable as plaintext from IndexedDB (fake-indexeddb in vitest); `cosignPolicy` accepts the two allowed shapes and refuses a lapse refund to any other address or with a second output.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; monero-ts runs inside the worker (needs `'wasm-unsafe-eval'`, already in the CSP).
- [ ] **Step 4:** `npm run check`; expect PASS. (The reload-mid-release test lives in Task 17 because it needs two browsers.)
- [ ] **Step 5:** Commit `feat(web): resumable browser escrow runtime; node proxy at root paths`.

### Task 8: Web app shell, tokens and the parity harness

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/theme/tokens.css` (generated), `apps/web/src/theme/fonts.css`, `apps/web/src/api/client.ts`, `apps/web/src/ui/{Button,StatusChip,Countdown,Amount,TradeHeader,BottomNav,DesktopShell,Sheet,BadgePill,EscrowDots}.tsx`, `apps/web/src/fixtures/boards.ts`, `tools/tokens-to-css.ts`, `tools/copy-lint.ts`, `tools/parity/capture-refs.ts`, `design/x2f-app/refs/*.png`, `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/parity.ts`, `apps/web/e2e/shell.spec.ts`
- Modify: root `package.json` (`check` runs `copy-lint`)

**Interfaces:**
- Produces:
  - `tokens.css`: every `tokens.json` colour as `--x2f-<name>` under `:root[data-theme=night]` (default) and `[data-theme=day]`, plus spacing, radius and type tokens. Generated by `npm run tokens`; the test fails if it is stale.
  - `api(path, init?)` typed fetch with `credentials: 'same-origin'`, JSON bigints as strings; `useServerClock(serverNow: string): () => Date` (offset from the last response; countdowns use it).
  - `<Button variant="primary">` renders the orange fill and `data-primary`; `<StatusChip tone="caution|escrow|danger" icon label>` refuses (type error) to render without `label`.
  - Routes: `/sell`, `/sell/:methodId`, `/buy`, `/buy/:methodId`, `/post`, `/trade/:code`, `/wallets`, `/setup/*`. Phones get `BottomNav` (Trade, Post offer, Wallets, Profile); ≥ 1024 px gets `DesktopShell` (X2F, Buy, Sell, My trades, Wallets) from the Desktop board.
  - Fixture mode: `VITE_FIXTURES=1` builds only (`?fixture=<Board>` loads the board's example data from `fixtures/boards.ts`). A test asserts the production bundle contains none of `satoshi_ghost`, `mira.k`, `fixture`.
  - `capture-refs.ts`: fetches the canvas runtime with the Artifact tool (`action: read`, url = X2F App, `path: 'support.js'`) into `design/x2f-app/support.js`, serves `design/x2f-app/` locally, and screenshots each board at its `$preview` size into `design/x2f-app/refs/<Board>.png`. If the canvas does not publish `support.js`, stop and ask the controller for exported board PNGs.
  - `expectParity(page: Page, board: string, o?: { masks?: Locator[]; viewport?: '390x844' | '1280x800' })` — `toHaveScreenshot` with `snapshotPathTemplate` pointed at `design/x2f-app/refs/{arg}{ext}`, `maxDiffPixelRatio: 0.03`, animations disabled, always masking `[data-mask=example]` (board-only "Example" tags) and `[data-mask=clock]` (ticking countdowns); also asserts exactly one `[data-primary]`, no horizontal scroll, and no element with `text-transform` on `[data-username]`.
  - `copy-lint.ts`: fails on `!` in JSX text or string literals under `apps/web/src/` (except `!==`, `!=`, and code), and on any emoji code point.
  - `index.html` served with the CSP from Global Constraints (Vite dev and the API's static handler); all assets hashed; Subresource Integrity is Plan 6.

- [ ] **Step 1: Failing tests:** `shell.spec.ts` loads `/sell` with the CSP header and records zero CSP violations and zero requests to any origin other than self; tokens are fresh; copy-lint flags a planted `"Done!"` and a planted emoji; the 1280×800 header matches the top 64 px of `Desktop.png`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; run `capture-refs.ts` once and commit the PNGs.
- [ ] **Step 4:** `npm run check` and `npx playwright test -c apps/web/e2e/playwright.config.ts shell`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): app shell, tokens, CSP and board parity harness`.

### Task 9: Main and SellOffers screens, quote sheet and the Trade button

**Board:** `Main.dc.html` (1 · Sell: pick how you get paid), `SellOffers.dc.html` (2 · Sell: buyers paying via Zelle).

**Files:**
- Create: `apps/web/src/screens/Main.tsx`, `apps/web/src/screens/Offers.tsx`, `apps/web/src/screens/QuoteSheet.tsx`, `apps/web/src/screens/OfferCard.tsx`
- Test: `apps/web/e2e/browse.spec.ts`, `apps/web/test/quote.test.ts`

**Interfaces:**
- Consumes: `GET /v1/methods`, `GET /v1/offers`, `GET /v1/price`, `POST /v1/offers/:id/take`; Task 1 maths; `useSession`.
- Produces: `/sell` lists "Buyers paying in USD" then "All payment methods" A–Z (rows read `No USD buyers right now · post an offer`), currency chips, search, Sort (Most buyers, Best rate, A–Z), empty search copy from the board. `/sell/:methodId` shows offer cards with Trade (online, eligible) or Message / Nudge (offline), the market price line, Sort (Best price, Online now, Most trades), badges (`BadgePill`, at most 2 featured, `+N` popover). `/buy` and `/buy/:methodId` reuse the same components with mirrored copy ("How do you want to pay?"); parity for buy is dependent task D1.
  - Quote sheet (no board yet; built from design-system parts, parity in D1): amount in XMR or fiat, **Max** (offer max at current rate), then the XMR amount, the ad's rate, the fiat total, network fee (fast), deposit when `depositFor` > 0, one final total. **No X2F fee line.** Primary button **Trade**.
  - Trade when logged out: routes to `/setup` with `returnTo` and resumes the take after setup. Trade when logged in: picks the user's funding wallet (seller) or default payout wallet (buyer), calls `take`, routes to `/trade/:code`.

- [ ] **Step 1: Failing tests:** parity for both boards at 390×844 with `?fixture=`; the quote sheet for a taker never contains "X2F fee" or "1%"; Trade disabled with "Price unavailable right now" when `/v1/price` returns 503; logged-out Trade lands on `/setup/username` and, after a stubbed setup, on `/trade/<code>`; the method list in another currency (EUR) shows only offers in EUR.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): browse methods and offers, quote, Trade`.

### Task 10: Live events, encrypted chat and the moderator notice

**Files:**
- Create: `apps/api/migrations/102_chat.sql`, `apps/api/src/events/bus.ts`, `apps/api/src/events/routes.ts`, `apps/api/src/chat/routes.ts`, `apps/api/src/chat/retention.ts`, `apps/web/src/api/events.ts`, `apps/web/src/chat/chatCrypto.ts`, `apps/web/src/chat/ChatPanel.tsx`
- Test: `apps/api/test/chat.test.ts`, `apps/web/test/chatCrypto.test.ts`

**Interfaces:**
- Consumes: `seal`, `open`, `ReplayGuard`, `generateIdentity` (Plan 1); moderation service (Task 6) for the chat's mod identity.
- Produces:
  - `GET /v1/events` (Server-Sent Events, one per logged-in user): `{type:'trade', code, state}`, `{type:'accepted', code, by: username}` (to the poster: "<username> accepted your offer"), `{type:'chat', chat}`, `{type:'nudge', from: username, context}`. `publish(userId, ev)` in `bus.ts`.
  - Conversations: `POST /v1/chats` `{ offerId }` → `{ chat }` (a code from `newTradeCode`, roles buyer/seller fixed by the offer side, mod identity created by the moderation service); a trade taken after chatting reuses that chat, otherwise `take` creates one. `POST /v1/chats/:chat/envelopes` (an `Envelope` sealed to buyer, seller **and** mod) and `GET /v1/chats/:chat/envelopes?after=<id>`. The server stores ciphertext only.
  - Retention: `purgeChats(now)` deletes envelopes 90 days after the linked trade closes (never while a dispute is open) and pre-trade chats after 7 days without a message.
  - `ChatPanel` shows at the top, always: "Encrypted. If a dispute is opened, a moderator can read this conversation." (Desktop board text). System cards render trade events (e.g. "mira.k marked the payment as sent: $412.50 via Zelle, memo K7M2-9QXA-4FTR-8WPN").

- [ ] **Step 1: Failing tests:** an envelope posted by the buyer opens for the seller and for the mod identity and for nobody else; a non-participant gets 404 on both chat routes; a replayed envelope is rejected by the reader's `ReplayGuard`; the chat notice renders in every chat; retention keeps a disputed trade's chat past 90 days; SSE delivers `accepted` to the poster within 1 s of a take.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: live events and end-to-end encrypted trade chat`.

### Task 11: PostOffer screen

**Board:** `PostOffer.dc.html` (3 · Post an offer).

**Files:**
- Create: `apps/web/src/screens/PostOffer.tsx`
- Test: `apps/web/e2e/post.spec.ts`

**Interfaces:**
- Consumes: `POST /v1/offers`, `GET /v1/price`, method profiles.
- Produces: I want to (Sell XMR / Buy XMR), payment method, currency, price as a margin with − / + (follows the market; shows today's price), smallest and largest trade, terms (optional), minimum completed trades (Anyone, 5+, 10+, 50+), and the "How others will see it" preview line (`Selling XMR via Zelle · USD · you`). Primary: **Post offer**. Logged out → setup, then back here with the form intact. Copy states the poster pays 1% on completed trades (spec 11.1: "learns of it … in the terms"); exact sentence: "You pay X2F 1% of each completed trade from this ad. Takers pay no X2F fee."

- [ ] **Step 1: Failing tests:** parity at 390×844; min > max refused inline; margin steps by 0.1% and the preview price updates; posting returns to `/sell/:methodId` with the new offer visible; a held user sees the API's refusal as text, not a crash.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): post an offer`.

### Task 12: TradeFund screen (seller funds escrow)

**Board:** `TradeFund.dc.html` (1 · Seller funds escrow).

**Files:**
- Create: `apps/web/src/screens/TradeRoom.tsx` (routes role × state to a screen), `apps/web/src/screens/TradeFund.tsx`, `apps/web/src/screens/FundFallback.tsx`
- Test: `apps/web/e2e/fund.spec.ts`

**Interfaces:**
- Consumes: `TradeView` (Task 4), `useEscrow` (Task 7), `moneroUri`, `qrcode` (SVG string rendered as `img src=data:`).
- Produces: header "Selling to <username>", `Trade <code> · <method>`; amber chip "Waiting for you to fund" with the 30-minute countdown; the escrow explainer and the three outcomes; amounts (You send to escrow, Rate (locked when you fund), Network fee (fast), You receive). **Primary: "Open in <wallet app name>"** linking `moneroUri(escrowAddress, sellerFundsAtomic)`, shown on Android and iOS only; desktop gets QR and copy address as the main content (Phase 0: Linux has no `monero:` handler). "Use another wallet (QR code or address)" opens `FundFallback`. When the seller is the poster, a muted line "Includes X2F fee (1%, your ad) 0.012500 XMR"; the taker seller never sees it. While setup runs: "Setting up escrow" with `EscrowDots` and the keep-open bar. After funding is seen: "Received 1.000000 of 1.250000 XMR, send the rest" when short; otherwise the trade room moves on. Buyer's view of `funding`: BuyerPay layout with amber "Waiting for <seller> to fund" (provisional, D1).

- [ ] **Step 1: Failing tests:** parity at 390×844 (mask: none beyond defaults); the link href equals `moneroUri(...)` exactly; on a desktop UA the primary is the copy button and no `monero:` link is the primary; the countdown follows `serverNow` even with the browser clock set 10 min ahead (`page.clock`) (Review Focus 3); a taker seller's screen contains no "X2F fee".
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): fund escrow with monero: link or QR`.

### Task 13: BuyerPay screen and the desktop trade room

**Boards:** `BuyerPay.dc.html` (2 · Buyer pays and uploads proof), `Desktop.dc.html` (Desktop · buyer paying, 1280×800).

**Files:**
- Create: `apps/web/src/screens/BuyerPay.tsx`, `apps/web/src/screens/PaidConfirmSheet.tsx`, `apps/web/src/screens/CancelSheet.tsx`, `apps/web/src/screens/DisputeSheet.tsx`, `apps/web/src/screens/TradeTimeline.tsx`
- Test: `apps/web/e2e/pay.spec.ts`

**Interfaces:**
- Consumes: `POST /v1/trades/:code/events` `{ type }` (a thin route over `applyEvent`, added here to `apps/api/src/trades/routes.ts`); `ChatPanel`; method profile fields.
- Produces:
  - Escrow chip: amber "Securing escrow" with "Confirmations 3 of 10 · about 14 min" (2 min per confirmation), teal "Escrow secured" at 10; "Time to pay 90 min / Clock starts when escrow settles, in N min" until secured, then the countdown.
  - Payment details: Send exactly, `<method> to` (seller's details from the profile `fields`), Memo = trade code, the own-name warning. Proof upload is Plan 5: its slot is omitted and masked in parity.
  - **I've paid** opens `PaidConfirmSheet`: checkbox "I sent exactly $412.50 via Zelle with K7M2-9QXA-4FTR-8WPN in the memo", **Yes, I've paid** / **Not yet**; without proof it adds "Sending without proof makes disputes harder."
  - `CancelSheet` (Cancel trade): proposes a mutual cancel; after I've paid it first shows the danger warning "Only cancel if your payment was never sent or was returned. Scammers try to talk buyers into cancelling after they've paid." The other side sees an accept/decline card.
  - `DisputeSheet` (Open dispute): when the rules allow (Task 2), confirms and applies `open-dispute`; the room then shows a rose chip "Dispute open" and "A moderator will join this chat." The full dispute room is dependent task D2. When not yet allowed it explains when it will be ("You can open a dispute if the seller hasn't confirmed within 2 h of your payment.").
  - Desktop (≥ 1024 px): `TradeTimeline` (Escrow funded, You pay · N min left, Seller confirms, XMR released), the counterparty card and `ChatPanel` side by side, per the Desktop board.

- [ ] **Step 1: Failing tests:** parity BuyerPay at 390×844 and Desktop at 1280×800 (mask proof slot); I've paid without ticking the box does nothing; Not yet leaves the state `secured`; Yes moves to `paid` and the seller's room receives the system card; the post-paid cancel shows the warning before proposing; Open dispute before `confirmBy` shows the explanation and sends nothing.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): buyer pays, confirm step, cancel and dispute entry, desktop room`.

### Task 14: SellerConfirm (press and hold) and the released screen

**Boards:** `SellerConfirm.dc.html` (3 · Seller checks bank and releases), `Review.dc.html` (4 · Released, rate the trade — the released part; the rating cards are Plan 5 and masked).

**Files:**
- Create: `apps/web/src/ui/HoldButton.tsx`, `apps/web/src/screens/SellerConfirm.tsx`, `apps/web/src/screens/Released.tsx`; add `GET /v1/trades/:code/confirmations` to `apps/api/src/trades/routes.ts`
- Test: `apps/web/test/HoldButton.test.tsx`, `apps/web/e2e/release.spec.ts`

**Interfaces:**
- Consumes: `useEscrow().release()`; `payoutsFor('release')`; profile `checkPrompt`, `confirmWindowMin`.
- Produces:
  - `HoldButton({ holdMs = 1500, disabled, onComplete, label, holdingLabel })` — pointer and keyboard (Space/Enter held) hold; fill sweeps 0→100% over 1.5 s; release early resets to 0; `onComplete` fires once. Under reduced motion the fill is replaced by a numeric "Keep holding… 1.0 s" text.
  - SellerConfirm: "<buyer>: Payment sent", confirm countdown, "Check your bank account for $412.50 sent via Zelle" (text from the profile, never "arrived in Zelle"), the reminder "Screenshot checks catch mistakes, but only your bank proves the money arrived." (smart proof card is Plan 5, masked), checkbox "I checked my bank account myself and the $412.50 from Zelle is there.", then the HoldButton with the board's three lines (Payment received / Hold to release 1.25 XMR to mira.k / hint). "Payment not received" opens `DisputeSheet` (seller may dispute any time after paid).
  - On complete: `release()` builds and sends the release; the buyer's app co-signs via `cosignPolicy`; states `settling` → `released`.
  - Released: "Released", "<amount> XMR is yours" (buyer) or "Released by you" copy per board, destination "your external wallet ending …k3Fz", live confirmations "1 of 10" from `/confirmations`, "View on the Monero blockchain" with the explorer note. **Poster only:** Trade amount, `X2F fee (1%, your ad) −0.012500 XMR`, You receive. Taker: no fee row, no "1%".

- [ ] **Step 1: Failing tests:** HoldButton: releasing at 1,499 ms does not complete, holding 1,500 ms completes exactly once, disabled ignores holds, keyboard hold works; parity for both boards at 390×844; release disabled until the checkbox is ticked; poster-buyer released view shows the fee row above You receive with `−0.012500 XMR`, taker view has none; confirmations update from 1 to 2 of 10 after a mined block (regtest in Task 17, stubbed here).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): press-and-hold release and released screen with poster fee`.

### Task 15: SellerRefund, extend, nudge

**Board:** `SellerRefund.dc.html` (Alt · buyer missed the deadline); Nudge on `SellOffers.dc.html`.

**Files:**
- Create: `apps/web/src/screens/SellerRefund.tsx`, `apps/web/src/nudge/useNudge.ts`, `apps/web/src/nudge/buzz.ts`, `apps/api/migrations/103_nudge.sql`, `apps/api/src/nudge/routes.ts`
- Test: `apps/api/test/nudge.test.ts`, `apps/web/e2e/refund.spec.ts`

**Interfaces:**
- Consumes: trade events route; `useEscrow().buildRefund()`; event bus.
- Produces:
  - SellerRefund (seller, `secured` past `payBy`, not paid): copy from the board; primary **Cancel & get refund** (applies `request-refund`, then `buildRefund()` signs and sends the auto-refund release to the relay); **Give 30 more min** (hidden after 2 extensions); **Nudge <buyer>**. The board's dispute-after-refund warning is shown before the tap. Buyer side during `refund_requested`: danger chip "The seller is cancelling. If you already paid, tap I've paid now." with the 15-minute countdown and I've paid as primary.
  - `POST /v1/nudges` `{ to: username, context: chat | code }`; `PUT /v1/me/nudges` `{ enabled: boolean, quietFrom: 'HH:MM' | null, quietTo: 'HH:MM' | null, tz: string }` (enabled by default); `POST /v1/blocks` `{ username }`. Refusals: `no-shared-context` (needs an open chat or active trade), `too-soon` (one per sender per 10 min), `recipient-busy` (3 received per hour from everyone), `blocked`, `quiet-hours`, `nudges-off`.
  - Delivery: SSE `nudge` → in-app "Wake up, <name> wants to trade" and a WebAudio buzz while the tab is open (`buzz.ts`, no audio file); when the tab is hidden, a `Notification` with exactly "Someone nudged you on X2F". Web Push for closed tabs and native alarm channels are Plan 6.

- [ ] **Step 1: Failing tests:** each nudge refusal reason, including the 3-per-hour cap across three senders; quiet hours in the recipient's time zone; parity SellerRefund at 390×844; Give 30 more min twice, then hidden; a hidden-tab nudge produces a Notification whose title and body contain neither username nor amount.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: seller refund and extend, nudges with limits`.

### Task 16: Your wallets and Getting started screens

**Boards:** `Wallet.dc.html` (3 · Your wallets); `SetupUsername`, `SetupLogin`, `SetupPgpKey`, `SetupPgpChallenge`, `SetupPassword`, `SetupBackup`, `SetupWallet`, `SetupWelcome` (Getting started row). Delete this task if Plan 2 builds these screens.

**Files:**
- Create: `apps/web/src/screens/Wallet.tsx`, `apps/web/src/screens/setup/{Username,Login,PgpKey,PgpChallenge,Password,Backup,Wallet,Welcome}.tsx`, `apps/web/src/screens/setup/SetupFlow.tsx`
- Test: `apps/web/e2e/setup.spec.ts`, `apps/web/e2e/wallets.spec.ts`

**Interfaces:**
- Consumes: Plan 2 endpoints (see the assumed interface block); `returnTo` from Task 9 and Task 11.
- Produces: the setup flow in board order (username 5–20 chars of letters, numbers, dots, dashes, underscores, shown exactly as typed; login method with PGP first; method setup; optional backup with "Skip for now"; link a wallet; Welcome with **Start trading** → `returnTo`). Wallet list (name, address end, role, status, never a balance), Add a wallet with app picker, the Edge Full Sync tip, confirm-it's-you on save, the per-trade escrow key row ("1 escrow key on this device for trade <code>…") fed from `escrowStore`, the optional fresh-address tip.

- [ ] **Step 1: Failing tests:** parity for all nine boards at 390×844; username `Mira.K_` is shown as `Mira.K_` everywhere after setup; the escrow key row appears while a trade is open and disappears when it closes; a wallet in its 24-hour wait shows its status and cannot be picked for a take.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): your wallets and getting started`.

### Task 17: End-to-end trades between two browsers on regtest

**Files:**
- Create: `apps/web/e2e/stack.ts` (starts regtest, relay, node proxy, API with moderation, Vite preview), `apps/web/e2e/trade.e2e.spec.ts`

**Interfaces:**
- Consumes: everything above; Plan 1's regtest harness. Funding in tests is done by a regtest wallet paying the URI's address and amount (parsed from the Open in … link or the copy button).

- [ ] **Step 1: Failing tests,** each run at 390×844 and at 1280×800, two browser contexts (seller, buyer):
  - Taker seller, poster buyer: browse → Trade → fund → 10 blocks → I've paid → hold to release → buyer's payout wallet receives amount − 1% − network fee; the fee wallet receives exactly 1%; only the buyer's released screen shows the fee row.
  - Taker buyer, poster seller: the seller funds amount + 1%; the buyer receives within the network fee of the full amount and never sees a fee.
  - Mutual cancel after funding: seller gets everything back minus network fee; no fee output.
  - Buyer no-show: clock advanced past `payBy`; Cancel & get refund; buyer stays silent; after 15 min the refund lands with the seller **with the seller's page closed**.
  - Lapse: seller never funds; the buyer's room says the trade ended with no penalty.
  - **Reload the seller's page during the hold-to-release signing and the buyer's page during co-signing:** both resume; exactly one release tx; the trade ends `released` (Review Focus 1).
- [ ] **Step 2:** Run; expect FAIL until wiring gaps are fixed in the owning tasks' files.
- [ ] **Step 3:** Fix what the runs expose, each with a unit test in the owning task's test file.
- [ ] **Step 4:** `npx playwright test -c apps/web/e2e/playwright.config.ts` and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `test: end-to-end trades on regtest at phone and desktop sizes`.

### Task 18: Security review of the plan's code

**Files:**
- Create: `docs/security/plan-3-review.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/trade`, `apps/api`, `apps/web`, `apps/relay`, `apps/node-proxy`; run Semgrep 1.178.0 and `npm audit`.
- [ ] **Step 2:** Fix every confirmed finding in the owning task's files with a test that would have caught it; re-run `npm run check`.
- [ ] **Step 3:** Record findings, fixes, accepted risks with reasons, and the known gap on participant-key distribution in `docs/security/plan-3-review.md`.
- [ ] **Step 4:** Commit `docs: plan 3 security review`.

---

## Dependent tasks (boards still being designed)

Each starts when its board lands on the X2F App canvas, and adds `expectParity` for it; the behaviour already exists unless noted.

- **D1 · Buy side.** Buy method list and seller offers (`/buy`, `/buy/:methodId`), the buyer's "waiting for the seller to fund" state, the quote sheet, and the **payout wallet picker** after Trade or on "<username> accepted your offer" (new behaviour: replaces the default-payout-wallet shortcut in Task 4).
- **D2 · Disputes from the trader side.** The dispute room with the moderator present (violet "X2F Moderator" badge, join banner, ruling card), the published deadline and live status, appeal, dispute-after-refund entry from a refunded trade, and the trading-hold notice on Post offer and Trade. Rulings and staff tools stay in Plan 4.
- **D3 · Plan 5 regions now masked:** proof upload and blur (BuyerPay, Desktop), smart proof card (SellerConfirm), rating and "How's X2F doing?" (Review), the review-before-next-trade gate.
