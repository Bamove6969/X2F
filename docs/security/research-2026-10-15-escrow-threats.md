# X2F escrow threat research (2026-10-15)

Scope: spec sections 3 and 6.5, plan 1 (Global Constraints, Review Focus, Tasks 3, 5, 7, 8, 9). No code changed, nothing committed.
Legend: **[V]** verified by me against a primary source or by running it; **[S]** secondary source only (news, blogs, automated reviews); **[U]** unverified.

## Top recommendations (details below)
1. Task 5: make the co-signer check structural, not just "destinations match": exactly one tx in the set, no output other than the payouts plus (optionally) change back to the escrow address, input total = outputs + fee, fee under a cap. Do not rely on wallet-level checks (R1.4).
2. Task 8: make the party runner a strict state machine (expected sender role, message type and round, once each), with participants fixed at trade creation and never changed by any message. This is the direct fix for the Haveno ACK flaw (R2.1).
3. Task 1: add exact overrides `serialize-javascript@7.1.2` and `uuid@11.1.1`; `npm audit` then reports 0 vulnerabilities and `import("monero-ts")` still loads (R3).
4. Task 7: set `options: { maxPayload: maxEnvelopeBytes }` on the WebSocket server (ws default is 100 MiB), add per-connection and per-trade byte caps, and require a signed challenge from a trade identity key before a socket may read or fill a queue (R5).
5. Tasks 1/8 docs: record that Phase 0 plain-http is not a secure context and had no CSP/SRI, so production needs HTTPS, HSTS, strict CSP and hashed assets, and Phase 0 numbers are not evidence about those (R4).

---

## 1. Monero multisig (v0.18.x) weaknesses and gotchas

