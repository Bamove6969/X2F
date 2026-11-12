# Payment-method verification brief (X2F)

X2F is a non-custodial, phone-first P2P marketplace for trading Monero (XMR) for fiat. Buyers pay sellers directly with an ordinary payment method (bank transfer, payment app, cash...). The catalog `data/payment-methods.json` lists the methods offered; every entry is `verified: false`. Your job: verify YOUR assigned entries against primary sources. RESEARCH ONLY.

## For each assigned entry, find and record
1. **Status**: operating / renamed / merged / discontinued / restricted (date + source).
2. **Official site** URL (the provider or the scheme operator / central bank, not a blog).
3. **Where it works**: countries and currencies it actually serves (from the official site).
4. **Transfer characteristics** relevant to a seller confirming a fiat payment: typical arrival time; whether the sender can reverse / charge back / dispute after sending, and for how long (this is the main scam risk in P2P trading); per-transfer limits if published.
5. **Crypto stance**: does the provider's terms of service or acceptable-use policy prohibit or restrict using it to buy/sell cryptocurrency? Quote the clause briefly (≤ 15 words) with URL. If you can't find a clause, say "no clause found" — do not guess.
6. **Legal / sanctions flags**: sanctions exposure (e.g. Russian systems), licensing issues, or anything a lawyer should see. Flag; do not conclude.
7. **Name check**: is the catalog `name` the current official name? Suggest a correction if not.
8. **Verdict**: one of `verified` (operating, facts confirmed from primary sources), `verified-with-flags` (operating but with a crypto-ban clause, high reversal risk, or legal flag), `outdated` (renamed/merged — give replacement), `discontinued`, `unclear` (couldn't confirm from primary sources).

## Rules
- Use WebSearch / WebFetch. Prefer official provider pages, scheme operators and central banks. Every factual claim gets a source URL. Mark anything you inferred as **(inferred)**.
- Do not copy large text from sources; summarise. One short quote per entry at most.
- Generic entries (e.g. "National bank transfer", "Cash in person") have no single provider: describe the general reversal risk and note "generic — no provider to verify".
- Do NOT edit `data/payment-methods.json` or any other file except your own output file.
- Today is 2026-10-21. Note the date you checked.

## Output
Write `research/payment-methods/<your-region>.md` in your worktree:
- A summary table: id | name | verdict | reversal risk (low/medium/high) | crypto clause (yes/no/unknown) | one-line note
- Then one section per entry with the 8 items above and sources.
- End with "Proposed catalog changes" (renames, removals, new legalReview flags) — proposals only.

## Git (binding rule R30)
In your worktree, commit your file as soon as you have a first draft and again when done, and push your branch each time:
`env GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git -c user.name=flem -c user.email=bamove@gmail.com commit -m "<msg>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` then `git push -u origin HEAD`.
Never push to any other branch, never force-push, never touch ~/x2f (the lead's checkout).

## Report back
Reply with: counts per verdict, the entries with crypto-ban clauses or high reversal risk, anything needing a lawyer, and the branch + commit you pushed.
