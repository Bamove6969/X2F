# Questions for the lawyer (OPEN — unfinished list, keep adding)

Started 2026-10-29 by the lead. Each item: the question, why it matters, the lead's recommendation.
Mark an item DONE with the lawyer's answer and the date once asked.

## 1. Warrant canary — OPEN
- Question: Is a warrant canary legal where X2F is registered (and where staff live)? If we receive a
  secret order with a gag clause, is stopping the canary treated as breaking the gag?
- Background: a monthly signed note "As of <date>, X2F has NOT received any secret government
  orders". If an order comes, we stop posting it instead of saying anything. Some countries have
  banned canaries for some orders (e.g. Australia); elsewhere it is untested in court.
- Also ask: must it be signed by a named person? What happens if we miss a month by accident?
- Lead's recommendation: build it only if the lawyer says it's safe; it's a small task. Until then the
  privacy page states plainly what we hold (30-day trade delete, 90 days for disputes) and that we
  can't move anyone's coins.

## 2. Team members and business / exchange status — OPEN
- Question: If a trader's account can have team members (staff who trade for the account owner), does
  that make the account, or X2F itself, look like a business or an exchange under the law where X2F
  is registered (money transmitter / VASP / exchange rules)? Does it change what X2F must check or keep?
- Background: Claude Design proposed (2026-10-29), for the phase after launch: up to 5 members per
  account, at most 3 logged in at once, each with their own two-factor login; members only work trades
  (chat, mark paid, confirm, release, dispute); only the account owner changes wallets, offers and
  members; partners see "replied by a team member"; one reputation; every member action logged.
  The owner has NOT confirmed the feature yet (spec "Revision 2026-10-29b").
- Also ask: does X2F need different Terms for accounts with members? Is anything required of the
  account owner (business registration) that X2F would have to state or enforce?
- Lead's recommendation: don't build it until the owner confirms and the lawyer answers; if the answer
  is risky, keep one person per account.

## 3. Paying staff in XMR — OPEN
- Question: paying moderators/staff automatically in XMR at the end of each shift (hourly + per-dispute + a % of large-trade revenue, with clawback if a decision is overruled on appeal): employment vs contractor status, payroll/tax reporting, whether clawback from wages is lawful where staff live, and record-keeping duties.
   - UPDATE 2026-10-29 (owner): team members are wanted AT LAUNCH: up to 3 per account, roles Offers and/or Trades, owner audit log, chat labelled "Team <name> member: <member>". Ask the lawyer early, since this is now launch scope.
