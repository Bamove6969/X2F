-- Owner 26 Nov 2026 ("Away" switch): a trader can say they are away from Settings. Turning it on
-- pauses every live offer of the account and marks the ones it paused; turning it off puts back
-- only those, each through the relist checks (offers/routes.ts switchOfferStatus). The public
-- profile shows "Away" while `away_since` is set.
alter table accounts add column away_since timestamptz;

-- True only on an offer the Away switch paused. Any other change of the offer's status clears it,
-- so a later "off" never turns on an offer the trader paused or relisted by hand.
alter table offers add column paused_by_away boolean not null default false;
