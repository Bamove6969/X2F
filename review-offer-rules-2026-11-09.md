# Review: wip/lead-offer-rules (price gap 3%, offer cap 3 + 3), 9 Nov 2026

- **Reviewer:** independent reviewer (cloud lead), read-only on the code. No code changed, no commit.
- **Branch:** `wip/lead-offer-rules`, worktree /home/user/X2F/.claude/worktrees/offer-rules, clean, head **738f02ee**. It is two commits on origin/main `0c6f3f16`:
  - `ac97ac44`: price feed `maxSpreadBps` 500 -> 300 (owner Q7).
  - `738f02ee`: offer cap of 3 buying + 3 selling per account (owner Q31).
- **Owner rulings under test** (owner-decisions-2026-11-06.md:8-9; his words in owner-answers-page-2026-11-06.md:37-40 and :166-169):
  - Q7: "max source gap 3%". The question he answered was "If two price sources disagree, how big a gap is allowed before X2F shows no price for that currency?" His answer: "3%".
  - Q31: "exactly 3 + 3; a seventh can't be posted, no on-hold seventh". His words: "If you're saying they can write a seventh offer that's on hold, no, it's a bad idea. They can just write the six."

## Verdict: APPROVED WITH MINOR

- **The cap code is correct.** Posting, relisting and the bulk switch count the same way. A paused offer counts and a removed one does not. Two posts at once cannot race past the cap, and the owner-settings override works for each side on its own.
- **The 3% change does what its commit says.** Whether "3%" means "from the median" or "between any two sources" is an owner question (below). It is not a code fault.
- **No finding above Minor.** There are three Minors (stale cap docs that a future task would follow, legacy over-cap accounts, the copy saying "market") and one owner question.

## Tests run (serialised runner)

- `apps/api/test/offers.test.ts`: **33/33 pass**.
- `apps/api/test/offersBulk.test.ts`: **17/17 pass**.
- `apps/api/test/price.test.ts`: **43/43 pass**.
- Not run: web tests (the only web change is a comment in `myoffers/model.ts`), and Playwright.

## Offer cap (738f02ee)

### Every path counts the same way
- **Defaults and keys:** `OFFER_CAP_DEFAULTS = { buy: 3, sell: 3 }` and `OFFER_CAP_KEYS = { buy: 'offers_max_buy', sell: 'offers_max_sell' }` (apps/api/src/offers/routes.ts:138-139).
- **Post** (routes.ts:469) and **relist** (`PATCH` to live, routes.ts:523) both go through `assertMayPost` (routes.ts:311-329). It counts `account_id = me and side = $side and status <> 'removed'`, leaving out the offer being relisted (`except`), and refuses with 409 `too-many-offers` when the count is `>= caps[side]`. Method and currency play no part any more.
- **Bulk switch** (`POST /v1/account/offers/status`, routes.ts:688-718) loads every non-removed offer of the account under `for update` (routes.ts:694). For each offer it is turning on, it counts the *other* offers on the same side, live or paused (routes.ts:717), against `caps[o.side]` (routes.ts:718). That is the same count as relisting.
  - Because paused offers are already in the count, turning several on in one call never changes the count part-way. The result for each offer does not depend on the order in the list.
- **Turning off and removing** run no cap check (routes.ts:530), which is right: they can only lower the count.
- **Only one code path inserts offers** (`insert into offers`, routes.ts:471). There is no seed, staff or admin path around the check.

### A paused 4th is refused, and so is any seventh
- Posting always inserts `status 'live'` (routes.ts:473). There is no way to post straight into paused, so "no on-hold seventh" holds.
- A paused offer stays in the count, so pausing one of three and posting a 4th gives 409. Tested at offers.test.ts:444 (pause, then post NZD -> 409).
- Six offers (3 + 3, over three currencies and two sides) are allowed and the seventh on either side is refused. Tested at offers.test.ts:461 (`count = 6`, then 409 for each side).

