-- Security review 7 Nov 2026, finding 2: a desk record or watch state is saved only over the
-- version it was read at, so a stale moderation process never overwrites a newer process's row.
alter table mod_trade_desk add column version bigint not null default 0;
alter table mod_watch add column version bigint not null default 0;
