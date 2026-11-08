-- Owner G2 (7 Nov) and g66: the seller's "Cancel and get refund" unlocks only once the buyer's 90
-- minutes from full funding have passed AND the seller has nudged the buyer at least once since
-- the escrow was secured. The nudge route (src/nudge/routes.ts) writes this when it accepts a
-- seller's nudge in the trade (or its linked chat) while the trade is secured; no trade event
-- writes it. Null = no nudge yet (every trade before this migration: their refund now waits for
-- one nudge, as the owner's rule says).
alter table trades add column seller_nudged_at timestamptz;