monero-ts 0.11.16 wraps monero v0.18.5.1 "Fluorine Fermi" [V: package README, [monero-ts](https://github.com/monero-ts/monero-ts)]. The daemon in plan 1 is v0.18.5.3; wallet and daemon versions differ, which is fine but should be logged in tests.

| # | Finding | Evidence | Status | Recommendation (task) |
|---|---|---|---|---|
| 1.1 | Multisig is labelled experimental: funds may become unspendable, spendable only with a malicious member, or stolen by a malicious member. Disabled by default in wallet2 since PR #8328. | [monero#9488](https://github.com/monero-project/monero/issues/9488) [V] | Still the official stance | Keep the audit gate (spec 6.5) and say "experimental" in user-facing risk copy. Pin the monero-ts wasm version; any bump re-runs Task 5 and 8 tests. (Task 1, 5) |
| 1.2 | Old view-key weakness: first kex round exposes enough to derive the multisig view key (a = H(a1)+...+H(an)), so an eavesdropper on the prepare messages could watch incoming funds. Closed in 2018 as known/by design, later reworked. | [monero#3389](https://github.com/monero-project/monero/issues/3389) [V] | Historic; relevant if prepare/make messages are ever sent unencrypted | Task 3 already encrypts every message to its recipients. Add a test that no `msig.*` payload is ever sent in the clear or to the relay as plaintext. (Task 3, 7) |
| 1.3 | `sign_multisig` could crash monero-wallet-rpc on a malformed but decryptable tx set. Fixed in 0.18.5.0. | [HackerOne H1:3683934 via vulners](https://vulners.com/hackerone/H1:3683934) [S]; fetch blocked (403) so version claim is from search snippet | Bundled wallet is 0.18.5.1, so fixed [V on version, S on fix] | Still wrap `cosign` in try/catch and treat any decode error as `payout-mismatch`/refuse, never as "skip check". Fuzz malformed tx-set hex in Task 5 tests. (Task 5) |
| 1.4 | Upstream added a `pending_tx` sanity checker that includes multisig tx sets and "cosigner imported multisig info before signing" checks. Merged to master 2026-09-09, flagged "needs backport" to v0.18/v0.19. | [monero#11076](https://github.com/monero-project/monero/pull/11076) [V] | **Not in the 0.18.5.1 wasm that monero-ts 0.11.16 ships** [U: backport status] | Do not assume wallet-side validation. Task 5 `cosign` is the only guard. Strengthen it (see below). (Task 5) |
| 1.5 | A malicious co-signer can set another signer's composite key image to a value of its choosing (low severity; needs M<N, i.e. our 2-of-3). Affects balance/spent view, i.e. denial of service, not theft. | [xmrack review of #11264](https://github.com/xmrack/monero-review/issues/779) [S: automated review, unverified claim] | Open upstream, pre-existing | After every import, assert `balance`/`unlocked` agree across all parties before signing; abort and escalate to moderator on disagreement. (Task 8) |
| 1.6 | A co-signer can plant forged rings in a victim's wallet cache before validation, causing tx failure or constraining decoys. | [xmrack review of #11392](https://github.com/xmrack/monero-review/issues/782) [S] | Open | A failed `submit` must not be retried blindly; rebuild from a fresh `exportState`. Per-trade throwaway wallets limit blast radius (already the design). (Task 5, 8) |
| 1.7 | Kex duplicate-signer check comment says it runs but "never runs after initialize_kex_update". No exploit shown. | [xmrack review of #11343](https://github.com/xmrack/monero-review/issues/681) [S] | Open question | Task 5 should assert, before `exchange`, that the peer list has exactly the expected distinct entries and the final address is identical across all three sessions. The plan's "agree on one address" test covers the result; add a duplicate-peer-message negative test. (Task 5) |
| 1.8 | Spent signing nonces can reappear from a rescan snapshot, which would leak a signer's key share if two different messages are signed with one nonce. | Search summary only; I could not find the primary issue [U] | Unverified | Never restore a wallet cache/`importState` from an older snapshot after a signature was produced. Task 8 resume must restore the **latest** saved state or refuse; add a "stale snapshot rejected" test via a monotonically increasing state counter in `PartyState`. (Task 8) |
| 1.9 | Ordering rules: every signer must `exportMultisigHex` and every other must `importMultisigHex` after any receive/spend and before the next `createTx`, otherwise key images are stale and tx building or signing fails (Haveno needed repeated fixes: per-peer import fallback, locks around import, delay to N confirmations). | [Haveno commits](https://git.hackliberty.org/Git-Mirrors/haveno/commit/c29cdb8b0f385d7c4b852806102b4cfdd3b48eb1) [S: mirror, titles only] | Practical | Task 5: serialise wallet calls per session with a mutex; import each peer's hex individually so one corrupt blob does not poison the rest; always `sync` to the 12-block unlock before export/import. Task 8: persist the last applied round number and make `state.export` idempotent. (Task 5, 8) |

**Recommended strengthening of the Task 5 `cosign` check** (Review Focus 2). The plan checks destinations and amounts. Also assert, from the decoded set:
- exactly one transaction in the set (a builder could add a second tx spending the same funds elsewhere);
- the destination list has no entries beyond `expected` and, at most, one change entry that equals the escrow address itself;
- sum(inputs) = sum(outputs incl. change) + fee, and fee is below a hard cap (the plan allows 0.01 XMR shortfall on index 0; make that the same cap for the declared fee);
- no unexpected `unlock_time`/`payment_id`-style extras.
How monero-ts exposes change in `describeMultisigTxSet` is **[U]**; the Task 5 Step 3 stop-and-report gate should include this question. Also add the negative test "builder adds a change output to an attacker address".

**FCMP++ status [V/S].** Official channel: second beta stressnet (FCMP++ and CARROT) went live 2026-05-06 ([@monero](https://x.com/monero/status/2047387048382791899) [S: not fetched, from search]); stressnet v3.0 forked 2026-10-05 at height 3102800 ([CryptoTicker](https://cryptoticker.io/en/monero-fcmp-stressnet-fork-october-2026/) [S]). Multisig is **unavailable on the beta stressnet** [S: search summary of Feather/xgram sources, [U] primary]. Several SEO sites claim a mainnet hard fork in August 2026; the cryptoticker article quotes "there is no announced date" and spec 3.4 agrees; treat the SEO claims as wrong [S, contradicted]. Effect: after the hard fork, current multisig will either be migrated or disabled; the escrow interface (Task 5 `EscrowEngine`) is the right seam. Recommend: (a) keep the interface free of wallet2-specific types, (b) add a monthly check to the project handoff for "FCMP++ multisig" (monero-project/monero PRs and the Monero Research Lab), (c) before the hard-fork date, ship a "drain existing escrows" mode that blocks new trades. (Task 5, spec 3.4)

---

## 2. 2026 RetoSwap / Haveno incidents

| Incident | What happened | Source | X2F rule that defends | Task |
|---|---|---|---|---|
| **May 20, 2026: arbitrator impersonation (~7,000 XMR, ~$2.7M)** | During Tor-based multisig setup the attacker (a trader, holding one key) sent a forged, out-of-order ACK that looked like it came from the arbitrator. Haveno accepted it without verifying the sender and recorded the attacker's address as the arbitrator for that trade, giving the attacker two keys of three. | [Halborn](https://www.halborn.com/blog/post/explained-the-retoswap-hack-may-2026) [S, but consistent across [Gate](https://www.gate.com/news/detail/haveno-protocol-hacked-retoswap-loses-7000-xmr-and-suspends-trading-21261649), [CryptoTimes](https://www.cryptotimes.io/2026/05/21/monero-dex-retoswap-suspends-trading-after-2-7m-exploit-in-haveno-protocol/)]. No primary Haveno advisory found. | Spec 3.3 "authenticated messages": every message signed by the sender's trade identity key and checked against the trade's participant list. The participants (incl. moderator public keys) are fixed at trade creation; no message may add or change one. | Task 3 `open` + Task 8 state machine |
| **June 16-17, 2026: dispute/forced-arbitration exploit** | Second active exploit of the protocol; reported as the attacker, posing as buyer, getting XMR released without paying the BTC. RetoSwap raised the minimum client to 2.0.0 and banned the attacker's onion address. Technical detail not published. | [CryptoNews](https://cryptonews.net/news/security/33021695/), [Cryip](https://cryip.co/retoswap-suspends-trading-after-second-haveno-protocol-exploit/) [S]; [haveno-reto#144](https://github.com/retoaccess1/haveno-reto/issues/144) [V: shows only the date and "contact support"] | Spec 2.3/3.3: disputes need a human moderator decision and the release is signed by moderator + one trader; every signer independently checks destination and amount; no automatic path except the single refund-to-recorded-address case. | Task 5 `cosign`, Task 9 |
| Both | Fiat traders largely unaffected; losses concentrated in large crypto-for-crypto trades (S). Haveno's flaws were business-logic, which scanners (Semgrep) are poor at finding. | Halborn [S] | Review Focus 3 tests must be adversarial and stateful; Task 10 review should be human/LLM design review, not only Semgrep. | Task 10 |

**Concrete gaps to close in Task 3 and 8 (derived from the Haveno flaw):**
1. `open` must look up the key by the **claimed `from` role** (`participants[from].signPublic`), not "any participant key". Test: buyer signs an envelope claiming `from: 'mod'` -> `not-participant`/`bad-signature`.
2. Bind `to` roles into the signed data (the plan signs every field except `sig`, which already covers `boxes`' keys; keep it that way and add a test that adding a recipient box invalidates the signature).
3. The state machine accepts each `(from, type, round)` once and in order; an "out-of-order ACK-like" message is ignored and recorded, not applied (the Haveno trigger). Add test: valid-signature, wrong-stage message from a real participant (e.g. mod sends `msig.make` twice, or buyer sends `release.txset` before setup) is rejected.
4. Moderator identity: the buyer and seller must learn the moderator's `signPublic`/`boxPublic` from a source the relay and the other trader cannot alter (the signed trade offer / X2F directory signed by an offline key), never from a protocol message. This is the actual "who is the arbitrator" decision in Haveno. Spec 6.6 should say where it comes from. (Task 3, 8; spec 6.6)
5. Adding a "participant pinning" test: swapping `participants` after setup begins makes the runner abort.

---

## 3. monero-ts 0.11.16 supply chain

Run in `/tmp/claude-1000/x2f-audit` with Node 22.23.3 and `npx npm@11.21.0 audit` [V].

`npm view monero-ts@0.11.16 dependencies`: ajv ^6.12.6, net ^1.0.2, tls 0.0.1, uuid 3.3.2, async 2.6.4, axios ^1.7.4, crypto-js ^4.0.0, decimal.js ^10.4.3, web-worker 1.3.0, @types/node ^20.6.0, text-encoding ^0.7.0, @babel/runtime ^7.23.2, promise-throttle ^1.1.2, socks-proxy-agent ^8.0.5, serialize-javascript ^3.1.0. Published 2026-09-24; latest is 0.11.20 (2026-10-05, too new for the 14-day rule and still pins uuid 3.3.2 and serialize-javascript ^3.1.0 [V]).

Audit with no overrides: **3 vulnerabilities (2 high, 1 moderate), "No fix available"**:
| Package | Installed | Advisory | Severity | Patched | Safe override (published >= 14 days before 2026-10-15) |
|---|---|---|---|---|---|
| serialize-javascript | 3.1.0 (range <=7.0.2) | [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq): RCE via RegExp.flags / Date.prototype.toISOString(), CVSS 8.1 | high | 7.0.3 | **`7.1.2`** (published 2026-09-23, 22 days; engines node >=20). 7.0.3 (2026-02-27) is the minimal fix if you prefer an older release. |
| uuid | 3.3.2 (range <11.1.1) | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq): missing buffer bounds check in v3/v5/v6 when `buf` given, CVSS 7.5 | moderate (per npm) | 11.1.1 / 12.0.1 / 13.0.1 | **`11.1.1`** (published 2026-04-29). 14.0.3 is only 5 days old; 14.0.2 (2026-08-18) also qualifies but is a bigger jump. |
| monero-ts | 0.11.16 | transitive only | high (inherited) | n/a | n/a |

Override test [V]: `overrides: {"serialize-javascript":"7.1.2","uuid":"11.1.1"}` -> `npm audit` = **found 0 vulnerabilities**, and `import("monero-ts")` resolves (`MoneroWalletFull` is a function).
Reachability [V by grep]: neither `uuid` nor `serialize-javascript` is `require`d anywhere in monero-ts's `dist/` (only a StackOverflow comment mentions "uuid" in GenUtils.js); they are declared but unused, so the override is low-risk. Still run the whole Phase 0/regtest suite after applying it.

Other notes:
- `net@1.0.2` (maintainer sleeplessinc) and `tls@0.0.1` (maintainer rolandpoulter) are abandoned stub packages with the names of Node core modules. They are real npm packages that monero-ts depends on [V]; I did not find them imported in `dist/` quickly [U: not exhaustively searched]. Recommend a Task 1 check that `node_modules/net` and `node_modules/tls` are never resolved at runtime (core modules win in Node, but bundlers in the browser may pick the npm stubs), and consider overriding them to an empty package (`"net": "npm:@x2f/empty@..."`) or excluding them in the bundler. Spike used `empty-shim.mjs`, which suggests the same issue was already hit.
- No npm provenance/attestation is published for monero-ts@0.11.16 [V: `dist.attestations` empty]; only the registry integrity hash `sha512-WnsF9N6e...` is available. Recommend recording the integrity hash and the tarball SHA-256 in a `docs/security/dependencies.md` and diffing on every bump. (Task 1)
- Plan stack check [V]: `fastify@5.12.5`, `@fastify/websocket@11.3.1`, `ws@8.22.0`, `libsodium-wrappers@0.8.4` install with **0 vulnerabilities** under npm@11.21.0, and all are older than 14 days except `ws@8.22.0` (2026-09-26, 19 days: OK) and `@fastify/websocket@11.3.1` (2026-09-18: OK).
- Task 1 Step: add `overrides` exactly as above to root `package.json`, keep `npm audit --omit=dev` as a gate, and add a test that fails if monero-ts is bumped without re-running the audit.

---

## 4. Browser wallet risks (WASM crypto in a PWA)

Phase 0 findings [V: `spikes/phase0-browser/RESULTS.md`]: pages loaded over plain `http://` on the LAN, "not a secure context"; Chrome Android warned; monero-ts ran anyway. No CSP, SRI or service worker were exercised.

Risks and what to do (all UI work is after plan 1; items that touch plan 1 are marked):
| Risk | Detail | Recommendation |
|---|---|---|
| Tampered code delivery | The main web-wallet risk (spec 6.5). A compromised server or CDN can serve altered JS that exfiltrates keys or alters payout addresses, and can do it to one targeted user. SRI and CSP only protect against third-party changes, not a malicious origin. WAICT (integrity manifest plus transparency log) is the in-progress fix; only an early prototype in Firefox Nightly. | [Mozilla Hacks 2026-05](https://hacks.mozilla.org/2026/05/trustworthy-javascript-for-the-open-web/), [Cloudflare](https://blog.cloudflare.com/improving-the-trustworthiness-of-javascript-on-the-web/) [S]. Keep spec 6.5: native signed builds for large trades; publish hashes of each release (reproducible build) and a verification page/extension; plan for WAICT/WEBCAT-style verification when browsers ship it. Large-trade threshold should be set conservatively. (later plan) |
| Wasm is embedded in JS | monero-ts ships **no `.wasm` file**; the wasm is inside `monero.js` and `monero.worker.js` (~2.6 MB and 3.6 MB) [V: no `*.wasm` in package]. So integrity of "wasm" equals integrity of those two files. | Hash both at build time; put the hashes in the signed release manifest. (later plan) |
| SRI coverage gaps | SRI covers `<script>`/`<link>`, and top-level module scripts; imported modules need an import map `integrity` (now in Chrome/Safari/Firefox). `new Worker(url)` has no integrity attribute [U: I could not find a primary source in this session; confirm]. | Prefer a single bundled file with `integrity=`, load the worker from a `blob:` URL created from the already-verified bundle, or verify the worker bytes with `fetch` + `crypto.subtle.digest` before constructing the Worker. Needs `worker-src blob:` in CSP. [SRI note: [Shopify Eng](https://shopify.engineering/shipping-support-for-module-script-integrity-in-chrome-safari) [S]] |
| CSP and wasm | Compiling wasm under a strict CSP needs `'wasm-unsafe-eval'` in `script-src` (not `'unsafe-eval'`). I could not fetch MDN in this session [U: confirm; also confirm whether emscripten code inside monero-ts uses `eval`/`new Function`, which would force `'unsafe-eval'`]. | Add a Playwright test that loads monero-ts under the production CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' wss://relay...; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` and fails on any violation. If `'unsafe-eval'` is required, that is a finding to report and mitigate. |
| Service worker as persistent foothold | A PWA service worker that is replaced by a malicious update keeps serving bad code. | Serve the SW with `Cache-Control: no-cache`, keep its scope minimal, version-pin the app shell by hash, and show the running build hash in Settings -> Security. |
| Secrets in the browser | Keys held in JS memory/IndexedDB are readable by any script in the origin (XSS = full compromise). | No third-party scripts (already in 6.5), Trusted Types, `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`, wrap secrets with a passphrase-derived key before IndexedDB. |

**How Phase 0's plain-http test must differ from production:**
1. Production is HTTPS-only with HSTS (preload) and WSS to the relay; plain http is not a secure context, so `crypto.subtle`, service workers, and Web Locks/`navigator.storage.persist()` may be missing or behave differently [U for exact availability on the test devices]. Phase 0 proves that monero-ts runs, not that the production PWA does.
2. Re-run the phone/desktop escrow with the **production CSP** and SRI-hashed bundle; failures from `wasm-unsafe-eval`, `worker-src` or `blob:` workers will only show up there.
3. Re-test backgrounding/resume (the Phase 0 failure) **with the service worker installed**, since SW lifetime, storage eviction and tab discarding differ in an installed PWA.
4. Relay origin: no `ws://` fallback; reject mixed content; Phase 0 plain-ws timing numbers (17 s setup, 2-3 s release) exclude TLS/Tor latency.
5. Add the iPhone Safari and Tor Browser runs already listed in spec 3.2 under the same production headers.

---

## 5. Relay risks (Task 7)

Facts from the dependencies [V]: `@fastify/websocket` 11.3.1 builds `new WebSocket.Server(Object.assign({noServer:true}, opts.options))`, and `ws` defaults `maxPayload` to **100 MiB** (`ws/lib/websocket-server.js:74`). So unless `options.maxPayload` is set, the relay will buffer up to 100 MiB per message before your `maxEnvelopeBytes` check ever runs. The plan's test "oversized envelope closes with 4400" can pass while this memory-exhaustion hole is open.

| Risk | Detail | Recommendation (Task 7) |
|---|---|---|
| Oversize frame DoS | See above. | `buildRelay` must pass `websocket: { options: { maxPayload: maxEnvelopeBytes } }`; ws closes with 1009 on oversize, so the 4400 test should accept 1009 or enforce the limit twice. Add test with a 10 MiB frame and assert RSS did not grow. |
| Queue exhaustion / poisoning | Anyone who knows a trade code can connect and fill `maxQueuedPerTrade` (1000 x 256 KiB = 256 MiB per trade) with junk, evicting or blocking real messages, or read the queue. Trade codes are short human-typed strings (`normalizeTradeCode`). | (a) Cap queue **bytes**, not just count (e.g. 2 MiB per trade, 8 MiB per role), (b) reject new when full rather than drop old (junk then cannot evict real messages) plus a per-sender-role cap, (c) a global cap on total queued bytes and number of live trades, (d) require a **signed challenge-response** before a socket joins: relay sends a nonce; client signs it with its trade identity key (Task 3 Ed25519); relay stores the three `signPublic` keys given at trade creation. This lets the relay stay blind to content while rejecting non-participants. Cost: relay learns three public keys per trade code (no names). Document this trade-off in spec 3.3 or choose to defer and rely on high-entropy codes (>= 128 bits for the relay path even if the human-facing code is shorter, derive a relay channel id as HKDF of the trade code). |
| Trade code guessing | Short codes mean room-guessing; the first 4400 closes are free oracle answers. | Derive an unguessable `channelId` from the trade secret rather than using the human code in the URL; rate-limit failed joins per IP; never distinguish "no such trade" from "bad role". |
| Connection exhaustion | Unlimited sockets per IP/trade, slowloris on upgrade, no ping/pong timeout. | Max connections per IP and per channel (3 roles = 3-6 sockets), idle timeout with ping/pong (ws `ping` every 30 s, terminate on missed pong), per-socket message rate limit (e.g. token bucket 10 msg/s), Fastify `connectionTimeout`/`requestTimeout`. Use `@fastify/rate-limit` [U: not evaluated here] or a reverse proxy. |
| Metadata: IPs | Plan logs "never IPs", but nginx/Cloudflare/the host log IPs by default and the relay's own TCP peer address is visible. | Run behind the `.onion` service for Tor users (spec 6.5), disable access logs on the proxy, no per-IP counters persisted (in-memory only), document that clearnet users expose their IP to the relay operator. |
| Metadata: timing, sizes, trade codes | The relay sees which sockets share a channel, when each message is sent and each ciphertext's length, so it can tell setup (4 rounds, distinctive sizes) from release from dispute, and correlate parties across IPs by timing. Tor does not defend against timing correlation by an observer on both ends ([Tor Project](https://archive.torproject.org/websites/support.torproject.org/about/attacks-on-onion-routing/) [S]). | Pad envelopes to fixed buckets (e.g. 1/4/16/64 KiB) before `seal` (Task 3: add a `pad` step inside the plaintext, covered by the signature), send the same message-type labels (`type` is in the clear in the envelope! see next row), and add small random send delays. Do not claim anonymity from the relay operator. |
| `type` and `seq` in clear | The `Envelope` fields `trade`, `from`, `seq`, `type` are signed but not encrypted, so the relay learns "msig.kex.3 from seller" and the stage of every trade. Task 7 requires the relay to read `trade` already. | Accept `trade`, `from`, `seq` as routing metadata, but move `type` into the encrypted payload (or use a generic `"m"`), keeping the signed header. Do this in Task 3 now; changing the envelope later is a protocol break. Also consider replacing the plain `trade` code in the envelope with the derived `channelId`. |
| Relay as an active attacker | Can drop, delay, duplicate, reorder or replay-from-another-channel messages. Cannot forge (Task 3) or read. Cannot cause theft but can cause stuck trades. | Task 8 already resumes and rejects replays. Add: per-stage timeouts that surface "relay unresponsive", and a way to switch to a backup relay URL listed in the signed offer. |
| Retention | `retainMs` 24 h; queued ciphertext persists in memory only. | Keep memory-only (no disk) so a seized server holds nothing; zero queues on trade finish (`release.done`). |

---

## Not verified / open
- Primary Haveno/RetoSwap post-mortems or advisories (none found; incident accounts are from news sites and Halborn).
- Details of the June 2026 exploit.
- The nonce-reuse-after-rescan multisig issue (1.8).
- Whether `describeMultisigTxSet` in monero-ts 0.11.16 exposes change outputs and fee (Task 5 Step 3 already gates on destinations).
- Whether monero-ts's wasm needs `'unsafe-eval'`, and exact SRI behaviour for `new Worker`.
- Multisig availability on the FCMP++ stressnet (from search summaries only) and the actual mainnet date (none announced as of the sources).
- Whether the 0.18.x backport of monero#11076 shipped (not in 0.18.5.1).
