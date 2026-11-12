-- P-012 (owner Q47, 6 Nov 2026) and P-013 (owner p9-8, 8 Nov): "Was this proof blurred correctly?"
-- asked of both parties, every proof for the first weeks, then every Nth proof on the site; a No
-- asks for a comment for the feedback readers (apps/api/src/proof/blurCheck.ts).
--
-- Kept to the minimum (the owner's brief): the answer, the comment, the payment method, whether the
-- blur was automatic or manual, the role and the day. Never the image (the API never sees one:
-- proofs are sealed end to end), and an answer names no trade, no proof and no account.
--
-- 1. blur_check_counter: the site's proof count, for "every Nth proof". One row.
create table blur_check_counter (
  id int primary key default 1 check (id = 1),
  proofs bigint not null default 0 check (proofs >= 0)
);
insert into blur_check_counter default values;

-- 2. blur_check_proofs: each announced proof once (the decision is kept, so a repeat answers the
--    same and the per-trade cap can be counted); goes with its trade.
create table blur_check_proofs (
  trade_code text not null references trades (code) on delete cascade,
  proof_id text not null check (proof_id ~ '^[0-9A-HJKMNP-TV-Z]{25}[048CGMRW]$'),
  ask boolean not null,
  primary key (trade_code, proof_id)
);

-- 3. blur_check_asks: a party's unanswered question about one proof; deleted when answered, and
--    goes with its trade.
create table blur_check_asks (
  trade_code text not null,
  proof_id text not null,
  side text not null check (side in ('buyer', 'seller')),
  role text not null check (role in ('uploader', 'receiver')),
  blur text not null check (blur in ('auto', 'manual', 'both', 'none')),
  primary key (trade_code, proof_id, side),
  foreign key (trade_code, proof_id) references blur_check_proofs (trade_code, proof_id) on delete cascade
);

-- 4. blur_check_answers: what the feedback readers see. No trade, proof, account or time of day;
--    the id is random. Deleted after 90 days (BLUR_CHECK_RETENTION_DAYS; lead call, the owner may extend it).
create table blur_check_answers (
  id uuid primary key default gen_random_uuid(),
  answered_on date not null,
  role text not null check (role in ('uploader', 'receiver')),
  correct boolean not null,
  comment text check (char_length(comment) between 1 and 500),
  method_id text not null check (char_length(method_id) between 1 and 64),
  blur text not null check (blur in ('auto', 'manual', 'both', 'none')),
  check (comment is null or not correct)
);
create index blur_check_answers_on on blur_check_answers (answered_on);
