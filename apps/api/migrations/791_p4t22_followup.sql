-- Review p4t22 residual (a) (23 Nov follow-up): the moderation process signs an after-refund
-- statement for every decided after-refund round, whatever its outcome ("decided, nothing to
-- send" for `no-action` and `seller-returns-fiat`), so a round 2 that overrules round 1 is a
-- signed fact and not just an absence. Such a round closes its dispute at once, so the
-- moderation process's list of after-refund disputes to sign also takes the ones closed in the
-- last 7 days whose ruling has no statement yet: it reads when a dispute closed and which rulings
-- already have one (ids only; the statement and its signature stay unread by it).
grant select (closed_at) on disputes to x2f_mod_reader;
grant select (ruling_id) on after_refund_statements to x2f_mod_reader;