### Removed offers are left out
- `status <> 'removed'` in `assertMayPost` and in the bulk load. A removed offer cannot be relisted (`PATCH` gives 404 for a removed row, routes.ts:504-505), so it cannot come back past the cap either. Tested at offers.test.ts:444 (remove, then a new post succeeds, then the next one is 409 again).

### Races: two posts at once
- `assertMayPost` takes `lockAccountLive` first: `select 1 from accounts where id = $1 for update` (routes.ts:336-337, :344-347). It then counts and inserts in the same transaction.
- `inTransaction` is a plain `begin`, so READ COMMITTED. A second post by the same account waits on the account row. Once it gets the lock, its count statement takes a fresh snapshot and sees the first post's committed row. The bulk switch and relisting take the same lock (routes.ts:688, via `assertMayPost`).
- So two posts, or a post and a turn-on, cannot both see "2 others". By reading the code this is sound.
- No test fires two posts at once. This is optional, and not a finding, because the lock is the same one Task 4's review already accepted for the old cap.

### The owner-settings override
- `loadOfferCaps` (routes.ts:288-297) reads `offers_max_buy` and `offers_max_sell` from `owner_settings` on every check, inside the transaction. A value that is not an integer from 1 to 1000 falls back to the default of 3, so a bad row cannot open the cap or shut every account to 0.
- Each side is overridden on its own. Tested at offers.test.ts:461 (`offers_max_sell = 1` leaves buying at 3, and `offers_max_buy = 2` leaves selling alone) and at offersBulk.test.ts:208.
- No API or screen writes these keys yet: Plan 4's Settings screen will. docs/coordination.md:354 now names the new keys and defaults for it.
- The old keys `offers_max_per_market` and `offers_max_total` are in no migration (grep), so no database holds a row that would now be silently ignored. If one was set by hand somewhere, it no longer has any effect.
- Lowering a cap below an account's current count takes nothing down. It only blocks new posts, relists and turn-ons on that side. That is consistent with the "no seventh" rule.

### Findings

**C1 (Minor, docs that a future task would follow): the spec and Plan 3 still give the old cap rule.**
- docs/superpowers/specs/2026-10-14-x2f-design.md:193 says "Cap: 2 offers per side (buy or sell) per currency, and 20 in total". Its popup copy on line 194 says the same.
- docs/superpowers/plans/2026-10-15-plan-3-trading.md:361, :1082 and :1121 tell **Task 34** to change the count to "(side, currency)" and the default `offers_max_per_market` to 2. Its Step 1 tests (:1122) expect "the 21st offer -> too-many-offers".
- A Task 34 builder following the plan would undo Q31. The price commit updated the spec for Q7 (design.md, decision 11.6); this commit did not update the spec or the plan for Q31.
- **Fix:** update both, citing Q31 and O-025: 3 buying + 3 selling per account across every method and currency, paused counted, no seventh. Add a line in Plan 3 Task 34 saying the cap is not to be changed there.

**C2 (Minor, lead/owner check): accounts already over the new cap keep their offers.**
- Under the old cap an account could hold up to 20 offers (3 per side, method and currency). No migration touches them. Such an account keeps all its live offers listed. It cannot relist or turn on any paused one on that side until it is under 3, and it cannot post on that side.
- **If there is no production data yet** (pre-launch), there is nothing to do; please confirm.
- **If there is,** the owner's "exactly 3 + 3" would need a decision: leave existing offers live until they are removed, or pause the newest above 3 on each side. That is an owner call; I recommend leaving them live.

