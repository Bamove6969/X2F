-- Owner, 8 Nov: a chat is erased 30 days after an undisputed trade closes and 90 days after a
-- dispute closes, never while a dispute is open. The purge's final check runs as x2f_purge (104),
-- so it needs to see which disputes are still open: these two columns and nothing else.
grant select (code, status) on disputes to x2f_purge;
