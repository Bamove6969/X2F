-- Plan 3 Task 39 (Revision 2026-10-29b, owner): the seller can never cancel after tapping "Fund
-- escrow". The server learns of the tap from the seller's `fund-started` event (TradeFund posts it
-- when its press-and-hold completes, or when the seller copies the escrow address or amount); from
-- then on the seller's `walk-away` is refused. Null = not tapped (every trade before this
-- migration: their walk-away then still depends on no coins having been seen).
alter table trades add column fund_started_at timestamptz;

-- Owner 2026-10-29 (option B with a seller confirm step): after a buyer's cancel the XMR goes back
-- to the seller at once, and the trade is officially cancelled only when the seller taps "Confirm
-- cancel", which the API accepts once the refund tx has 10 confirmations on X2F's own node.
alter table trades add column cancel_confirmed_at timestamptz;
