-- Plan 4, Task 28 (owner, 2026-10-29; spec 6.6 "News"): the News inbox, messages from X2F shown at
-- login, newest first, each with the date it was posted. Anyone can read them, logged in or not.
--
-- Nothing per reader is stored here: whether a message is new or already seen is kept on the
-- reader's device (the newest message id it has shown), never on the server (lead, 2026-10-29).
--
-- `id` only ever counts up, and `published_at` is the server time at insert and never changes, so
-- "newer than the last one this device showed" is simply a higher id. Editing a message sets
-- `edited_at` and does not make it new again.
create table news (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  published_at timestamptz not null,
  edited_at timestamptz,
  check (edited_at is null or edited_at >= published_at)
);

create index news_newest on news (published_at desc, id desc);
