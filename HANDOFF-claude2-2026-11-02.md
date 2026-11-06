# Handoff for claude2, written 2026-11-02 before the full context clear

Account bnkxfers@gmail.com, repo ~/x2f, worktrees in ~/x2f-worktrees/. **Report only to the lead**
(~/x2f-comms/to-lead.log), read the lead from ~/x2f-comms/to-second.log. Brief every helper with
~/x2f-comms/helper-common.md plus "commit WIP early, push every commit". Max helpers: whatever the lead
says (last: up to 3). Run `free -m` first and stay above ~1.5 GB available.

**Owner rules:**
- (1 Nov) Finish what's started. No new tasks without the lead's go. Every product, security, copy or limits
  choice goes to the lead as a question with options and a recommendation. Purely technical choices
  (merges, test fixes, code structure) are ours.
- Never push to the main line (origin/claude/compassionate-johnson-k95ssr). Timestamps only from
  `date '+%F %T'`.
- Commit identity: `git -c user.name=flem -c user.email=bamove@gmail.com commit`. The message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01MytcQsLRXpcE7MbnNn6QK7`.

**Main line at handoff: b6835ee.**

## Branches I own

All are pushed, with clean trees (checked at handoff).

| Branch | Head | Worktree | State |
|---|---|---|---|
| wip/second-design-offers-v2 | 879b12e | second-design-offers-v2 | **BUILDING (C2-V3)**: tokens only so far (same hunks as loginapprove-v2); no screen restyled; no tests run; npm ci done; helper stopped cleanly |
| wip/second-design-loginapprove-v2 | 3e9a906 | second-design-la-v2 | **IN REVIEW** (lead review running); ready to land; contains main 5bfb450 |
| wip/second-api-cap-dispute | 83f814f | second-api-cap | **IN REVIEW**; ready to land; on main 5bfb450 |
| wip/second-design-selection | 22a36eb | second-design-selection | **IN REVIEW**; contains main 5bfb450; tests NOT rerun after that merge |
| wip/second-p3-task34 | be19e5e | second-t34 | **WAITING ON OWNER/LEAD**: lands last; multi-currency design note + owner decisions |
| wip/second-docs-1030-answers | e286489 | second-docs1030 | **WAITING ON OWNER** docs pass; contains main 52b7a0e |
| wip/second-p3-task9-io | 7346fc0 | second-t9io | **OWNER HOLD** (watcher idea); held landing is on wip/lead-land-t9io-held |
| wip/second-p3-task9-view | 99ba09f | second-t9view (local branch name w2-t9view) | **OWNER HOLD** |
| wip/second-p3-task10 | 305124b | second-t10 | **OWNER HOLD**; round 4 APPROVED WITH MINOR; follow-up R4-M1/M2 after the hold lifts (new branch from main) |
| wip/second-design-devices | 4e65c4c | second-design-devices | LANDED (main 850052d) |
| wip/second-fix-myoffers-flake | 30b1794 | second-flake | LANDED (d77134d) |
| wip/second-p2-fud | 0c2f679 | second-fud | LANDED |
| wip/landing-p2-task18 | lead's | second-land-t18 | lead took it over and LANDED Task 18: **don't touch** |

Not mine; don't touch: lead-p7-retention (the lead took over HH2).

## Mid-flight: C2-V3, the offers screens on design v2 batch 3

The lead asked at 07:04 on 2 Nov:
- Restyle Main, BuyMain, BuyOffers, SellOffers, BuyQuote and PostOffer to the boards on origin/wip/design-brief
  (@84aceaa9 or later; it was d9ccbb96).
- Use the shared kit and tokens only. Visuals only, no behaviour change. Not My offers.
- Branch wip/second-design-offers-v2 from main b6835ee. Red tests where testable, then reshoot.

**Next step:**
1. Read the branch log and the helper's status (if it arrived it is appended below).
2. Finish the remaining screens.
3. Run the checks: tsc web; full web vitest; copy-lint; Playwright browse-buy, browse-sell, quote, post, shell,
   parity.
4. Reshoot with X2F_DESIGN_SHOTS=1 and X2F_DESIGN_SHOTS_DATE=2026-11-02-offers-v2.
5. Report the head to the lead.

**Do not build** the PostOffer currency multi-select (d9ccbb96). It is Task 34 multi-currency, which waits on
the lead.

**Token names:** keep them identical to the loginapprove-v2 branch so the two merge cleanly: radius-lg 16,
space-3/5/8, sheet-title 24/30 700, screen-title 28/32 700.

## Open questions waiting on the lead or owner

The numbering follows my to-lead.log reports.

**LoginApprove v2 (3e9a906):**
- Q1: link hover colour. The v2 boards use ink; the monero-ink-hover token is orange. Recommendation: decide
  with batch 2.
- Q2: disabled buttons and sheet titles now look v2 app-wide. Recommendation: keep it global.
- Q3: close two spacing gaps (sheet part gap 8→20; desktop dialog buttons 56→48). Recommendation: yes, as a
  follow-up.
- Q4: the merged kit Notice's caution tone is now the v2 callout (30% border + wash), and it also shows on My
  offers' hold notice. I changed the My offers e2e probe to match. Recommendation: one look app-wide.

**C2-A1 cap/dispute (83f814f):**
- Q1: hold end time is not built. Who sets it, default length, where it's exposed, which end to show with
  several holds, what users see. Recommendation: Plan 4 adds a nullable ends_at; expose it in
  /v1/account/me; show the latest end.
- Q2: sign off the cap copy: "You can have 3 buying and 3 selling offers." plus the existing "Remove one…"
  sentences; the row line "Stayed off: over the offer limit."
- Q3: the web shows a fixed "3" while the owner setting can change it. Recommendation: keep it fixed until
  Plan 4 Settings.
- Q4: the 30 min wait after paid does not pause during maintenance. Recommendation: leave it.
- Q5: My offers' footnote "Each offer can cover several currencies." is untrue until Task 34.

**Selection (22a36eb):**
- Q1: XMR unit colour. The review says ink-muted; the boards and tokens say orange. Recommendation: orange
  until design settles it.
- Q2: should the Buy/Sell segment tabs get the 2px ink border?

**Devices (landed; the lead sent Q1–Q7 to owner/design):**
- The team card when nobody is logged in.
- The "unless you switch them off" sentence.
- "2 of 1 devices".
- The "Back to log in" label on "You're in".
- The session-length clause in the intro.

**Task 34 multi-currency:** see the owner answers below. The lead is still reviewing the remaining points.

## Owner answers collected (2 Nov night, directly with me)

None of these are in code yet. They are recorded in docs/superpowers/specs/2026-11-02-task34-multi-currency.md on
wip/second-p3-task34, section "Owner decisions (2026-11-02)".
- **Amount bands:** the vendor types them per currency, with NO conversion (option B). There is no base
  currency.
- **Methods:** every method we can find is listed. Each vendor picks their methods and currencies. Buyers filter
  first (currency + method).
- **Payment instructions:** per payment type AND currency where they differ (bank USD account+routing / EUR
  IBAN / GBP sort code). Most methods have one shared set. (Lead review, 07:08.)
- **Pricing:** market + X% only; no fixed-price offers (unless feedback changes it).
- **No market price:** a currency with no market price is hidden for that currency only.
- **Rounding:** none.
- **Bands:** contiguous, with no overlaps and no gaps (200–400 then 401–600). My note: in minor units the next
  band starts one cent later; to be confirmed.
- **Currencies per offer:** max 5.
- **No USD price:** the trade is refused, with a popup (CantDoThat family) explaining it may be temporary.
  Several price feeds may be needed.
- **Signed rate:** the rate is in the signed terms; deal.centsPerXmr already signs it.
- **Owner's request:** the lead reviews ALL of these and raises disagreements with the owner. Build waits for
  that review.
- **Earlier owner/lead decisions:**
  - Ad cap 3 buy + 3 sell, built on 83f814f.
  - Buyer may dispute 30 min after paid, built on 83f814f.
  - Task 34 must later become multi-currency + multi-method per ad, with the cap counted per side.

## Test caveats

- **run-check.sh** logs `exit=0` even when `npm test` fails, and stops before audit/semgrep. Read the log;
  run audit and semgrep separately.
- **Flakes seen under full-suite load:**
  - apps/api password.test.ts "Argon2 slots full 503" (passes alone).
  - setup.spec.ts:733 "Terms that move to a NEW version" (passes alone).
  - attestation-flow.test.ts:283 (claude3 owns it).
- **npm audit:** 7 advisories (1 high, follow-redirects), from main's lockfile. Noted, not fixed.
- **Memory:** one test command at a time under ~/x2f-comms/check.lock; never nest flock; full checks use
  full.lock.
- **Selection branch:** it needs tsc + full web vitest + Playwright rerun after its 5bfb450 merge (22a36eb).

## Helpers that may still be running

- None. ab291a7763e25493b (C2-V3) stopped cleanly at 879b12e. Restart the remaining work fresh from the branch.

## C2-V3 helper's final status (stopped at 879b12e, nothing lost)

- **Code locations:**
  - Main and BuyMain: apps/web/src/screens/browse/MethodList.tsx.
  - Offer lists: OfferList.tsx and OfferCard.tsx, styled in browse.css.
  - BuyQuote: screens/quote/Quote.tsx, quote.css and WalletPicker.tsx (the seller quote shares them).
  - PostOffer: screens/PostOffer.tsx and post/PostOffer.css.
- **Wide boards:** none of the six boards has one.
- **Board vs app, seen so far:**
  - Main/BuyMain:
    - a new "Market price" card with a currency select (the app has currency chips);
    - 40px method icon tiles;
    - the price split into a right-hand column;
    - section counts;
    - method rows grouped in one card.
  - Offer lists:
    - 28px screen title;
    - back button on its own row;
    - a raised Market price block;
    - cards with radius 16 and padding 20.
  - BuyQuote:
    - "You receive" above the wallet picker;
    - a Chat pill;
    - an info box "Nothing changes after you tap Trade…";
    - the wallet picked shown in ink.
  - PostOffer:
    - sections as cards with capital labels;
    - "Your price" and "Who can trade with you" headings;
    - a "How others will see it" preview;
    - a Currencies multi-select, which is NOT built (Task 34).
- **Likely questions or not-built items (to confirm):**
  - the Market price card plus its line, and chips becoming a select (that changes the control);
  - method icon tiles (needs an icon per method group);
  - section counts;
  - the quote info box and the PostOffer preview, if the app doesn't already have them;
  - the currency multi-select.
- **Next step:**
  1. Add design-shot tests numbered 66+ for /sell, /buy, /sell/ZELLE, /buy/ZELLE, the buy and seller quotes,
     and /post. Copy the setup from browse-buy, quote and post specs.
  2. Shoot the app as it is now and compare with the boards.
  3. Write red vitest tests: 44px targets, ink selection on chips, the wallet radio and the side toggle,
     radius 16, the screen-title class.
  4. Restyle through CSS and kit classes only. Keep every word as it is (the parity check needs the old
     boards' text).
  5. Run the checks one at a time, then reshoot into docs/design-screens/2026-11-02-offers-v2/.
