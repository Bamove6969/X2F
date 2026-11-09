-- Review S-m1 (8 Nov 2026): every "Stay logged in" gives the session a new token. The token before
-- it stays valid only until the end it already had (`prev_token_until`), so a tab whose request
-- still carries it is not logged out by the swap, and a copied cookie dies at the old end.
alter table sessions
  add column prev_token_hash bytea unique,
  add column prev_token_until timestamptz,
  add constraint sessions_prev_token check ((prev_token_hash is null) = (prev_token_until is null));