**C3 (Minor, copy, for the owner's copy page): the My offers refusal still talks about a "market".** With the cap now per side for the whole account, these strings are wrong. All are already marked `COPY-UNSIGNED`. The builder's "two strings" are the two functions; there are three lines in all:
1. apps/web/src/ui/cantDoCodes.ts:327 (`myOffersCantDoText`, one offer): "You have more offers in this market than the limit allows now. Remove one you no longer need, then turn this one on."
2. apps/web/src/ui/cantDoCodes.ts:328 (`myOffersCantDoText`, several): "You have more offers in some markets than the limit allows now. Remove ones you no longer need, then turn these on."
3. apps/web/src/ui/cantDoCodes.ts:339 (`myOffersCantDoRow`, the line under each offer): "Stayed off: over the offer limit for this market."

Suggested direction (the wording is the owner's): "You already have 3 buying (or selling) offers, on or off. Remove one you no longer need, then turn this one on." and "Stayed off: you have 3 offers on this side already."
- The Post offer refusal (cantDoCodes.ts:272: "You have as many offers as you can post for now. ...") does not say "market" and is still accurate.
- The My offers footnote (`FOOTNOTE`, myoffers/model.ts:146) already says "You can have 3 buying and 3 selling offers."

## Price gap 3% (ac97ac44)

### What the code does
- `PRICE_FEED_DEFAULTS.maxSpreadBps` 500 -> 300 (apps/api/src/price/feed.ts:46). `pairSpreadBps` stays 200. main.ts:67 uses the defaults, and nothing else overrides them.
- **Rule per poll and currency** (feed.ts:208-219):
  - Take the median of the sources that answered.
  - A source counts when `|source - median| <= spread × median`.
  - With three or more sources answering, the spread is 3%. With exactly two, it is 2%, and with two the median is their mean.
  - At least 2 sources must count (`minSources`), or the currency has no price. The price published is always the median of every source that answered.
- **Tests:**
  - price.test.ts:197 pins the 3% edge with three sources: 35030 against a median of 34010 counts; 3.5% does not.
  - price.test.ts:177 keeps the two-source rule: 3% apart gives a price, 6% apart gives none.
  - The spec (design.md, decision 6 in section 11) now states the rule.

### Owner question O1: does "3% gap" mean 3% from the median, or 3% between sources?

The builder asked; I state the maths and do not decide. The owner's question was worded as a gap *between two sources* ("If two price sources disagree, how big a gap is allowed...").

**As built ("within 3% of the median"):**
- **Three sources:** each counting source may be up to 3% above or below the middle one. So two counting sources can be up to **about 6%** apart and X2F still shows a price.
  - Example: 100, 103, 106. The median is 103. 100 is 2.9% below it and 106 is 2.9% above it, so all three count and the price is 103. The outer two are 6% apart.
- **Two sources** (one source down): each may be up to 2% from their average. So the two may be up to **about 4%** apart and X2F still shows a price. That is the average of the two.
  - Example: 98 and 102. The average is 100 and each is 2% from it, so the price is 100, with the two 4% apart. At 3.5% apart there is still a price.
  - Today, then, "two sources more than 3% apart" does **not** always mean "no price".

**The other reading ("no two counting sources more than 3% apart"):**
- **Two sources:** a price only when they are at most 3% apart. In code that is `pairSpreadBps` 150 (1.5% each side of their average).
- **Three sources:** keep the sources that lie within one 3% band (highest minus lowest at most 3%), and need at least 2 of them. For example, 100 and 102.5 count and 106 does not: there is a price from the two that agree. 100, 103 and 106 would have to drop one end.
  - Roughly, this is "within 1.5% of the median" when the sources sit evenly around it. It needs a few more lines of code than today's rule.

**What changes for users:** the stricter reading means more minutes with no price, and so more market-priced offers paused. The looser reading (as built) means a price can rest on sources that differ by up to 6% (three sources) or 4% (two).
- With three sources the median protects against one wrong source either way: it moves the published price by at most the gap to the next source.
- With two sources the price is their average, so a single wrong source moves it by half the gap. That is at most 2% as built, or 1.5% under the stricter reading.

**Recommendation for the owner to confirm, not a decision:** "3% between any two sources that count", because that is how the question was put to him. That means `pairSpreadBps` 150 and a band rule for three or more. If he means "3% from the middle price", the code is already right as it is.

## Merge note (not a finding)
- `wip/lead-front-door` moves `GET /v1/offers` behind `requireInside` and changes `assertTermsCurrent(deps, req.auth!)` in the same file (offers/routes.ts). Expect a mechanical conflict in routes.ts around the PATCH and GET handlers. The cap lines do not overlap it.
