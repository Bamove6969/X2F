# The watcher, in plain words (for the owner, 30 Oct 2026)

## What it is
A small program inside X2F's **moderation service** (the separate server that holds the moderator's key, never the main X2F server). Every 15 seconds, for each open trade, it asks a Monero node one question: "how many coins are in this escrow right now, and how many confirmations do they have?" It reports the answer to the trade. That's all it does on its own.

It can't move coins. Moving coins always needs two of the three keys (buyer, seller, moderator).

## Why something has to look at all
- **Monero hides balances.** Unlike Bitcoin, you can't look up an escrow address on a public website and see what's in it. Only a wallet holding the escrow's private *view key* can recognise its coins. So some program with that key has to look.
- **The phones can't be trusted alone.** The buyer's and seller's apps also look when they're open, but each could lie ("I funded!", "nothing arrived!"), and both are often closed.

## What it's used for in a trade
1. **"Seller funded" starts the buyer's clock.** The buyer's payment deadline starts when the coins really arrived and confirmed, not when the seller says so.
2. **No-show refunds.** If the buyer vanishes after funding, the seller gets the coins back automatically (moderator key + seller). That needs a trustworthy "yes, the coins are there" without the buyer.
3. **Lapsed trades.** If the seller never funds, the trade ends. That needs a trustworthy "nothing arrived".
4. **Knowing a payout happened.** When coins leave the escrow, the trade can be marked finished.
5. **Odd cases.** Coins sent twice, or arriving after a trade closed, get flagged to a moderator instead of sitting forgotten. Under your new surplus rule, this is how the extra is noticed at all.

## What it does NOT do
- It doesn't see who the buyer or seller are, any bank details, or anyone's other wallets. Only this one escrow.
- It doesn't decide disputes; people do.
- It doesn't hold anyone's coins.

## What it costs in privacy
The moderation service holds each escrow's view key while the trade is open (plus 30 days after, to catch late coins). That lets it see the amounts in that escrow. It already needs that key to co-sign as the third party, so the watcher adds no new key.

## The alternatives, honestly
- **A. No watcher; trust the phones.** Cheaper, but a cheater can lie about funding, and auto-refunds can't work when the buyer is gone. Not recommended.
- **B. Watcher as built (current plan).** Always on, independent of both sides, can't move coins.
- **C. Lighter watcher.** Only look at key moments (setup, deadline, payout) instead of every 15 s. Same powers, less constant activity; slower to notice late or extra coins. Possible if you prefer it.
- **D. Watcher only when there's a problem.** Look only when a phone reports trouble or a deadline passes. Lowest footprint, but misses things nobody reports (late coins, stranded extra).

Lead recommendation: B (or C if you prefer less constant activity). Your call.

## Known trade-off already written down
A person who simply goes silent can push an honest trade into a 6-hour moderator review instead of finishing on its own. No coins at risk; only a delay. A later task would close those reviews automatically once the escrow is empty.
