-- Plan 3, Task 3: "Suggest a missing method" (spec 2.6, P3-M3). Stored WITHOUT the account that
-- sent it: no account id, no session, no device, and only the day it arrived (not the time), so
-- a row cannot be matched to a session's activity. Only a name and an optional country.
create table method_suggestions (
  id bigserial primary key,
  name text not null check (char_length(name) between 1 and 60),
  country text check (country ~ '^[A-Z]{2}$'),
  created_on date not null
);
